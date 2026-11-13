// =====================================================================
// 홈페이지 대관예약 동기화 코어 (Cron / 수동버튼 공용).
//
//   흐름: 업체 API(GET /api/rentalExport) → list → reservation_no upsert.
//
//   ★ 지난 기간을 매번 다시 받는 이유는 "취소 갱신" 입니다.
//     확정(Y) 이던 예약이 나중에 취소(C)로 바뀌므로, 새 예약만 받아오면
//     우리 DB 에는 취소된 건이 영원히 '확정'으로 남습니다. 그래서 기본 창을
//     과거까지 넓게 잡고(오늘-180일), 이미 있는 행도 upsert 로 덮습니다.
//     → 이 동기화는 "증분 추가" 가 아니라 "창 전체 재복제" 입니다.
//
//   ★ 홈페이지에서 '삭제'된 예약 (2026-11)
//     취소(C)와 달리 삭제는 API 응답에서 행이 아예 사라집니다. upsert 만 하면 그 행이
//     DB 에 '확정'으로 계속 남아(8~11월 148건 실측) 실적·통계가 부풀었습니다.
//     → 조회한 창 안에서 이번 응답에 없는 행에 removed_at 을 찍습니다(행은 지우지
//       않음). 다시 나타나면 upsert 가 removed_at=null 로 되돌립니다.
//     안전장치: 응답 0건·오류·잘린 구간(incomplete)이면 표시하지 않고, 창 안 살아
//       있는 행의 20% 넘게 한 번에 사라지면 표시하지 않고 관장 DM 으로 경고합니다
//       (API 장애로 빈/부분 응답이 왔을 때 멀쩡한 예약을 대량으로 빼는 것을 막음).
//
//   * 실패는 throw 하지 않고 { ok:false, message } 로 돌려줍니다 — Cron 은
//     500 을 내되, 화면(수동 버튼)은 조회 자체를 막지 않아야 합니다.
//   * "use server" 아님 — 라우트/액션이 각자 인증 후 호출(lib/mailCollector 와 동일).
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  sendSlack,
  sendSlackDMToUser,
  siteBaseUrl,
  slackLink,
} from "@/lib/slack";
import { fmtKstDateTime } from "@/lib/datetime";
import { kstTodayYmd } from "@/lib/trainings";
import { RENTAL_TABLE, toRentalUpsert, type RentalApiItem } from "@/lib/rental";

const API_URL = "https://www.onnainna.kr/api/rentalExport";

// --- 동기화 창 ---
//   과거 180일 + 미래 185일 = 365일. API 상한(366일) 안쪽으로 하루 남깁니다
//   (윤년·경계 계산이 한 칸 어긋나도 400 이 나지 않도록).
const WINDOW_BACK_DAYS = 180;
const WINDOW_AHEAD_DAYS = 185;

// API 는 1회 응답을 10,000건에서 잘라내고 truncated:true 를 줍니다(실측).
//   현재 물량이 하루 약 75건이라 365일 창은 약 27,000건 → 반드시 분할됩니다.
const SPLIT_MAX_DEPTH = 8; // 365일을 하루 단위까지 쪼개도 9단계 안쪽
const UPSERT_CHUNK = 500; // 1회 upsert 행수 — 요청 본문 크기 대비
const FETCH_TIMEOUT_MS = 30_000;

// --- 실행 기록 / 실패 알림 ---
//   settings 는 프로젝트 공용 Key-Value 테이블(lib/mailCollector 의
//   mail_last_fetch_at 과 같은 방식). 상태 하나 때문에 테이블을 만들지 않습니다.
const LAST_SYNC_KEY = "rental_last_sync_at";
const ALERT_KEY = "rental_sync_alert_at";
// Cron 이 1일 1회라 억제 간격도 하루 — 같은 실패로 도배되지 않게 합니다.
const ALERT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const ALERT_WEBHOOK = "SLACK_WEBHOOK_ADMIN";

