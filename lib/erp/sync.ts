import "server-only";

// =====================================================================
// ERP → 동업자씨 자동 동기화(2단계) — 조회 API 를 받아 erp_* 표에 복제합니다.
//   * ERP 가 원본. 우리는 받아 적기만 합니다(ERP 로 쓰는 일 없음).
//   * 모든 행에 raw(ERP 원본 1건) + 주요 칸 펼침. ERP 일시("YYYY-MM-DD HH:mm:ss", 한국시간)는
//     +09:00 을 붙여 timestamptz 로 저장합니다.
//   * 범위
//     - employees      : 처음 전체, 이후 updated_since = 마지막 성공 실행의 시작 시각(-10분 여유).
//     - leaveBalances  : 매번 전체.  codes : kind=expenditure·revenue, 올해, 매번 전체(스냅숏).
//     - duties          : 올해 1월 1일 ~ 오늘+180일(366일 초과 → 366일 이하 구간으로 나눠 호출).
//     - schedules·rentals·documents : 오늘 -90일 ~ +180일.
//     - transactions·expenditures(회계 키) : 올해 1월 1일 ~ 오늘(366일 제한 안).
//     - 페이지는 page_size 500 + next_cursor 끝까지(erpGetAll).
//   * 사라진 건: 기간 API 6종만(removed_at 칸이 있는 표). 받은 기간 안에서 DB 에 있는데
//     이번 응답에 없으면 removed_at=now(), 다시 나타나면 upsert 가 removed_at=null 로 되돌립니다.
//     페이지 상한에 걸려 응답이 덜 왔으면 사라진 건 처리는 건너뜁니다(잘못 지우지 않게).
//   * API 별로 erp_sync_runs 에 시작·끝·건수·오류. 한 API 가 실패해도 나머지는 계속합니다.
//   * 직원 연결: 동기화 뒤 employee_profiles.erp_employee_id 가 빈 사람만, 재직 ERP 직원과
//     이름이 정확히 1명 일치하면 연결. 이미 연결된 값은 절대 덮어쓰지 않습니다.
//   ⚠️ 로그·오류 문구에 키·금액·계좌·이름을 싣지 않습니다(건수·API 이름·오류 코드만).
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { erpGet, erpGetAll, ErpError, type ErpApi } from "@/lib/erp/client";

export type ErpSyncTrigger = "cron" | "manual";
export type ErpSyncApi = ErpApi;

type Row = Record<string, unknown>;

