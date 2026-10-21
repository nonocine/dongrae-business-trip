// =====================================================================
// 의무교육 알림 — Cron(매일 KST 09:00) / 수동버튼(미리보기) 공용 코어.
//   * 판정은 lib/trainings.evaluateTraining 단일 출처(현황판·내 의무교육과 같음).
//     신규 입사자는 교육별 new_hire_rule 에 따른 개인 기한으로 셉니다.
//   * 본인 DM: 개인 기한 14일 전·3일 전·당일, 지나면 매주 화요일 1회.
//     같은 교육·같은 시점은 training_notification_log 로 한 번만.
//   * 신규 입사 환영 DM: 입사일이 최근 30일 안인 직원에게 한 번 — 올해 받아야
//     할 교육(대상인 것만)·개인 기한·수료증 올리는 곳. 기능 첫 실행(welcome
//     기록 0건)에만 90일 안까지 넓혀 도입 직전 입사자도 받게 합니다.
//   * 공개 채널(SLACK_WEBHOOK_TRAINING = #0_독촉자)은 화요일에 숫자 요약만.
//     이름은 싣지 않고, 지난번과 숫자가 같으면 올리지 않습니다.
//     이름 있는 상세 명단은 인사 파일 열람 보유자(관장·부장·관장이 지정한 사람)에게만 DM.
//   * 실제 발송은 TRAINING_NOTIFY_LIVE=1 일 때만(관장 확인 후 켬). 그 전에는
//     의무교육 부분은 dry-run — 무엇이 나갈지만 계산해 돌려줍니다.
//   * SA-14: 같은 Cron 에 성범죄경력조회 만료 스캔을 얹는다(별도 Cron 만들지 않음).
//     단 발송 채널은 분리 — SLACK_WEBHOOK_ADMIN 으로 별도 1건. 강사는 슬랙 미가입
//     → 개인 DM 없음. Cron 이 매일로 바뀌어 화요일에만 보냅니다(종전 주 1회 그대로).
//   * MU-3: 상조회 블록(생일 축하금 대상·연말상여 제안) — 화요일에만, 요약 채널로
//     별도 1건(종전과 같음 — 연말상여 제안은 12/1 이 화요일인 해에만 뜹니다).
//   * 슬랙 발송은 부가기능 — 전부 실패해도 throw 하지 않음. DB 조회 실패만 throw.
//   * "use server" 아님 — 라우트/액션이 각자 인증 후 호출.
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  sendSlack,
  sendSlackDMDetailed,
  siteBaseUrl,
  slackLink,
} from "@/lib/slack";
import {
  kstTodayYmd,
  addDaysYmd,
  toTraining,
  cellKey,
  sortTrainings,
  evaluateTraining,
  needsTargetList,
  dueLabel,
  targetReasonLabel,
  type MandatoryTraining,
  type TrainingEvaluation,
} from "@/lib/trainings";
import {
  loadTrainingRoster,
  loadTrainingTargets,
  type TrainingRosterEmployee,
} from "@/lib/trainingRoster";
import { isPersonnelHolder, PERSONNEL_ROLE_KEY } from "@/lib/personnel";
import { MASTER_EMAIL } from "@/lib/authConstants";
import {
  CRIME_CHECK_SLOT,
  crimeCheckState,
  needsCrimeCheckAction,
} from "@/lib/saemDocExpiry";
import {
  BIRTHDAY_AHEAD_DAYS,
  YEAR_END_BONUS_MIN_BALANCE,
  YEAR_END_BONUS_UNIT,
  birthdaysWithin,
  formatKRW,
  mutualCategory,
  normalizeKind,
  sumEntries,
} from "@/lib/mutual";

// 주 1회 블록(공개 요약·기한 지남 DM·관리자 명단·성범죄경력조회·상조회)을
//   보내는 요일 — 화(2). 종전 Cron(0 0 * * 2, KST 화 09:00)과 같은 요일입니다.
const WEEKLY_DOW = 2;
// 본인 DM 시점(개인 기한 기준 남은 일수). 창으로 판정해 Cron 이 하루 빠져도 놓치지 않습니다.
const STAGES = [
  { key: "d14", from: 4, to: 14 },
  { key: "d3", from: 1, to: 3 },
  { key: "d0", from: 0, to: 0 },
] as const;
// 공개 요약의 "곧 마감" 범위.
const SOON_DAYS = 7;
// 환영 DM — 입사일이 오늘 기준 이 일수 안이면 대상(입사일을 나중에 넣어도 잡히게).
const WELCOME_WINDOW_DAYS = 30;
// 기능 첫 실행(welcome 기록 0건)에만 넓히는 창 — 도입 직전 입사자 포함.
const WELCOME_FIRST_RUN_DAYS = 90;
const LOG_TABLE = "training_notification_log";