// --- 삭제 표시 안전장치 ---
//   한 번에 창 안 살아 있는 행의 이 비율을 넘게 사라지면 표시하지 않습니다.
export const REMOVE_MAX_RATIO = 0.2;
// 경고 DM 받는 사람 — 관장. lib/pendingDigest 와 같은 슬랙 ID.
const REMOVE_GUARD_DM_USER = "U0ADUPN08Q3";
const REMOVE_GUARD_ALERT_KEY = "rental_remove_guard_alert_at";

export type RentalSyncResult = {
  ok: boolean;
  message?: string;
  upserted: number; // DB 에 쓴 행수(중복 제거 후)
  fetched: number; // API 가 준 행수(중복 포함)
  calls: number; // API 호출 횟수(분할 포함)
  window: { start: string; end: string };
  // 하루 단위까지 쪼갰는데도 10,000건을 넘겨 일부를 못 받은 구간.
  //   비어 있어야 정상 — 값이 있으면 그 날짜의 데이터가 불완전합니다.
  incomplete: string[];
  byType: Record<string, number>; // 구분별 행수 — rental/room 양쪽이 왔는지 확인용
  // 이번에 '삭제됨'으로 표시한 행수 / 표시가 풀린(다시 나타난) 행수.
  removed: number;
  restored: number;
  // 표시를 건너뛴 사유(0건·잘린 구간·20% 초과·확인 실패). 없으면 null.
  removeSkipped: string | null;
  // 표시·해제가 일어난 대관일의 월("YYYY-MM") — 사업실적 재계산 대상.
  changedMonths: string[];
};

// --- 날짜 유틸 (UTC 고정) ---
//   대관일은 "YYYY-MM-DD" 문자열이고 시각 개념이 없으므로, 로컬 타임존이
//   끼어들어 하루 밀리지 않게 전부 UTC 로 계산합니다.
function ymdToUtc(ymd: string): number {
  return Date.parse(`${ymd}T00:00:00Z`);
}

function utcToYmd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(ymd: string, days: number): string {
  return utcToYmd(ymdToUtc(ymd) + days * 86_400_000);
}

// 기본 동기화 창 — 오늘(KST) 기준.
export function defaultRentalWindow(): { start: string; end: string } {
  const today = kstTodayYmd();
  return {
    start: addDays(today, -WINDOW_BACK_DAYS),
    end: addDays(today, WINDOW_AHEAD_DAYS),
  };
}

// --- settings key-value ---
async function readMark(key: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error || !data) return null;
  const value = (data as { value: unknown }).value;
  return value == null ? null : String(value);
}

async function writeMark(key: string, value: string): Promise<void> {
  // key 에 unique 제약 → upsert. select 후 insert/update 로 나누면 Cron 과
  //   수동 버튼이 겹칠 때 충돌합니다(lib/mailCollector 와 같은 이유).
  await supabaseAdmin
    .from("settings")
    .upsert({ key, value }, { onConflict: "key" });
}

// 마지막 동기화 시각. 화면에 "언제 기준 데이터인가" 를 보여주는 용도입니다.
export async function readRentalLastSyncAt(): Promise<string | null> {
  try {
    return await readMark(LAST_SYNC_KEY);
  } catch {
    return null;
  }
}

// 기록 실패는 삼킵니다 — 상태 표시용이므로, 여기서 throw 하면 복제라는
//   본 작업이 부가기능 때문에 멈춥니다(프로젝트 원칙).
async function markLastSync(at: Date): Promise<void> {
  try {
    await writeMark(LAST_SYNC_KEY, at.toISOString());
  } catch (e) {
    console.warn(
      "[rental] 마지막 동기화 시각 기록 실패:",
      e instanceof Error ? e.message : e
    );
  }
}

async function clearAlertMark(): Promise<void> {
  try {
    await supabaseAdmin.from("settings").delete().eq("key", ALERT_KEY);
  } catch (e) {
    console.warn(
      "[rental] 실패 알림 억제 해제 실패:",
      e instanceof Error ? e.message : e
    );
  }
}