// --- 값 변환 -------------------------------------------------------------
const KST_DT = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/;
// ERP 한국시간 일시 → timestamptz 문자열. 날짜만 오면 그날 00:00(한국시간).
export function kstTs(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.trim();
  const m = s.match(KST_DT);
  if (m) return `${m[1]}T${m[2].length === 5 ? `${m[2]}:00` : m[2]}+09:00`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00+09:00`;
  return null;
}
const ymd = (v: unknown): string | null =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
const txt = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
const int = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
const numeric = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const bool = (v: unknown): boolean | null => (v == null ? null : v === true || v === 1 || v === "1" || v === "Y");
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);
const intArr = (v: unknown): number[] =>
  Array.isArray(v) ? v.map((x) => Number(x)).filter((n) => Number.isFinite(n)).map(Math.trunc) : [];
const json = (v: unknown, fb: unknown = null) => (v === undefined ? fb : v);

// --- 날짜(한국시간) ---------------------------------------------------------
function kstNow(): Date {
  return new Date(Date.now() + 9 * 3600 * 1000);
}
function ymdOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function kstToday(): string {
  return ymdOf(kstNow());
}
function addDays(ymdStr: string, days: number): string {
  const d = new Date(`${ymdStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return ymdOf(d);
}
// timestamptz → ERP updated_since 형식("YYYY-MM-DD HH:mm:ss", 한국시간).
function toKstStamp(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

// --- API 별 저장 규칙 ---------------------------------------------------------
type DatedSpec = {
  api: ErpApi;
  table: string;
  pk: string;
  // 사라진 건 판정 기준 칸(받은 기간 안의 행인지). kind=date 는 날짜 칸, ts 는 timestamptz 칸.
  scope: { col: string; kind: "date" | "ts" };
  range: () => { start: string; end: string };
  map: (r: Row) => Row;
};

const operational = () => {
  const today = kstToday();
  return { start: addDays(today, -90), end: addDays(today, 180) };
};
// 복무 — 올해 1월 1일 ~ 오늘+180일(연차 사용 집계·앞으로의 일정). 366일을 넘으므로 나눠 부릅니다.
const dutiesRange = () => {
  const today = kstToday();
  return { start: `${today.slice(0, 4)}-01-01`, end: addDays(today, 180) };
};
const thisYearToDate = () => {
  const today = kstToday();
  return { start: `${today.slice(0, 4)}-01-01`, end: today };
};

const DATED: DatedSpec[] = [
  {
    api: "duties",
    table: "erp_duties",
    pk: "duty_id",
    scope: { col: "start_at", kind: "ts" },
    range: dutiesRange,
    map: (r) => ({
      duty_id: int(r.duty_id),
      document_number: int(r.document_number),
      employee_ids: strArr(r.employee_ids),
      submitted_by: txt(r.submitted_by),
      type_code: txt(r.type_code),
      type_name: txt(r.type_name),
      start_at: kstTs(r.start_at),
      end_at: kstTs(r.end_at),
      declared_amount: numeric(r.declared_amount),
      amount_unit: txt(r.amount_unit),
      location: txt(r.location),
      process_code: int(r.process_code),
      status: txt(r.status),
      submitted_at: kstTs(r.submitted_at),
    }),
  },
  {
    api: "schedules",
    table: "erp_schedules",
    pk: "schedule_id",
    scope: { col: "start_at", kind: "ts" },
    range: operational,
    map: (r) => ({
      schedule_id: int(r.schedule_id),
      document_number: int(r.document_number),
      title: txt(r.title),
      group_code: txt(r.group_code),
      group_name: txt(r.group_name),
      homepage_shared: bool(r.homepage_shared),
      start_at: kstTs(r.start_at),
      end_at: kstTs(r.end_at),
      registered_at: kstTs(r.registered_at),
    }),
  },
  {
    api: "rentals",
    table: "erp_rentals",
    pk: "rental_id",
    scope: { col: "reservation_date", kind: "date" },
    range: operational,
    map: (r) => ({
      rental_id: int(r.rental_id),
      space_id: int(r.space_id),
      space_name: txt(r.space_name),
      program_id: int(r.program_id),
      program_name: txt(r.program_name),
      reservation_date: ymd(r.reservation_date),
      start_time: txt(r.start_time),
      end_time: txt(r.end_time),
      team_name: txt(r.team_name),
      purpose: txt(r.purpose),
      person_total: int(r.person_total),
      status: txt(r.status),
      registered_at: kstTs(r.registered_at),
    }),
  },
  {
    api: "documents",
    table: "erp_documents",
    pk: "document_id",
    scope: { col: "registered_at", kind: "ts" },
    range: operational,
    map: (r) => ({
      document_id: int(r.document_id),
      document_number: int(r.document_number),
      document_type: txt(r.document_type),
      direction: txt(r.direction),
      title: txt(r.title),
      drafted_by: txt(r.drafted_by),
      group_code: txt(r.group_code),
      recipient_text: txt(r.recipient_text),
      via_text: txt(r.via_text),
      process_code: int(r.process_code),
      status: txt(r.status),
      registered_at: kstTs(r.registered_at),
    }),
  },
  {
    api: "transactions",
    table: "erp_transactions",
    pk: "transaction_id",
    scope: { col: "transaction_date", kind: "date" },
    range: thisYearToDate,
    map: (r) => ({
      transaction_id: int(r.transaction_id),
      group_code: txt(r.group_code),
      account_alias: txt(r.account_alias),
      account_last4: txt(r.account_last4),
      transaction_date: ymd(r.transaction_date),
      description: txt(r.description),
      transaction_type: txt(r.transaction_type),
      transaction_detail: txt(r.transaction_detail),
      input_amount: int(r.input_amount),
      output_amount: int(r.output_amount),
      balance: int(r.balance),
      memo: txt(r.memo),
      linked_vouchers: json(r.linked_vouchers, []) ?? [],
    }),
  },
  {
    api: "expenditures",
    table: "erp_expenditures",
    pk: "expenditure_id",
    scope: { col: "registered_at", kind: "ts" },
    range: thisYearToDate,
    map: (r) => ({
      expenditure_id: int(r.expenditure_id),
      parent_id: int(r.parent_id),
      document_number: int(r.document_number),
      ledger_number: int(r.ledger_number),
      year: int(r.year),
      kind: txt(r.kind),
      description: txt(r.description),
      business_area_code: int(r.business_area_code),
      budget_id: int(r.budget_id),
      process_code: int(r.process_code),
      drafted_by: txt(r.drafted_by),
      manager_reference_raw: txt(r.manager_reference_raw),
      bank_name: txt(r.bank_name),
      payee_text: txt(r.payee_text),
      payee_account_last4: txt(r.payee_account_last4),
      stored_amounts: json(r.stored_amounts),
      stages: json(r.stages),
      details: json(r.details),
      linked_transaction_ids: intArr(r.linked_transaction_ids),
      registered_at: kstTs(r.registered_at),
    }),
  },
];

const mapEmployee = (r: Row): Row => ({
  employee_id: String(r.employee_id),
  employee_no: int(r.employee_no),
  name: txt(r.name),
  department_code: txt(r.department_code),
  department_name: txt(r.department_name),
  job_title: txt(r.job_title),
  is_employed: bool(r.is_employed),
  employment_status: txt(r.employment_status),
  email: txt(r.email),
  deleted: bool(r.deleted),
  erp_updated_at: kstTs(r.updated_at),
});
const mapLeave = (r: Row): Row => ({
  employee_id: String(r.employee_id),
  employee_no: int(r.employee_no),
  is_employed: bool(r.is_employed),
  annual_remaining_days: numeric(r.annual_remaining_days),
  compensatory_remaining_days: numeric(r.compensatory_remaining_days),
  annual_allocation_override_days: numeric(r.annual_allocation_override_days),
  annual_preused_days: numeric(r.annual_preused_days),
});

// --- 공용 저장 -------------------------------------------------------------
const PAGE_LIMIT = 200; // 500 × 200 = 10만 건 — 넘으면 '덜 받음'으로 보고 사라진 건 처리 생략

async function upsertRows(table: string, pk: string, rows: Row[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const part = rows.slice(i, i + 500);
    const { error } = await supabaseAdmin.from(table).upsert(part, { onConflict: pk });
    if (error) throw new Error(`${table} 저장 실패(${error.code ?? "?"}): ${error.message}`);
    n += part.length;
  }
  return n;
}

async function markRemoved(spec: DatedSpec, range: { start: string; end: string }, seen: Set<string>): Promise<number> {
  const ids: string[] = [];
  const lo = spec.scope.kind === "date" ? range.start : `${range.start}T00:00:00+09:00`;
  const hi = spec.scope.kind === "date" ? range.end : `${range.end}T23:59:59.999+09:00`;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from(spec.table)
      .select(spec.pk)
      .is("removed_at", null)
      .gte(spec.scope.col, lo)
      .lte(spec.scope.col, hi)
      .order(spec.pk, { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`${spec.table} 확인 실패: ${error.message}`);
    for (const r of (data ?? []) as unknown as Row[]) {
      const id = String(r[spec.pk]);
      if (!seen.has(id)) ids.push(id);
    }
    if (!data || data.length < 1000) break;
  }
  const now = new Date().toISOString();
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabaseAdmin
      .from(spec.table)
      .update({ removed_at: now })
      .in(spec.pk, ids.slice(i, i + 200))
      .is("removed_at", null);
    if (error) throw new Error(`${spec.table} 사라진 건 표시 실패: ${error.message}`);
  }
  return ids.length;
}

export type ErpRunResult = {
  api: string;
  ok: boolean;
  fetched: number;
  upserted: number;
  removed: number;
  error: string | null;
  range: { start: string; end: string } | null;
};

// 실행 기록 — 시작 행을 만들고, 끝나면 갱신합니다.
async function withRun(
  api: string,
  trigger: ErpSyncTrigger,
  range: { start: string; end: string } | null,
  work: () => Promise<{ fetched: number; upserted: number; removed: number; note?: string }>
): Promise<ErpRunResult> {
  const { data: run } = await supabaseAdmin
    .from("erp_sync_runs")
    // 시작·끝 시각을 같은 시계(서버)로 — DB now() 와 섞으면 소요 시간이 어긋납니다.
    .insert({ api, trigger, started_at: new Date().toISOString(), range_start: range?.start ?? null, range_end: range?.end ?? null })
    .select("id")
    .single();
  const runId = (run as { id?: string } | null)?.id ?? null;
  let res: ErpRunResult;
  try {
    const r = await work();
    res = { api, ok: true, fetched: r.fetched, upserted: r.upserted, removed: r.removed, error: r.note ?? null, range };
  } catch (e) {
    // 오류 문구는 ERP 코드·표 이름 수준 — 키·값은 들어가지 않습니다.
    const msg = e instanceof ErpError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
    res = { api, ok: false, fetched: 0, upserted: 0, removed: 0, error: msg.slice(0, 500), range };
  }
  if (runId) {
    await supabaseAdmin
      .from("erp_sync_runs")
      .update({
        finished_at: new Date().toISOString(),
        ok: res.ok,
        fetched: res.fetched,
        upserted: res.upserted,
        removed: res.removed,
        error: res.error,
      })
      .eq("id", runId);
  }
  return res;
}

// --- API 별 동기화 -----------------------------------------------------------
async function syncEmployees(trigger: ErpSyncTrigger): Promise<ErpRunResult> {
  // 마지막 성공 실행의 시작 시각 — 그 뒤 바뀐 직원만. 처음이면 전체.
  const { data: last } = await supabaseAdmin
    .from("erp_sync_runs")
    .select("started_at")
    .eq("api", "employees")
    .eq("ok", true)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const since = (last as { started_at?: string } | null)?.started_at ?? null;
  // 10분 여유(ERP·우리 시계 차이, 실행 중 바뀐 건).
  const updatedSince = since ? toKstStamp(new Date(new Date(since).getTime() - 10 * 60 * 1000).toISOString()) : null;
  return withRun("employees", trigger, null, async () => {
    const r = await erpGetAll("employees", updatedSince ? { updated_since: updatedSince } : {}, { maxPages: PAGE_LIMIT });
    const rows = r.data.filter((x) => x.employee_id != null).map((x) => ({ ...mapEmployee(x), raw: x, synced_at: new Date().toISOString() }));
    const upserted = await upsertRows("erp_employees", "employee_id", rows);
    return {
      fetched: r.data.length,
      upserted,
      removed: 0,
      // error 칸에는 오류·경고만(전체/변경분 여부는 range 가 비어 있는 것으로 구분하지 않고 상태판이 표시).
      note: r.truncated ? "페이지 상한 도달" : undefined,
    };
  });
}

async function syncLeaveBalances(trigger: ErpSyncTrigger): Promise<ErpRunResult> {
  return withRun("leaveBalances", trigger, null, async () => {
    const r = await erpGetAll("leaveBalances", {}, { maxPages: PAGE_LIMIT });
    const rows = r.data.filter((x) => x.employee_id != null).map((x) => ({ ...mapLeave(x), raw: x, synced_at: new Date().toISOString() }));
    const upserted = await upsertRows("erp_leave_balances", "employee_id", rows);
    return { fetched: r.data.length, upserted, removed: 0, note: r.truncated ? "페이지 상한 도달" : undefined };
  });
}

// codes — 구역별 배열이 페이지마다 오므로(budget_codes 가 나뉘어 옴) 배열을 이어 붙이고 중복을 뺍니다.
async function fetchCodes(kind: "expenditure" | "revenue", year: number): Promise<{ body: Row; items: number }> {
  let merged: Row | null = null;
  let cursor: string | null = null;
  const seen = new Set<string>();
  for (let page = 0; page < PAGE_LIMIT; page++) {
    const r: Awaited<ReturnType<typeof erpGet>> = await erpGet("codes", { kind, year, page_size: 500, cursor });
    if (!merged) merged = { ...r.body };
    else {
      for (const [k, v] of Object.entries(r.body)) {
        if (!Array.isArray(v)) continue;
        const cur = Array.isArray(merged[k]) ? (merged[k] as unknown[]) : [];
        const keys = new Set(cur.map((x) => JSON.stringify(x)));
        merged[k] = [...cur, ...v.filter((x) => !keys.has(JSON.stringify(x)))];
      }
    }
    if (!r.truncated || !r.nextCursor || seen.has(r.nextCursor)) break;
    seen.add(r.nextCursor);
    cursor = r.nextCursor;
  }
  const body = merged ?? {};
  delete body.result;
  delete body.next_cursor;
  delete body.truncated;
  const items = Array.isArray(body.budget_codes) ? (body.budget_codes as unknown[]).length : 0;
  return { body, items };
}

async function syncCodes(trigger: ErpSyncTrigger): Promise<ErpRunResult> {
  const year = Number(kstToday().slice(0, 4));
  return withRun("codes", trigger, null, async () => {
    let fetched = 0;
    let upserted = 0;
    for (const kind of ["expenditure", "revenue"] as const) {
      const { body, items } = await fetchCodes(kind, year);
      fetched += items;
      const { error } = await supabaseAdmin
        .from("erp_code_snapshots")
        .upsert({ kind, year, data: body, synced_at: new Date().toISOString() }, { onConflict: "kind,year" });
      if (error) throw new Error(`erp_code_snapshots 저장 실패: ${error.message}`);
      upserted += 1;
    }
    // fetched = 예산코드 건수(두 kind 합), upserted = 스냅숏 수(kind × 올해 = 2).
    return { fetched, upserted, removed: 0 };
  });
}

// ERP 는 한 번에 최대 366일(양 끝 포함) — 넘으면 나눕니다.
const MAX_RANGE_DAYS = 366;
export function splitRange(range: { start: string; end: string }): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  let s = range.start;
  while (s <= range.end && out.length < 20) {
    const e0 = addDays(s, MAX_RANGE_DAYS - 1);
    const e = e0 < range.end ? e0 : range.end;
    out.push({ start: s, end: e });
    s = addDays(e, 1);
  }
  return out;
}

