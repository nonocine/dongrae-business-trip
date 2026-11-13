// 홈페이지 대관 → 사업실적 연결 확대 — 1단계 미리보기 (조회만, 쓰기 없음).
//   실행: npx tsx scripts/rental-link-preview.mts [YYYY-MM]   (기본 2026-10)
//
//   김혜지 팀장 연결표(2026-11)를 '제안 규칙'으로 옮겨, 한 달 확정(status Y) 예약을
//   사업별로 나눠 건수·인원을 출력합니다.
//     · 기준 데이터는 홈페이지 API(원본). 같은 규칙을 동업자씨 DB(rental_reservations)에도
//       돌려 나란히 보여줍니다 — 차이는 홈페이지에서 지워졌는데 DB 에 남은 예약(동기화가
//       삭제를 반영하지 않음) 때문입니다.
//     · 한 예약은 위에서부터 첫 번째로 맞는 사업 하나에만 들어갑니다.
//     · API 에 연령대×성별 인원이 없어(2026-11 실측: 16개 필드뿐) 청소년/기타는 사업의
//       기본 구분으로 총인원을 통째로 넣은 값입니다.
//   ⚠️ 홈페이지 API·DB 모두 GET/select 만 합니다. 개인정보(신청자)는 출력하지 않습니다.
import fs from "node:fs";
import path from "node:path";

const month = process.argv[2] ?? "2026-10";
if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("월은 YYYY-MM 형식");
const [y, m] = month.split("-").map(Number);
const START = `${month}-01`;
const END = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // 말일

for (const line of fs
  .readFileSync(path.join(process.cwd(), ".env.local"), "utf8")
  .split(/\r?\n/)) {
  const mm = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (mm && process.env[mm[1]] == null)
    process.env[mm[1]] = mm[2].replace(/^"|"$/g, "");
}

type R = {
  reservation_no: number;
  reservation_type: string;
  reservation_date: string;
  space_name: string | null;
  room_name: string | null;
  purpose: string | null;
  program_name: string | null;
  person_total: number;
  status: string;
};

const norm = (s: string | null | undefined) =>
  (s ?? "").replace(/\s+/g, "").toLowerCase();

// --- 제안 규칙 ---------------------------------------------------------
//   prog: program_name(공백 무시) 포함 / progExact: 정확히 일치
//   space: 프로그램명이 빈 예약을 공간명으로(types 로 rental/room 제한)
type Rule =
  | { prog: string }
  | { progExact: string }
  | { progRe: RegExp }
  | { space: string[]; types?: ("rental" | "room")[] };
type Target = {
  business: string; // business_programs.name (없으면 ※)
  audience: "youth" | "other";
  rules: Rule[];
  note?: string;
};

const ONNA_ROOMS = [
  "온나 노래방",
  "온나 숨숨존",
  "온나 닌텐도존",
  "온나 스낵존",
  "온나 보드게임존",
  "온나 네컷사진존",
];