// 의무교육 요약(+상조회) 채널. 환경변수 미설정 시 기존 관리자 채널로 폴백.
function summaryWebhookKey(): string {
  return process.env.SLACK_WEBHOOK_TRAINING
    ? "SLACK_WEBHOOK_TRAINING"
    : "SLACK_WEBHOOK_ADMIN";
}

// 성범죄경력조회 경고 채널 — 교육 요약과 분리해 항상 관리자 채널로 보낸다.
const CRIME_CHECK_WEBHOOK = "SLACK_WEBHOOK_ADMIN";

// 직원×교육 판정 한 줄 — dry-run 표·관리자 상세 명단용.
export type TrainingEvalRow = {
  driverId: string;
  name: string;
  joinDate: string | null;
  trainingId: string;
  training: string;
  completed: boolean;
} & TrainingEvaluation;

export type PlannedDm = {
  kind: "reminder" | "welcome" | "admin-detail";
  to: string; // 직원 이름
  text: string;
  keys: string[]; // 발송 성공 시 남길 중복방지 키
  result: "sent" | "failed" | "dry-run";
  failReason?: string | null;
};

export type TrainingReminderSummary = {
  today: string;
  weekly: boolean; // 화요일 블록 실행 여부
  live: boolean; // 실제 발송 여부(false = dry-run)
  liveBlockedReason: string | null; // 켜려 했으나 막힌 이유(로그 테이블 없음 등)
  rows: TrainingEvalRow[];
  dms: PlannedDm[];
  publicSummary: {
    text: string;
    counts: SummaryCounts;
    post: boolean;
    skipReason: string | null;
  } | null;
  dmSent: number;
  dmFailed: number;
  unreachable: string[];
  crimeCheckTargets: number; // 성범죄경력조회 만료·임박·미제출 강사 수
  mutualBirthdays: number; // MU-3: 7일 내 생일 회원 수
  mutualBonusProposed: boolean; // MU-3: 연말상여 제안 발송 여부(12/1 하루만)
};

export type SummaryCounts = {
  people: number; // 미이수가 있는 직원 수
  items: number; // 미이수 건
  overdue: number; // 기한 지난 것
  soon: number; // 7일 내 마감
};

export type TrainingReminderOptions = {
  dryRun?: boolean; // true 면 무엇도 보내지 않고 계획만 돌려줍니다.
  today?: string; // 검증용 기준일 덮어쓰기(YYYY-MM-DD)
  // dry-run 전용 — 여러 날을 이어 시뮬레이션할 때 "이미 보낸 것"으로 칠 키.
  //   PlannedDm.keys 를 모아 넘기면 됩니다.
  assumeSentKeys?: ReadonlySet<string>;
};

// =====================================================================
// SA-14. 성범죄경력조회 만료 스캔 — active 강사만. 관리자 요약용 라인 반환.
//   조회 실패는 부가기능이므로 빈 배열로 넘긴다(의무교육 독촉을 막지 않음).
// =====================================================================
async function scanCrimeCheckLines(today: string): Promise<string[]> {
  try {
    const [{ data: ins }, { data: docs }] = await Promise.all([
      supabaseAdmin.from("saem_instructors").select("id, name, status"),
      supabaseAdmin
        .from("saem_instructor_documents")
        .select("instructor_id, slot, issued_on"),
    ]);
    const issuedById = new Map<string, string | null>();
    for (const d of docs ?? []) {
      const r = d as {
        instructor_id: string;
        slot: string;
        issued_on: string | null;
      };
      if (r.slot === CRIME_CHECK_SLOT)
        issuedById.set(r.instructor_id, r.issued_on ?? null);
    }

    const lines: string[] = [];
    for (const raw of ins ?? []) {
      const r = raw as { id: string; name: string; status: string | null };
      if (r.status === "inactive") continue; // 비활성 강사 제외
      const st = crimeCheckState(issuedById.get(r.id) ?? null, today);
      if (!needsCrimeCheckAction(st.status)) continue;
      // "만료 D-n" / "만료됨" / "미제출" — 뒤에 만료일을 괄호로 덧붙인다.
      const detail =
        st.status === "missing"
          ? "미제출"
          : st.status === "expired"
            ? `만료됨${st.expiresOn ? ` (만료일 ${st.expiresOn})` : ""}`
            : `${st.dday === 0 ? "오늘 만료" : `만료 D-${st.dday}`}${
                st.expiresOn ? ` (${st.expiresOn})` : ""
              }`;
      lines.push(`• ${r.name} — ${detail}`);
    }
    return lines.sort((a, b) => a.localeCompare(b, "ko"));
  } catch {
    return [];
  }
}