async function syncDated(spec: DatedSpec, trigger: ErpSyncTrigger): Promise<ErpRunResult> {
  const range = spec.range();
  return withRun(spec.api, trigger, range, async () => {
    let fetched = 0;
    let upserted = 0;
    let removed = 0;
    const notes: string[] = [];
    // 구간마다 받아 저장하고, 사라진 건 처리도 그 구간 안에서만 합니다.
    for (const part of splitRange(range)) {
      const r = await erpGetAll(spec.api, { start_date: part.start, end_date: part.end }, { maxPages: PAGE_LIMIT });
      const now = new Date().toISOString();
      const byPk = new Map<string, Row>();
      for (const x of r.data) {
        const row: Row = { ...spec.map(x), raw: x, synced_at: now, removed_at: null };
        if (row[spec.pk] != null) byPk.set(String(row[spec.pk]), row);
      }
      const rows = [...byPk.values()];
      fetched += r.data.length;
      upserted += await upsertRows(spec.table, spec.pk, rows);
      if (r.truncated) notes.push(`${part.start}~${part.end} 페이지 상한 도달 — 사라진 건 처리 생략`);
      else removed += await markRemoved(spec, part, new Set(byPk.keys()));
    }
    return { fetched, upserted, removed, note: notes.length ? notes.join(" / ") : undefined };
  });
}