// 동기화 실패 슬랙 알림 — 하루 1회만.
//   ★ 알림은 부가기능 — 여기서 무슨 일이 생겨도 절대 throw 하지 않습니다.
//   실제로 발송된 경우에만 억제 기록을 남기므로, 웹훅을 나중에 넣으면
//   그 즉시 알림이 나갑니다(lib/mailCollector notifyFetchFailure 와 동일).
async function notifySyncFailure(message: string): Promise<void> {
  try {
    const now = new Date();
    const last = await readMark(ALERT_KEY);
    if (last) {
      const at = Date.parse(last);
      if (!Number.isNaN(at) && now.getTime() - at < ALERT_INTERVAL_MS) return;
    }
    const base = siteBaseUrl();
    const link = base
      ? slackLink(`${base}/hr/facility/rentals`, "대관예약 조회 열기")
      : "/hr/facility/rentals";
    const lines = [
      "🚨 홈페이지 대관예약을 가져오지 못했습니다. 화면에는 이전 동기화 결과가 남아 있어, 최근 신청·취소가 빠져 보일 수 있습니다.",
      `실패 시각: ${fmtKstDateTime(now.toISOString())} (KST)`,
      `오류: ${message}`,
      "※ 같은 실패가 반복돼도 이 알림은 하루 1회만 보냅니다.",
      link,
    ];
    const sent = await sendSlack(ALERT_WEBHOOK, lines.join("\n"));
    if (sent) await writeMark(ALERT_KEY, now.toISOString());
  } catch (e) {
    console.warn(
      "[rental] 실패 알림 발송 실패:",
      e instanceof Error ? e.message : e
    );
  }
}

// --- API 호출 ---
//   인증은 X-API-Key 헤더로만 합니다. 쿼리스트링 key= 도 받아주지만 그쪽은
//   서버 접근 로그에 키가 그대로 남으므로 쓰지 않습니다.
type FetchedRange = { list: RentalApiItem[]; truncated: boolean };

async function fetchRange(
  apiKey: string,
  start: string,
  end: string
): Promise<FetchedRange> {
  const url = new URL(API_URL);
  url.searchParams.set("start_date", start);
  url.searchParams.set("end_date", end);
  // ★ type=all 은 반드시 명시 — 빼먹으면 청소년 공간(room)이 누락됩니다.
  url.searchParams.set("type", "all");
  // status 는 보내지 않습니다 — 확정/신청중/취소를 전부 받아 우리가 저장하고,
  //   무엇을 보여줄지는 화면 필터가 정합니다(취소 갱신도 이래야 들어옵니다).

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "X-API-Key": apiKey, Accept: "application/json" },
      cache: "no-store",
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  // 본문을 먼저 텍스트로 읽습니다 — 오류일 때 JSON 이 아닐 수 있고, 그때
  //   "JSON 파싱 실패" 만 남으면 원인(401·503 본문)을 못 봅니다.
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(
      `대관 API 응답을 해석할 수 없습니다 (HTTP ${res.status}): ${text.slice(0, 200)}`
    );
  }
  const obj = (body ?? {}) as Record<string, unknown>;

  if (obj.result === "error" || !res.ok) {
    const code = obj.error_code ? `${obj.error_code} ` : "";
    const msg = obj.error_msg ? String(obj.error_msg) : `HTTP ${res.status}`;
    throw new Error(`대관 API 오류 (${code}${start}~${end}): ${msg}`);
  }
  if (obj.result !== "ok") {
    throw new Error(
      `대관 API 응답이 정상(ok)이 아닙니다 (${start}~${end}): ${String(obj.result)}`
    );
  }

  return {
    list: Array.isArray(obj.list) ? (obj.list as RentalApiItem[]) : [],
    truncated: obj.truncated === true,
  };
}