// 성범죄경력조회 경고 — 교육 요약과 별개 메시지로 관리자 채널에 1건.
//   대상 0명이면 아무것도 보내지 않는다(빈 알림 금지).
async function sendCrimeCheckAlert(
  today: string,
  lines: string[]
): Promise<void> {
  if (lines.length === 0) return;
  await sendSlack(
    CRIME_CHECK_WEBHOOK,
    [`⚠️ 성범죄경력조회 갱신 필요 (${today})`, ...lines].join("\n")
  );
}

// =====================================================================
// MU-3. 상조회 스캔 — 관리자 요약용 라인 + 요약 카운트.
//   ① 향후 7일 내 활동 회원 생일 → 축하금 지급 대상
//   ② 12월 1일 하루만: 잔액 ≥ 200만이면 연말 상여 제안
//   조회 실패는 부가기능이므로 빈 결과로 넘긴다(의무교육 독촉을 막지 않음).
// =====================================================================
type MutualScan = { lines: string[]; birthdays: number; bonusProposed: boolean };

async function scanMutual(today: string): Promise<MutualScan> {
  const empty: MutualScan = { lines: [], birthdays: 0, bonusProposed: false };
  try {
    const { data: mems } = await supabaseAdmin
      .from("mutual_members")
      .select("employee_id, status")
      .eq("status", "active");
    const activeIds = (mems ?? []).map((m) =>
      String((m as { employee_id: string }).employee_id)
    );
    if (activeIds.length === 0) return empty;

    const [{ data: drivers }, { data: profs }] = await Promise.all([
      supabaseAdmin.from("drivers").select("id, name").in("id", activeIds),
      supabaseAdmin
        .from("employee_profiles")
        .select("driver_id, birth_date")
        .in("driver_id", activeIds),
    ]);
    const nameById = new Map(
      (drivers ?? []).map((d) => [
        String((d as { id: string }).id),
        String((d as { name: string }).name ?? ""),
      ])
    );
    const birthById = new Map(
      (profs ?? []).map((p) => [
        String((p as { driver_id: string }).driver_id),
        ((p as { birth_date: string | null }).birth_date ?? null) as string | null,
      ])
    );

    const lines: string[] = [];

    // ① 생일 — 축하금 지급 대상.
    const cash = mutualCategory("birthday_cash");
    const cashAmount =
      cash && cash.rule.type === "fixed" ? cash.rule.amount : 0;
    const soon = birthdaysWithin(
      activeIds.map((id) => ({
        name: nameById.get(id) ?? "(이름 없음)",
        birthDate: birthById.get(id) ?? null,
      })),
      today,
      BIRTHDAY_AHEAD_DAYS
    );
    for (const b of soon) {
      const when = b.dday === 0 ? "오늘" : `${b.dday}일 뒤`;
      lines.push(
        `• 🎂 ${b.name}(${b.monthDay}) ${when} — 축하금 ${formatKRW(cashAmount)} 지급 대상`
      );
    }

    // ② 연말 상여 제안 — 12월 1일 하루만.
    let bonusProposed = false;
    if (today.slice(5) === "12-01") {
      const { data: all } = await supabaseAdmin
        .from("mutual_ledger")
        .select("kind, amount, entry_date");
      const balance = sumEntries(
        ((all ?? []) as Record<string, unknown>[]).map((r) => ({
          entry_date: String(r.entry_date ?? ""),
          kind: normalizeKind(r.kind),
          amount: Math.round(Number(r.amount) || 0),
        }))
      ).net;
      if (balance >= YEAR_END_BONUS_MIN_BALANCE) {
        const total = activeIds.length * YEAR_END_BONUS_UNIT;
        lines.push(
          `• 🎁 연말 상여 조건 충족(잔액 ${formatKRW(balance)}원, 회원 ${
            activeIds.length
          }명 × ${formatKRW(YEAR_END_BONUS_UNIT)} = ${formatKRW(total)}원)`
        );
        bonusProposed = true;
      }
    }

    return { lines, birthdays: soon.length, bonusProposed };
  } catch {
    return empty;
  }
}

