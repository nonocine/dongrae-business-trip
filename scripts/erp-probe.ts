// ERP 조회 API 1단계 시험 — 조회만(쓰기 없음).
//   실행: npx tsx scripts/erp-probe.ts
//
//   1) 9개 API 를 1페이지(page_size 20)씩 불러 HTTP 상태·count·truncated·첫 건의 '키 이름'만 출력.
//      ⚠️ 실제 값(이름·금액·계좌·제목)과 API 키는 출력하지 않습니다.
//   2) 직원 연결 가능성 — ERP employees 의 email·name 과 동업자씨 drivers 의 email·name 비교(숫자만,
//      못 맞춘 사람만 이름).
//   3) 대관 — ERP rentals.rental_id 와 동업자씨 rental_reservations.reservation_no 를 같은 기간으로 비교(건수만).
//   동업자씨 DB 는 select 만 합니다.
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import { createClient } from "@supabase/supabase-js";

const START = "2026-10-01";
const END = "2026-11-30";

// .env.local 읽기(값은 출력하지 않음).
const envFile = path.join(process.cwd(), ".env.local");
for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

// lib/erp/client.ts 의 `import "server-only"` — Next 밖(tsx)에서는 빈 모듈로 바꿔 불러옵니다.
type Resolve = (request: string, ...rest: unknown[]) => string;
const M = Module as unknown as { _resolveFilename: Resolve };
const origResolve = M._resolveFilename;
M._resolveFilename = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return require.resolve("next/dist/compiled/server-only/empty.js");
  return origResolve.call(this, request, ...rest);
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { erpGet, erpGetAll, ErpError } = require("../lib/erp/client") as typeof import("../lib/erp/client");
type ErpApi = import("../lib/erp/client").ErpApi;

const DATED: ErpApi[] = ["duties", "schedules", "transactions", "expenditures", "rentals", "documents"];
const APIS: ErpApi[] = [
  "employees",
  "duties",
  "leaveBalances",
  "schedules",
  "transactions",
  "expenditures",
  "rentals",
  "codes",
  "documents",
];

const keysOf = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v as object) : []);