const TARGETS: Target[] = [
  // 디지털 기반 청소년 활동기회 확대
  { business: "특성화체험활동 On-나-Go", audience: "youth", rules: [{ prog: "On나Go" }] },
  { business: "청소년 수련활동 해결해ON-나", audience: "youth", rules: [{ prog: "해결해ON나" }] },
  {
    business: "※[인증-D0078호] 인공지능 시대의 청소년을 위한 AI 윤리(사업 미등록)",
    audience: "youth",
    rules: [{ prog: "인공지능 시대의 청소년을 위한 AI 윤리" }],
  },
  { business: "AI 인공지능 코딩 자격증반", audience: "youth", rules: [{ prog: "] 인공지능 코딩" }] },
  { business: '디지털 드로잉 공작소 "상상ON 아트데이"', audience: "youth", rules: [{ prog: "슥샥 디지털드로잉" }] },
  { business: 'AR(증강현실) 피구 스포츠 "동(래)키(즈)"', audience: "youth", rules: [{ prog: "피구AR 동(래)키(즈)" }] },
  { business: '스낵바 운영 청소년 자원봉사단 "알바냥"', audience: "youth", rules: [{ prog: "알바냥" }] },
  // 청소년 정책제안 및 실현
  { business: "청소년운영위원회 '청동거울'", audience: "youth", rules: [{ prog: "청소년운영위원회 '청동거울" }] },
  { business: "청소년참여위원회 '동참해'", audience: "youth", rules: [{ prog: "청소년참여위원회 동참해" }] },
  { business: "연합동아리대표회 '유쓰 띵동'", audience: "youth", rules: [{ prog: "Youth 띵동" }, { prog: "유쓰띵동" }] },
  { business: "청소년 자치기구 연합 활동 '동래화합'", audience: "youth", rules: [{ prog: "'동래화합'" }] },
  { business: "정보기술자격(ITQ) 한글 자격증반", audience: "youth", rules: [{ prog: "톡톡 컴퓨터 교실" }] },
  // 청소년활동 프로그램 다양화
  { business: "대학교 자원봉사 및 멘토링", audience: "youth", rules: [{ progExact: "대학교 자원봉사 및 멘토링" }] },
  {
    business: "사직동 자유공간 '온나'",
    audience: "youth",
    rules: [
      { progExact: "온나 다목적홀" },
      { prog: "유(YOU)스 온(ON)나" },
      { prog: "'동래 BOX'(사직동 온나)" },
      { space: ONNA_ROOMS, types: ["room"] },
    ],
  },
  { business: "달마다 달라지는 해볼거리", audience: "youth", rules: [{ prog: "달달해" }] },
  // 학교안팎 청소년 활동지원 강화
  { business: "방과후아카데미 이음Z음", audience: "youth", rules: [{ progExact: "청소년방과후아카데미" }] },
  {
    business: "오케스트라(합주·플루트·바이올린 — 나누는 기준 미정)",
    audience: "youth",
    rules: [{ prog: "오케스트라" }],
  },
  { business: "청소년동아리연합회 Do Go Do Go 동래", audience: "youth", rules: [{ progExact: "청소년동아리연합회 Do Go Do Go 동래" }] },
  { business: "청소년 쿠킹 클래스 '밥 해달레'", audience: "youth", rules: [{ prog: "밥 해달레" }] },
  // 문화예술 여가활동 다양화
  {
    business: "청소년만 ON NA",
    audience: "youth",
    rules: [
      { space: ["뒹굴뒹굴 청소년 ZONE", "룰루랄라 노래방", "플레이 디딤"], types: ["room"] },
      // 디지털 유스카페는 room 예약이 없고 프로그램명 빈 대관(rental)만 있습니다.
      { space: ["디지털 유스카페"] },
    ],
    note: "디지털 유스카페 = 프로그램명 빈 대관(10월은 동래읍성역사축제 2건)",
  },
  {
    business: "청소년 E-스포츠존 '롤(LOL)면 뭐하니'",
    audience: "youth",
    rules: [{ space: ["E-스포츠존"], types: ["room"] }],
    note: "공식(실별 누적 − 늘봄) 미정 — room 예약만",
  },
  { business: "스낵바(간식·문구) 동래점빵 다있소", audience: "youth", rules: [{ progExact: "동래점빵 다있소" }] },
  // 지역사회 연계
  { business: "시설대관", audience: "other", rules: [{ progExact: "시설 대관" }] },
  // 늘봄(동래미래 아카데미) 후보 — 위에서 안 걸린 '(HH:MM~HH:MM)' 강좌
  {
    business: "[후보] 초등 통합방과후학교 동래미래 아카데미(늘봄)",
    audience: "youth",
    rules: [{ progRe: /\(\d{2}:\d{2}~\d{2}:\d{2}\)\s*$/ }],
  },
];

function hit(rule: Rule, r: R): boolean {
  const prog = (r.program_name ?? "").trim();
  if ("progExact" in rule) return prog === rule.progExact;
  if ("prog" in rule) return norm(prog).includes(norm(rule.prog));
  if ("progRe" in rule) return rule.progRe.test(prog);
  return (
    prog === "" &&
    rule.space.includes((r.space_name ?? "").trim()) &&
    (!rule.types || rule.types.includes(r.reservation_type as "rental" | "room"))
  );
}

async function fetchApi(): Promise<R[]> {
  const u = new URL("https://www.onnainna.kr/api/rentalExport");
  u.searchParams.set("start_date", START);
  u.searchParams.set("end_date", END);
  u.searchParams.set("type", "all");
  const res = await fetch(u, {
    headers: { "X-API-Key": process.env.RENTAL_API_KEY ?? "", Accept: "application/json" },
  });
  const j = (await res.json()) as { result: string; truncated?: boolean; list?: Record<string, unknown>[] };
  if (j.result !== "ok") throw new Error(`API 오류 ${res.status}`);
  if (j.truncated) throw new Error("API 응답이 잘렸습니다(10,000건 초과)");
  return (j.list ?? []).map((x) => ({
    reservation_no: Number(x.reservation_no),
    reservation_type: String(x.reservation_type ?? ""),
    reservation_date: String(x.reservation_date ?? ""),
    space_name: (x.space_name as string) || null,
    room_name: (x.room_name as string) || null,
    purpose: (x.purpose as string) || null,
    program_name: (x.program_name as string) || null,
    person_total: Number(x.person_total) || 0,
    status: String(x.status ?? "").toUpperCase(),
  }));
}