// 관리자 상세 명단 DM 수신자 = 인사 파일 열람(personnel) 보유자 — 관장·부장·master 자동 +
//   관장이 지정한 사람(lib/personnel.ts). ★ 2026-10 관장 결정: 미이수자 이름·기한은 인사
//   파일이라 hr 직무·권한등급 M0 만으로는 받지 않습니다.
async function loadAdminRecipients(
  roster: TrainingRosterEmployee[],
): Promise<TrainingRosterEmployee[]> {
  const ids = roster.map((e) => e.driver_id);
  if (ids.length === 0) return [];
  const { data: roles, error: rErr } = await supabaseAdmin
    .from("employee_roles")
    .select("driver_id, role_key")
    .in("driver_id", ids)
    .eq("role_key", PERSONNEL_ROLE_KEY);
  if (rErr) throw new Error(rErr.message);
  const granted = new Set(
    ((roles ?? []) as Record<string, unknown>[]).map((r) =>
      String(r.driver_id ?? ""),
    ),
  );
  return roster.filter((e) =>
    isPersonnelHolder({
      rank: e.rank,
      isMaster: !!e.email && e.email.trim().toLowerCase() === MASTER_EMAIL,
      roles: granted.has(e.driver_id) ? [PERSONNEL_ROLE_KEY] : [],
    }),
  );
}

// 중복방지 기록 — 테이블이 없으면 available=false(그때는 실제 발송을 막습니다).
type NotifyLog = {
  available: boolean;
  keys: Set<string>;
  lastSummary: SummaryCounts | null;
  hasWelcome: boolean; // welcome 기록이 하나라도 있는지(없으면 첫 실행)
};

async function loadNotifyLog(today: string): Promise<NotifyLog> {
  const since = `${addDaysYmd(today, -400)}T00:00:00Z`;
  const keys = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from(LOG_TABLE)
      .select("dedup_key")
      .gte("sent_at", since)
      .order("dedup_key")
      .range(from, from + PAGE - 1);
    if (error)
      return { available: false, keys, lastSummary: null, hasWelcome: false };
    for (const r of (data ?? []) as { dedup_key: string }[]) keys.add(r.dedup_key);
    if (!data || data.length < PAGE) break;
  }
  const { data: last } = await supabaseAdmin
    .from(LOG_TABLE)
    .select("payload")
    .eq("kind", "public_summary")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const payload = (last as { payload?: SummaryCounts } | null)?.payload ?? null;
  // 기간 제한 없이 확인 — 첫 실행 판정이 400일 창에 좌우되지 않게.
  const { count } = await supabaseAdmin
    .from(LOG_TABLE)
    .select("dedup_key", { count: "exact", head: true })
    .eq("kind", "welcome");
  return {
    available: true,
    keys,
    lastSummary: payload,
    hasWelcome: (count ?? 0) > 0,
  };
}