// truncated:true 면 기간을 반으로 쪼개 재귀 호출합니다.
//   * dedupe: reservation_no 기준 Map. 같은 번호가 두 번 들어오면 Postgres
//     ON CONFLICT 가 "cannot affect row a second time" 로 청크 전체를
//     실패시키므로, DB 에 보내기 전에 반드시 접어야 합니다.
//   * 하루까지 쪼갰는데도 잘리면(하루 10,000건 초과) 더 쪼갤 수 없으므로,
//     받은 만큼만 쓰고 그 날짜를 incomplete 에 남겨 보고합니다.
async function collectRange(
  apiKey: string,
  start: string,
  end: string,
  out: Map<number, RentalApiItem>,
  stats: { calls: number; fetched: number; incomplete: string[] },
  depth: number
): Promise<void> {
  const { list, truncated } = await fetchRange(apiKey, start, end);
  stats.calls += 1;

  const keep = () => {
    stats.fetched += list.length;
    for (const item of list) {
      const no = Number(item.reservation_no);
      if (Number.isInteger(no)) out.set(no, item);
    }
  };

  if (!truncated) {
    keep();
    return;
  }

  if (start === end || depth >= SPLIT_MAX_DEPTH) {
    // 더 쪼갤 수 없음 — 받은 만큼은 살리고, 불완전 구간으로 기록합니다.
    keep();
    stats.incomplete.push(start === end ? start : `${start}~${end}`);
    console.warn(
      `[rental] ${start}~${end} 구간이 응답 상한을 넘겨 일부만 받았습니다.`
    );
    return;
  }

  // 잘린 응답은 버리고 반씩 다시 받습니다(어차피 분할 호출이 같은 행을
  //   다시 가져오므로, 부분 결과를 섞어두면 집계만 헷갈립니다).
  const mid = utcToYmd(
    ymdToUtc(start) +
      Math.floor((ymdToUtc(end) - ymdToUtc(start)) / 86_400_000 / 2) *
        86_400_000
  );
  await collectRange(apiKey, start, mid, out, stats, depth + 1);
  await collectRange(apiKey, addDays(mid, 1), end, out, stats, depth + 1);
}

// --- 삭제 표시 ---
export type ExistingRentalRow = {
  reservation_no: number;
  reservation_date: string;
  removed_at: string | null;
};

