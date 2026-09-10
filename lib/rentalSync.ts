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
//   * 실패는 throw 하지 않고 { ok:false, message } 로 돌려줍니다 — Cron 은
//     500 을 내되, 화면(수동 버튼)은 조회 자체를 막지 않아야 합니다.
//   * "use server" 아님 — 라우트/액션이 각자 인증 후 호출(lib/mailCollector 와 동일).
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendSlack, siteBaseUrl, slackLink } from "@/lib/slack";
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
    message:
      stats.incomplete.length > 0
        ? `일부 구간(${stats.incomplete.join(", ")})은 응답 상한을 넘겨 불완전할 수 있습니다.`
        : undefined,
  };
}