async function writeNotifyLog(
  rows: {
    dedup_key: string;
    kind: string;
    driver_id?: string | null;
    training_id?: string | null;
    payload?: unknown;
  }[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabaseAdmin
    .from(LOG_TABLE)
    .upsert(rows, { onConflict: "dedup_key", ignoreDuplicates: true });
  if (error) console.warn(`[training-notify] 기록 실패: ${error.message}`);
}

const sameCounts = (a: SummaryCounts | null, b: SummaryCounts) =>
  !!a &&
  a.people === b.people &&
  a.items === b.items &&
  a.overdue === b.overdue &&
  a.soon === b.soon;

function dowOf(ymd: string): number {
  return new Date(`${ymd}T00:00:00Z`).getUTCDay();
}

// 본인 DM 시점 — 기한 전은 STAGES 창, 지나면 화요일만 "overdue".
function stageOf(dday: number, weekly: boolean): string | null {
  if (dday < 0) return weekly ? "overdue" : null;
  return STAGES.find((s) => dday >= s.from && dday <= s.to)?.key ?? null;
}

export async function runTrainingReminder(
  opts: TrainingReminderOptions = {},
): Promise<TrainingReminderSummary> {
  const today = opts.today ?? kstTodayYmd();
  const year = Number(today.slice(0, 4));
  const weekly = dowOf(today) === WEEKLY_DOW;
  const dryRun = opts.dryRun === true;

  // SA-14 / MU-3 — 화요일에만(종전 주 1회 Cron 과 같음). 의무교육 발송 스위치와 무관.
  const [crimeLines, mutual] = await Promise.all([
    weekly ? scanCrimeCheckLines(today) : Promise.resolve([] as string[]),
    weekly
      ? scanMutual(today)
      : Promise.resolve<MutualScan>({ lines: [], birthdays: 0, bonusProposed: false }),
  ]);
  if (!dryRun) {
    await sendCrimeCheckAlert(today, crimeLines);
    if (mutual.lines.length > 0) {
      await sendSlack(
        summaryWebhookKey(),
        [`🤲 상조회 알림 (${today})`, ...mutual.lines].join("\n"),
      );
    }
  }

  // 1) 올해 활성 교육 + 재직자 + 이수기록 + 지정 명단.
  const { data: trsRaw, error: tErr } = await supabaseAdmin
    .from("mandatory_trainings")
    .select("*")
    .eq("year", year)
    .eq("is_active", true);
  if (tErr) throw new Error(tErr.message);
  const trainings: MandatoryTraining[] = sortTrainings(
    (trsRaw ?? []).map((r) => toTraining(r as Record<string, unknown>)),
  );
  const roster = await loadTrainingRoster();
  const ids = trainings.map((t) => t.id);
  const [compsRes, targetsByTraining, admins, log] = await Promise.all([
    ids.length
      ? supabaseAdmin
          .from("training_completions")
          .select("training_id, driver_id")
          .in("training_id", ids)
      : Promise.resolve({ data: [] as Record<string, unknown>[], error: null }),
    loadTrainingTargets(trainings.filter(needsTargetList).map((t) => t.id)),
    loadAdminRecipients(roster),
    loadNotifyLog(today),
  ]);
  if (compsRes.error) throw new Error(compsRes.error.message);
  const done = new Set<string>();
  for (const c of compsRes.data ?? []) {
    const r = c as Record<string, unknown>;
    done.add(cellKey(String(r.training_id ?? ""), String(r.driver_id ?? "")));
  }

  if (dryRun) {
    for (const k of opts.assumeSentKeys ?? []) {
      log.keys.add(k);
      if (k.startsWith("welcome:")) log.hasWelcome = true;
    }
  }

  const wantLive = !dryRun && process.env.TRAINING_NOTIFY_LIVE === "1";
  const liveBlockedReason =
    wantLive && !log.available
      ? `${LOG_TABLE} 테이블이 없어 중복 방지를 할 수 없습니다 — dry-run 으로만 실행`
      : null;
  const live = wantLive && log.available;

  // 2) 판정 — 직원×교육 전부(evaluateTraining 단일 출처).
  const rows: TrainingEvalRow[] = [];
  for (const emp of roster) {
    for (const t of trainings) {
      const completed = done.has(cellKey(t.id, emp.driver_id));
      const ev = evaluateTraining(
        t,
        emp,
        targetsByTraining.get(t.id),
        today,
        completed,
      );
      rows.push({
        driverId: emp.driver_id,
        name: emp.name,
        joinDate: emp.joinDate,
        trainingId: t.id,
        training: t.name,
        completed,
        ...ev,
      });
    }
  }
  const pendingRows = rows.filter((r) => r.isTarget && !r.completed);

  const base = siteBaseUrl() ?? "";
  const myUrl = `${base}/profile/hr#my-trainings`;
  const boardUrl = `${base}/hr/trainings`;
  const siteOf = new Map(trainings.map((t) => [t.id, t.site_url]));
  const itemLine = (r: TrainingEvalRow) => {
    const site = siteOf.get(r.trainingId);
    return `• *${r.training}* — ${dueLabel(r.dueDate, r.dday)}${
      site ? ` · ${slackLink(site, "수강 사이트")}` : ""
    }`;
  };

  // 3) 본인 DM 계획 — 환영 DM 이 나가는 날은 그 안에 묶습니다(같은 날 두 통 방지).
  //   중복방지 키: 시점:직원:교육:개인기한(기한이 바뀌면 다시 알림). 지남은 주차(오늘)까지.
  const dms: PlannedDm[] = [];
  const welcomeFrom = addDaysYmd(
    today,
    -(log.hasWelcome ? WELCOME_WINDOW_DAYS : WELCOME_FIRST_RUN_DAYS),
  );
  for (const emp of roster) {
    const mine = pendingRows.filter((r) => r.driverId === emp.driver_id);
    const stageKeys: string[] = [];
    const stageItems: TrainingEvalRow[] = [];
    for (const r of mine) {
      if (!r.dueDate || r.dday == null) continue;
      const stage = stageOf(r.dday, weekly);
      if (!stage) continue;
      const key = [stage, emp.driver_id, r.trainingId, r.dueDate]
        .concat(stage === "overdue" ? [today] : [])
        .join(":");
      if (log.keys.has(key)) continue;
      stageKeys.push(key);
      stageItems.push(r);
    }

    // 환영 DM 목록 = 올해 대상 교육 전부(대상 아닌 것은 뺌). 이미 이수한 것은 ✓ 로
    //   남깁니다 — 첫 실행 90일 창에는 이미 다 들은 직원도 들어오기 때문입니다.
    const welcomeKey = `welcome:${emp.driver_id}`;
    const targetsOfEmp = rows.filter(
      (r) => r.driverId === emp.driver_id && r.isTarget,
    );
    const isWelcome =
      !!emp.joinDate &&
      emp.joinDate >= welcomeFrom &&
      !log.keys.has(welcomeKey) &&
      targetsOfEmp.length > 0;
    if (isWelcome) {
      const list = [...targetsOfEmp].sort(
        (a, b) =>
          Number(a.completed) - Number(b.completed) ||
          (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"),
      );
      const remaining = list.filter((r) => !r.completed).length;
      dms.push({
        kind: "welcome",
        to: emp.name,
        text: [
          `👋 ${emp.name}님, 입사를 환영합니다!`,
          remaining > 0
            ? `올해 받아야 할 법정 의무교육 ${list.length}건(남은 것 ${remaining}건)과 개인 기한입니다.`
            : `올해 받아야 할 법정 의무교육 ${list.length}건을 모두 이수하셨습니다 ✓`,
          ...list.map((r) =>
            r.completed ? `• ✓ ${r.training} — 이수 완료` : itemLine(r),
          ),
          `수료 후 수료증을 동업자씨 ${slackLink(myUrl, "내 의무교육")}에 올리면 이수 처리됩니다.`,
        ].join("\n"),
        keys: [welcomeKey, ...stageKeys],
        result: "dry-run",
      });
      continue;
    }
    if (stageItems.length === 0) continue;
    const overdue = stageItems.some((r) => (r.dday ?? 0) < 0);
    dms.push({
      kind: "reminder",
      to: emp.name,
      text: [
        overdue
          ? "⏰ 이수 기한이 지난 법정 의무교육이 있습니다."
          : "⏰ 이수 기한이 다가오는 법정 의무교육이 있습니다.",
        ...stageItems.map(itemLine),
        `수료증 올리기: ${slackLink(myUrl, "동업자씨 내 의무교육")}`,
      ].join("\n"),
      keys: stageKeys,
      result: "dry-run",
    });
  }

  // 4) 공개 요약(화요일) — 이름 없이 숫자만. 지난번과 같으면 올리지 않습니다.
  let publicSummary: TrainingReminderSummary["publicSummary"] = null;
  let adminText: string | null = null;
  if (weekly) {
    const counts: SummaryCounts = {
      people: new Set(pendingRows.map((r) => r.driverId)).size,
      items: pendingRows.length,
      overdue: pendingRows.filter((r) => r.status === "overdue").length,
      soon: pendingRows.filter(
        (r) => r.dday != null && r.dday >= 0 && r.dday <= SOON_DAYS,
      ).length,
    };
    const text = [
      `📋 의무교육 미이수 현황 (${today})`,
      `미이수 ${counts.people}명 ${counts.items}건 · 기한 지난 것 ${counts.overdue}건 · ${SOON_DAYS}일 내 마감 ${counts.soon}건`,
      slackLink(boardUrl, "동업자씨 의무교육 현황 보기"),
    ].join("\n");
    const skipReason =
      counts.items === 0
        ? "미이수 없음"
        : sameCounts(log.lastSummary, counts)
          ? "지난번과 숫자가 같음"
          : null;
    publicSummary = { text, counts, post: skipReason == null, skipReason };

    // 이름 있는 상세 명단 — 공개 요약이 올라가는 주에만 관리자에게 DM.
    if (skipReason == null) {
      const sorted = [...pendingRows].sort(
        (a, b) =>
          (a.dday ?? 9999) - (b.dday ?? 9999) ||
          a.name.localeCompare(b.name, "ko"),
      );
      adminText = [
        `📋 의무교육 미이수 상세 (${today}) — 관장·부장·인사 파일 열람 권한자에게만 보내는 명단입니다.`,
        ...sorted.map(
          (r) =>
            `• ${r.name} — ${r.training} (${dueLabel(r.dueDate, r.dday)}${
              r.personalDue ? ", 개인 기한" : ""
            })`,
        ),
        slackLink(boardUrl, "의무교육 현황 보기"),
      ].join("\n");
    }
  }

  // 5) 발송(live) — 본인 DM 먼저(미연결 명단을 관리자 상세에 붙이기 위해).
  //   성공한 DM 만 기록 → 실패분은 다음 실행에서 다시 시도됩니다.
  let dmSent = 0;
  let dmFailed = 0;
  const unreachable: string[] = [];
  const empByName = new Map(roster.map((e) => [e.name, e]));
  if (live) {
    for (const dm of dms) {
      const emp = empByName.get(dm.to);
      const res = await sendSlackDMDetailed(emp?.email, dm.text);
      dm.result = res.ok ? "sent" : "failed";
      dm.failReason = res.reason;
      if (res.ok) {
        dmSent++;
        await writeNotifyLog(
          dm.keys.map((k) => ({
            dedup_key: k,
            kind: k.split(":")[0],
            driver_id: emp?.driver_id ?? null,
            training_id: k.split(":")[2] ?? null,
          })),
        );
      } else {
        dmFailed++;
        unreachable.push(dm.to);
      }
    }
  }

  if (adminText != null) {
    const text =
      unreachable.length > 0
        ? `${adminText}\n⚠️ 슬랙 미연결(DM 실패): ${unreachable.join(", ")}`
        : adminText;
    for (const a of admins) {
      const dm: PlannedDm = {
        kind: "admin-detail",
        to: a.name,
        text,
        keys: [],
        result: "dry-run",
      };
      if (live) {
        const res = await sendSlackDMDetailed(a.email, text);
        dm.result = res.ok ? "sent" : "failed";
        dm.failReason = res.reason;
      }
      dms.push(dm);
    }
  }

  if (live && publicSummary?.post) {
    const ok = await sendSlack(summaryWebhookKey(), publicSummary.text);
    if (ok) {
      await writeNotifyLog([
        {
          dedup_key: `public_summary:${today}`,
          kind: "public_summary",
          payload: publicSummary.counts,
        },
      ]);
    }
  }

  return {
    today,
    weekly,
    live,
    liveBlockedReason,
    rows,
    dms,
    publicSummary,
    dmSent,
    dmFailed,
    unreachable,
    crimeCheckTargets: crimeLines.length,
    mutualBirthdays: mutual.birthdays,
    mutualBonusProposed: mutual.bonusProposed,
  };
}

// dry-run 출력용 — 직원별 대상 교육·개인 기한·상태 표(텍스트).
export function formatEvalTable(rows: TrainingEvalRow[]): string {
  const out: string[] = [];
  let cur = "";
  for (const r of rows) {
    if (r.driverId !== cur) {
      cur = r.driverId;
      out.push("", `■ ${r.name} (입사 ${r.joinDate ?? "미기재"})`);
    }
    const state = !r.isTarget
      ? targetReasonLabel(r.reason, null)
      : r.completed
        ? "이수"
        : `미이수 · ${dueLabel(r.dueDate, r.dday)}${r.personalDue ? " · 개인 기한" : ""}`;
    out.push(`  - ${r.training}: ${state}`);
  }
  return out.join("\n");
}

