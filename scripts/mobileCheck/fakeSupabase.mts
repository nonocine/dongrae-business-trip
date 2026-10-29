// 화면 점검용 가짜 Supabase(PostgREST·Storage 흉내) — 운영 DB 대신 앱이 이쪽을 봅니다.
//   * 표·칸 정보는 db-schema.json(운영 REST 의 OpenAPI 명세에서 칸 이름·형식만 뽑은 스냅샷,
//     데이터 없음)을 씁니다. 행은 칸 이름·형식으로 지어낸 가짜 값 — 일부러 길게 만들어
//     좁은 화면에서 넘치는 곳이 드러나게 합니다.
//   * 쓰기(POST·PATCH·DELETE)는 아무 데도 저장하지 않고 writes 에 기록만 합니다.
//     화면을 여는 것만으로 쓰기가 생기면 점검 결과에 함께 나옵니다.
import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";

type Col = { type?: string; enum?: string[]; fk?: [string, string]; items?: string };
type Schema = Record<string, Record<string, Col>>;
type Row = Record<string, unknown>;

export const BOSS_ID = "00000000-0000-4000-8000-0000000000b0";
export const BOSS_NAME = "테스트관장";

const LONG = "가나다라마바사 긴 텍스트 예시 1234567890";
const SENTENCE =
  "좁은 화면에서 줄바꿈이 제대로 되는지 보려고 일부러 길게 쓴 가짜 문장입니다. 띄어쓰기없이아주길게이어지는단어도하나넣어둡니다";

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

// 칸 이름·형식으로 그럴듯한 값 — 틀려도 화면은 그려지게 무난한 값을 고릅니다.
function fakeValue(table: string, col: string, c: Col | undefined, i: number): unknown {
  const t = (c?.type ?? "text").toLowerCase();
  const n = col.toLowerCase();
  if (c?.enum?.length) return c.enum[0];
  if (t === "uuid") return n === "id" ? uuid(i + 1) : uuid(i + 1);
  if (t === "boolean") return /^(is_active|active|enabled|is_open|published|is_published)$/.test(n);
  if (/int|numeric|double|real|float|bigint|smallint/.test(t)) {
    if (/year/.test(n)) return 2026;
    if (/month/.test(n)) return 10;
    if (/(sort|order|seq|position|step|grade|level|rank|round|week|day|no)$/.test(n)) return i + 1;
    if (/(count|cnt|num|people|persons|hours|minutes|days|times)/.test(n)) return 12 + i;
    return 12345678 + i;
  }
  if (t === "date") return "2026-10-27";
  if (/timestamp/.test(t)) return "2026-10-27T05:00:00+00:00";
  if (/^time/.test(t)) return "09:00:00";
  // 학력·경력처럼 이름이 s 로 끝나지 않는 목록 칸도 배열로(객체면 지원자 화면이 형식 오류로 멈춤).
  if (t === "json" || t === "jsonb") return /s$|list|items|history|files|logs|education|career/.test(n) ? [] : {};
  if (t === "array") return c?.items === "string" ? ["가나다 항목", "긴 항목 예시 1234"] : [];
  // text
  if (n === "rank") return "팀원";
  if (n === "ym" || /_ym$/.test(n)) return "2026-10";
  if (/(^|_)(date|on|day)$/.test(n)) return "2026-10-27";
  if (/(^|_)year$/.test(n)) return "2026";
  if (/email/.test(n)) return "very.long.address.for.layout.check@dongrae-youth.example.kr";
  if (/(phone|tel|mobile|fax)/.test(n)) return "010-1234-5678";
  if (/(url|link|href|homepage|website)/.test(n)) return "https://www.example.com/very/long/path/for/layout/check?query=1234567890abcdef";
  if (/(path|storage_key|object|file_key)$/.test(n)) return `test/${table}/${i}.pdf`;
  if (/(mime|content_type)/.test(n)) return "application/pdf";
  // slug 는 운영 DB 에서 unique — 줄마다 다르게(같으면 목록 key 중복 경고가 거짓으로 뜸). 화면 경로의 eq 조건은 forced 로 덮임.
  if (/(slug)/.test(n)) return `2026-${i + 1}`;
  if (/(status|state|type|kind|category|role|scope|channel|key|code|level|source|mode|gender|method|unit)$/.test(n))
    return "etc";
  if (/(memo|note|body|content|description|reason|comment|detail|summary|text|message|address|remarks)/.test(n))
    return SENTENCE;
  if (/(name|title|label|subject)/.test(n)) return `${LONG} ${i + 1}`;
  return LONG;
}

// select=a,b,rel(c,d),alias:rel!hint(e) → [{name, alias, sub?}]
type Sel = { name: string; alias: string; sub?: Sel[] };
function parseSelect(s: string): Sel[] {
  const out: Sel[] = [];
  let depth = 0;
  let cur = "";
  const parts: string[] = [];
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  for (let p of parts) {
    p = p.trim();
    if (!p) continue;
    const paren = p.indexOf("(");
    let head = paren >= 0 ? p.slice(0, paren) : p;
    const inner = paren >= 0 ? p.slice(paren + 1, p.lastIndexOf(")")) : undefined;
    let alias = "";
    if (head.includes(":") && !head.includes("::")) [alias, head] = head.split(":");
    head = head.split("::")[0].split("!")[0].trim().replace(/^\.\.\./, "");
    out.push({ name: head, alias: (alias || head).trim(), sub: inner !== undefined ? parseSelect(inner) : undefined });
  }
  return out;
}