// 창 안의 기존 행(살아 있는 것 + 이미 표시된 것) — upsert 전에 읽어야 '다시
//   나타난' 행을 알 수 있습니다(upsert 가 removed_at 을 null 로 덮으므로).
async function loadExistingInWindow(window: {
  start: string;
  end: string;
}): Promise<ExistingRentalRow[]> {
  const out: ExistingRentalRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from(RENTAL_TABLE)
      .select("reservation_no,reservation_date,removed_at")
      .gte("reservation_date", window.start)
      .lte("reservation_date", window.end)
      .order("reservation_no")
      .range(from, from + 999);
    if (error) throw new Error(`기존 대관예약 확인 실패: ${error.message}`);
    const page = (data ?? []) as ExistingRentalRow[];
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

async function markRemoved(nos: number[], at: string): Promise<void> {
  for (let i = 0; i < nos.length; i += 200) {
    const { error } = await supabaseAdmin
      .from(RENTAL_TABLE)
      .update({ removed_at: at })
      .in("reservation_no", nos.slice(i, i + 200))
      .is("removed_at", null);
    if (error) throw new Error(`삭제된 예약 표시 실패: ${error.message}`);
  }
}

// 20% 초과 경고 — 하루 1회. 부가기능이라 절대 throw 하지 않습니다.
async function notifyRemoveGuard(
  missing: number,
  active: number,
  window: { start: string; end: string }
): Promise<void> {
  try {
    const now = new Date();
    const last = await readMark(REMOVE_GUARD_ALERT_KEY);
    if (last) {
      const at = Date.parse(last);
      if (!Number.isNaN(at) && now.getTime() - at < ALERT_INTERVAL_MS) return;
    }
    const pct = active > 0 ? Math.round((missing / active) * 100) : 0;
    const base = siteBaseUrl();
    const text = [
      "⚠️ 홈페이지 대관예약 동기화: 한 번에 너무 많은 예약이 홈페이지 응답에서 사라졌습니다.",
      `기간 ${window.start} ~ ${window.end} · 기존 ${active.toLocaleString("ko-KR")}건 중 ${missing.toLocaleString("ko-KR")}건(${pct}%)이 응답에 없음`,
      `${Math.round(REMOVE_MAX_RATIO * 100)}%를 넘어 홈페이지 장애일 수 있어 '삭제됨' 표시를 하지 않았습니다(집계는 그대로). 실제로 지운 것이 맞는지 홈페이지에서 확인해 주세요.`,
      "※ 같은 상황이 반복돼도 이 DM 은 하루 1회만 보냅니다.",
      base ? slackLink(`${base}/hr/facility/rentals`, "대관예약 조회 열기") : "",
    ]
      .filter(Boolean)
      .join("\n");
    const res = await sendSlackDMToUser(REMOVE_GUARD_DM_USER, text);
    if (res.ok) await writeMark(REMOVE_GUARD_ALERT_KEY, now.toISOString());
  } catch (e) {
    console.warn(
      "[rental] 삭제 경고 DM 실패:",
      e instanceof Error ? e.message : e
    );
  }
}

export type RemovalPlan = {
  toRemove: ExistingRentalRow[]; // 이번에 표시할 행(건너뛰면 빈 배열)
  restored: ExistingRentalRow[]; // 표시돼 있었는데 다시 나타난 행
  missing: number; // 응답에 없는 살아 있는 행수(건너뛰어도 셈)
  active: number; // 창 안 살아 있는 행수
  skipped: string | null;
  overLimit: boolean;
};

// 기존 행과 이번 응답을 비교해 표시할 것·풀릴 것을 정합니다(DB 접근 없음).
export function planRemoval(
  existing: ExistingRentalRow[],
  seen: Set<number>,
  opts: { fetched: number; incomplete: string[] }
): RemovalPlan {
  const active = existing.filter((r) => r.removed_at == null);
  const missing = active.filter((r) => !seen.has(r.reservation_no));
  const restored = existing.filter(
    (r) => r.removed_at != null && seen.has(r.reservation_no)
  );
  const base = {
    restored,
    missing: missing.length,
    active: active.length,
  };
  if (opts.fetched === 0 || seen.size === 0)
    return { ...base, toRemove: [], skipped: "응답 0건", overLimit: false };
  if (opts.incomplete.length > 0)
    return {
      ...base,
      toRemove: [],
      skipped: `잘린 구간(${opts.incomplete.join(", ")})이 있어 표시 안 함`,
      overLimit: false,
    };
  if (missing.length > active.length * REMOVE_MAX_RATIO)
    return {
      ...base,
      toRemove: [],
      skipped: `응답에 없는 예약 ${missing.length}/${active.length}건 — ${Math.round(REMOVE_MAX_RATIO * 100)}% 초과로 표시 안 함`,
      overLimit: true,
    };
  return { ...base, toRemove: missing, skipped: null, overLimit: false };
}

// --- 저장 ---
type RentalUpsertRow = NonNullable<ReturnType<typeof toRentalUpsert>>;

async function upsertRows(rows: RentalUpsertRow[]): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await supabaseAdmin
      .from(RENTAL_TABLE)
      .upsert(chunk, { onConflict: "reservation_no" });
    if (error) {
      // 어느 청크에서 멈췄는지 남깁니다 — 부분 저장 상태를 알 수 있어야
      //   다음 동기화가 메꿀 범위를 판단할 수 있습니다.
      throw new Error(
        `대관예약 저장 실패 (${i + 1}~${i + chunk.length}번째 행): ${error.message}`
      );
    }
    written += chunk.length;
  }
  return written;
}