// --- 직원 자동 연결 -------------------------------------------------------------
export type ErpLinkSummary = { linked: number; ambiguous: number; notFound: number };

const normName = (s: unknown) => String(s ?? "").replace(/\s+/g, "");

export async function autoLinkEmployees(): Promise<ErpLinkSummary> {
  const out: ErpLinkSummary = { linked: 0, ambiguous: 0, notFound: 0 };
  const { data: profs } = await supabaseAdmin
    .from("employee_profiles")
    .select("id, driver_id, erp_employee_id")
    .is("erp_employee_id", null);
  const targets = ((profs ?? []) as { id: string; driver_id: string | null }[]).filter((p) => p.driver_id);
  if (!targets.length) return out;
  const { data: drv } = await supabaseAdmin
    .from("drivers")
    .select("id, name, is_active")
    .in("id", targets.map((p) => p.driver_id!));
  const driverName = new Map(((drv ?? []) as { id: string; name: string; is_active: boolean | null }[])
    .filter((d) => d.is_active !== false)
    .map((d) => [d.id, normName(d.name)]));
  const { data: emps } = await supabaseAdmin
    .from("erp_employees")
    .select("employee_id, name")
    .eq("is_employed", true)
    .or("deleted.is.null,deleted.eq.false");
  // 이미 다른 사람에게 연결된 ERP 계정은 후보에서 뺍니다(유니크).
  const { data: taken } = await supabaseAdmin.from("employee_profiles").select("erp_employee_id").not("erp_employee_id", "is", null);
  const takenSet = new Set(((taken ?? []) as { erp_employee_id: string }[]).map((t) => t.erp_employee_id));
  const byName = new Map<string, string[]>();
  for (const e of (emps ?? []) as { employee_id: string; name: string | null }[]) {
    const k = normName(e.name);
    if (!k) continue;
    byName.set(k, [...(byName.get(k) ?? []), e.employee_id]);
  }
  for (const p of targets) {
    const name = driverName.get(p.driver_id!);
    if (!name) continue; // 비활성 직원은 연결 대상에서 뺍니다.
    const cands = byName.get(name) ?? [];
    if (cands.length > 1) {
      out.ambiguous++;
      continue;
    }
    const id = cands[0];
    if (!id || takenSet.has(id)) {
      out.notFound++;
      continue;
    }
    // 빈 칸일 때만 — 이미 연결된 값은 덮어쓰지 않습니다.
    const { error, count } = await supabaseAdmin
      .from("employee_profiles")
      .update({ erp_employee_id: id }, { count: "exact" })
      .eq("id", p.id)
      .is("erp_employee_id", null);
    if (error) {
      if (error.code === "23505") out.ambiguous++;
      continue;
    }
    if (count) {
      out.linked++;
      takenSet.add(id);
    }
  }
  return out;
}