export function startFakeSupabase(port: number, schemaPath: string) {
  const schema: Schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const writes: string[] = [];

  function makeRow(table: string, sel: Sel[] | null, i: number, forced: Row): Row {
    const cols = schema[table] ?? {};
    const row: Row = {};
    const wanted = sel && !(sel.length === 1 && sel[0].name === "*") ? sel : null;
    const plain = wanted ? wanted.filter((s) => !s.sub && s.name !== "*") : Object.keys(cols).map((k) => ({ name: k, alias: k }));
    if (wanted?.some((s) => s.name === "*")) for (const k of Object.keys(cols)) row[k] = fakeValue(table, k, cols[k], i);
    for (const s of plain) row[s.alias] = fakeValue(table, s.name, cols[s.name], i);
    for (const s of wanted?.filter((x) => x.sub) ?? []) {
      const rel = s.name;
      if (!schema[rel]) {
        row[s.alias] = null;
        continue;
      }
      // 자식 표가 이 표를 가리키면(1:N) 배열, 아니면(N:1) 객체.
      const childPointsHere = Object.values(schema[rel]).some((c) => c.fk?.[0] === table);
      const one = makeRow(rel, s.sub!, i, {});
      row[s.alias] = childPointsHere ? [one] : one;
    }
    Object.assign(row, forced);
    return overrides(table, row, i);
  }

  // 로그인한 가짜 관장이 모든 화면에 들어가도록 필요한 값만 고정합니다.
  function overrides(table: string, row: Row, i: number): Row {
    if (table === "drivers") {
      if (row.id === BOSS_ID || row.name === BOSS_NAME) Object.assign(row, { id: BOSS_ID, name: BOSS_NAME, rank: "관장" });
      if ("is_active" in row) row.is_active = true;
      if ("must_change_password" in row) row.must_change_password = false;
    }
    if (table === "employee_profiles" && "auth_level" in row) row.auth_level = "M0";
    if ("must_change_password" in row) row.must_change_password = false;
    // 활동은 본인 작성분만 열립니다(getActivity) — 작성자를 가짜 관장으로, 종류는 실제 값 중 하나로.
    if (table === "activities") Object.assign(row, { author: BOSS_NAME, activity_type: "business_trip", driving_log_id: null });
    // 동래샘들 계정 — 목록마다 버튼 조합이 달라지게 섞습니다(동아리샘 목록 넘침 2026-10).
    //   0: 가입 완료 + 강사 겸직(saem_member_roles 가짜 행이 uuid(1)) → 비밀번호 재설정·중지·역할 해제·완전 삭제
    //   1: 미가입·링크 만료 → [초대 링크 재발급]
    //   2: 짧은 이름 + 하이픈 없는 전화번호(표시 형식 확인)
    if (table === "saem_instructors") {
      if (i === 1 && "password_set_at" in row) Object.assign(row, { password_set_at: null, invite_expires_at: "2026-01-01T00:00:00+00:00" });
      if (i === 2) {
        if ("name" in row) row.name = "김샘";
        if ("phone" in row) row.phone = "01098765432";
      }
    }
    // 직인사용대장 — 상세 화면을 상태별로 열 수 있게 id 로 상태를 정합니다.
    //   uuid(1) 결재 대기(남의 신청 → 승인·반려 버튼) / uuid(2) 발급(내 신청, 2번 줄 취소) / uuid(3) 반려(내 신청 → 고치기)
    if (table === "seal_requests") {
      const st: Record<string, string> = { [uuid(1)]: "pending", [uuid(2)]: "issued", [uuid(3)]: "rejected", [uuid(4)]: "draft" };
      const status = st[String(row.id)] ?? ["pending", "issued", "rejected", "draft"][i % 4];
      Object.assign(row, { status, doc_type: "award_confirm", cert_date: "2026-10-17" });
      if ("requester_driver_id" in row && row.requester_driver_id !== BOSS_ID) row.requester_driver_id = status === "pending" ? uuid(9) : BOSS_ID;
      if ("item_template" in row)
        row.item_template = [
          { label: "행 사 명", scope: "common", value: LONG },
          { label: "참가팀/명", scope: "person", isName: true },
          { label: "참가일시", scope: "common", date: true, value: "2026-10-17" },
          { label: "수상부문", scope: "person" },
        ];
      if ("body_template" in row) row.body_template = `${SENTENCE} {수상부문}`;
      if (status !== "issued") Object.assign(row, { issue_year: null, issued_at: null });
    }
    if (table === "seal_recipients") {
      // 발급 신청(uuid(2))의 줄, 또는 전체 대장 조회(신청을 함께 읽음 — seal_requests 칸이 붙음)
      const issued = row.request_id === uuid(2) || "seal_requests" in row;
      if ("items" in row) row.items = [{ label: "행 사 명", value: LONG }, { label: "참가팀/명", value: `${LONG} 팀` }, { label: "참가일시", value: "2026. 10. 17. (토)" }, { label: "수상부문", value: "대상" }];
      if ("body" in row) row.body = SENTENCE;
      if (issued) {
        Object.assign(row, { issue_year: 2026, issue_seq: 15 + i, issued_at: "2026-10-27T05:00:00+00:00" });
        if ("snapshot" in row) row.snapshot = { issueLabel: `제2026-${15 + i}호`, title: "수상확인증", certDate: "2026-10-17", approvedBy: BOSS_NAME };
        if ("canceled_at" in row) row.canceled_at = i === 1 ? "2026-10-28T05:00:00+00:00" : null;
      } else Object.assign(row, { issue_year: null, issue_seq: null, issued_at: null, snapshot: null, canceled_at: null });
    }
    if (table === "approvals" && "status" in row) {
      row.status = ["rejected", "approved", "withdrawn", "pending"][i % 4];
      if (row.status === "rejected") row.reject_reason = SENTENCE;
    }
    if ("deleted_at" in row) row.deleted_at = null;
    if ("left_on" in row) row.left_on = null;
    return row;
  }

  function rowsFor(table: string, q: URLSearchParams, method: string): Row[] {
    const sel = q.get("select") ? parseSelect(q.get("select")!) : null;
    const forced: Row = {};
    let eqCount = 0;
    for (const [k, v] of q) {
      if (["select", "order", "limit", "offset", "on_conflict", "columns", "or", "and"].includes(k)) continue;
      const m = v.match(/^(eq|is|in|gte|lte|gt|lt|neq|like|ilike|not|cs|ov)\.(.*)$/);
      if (!m) continue;
      if (m[1] === "eq") {
        eqCount++;
        const val = m[2];
        const t = schema[table]?.[k]?.type ?? "";
        forced[k] = t === "boolean" ? val === "true" : /int|numeric/.test(t) ? Number(val) : val;
      }
      if (m[1] === "is" && m[2] === "null") forced[k] = null;
    }
    // 직무: 가짜 관장은 모든 직무 보유
    if (table === "employee_roles" && (forced.driver_id === BOSS_ID || !forced.driver_id)) {
      const keys = ["facility", "accounting", "hr", "personnel", "recruitment", "mutual", "saem", "bangka", "press", "mail"];
      return keys.map((k, i) => makeRow(table, sel, i, { ...forced, driver_id: BOSS_ID, role_key: k }));
    }
    const limit = Number(q.get("limit") ?? "") || Infinity;
    const n = Math.min(eqCount > 0 ? 1 : 4, limit);
    return Array.from({ length: n }, (_, i) => makeRow(table, sel, i, forced));
  }

  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const send = (status: number, data: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { "Content-Type": "application/json", ...headers });
        res.end(data === undefined ? "" : JSON.stringify(data));
      };
      const method = req.method ?? "GET";
      if (u.pathname.startsWith("/storage/v1/")) {
        if (method !== "GET" && !/\/sign\b/.test(u.pathname) && !/\/list\//.test(u.pathname)) writes.push(`${method} ${u.pathname}`);
        if (/\/object\/sign\/[^/]+$/.test(u.pathname) && method === "POST") {
          // createSignedUrls(여러 개)
          const paths: string[] = (JSON.parse(body || "{}").paths ?? []) as string[];
          return send(200, paths.map((p) => ({ path: p, signedURL: `/storage/v1/object/sign/fake/${p}?token=x`, error: null })));
        }
        if (/\/object\/sign\//.test(u.pathname)) return send(200, { signedURL: `/storage/v1/object/sign/fake?token=x` });
        return send(200, []);
      }
      const m = u.pathname.match(/^\/rest\/v1\/(rpc\/)?([a-z_0-9]+)/);
      if (!m) return send(404, { message: "not found" });
      if (m[1]) {
        writes.push(`RPC ${m[2]}`);
        return send(200, null);
      }
      const table = m[2];
      if (method !== "GET" && method !== "HEAD") {
        writes.push(`${method} ${table}`);
        const wantRep = /return=representation/.test(String(req.headers.prefer ?? ""));
        return wantRep ? send(201, rowsFor(table, u.searchParams, method).slice(0, 1)) : send(201, undefined);
      }
      const rows = rowsFor(table, u.searchParams, method);
      const headers = { "Content-Range": `0-${Math.max(0, rows.length - 1)}/${rows.length}` };
      if (method === "HEAD") return send(200, undefined, headers);
      if (String(req.headers.accept ?? "").includes("vnd.pgrst.object")) {
        if (rows.length !== 1) return send(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
        return send(200, rows[0], headers);
      }
      send(200, rows, headers);
    });
  });
  server.listen(port, "127.0.0.1");
  return { server, writes };
}

export const schemaFile = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "db-schema.json");