// =====================================================================
// 동기화 실행. 기간을 주지 않으면 기본 창(오늘-180일 ~ 오늘+185일).
//   반환값은 항상 객체 — 실패해도 throw 하지 않습니다.
// =====================================================================
export async function runRentalSync(opts?: {
  start?: string;
  end?: string;
}): Promise<RentalSyncResult> {
  const window =
    opts?.start && opts?.end
      ? { start: opts.start, end: opts.end }
      : defaultRentalWindow();
  const empty: RentalSyncResult = {
    ok: false,
    upserted: 0,
    fetched: 0,
    calls: 0,
    window,
    incomplete: [],
    byType: {},
    removed: 0,
    restored: 0,
    removeSkipped: null,
    changedMonths: [],
  };

  const apiKey = (process.env.RENTAL_API_KEY ?? "").trim();
  if (!apiKey) {
    // "설정이 없다" 와 "인증이 거부됐다" 는 화면·로그에서 구분돼야 합니다.
    const message =
      "대관 API 키(RENTAL_API_KEY)가 설정되지 않았습니다. .env.local 또는 Vercel 환경변수에 등록해주세요.";
    await notifySyncFailure(message);
    return { ...empty, message };
  }

  const stats = { calls: 0, fetched: 0, incomplete: [] as string[] };
  const collected = new Map<number, RentalApiItem>();

  try {
    await collectRange(apiKey, window.start, window.end, collected, stats, 0);
  } catch (e) {
    const message = e instanceof Error ? e.message : "대관 API 호출 실패";
    console.error("[rental] 동기화 실패:", message);
    await notifySyncFailure(message);
    return { ...empty, message, calls: stats.calls, fetched: stats.fetched };
  }

  const syncedAt = new Date();
  const rows: RentalUpsertRow[] = [];
  const byType: Record<string, number> = {};
  for (const item of collected.values()) {
    const row = toRentalUpsert(item, syncedAt.toISOString());
    if (!row) continue; // 예약번호·대관일이 없는 행은 저장하지 않습니다.
    rows.push(row);
    byType[row.reservation_type] = (byType[row.reservation_type] ?? 0) + 1;
  }

  // 삭제 표시 계획 — upsert 전에 기존 행을 읽어야 '다시 나타난' 행을 압니다.
  //   API 호출이 오류면 위에서 이미 return 했으므로 여기 오지 않습니다.
  let plan: RemovalPlan | null = null;
  let planError: string | null = null;
  try {
    const existing = await loadExistingInWindow(window);
    plan = planRemoval(existing, new Set(collected.keys()), {
      fetched: stats.fetched,
      incomplete: stats.incomplete,
    });
  } catch (e) {
    // 기존 행을 못 읽었으면 표시를 건너뜁니다(복제라는 본 작업은 계속).
    planError = e instanceof Error ? e.message : String(e);
    console.warn(`[rental] 삭제 표시 건너뜀: ${planError}`);
  }

  let upserted = 0;
  try {
    upserted = await upsertRows(rows);
  } catch (e) {
    const message = e instanceof Error ? e.message : "대관예약 저장 실패";
    console.error("[rental] 저장 실패:", message);
    await notifySyncFailure(message);
    return {
      ...empty,
      message,
      calls: stats.calls,
      fetched: stats.fetched,
      incomplete: stats.incomplete,
      byType,
    };
  }

  // 삭제 표시 — 저장이 성공한 뒤에만. 실패해도 동기화 자체는 성공으로 둡니다.
  let removed = 0;
  let removeSkipped: string | null = planError
    ? `기존 행 확인 실패: ${planError}`
    : null;
  const changed = new Set<string>();
  if (plan) {
    removeSkipped = plan.skipped;
    // 다시 나타난 행은 upsert 로 이미 풀렸습니다 — 그 달도 실적 재계산 대상.
    for (const r of plan.restored) changed.add(r.reservation_date.slice(0, 7));
    if (plan.overLimit) {
      console.warn(`[rental] ${plan.skipped}`);
      await notifyRemoveGuard(plan.missing, plan.active, window);
    } else if (plan.toRemove.length > 0) {
      try {
        await markRemoved(
          plan.toRemove.map((r) => r.reservation_no),
          syncedAt.toISOString()
        );
        removed = plan.toRemove.length;
        for (const r of plan.toRemove)
          changed.add(r.reservation_date.slice(0, 7));
      } catch (e) {
        removeSkipped = e instanceof Error ? e.message : String(e);
        console.warn(`[rental] ${removeSkipped}`);
      }
    }
  }

  // 여기까지 왔으면 호출·저장 모두 성공 — 이전 실패의 억제를 풀고 시각을 남깁니다.
  await clearAlertMark();
  await markLastSync(syncedAt);

  return {
    ok: true,
    upserted,
    fetched: stats.fetched,
    calls: stats.calls,
    window,
    incomplete: stats.incomplete,
    byType,
    removed,
    restored: plan?.restored.length ?? 0,
    removeSkipped,
    changedMonths: [...changed].sort(),
    message:
      stats.incomplete.length > 0
        ? `일부 구간(${stats.incomplete.join(", ")})은 응답 상한을 넘겨 불완전할 수 있습니다.`
        : undefined,
  };
}