// --- 전체 실행 -------------------------------------------------------------
export type ErpSyncSummary = { trigger: ErpSyncTrigger; results: ErpRunResult[]; link: ErpLinkSummary | null; linkError: string | null };

export async function runErpSync(trigger: ErpSyncTrigger): Promise<ErpSyncSummary> {
  const results: ErpRunResult[] = [];
  // 직원·휴가·코드 먼저(작고 다른 표의 기준), 그다음 기간 API.
  results.push(await syncEmployees(trigger));
  results.push(await syncLeaveBalances(trigger));
  results.push(await syncCodes(trigger));
  for (const spec of DATED) results.push(await syncDated(spec, trigger));
  let link: ErpLinkSummary | null = null;
  let linkError: string | null = null;
  try {
    link = await autoLinkEmployees();
  } catch (e) {
    linkError = e instanceof Error ? e.message : String(e);
  }
  return { trigger, results, link, linkError };
}

// 로그 한 줄 — API 별 건수·성공 여부만(값 없음).
export function formatErpSyncSummary(s: ErpSyncSummary): string {
  const parts = s.results.map((r) => `${r.api}:${r.ok ? "ok" : "FAIL"} ${r.fetched}/${r.upserted}/${r.removed}`);
  const link = s.link ? ` · 직원연결 +${s.link.linked} (모호 ${s.link.ambiguous}, 없음 ${s.link.notFound})` : "";
  return `[erp-sync ${s.trigger}] ${parts.join(" · ")}${link}`;
}