async function probeAll() {
  console.log(`\n=== 1. API 9종 (page_size 20, 기간 ${START}~${END}) ===`);
  for (const api of APIS) {
    const params = { page_size: 20, ...(DATED.includes(api) ? { start_date: START, end_date: END } : {}) };
    try {
      const r = await erpGet(api, params);
      console.log(`\n[${api}] HTTP ${r.status} · count ${r.count} · truncated ${r.truncated} · next_cursor ${r.nextCursor ? "있음" : "없음"}`);
      if (api === "codes") {
        // codes 는 data 대신 구역별 배열 — 구역 이름과 각 구역 첫 건의 키만.
        for (const [k, v] of Object.entries(r.body)) {
          if (Array.isArray(v)) console.log(`  ${k}[${v.length}]: ${keysOf(v[0]).join(", ") || "(값 목록)"}`);
        }
      } else {
        console.log(`  첫 건 키: ${keysOf(r.data[0]).join(", ") || "(데이터 없음)"}`);
      }
      const meta = Object.keys(r.body).filter((k) => !["data", "result"].includes(k) && !Array.isArray(r.body[k]));
      console.log(`  응답 메타 키: ${meta.join(", ")}`);
    } catch (e) {
      if (e instanceof ErpError) console.log(`\n[${api}] HTTP ${e.status} · 오류 ${e.code}`);
      else console.log(`\n[${api}] 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
const normName = (s: unknown) => String(s ?? "").replace(/\s+/g, "");

async function compareStaff() {
  console.log("\n=== 2. 직원 연결(ERP employees ↔ 동업자씨 drivers) ===");
  const erp = await erpGetAll("employees", {});
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  // 동업자씨 직원 이메일은 drivers 가 아니라 employee_profiles(email → driver_id)에 있습니다(구글 로그인 매칭과 같은 기준).
  const { data: drivers, error } = await sb.from("drivers").select("id, name");
  if (error) throw new Error(`drivers 조회 실패: ${error.message}`);
  const { data: profs, error: pErr } = await sb.from("employee_profiles").select("driver_id, email");
  if (pErr) throw new Error(`employee_profiles 조회 실패: ${pErr.message}`);
  const byEmail = new Set((profs ?? []).filter((p) => p.driver_id).map((p) => norm(p.email)).filter(Boolean));
  const byName = new Set((drivers ?? []).map((d) => normName(d.name)).filter(Boolean));
  const tally = (list: Record<string, unknown>[]) => {
    let emailHit = 0;
    let nameOnly = 0;
    const missed: string[] = [];
    for (const e of list) {
      const email = norm(e.email);
      if (email && byEmail.has(email)) emailHit++;
      else if (byName.has(normName(e.name))) nameOnly++;
      else missed.push(String(e.name ?? "(이름 없음)"));
    }
    return { emailHit, nameOnly, missed };
  };
  const live = erp.data.filter((e) => e.deleted !== true);
  const employed = live.filter((e) => e.is_employed === true);
  console.log(
    `ERP 직원 ${live.length}명(재직 ${employed.length})${erp.truncated ? "(일부만)" : ""} · 동업자씨 직원 ${(drivers ?? []).length}명(이메일 등록 ${byEmail.size})`
  );
  for (const [label, list] of [["재직자", employed], ["전체(퇴직 포함)", live]] as const) {
    const t = tally(list);
    console.log(`[${label}] 이메일로 일치 ${t.emailHit}명 / 이름으로만 일치 ${t.nameOnly}명 / 못 맞춘 ${t.missed.length}명`);
    if (t.missed.length && label === "재직자") console.log(`  못 맞춘 재직자: ${t.missed.join(", ")}`);
  }
}

async function compareRentals(): Promise<void> {
  console.log(`\n=== 3. 대관(ERP rentals.rental_id ↔ rental_reservations.reservation_no, ${START}~${END}) ===`);
  const erp = await erpGetAll("rentals", { start_date: START, end_date: END });
  // 범위(coverage) — 첫 페이지 메타에서.
  const coverage = (await erpGet("rentals", { start_date: START, end_date: END, page_size: 1 })).body.coverage ?? null;
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const ours = new Set<string>();
  const oursRental = new Set<string>(); // reservation_type='rental'(시설대관) — ERP rentals 범위(coverage: facility)
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("rental_reservations")
      .select("reservation_no, reservation_type")
      .gte("reservation_date", START)
      .lte("reservation_date", END)
      .range(from, from + 999);
    if (error) throw new Error(`rental_reservations 조회 실패: ${error.message}`);
    for (const r of data ?? []) {
      ours.add(String(r.reservation_no));
      if (r.reservation_type === "rental") oursRental.add(String(r.reservation_no));
    }
    if (!data || data.length < 1000) break;
  }
  const theirs = new Set(erp.data.map((r) => String(r.rental_id ?? "")).filter(Boolean));
  const cmp = (label: string, mine: Set<string>) => {
    let both = 0;
    for (const id of theirs) if (mine.has(id)) both++;
    console.log(
      `[${label}] ERP ${theirs.size}건${erp.truncated ? "(일부만)" : ""} · 동업자씨 ${mine.size}건 → 양쪽 다 있음 ${both}건 / ERP에만 ${theirs.size - both}건 / 동업자씨에만 ${mine.size - both}건`
    );
  };
  console.log(`ERP coverage: ${JSON.stringify(coverage)}`);
  cmp("동업자씨 전체(room 포함)", ours);
  cmp("동업자씨 시설대관(rental)만", oursRental);
}

(async () => {
  await probeAll();
  await compareStaff();
  await compareRentals();
})().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