async function fetchDb(): Promise<R[]> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const out: R[] = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(
      `${base}/rest/v1/rental_reservations?select=reservation_no,reservation_type,reservation_date,space_name,room_name,purpose,program_name,person_total,status&reservation_date=gte.${START}&reservation_date=lte.${END}&order=reservation_no${process.env.PREVIEW_INCLUDE_REMOVED ? "" : "&removed_at=is.null"}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}` } },
    );
    const page = (await res.json()) as R[];
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

type Agg = { n: number; p: number; days: Set<string>; sub: Map<string, { n: number; p: number }> };
function classify(rows: R[]) {
  const by = new Map<string, Agg>();
  const unmatched = new Map<string, { n: number; p: number }>();
  for (const r of rows) {
    if (r.status !== "Y") continue;
    const t = TARGETS.find((t) => t.rules.some((rule) => hit(rule, r)));
    if (!t) {
      const k = `${r.program_name ?? "(프로그램명 없음)"} @ ${r.space_name ?? "-"}${r.purpose ? ` [${r.purpose}]` : ""}`;
      const u = unmatched.get(k) ?? { n: 0, p: 0 };
      u.n += 1;
      u.p += r.person_total;
      unmatched.set(k, u);
      continue;
    }
    const a = by.get(t.business) ?? { n: 0, p: 0, days: new Set(), sub: new Map() };
    a.n += 1;
    a.p += r.person_total;
    a.days.add(r.reservation_date);
    const sk = r.program_name ? `${r.program_name} @ ${r.space_name}` : `(공간) ${r.space_name}`;
    const s = a.sub.get(sk) ?? { n: 0, p: 0 };
    s.n += 1;
    s.p += r.person_total;
    a.sub.set(sk, s);
    by.set(t.business, a);
  }
  return { by, unmatched };
}

const api = await fetchApi();
const db = await fetchDb();
const A = classify(api);
const D = classify(db);
const apiNos = new Set(api.map((r) => r.reservation_no));
const stale = db.filter((r) => !apiNos.has(r.reservation_no));

console.log(`\n# ${month} 확정 예약 → 사업 미리보기 (API ${api.length}건 / DB ${db.length}건, DB에만 남은 예약 ${stale.length}건)\n`);
console.log("| 사업 | 구분 | 건수 | 운영일 | 인원(API) | 청소년 | 기타 | 인원(DB) |");
console.log("|---|---|---:|---:|---:|---:|---:|---:|");
for (const t of TARGETS) {
  const a = A.by.get(t.business);
  const d = D.by.get(t.business);
  const p = a?.p ?? 0;
  console.log(
    `| ${t.business}${t.note ? ` (${t.note})` : ""} | ${t.audience === "youth" ? "청소년" : "기타"} | ${a?.n ?? 0} | ${a?.days.size ?? 0} | ${p} | ${t.audience === "youth" ? p : 0} | ${t.audience === "other" ? p : 0} | ${d?.p ?? 0}${(d?.p ?? 0) !== p ? " ⚠" : ""} |`,
  );
}

console.log("\n## 사업별 내역(API)\n");
for (const t of TARGETS) {
  const a = A.by.get(t.business);
  if (!a) continue;
  console.log(`- ${t.business}: ${a.n}건 ${a.p}명`);
  for (const [k, v] of [...a.sub].sort((x, y) => y[1].p - x[1].p))
    console.log(`    · ${k} — ${v.n}건 ${v.p}명`);
}

console.log("\n## 어디에도 안 걸린 확정 예약(API, 인원 많은 순)\n");
for (const [k, v] of [...A.unmatched].sort((x, y) => y[1].p - x[1].p))
  console.log(`- ${v.p}명 / ${v.n}건 — ${k}`);

if (stale.length > 0) {
  console.log("\n## 홈페이지에선 없어졌는데 DB에 남은 예약(동기화가 삭제를 반영하지 않음)\n");
  const g = new Map<string, { n: number; p: number; y: number }>();
  for (const r of stale) {
    const k = `${r.reservation_type} ${r.program_name ?? "(프로그램명 없음)"} @ ${r.space_name}`;
    const v = g.get(k) ?? { n: 0, p: 0, y: 0 };
    v.n += 1;
    v.p += r.person_total;
    if (r.status === "Y") v.y += 1;
    g.set(k, v);
  }
  for (const [k, v] of g) console.log(`- ${k} — ${v.n}건(그중 확정 ${v.y}) ${v.p}명`);
}
