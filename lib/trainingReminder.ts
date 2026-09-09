// =====================================================================
// 의무교육 D-7 독촉 로직 — Cron / 수동버튼 공용 코어(권한 게이트 없음).
//   * 재직자의 미이수 의무교육 중 마감 D-7 이내(초과 포함) 건을 스캔.
//   * 개인: 이메일로 슬랙 DM. 관리자: SLACK_WEBHOOK_TRAINING 요약 1건
//     (미설정이면 SLACK_WEBHOOK_ADMIN 으로 폴백 — 다른 알림은 ADMIN 그대로).
//   * SA-14: 같은 Cron 에 성범죄경력조회 만료 스캔을 얹는다(별도 Cron 만들지 않음).
//     단 발송 채널은 분리 — 교육 요약과 한 메시지로 묶지 않고 SLACK_WEBHOOK_ADMIN
//     으로 별도 1건. 강사는 슬랙 미가입 → 개인 DM 없음.
//   * MU-3: 같은 Cron 에 상조회 블록(생일 축하금 대상·연말상여 제안)을 더 얹는다.
//     상조회 담당을 코드로 식별하려면 employee_roles 를 뒤져야 하고 담당이 자주
//     바뀌므로, 개인 DM 대신 관리자 요약에 포함한다(지시문 지시).
//   * 슬랙 발송은 부가기능 — 전부 실패해도 throw 하지 않음. DB 조회 실패만 throw.
//   * "use server" 아님 — 라우트/액션이 각자 인증 후 호출.
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendSlack, sendSlackDM, siteBaseUrl, slackLink } from "@/lib/slack";
import {
  kstTodayYmd,
  daysUntil,
  toTraining,
  cellKey,
  isTargetOn,
  trainingBaseYmd,
} from "@/lib/trainings";
import {
  loadTrainingRoster,
  type TrainingRosterEmployee,
} from "@/lib/trainingRoster";
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

const DUE_WITHIN_DAYS = 7; // D-7 이내(초과 포함)

// 의무교육 요약(+상조회) 채널. 환경변수 미설정 시 기존 관리자 채널로 폴백.
function summaryWebhookKey(): string {
  return process.env.SLACK_WEBHOOK_TRAINING
    ? "SLACK_WEBHOOK_TRAINING"
    : "SLACK_WEBHOOK_ADMIN";
}

// 성범죄경력조회 경고 채널 — 교육 요약과 분리해 항상 관리자 채널로 보낸다.
const CRIME_CHECK_WEBHOOK = "SLACK_WEBHOOK_ADMIN";

export type TrainingReminderSummary = {
  today: string;
  targetEmployees: number; // 독촉 대상 직원 수
  targetItems: number; // (직원×교육) 미이수 건 수
  dmSent: number; // DM 성공
  dmFailed: number; // DM 미연결/실패
  unreachable: string[]; // DM 실패 직원 이름
  crimeCheckTargets: number; // 성범죄경력조회 만료·임박·미제출 강사 수
  mutualBirthdays: number; // MU-3: 7일 내 생일 회원 수
  mutualBonusProposed: boolean; // MU-3: 연말상여 제안 발송 여부(12/1 하루만)
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

// 재직자 명단(+이메일·입사일)은 lib/trainingRoster 단일 출처를 씁니다.
//   현황판·대시보드 카드와 같은 명단·같은 대상 판정을 쓰기 위한 것으로,
//   여기서 따로 만들면 화면과 슬랙 숫자가 어긋납니다.
type Emp = TrainingRosterEmployee;

// dday 를 사람이 읽는 문구로.
function ddayPhrase(dday: number): string {
  if (dday > 0) return `D-${dday} (${dday}일 남음)`;
  if (dday === 0) return "D-DAY (오늘 마감)";
  return `${-dday}일 초과`;
}

// =====================================================================
// 독촉 대상 여부 — "입사일 이후에 도래하는 기한"만 독촉합니다.
//   * 대상 판정(lib/trainings.targetStateOn)과는 별개입니다. 대상 판정에서
//     before-join 을 제거해 재직 전원이 모든 교육의 대상이 되었지만, 독촉
//     필터는 dday <= 7 로 하한이 없어(기한이 한참 지난 교육도 상시 포함)
//     그대로 두면 신규 입사자에게 입사 전 교육이 DM 한 통에 몰립니다.
//   * 현황판·마이페이지의 미이수 집계는 건드리지 않습니다 — 법적 관리
//     의무(미이수를 보이는 것)와 독촉(DM 을 보내는 것)은 성격이 다릅니다.
//   * 입사일이 없으면 독촉하지 않습니다. 비교 기준이 없어 과거 교육을 전부
//     보내게 되고, 그 직원은 애초에 인사기록 보완 안내 대상입니다
//     (targetStateOn 의 'no-join-date'). 현황판에는 그대로 미이수로 남습니다.
//   * due_date 가 없는 교육은 애초에 dueTrainings 에 들어오지 않지만
//     (daysUntil 이 null → 필터에서 제외), 방어적으로 함께 막습니다.
// =====================================================================
function isReminderDue(emp: Emp, t: { due_date: string | null }): boolean {
  if (!emp.joinDate) return false;
  if (!t.due_date) return false;
  return t.due_date >= emp.joinDate;
}

// DM 이 가지 않는 이유 — 관리자 요약에만 덧붙입니다. 요약에는 미이수 전부가
//   실리므로, 표시가 없으면 관리자가 "왜 DM 은 안 갔지" 하고 헷갈립니다.
function reminderSkipNote(emp: Emp, t: { due_date: string | null }): string {
  if (!emp.joinDate) return "입사일 미기재 · DM 미발송";
  if (t.due_date && t.due_date < emp.joinDate) return "입사 전 교육 · DM 미발송";
  return "DM 미발송";
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

function mutualBlock(lines: string[]): string[] {
  return lines.length ? ["", "🤲 상조회", ...lines] : [];
}

export async function runTrainingReminder(): Promise<TrainingReminderSummary> {
  const today = kstTodayYmd();
  const year = Number(today.slice(0, 4));

  // SA-14 / MU-3 — 의무교육 대상 유무와 무관하게 항상 스캔한다(같은 Cron 재사용).
  const [crimeLines, mutual] = await Promise.all([
    scanCrimeCheckLines(today),
    scanMutual(today),
  ]);

  // 의무교육 독촉 대상이 없을 때: 부가 블록(성범죄경력조회·상조회)만 보내고 끝낸다.
  //   성범죄경력조회는 관리자 채널, 상조회는 교육 요약과 같은 채널로 각각 발송.
  const noTrainingTargets = async (): Promise<TrainingReminderSummary> => {
    await sendCrimeCheckAlert(today, crimeLines);
    if (mutual.lines.length > 0) {
      await sendSlack(
        summaryWebhookKey(),
        [`🤲 상조회 알림 (${today})`, ...mutual.lines].join("\n")
      );
    }
    return {
      today,
      targetEmployees: 0,
      targetItems: 0,
      dmSent: 0,
      dmFailed: 0,
      unreachable: [],
      crimeCheckTargets: crimeLines.length,
      mutualBirthdays: mutual.birthdays,
      mutualBonusProposed: mutual.bonusProposed,
    };
  };
  // 기존 호출부 이름 유지(아래 early return 들이 쓴다).
  const crimeOnly = noTrainingTargets;

  // 1) 올해 활성 교육 중 마감 D-7 이내(초과 포함).
  const { data: trsRaw, error: tErr } = await supabaseAdmin
    .from("mandatory_trainings")
    .select("*")
    .eq("year", year)
    .eq("is_active", true);
  if (tErr) throw new Error(tErr.message);

  const dueTrainings = (trsRaw ?? [])
    .map((r) => toTraining(r as Record<string, unknown>))
    .map((t) => ({ t, dday: daysUntil(t.due_date, today) }))
    .filter(
      (x): x is { t: ReturnType<typeof toTraining>; dday: number } =>
        x.dday != null && x.dday <= DUE_WITHIN_DAYS
    );

  if (dueTrainings.length === 0) return crimeOnly();

  // 2) 재직자 + 이수기록.
  const roster = await loadTrainingRoster();
  if (roster.length === 0) return crimeOnly();

  const trainingIds = dueTrainings.map((x) => x.t.id);
  const { data: comps, error: cErr } = await supabaseAdmin
    .from("training_completions")
    .select("training_id, driver_id")
    .in("training_id", trainingIds);
  if (cErr) throw new Error(cErr.message);
  const done = new Set<string>();
  for (const c of comps ?? []) {
    const r = c as Record<string, unknown>;
    done.add(cellKey(String(r.training_id ?? ""), String(r.driver_id ?? "")));
  }

  // 3) 직원별 미이수 due-soon 항목 수집.
  const base = siteBaseUrl();
  type Item = { name: string; dday: number; url: string };
  const perEmp = new Map<string, { emp: Emp; items: Item[] }>();
  const adminLines: string[] = [];
  for (const emp of roster) {
    for (const { t, dday } of dueTrainings) {
      // 퇴사 후에 실시된 교육은 대상이 아닙니다.
      //   → DM·관리자 요약 어느 쪽에도 넣지 않습니다.
      if (!isTargetOn(emp, trainingBaseYmd(t))) continue;
      if (done.has(cellKey(t.id, emp.driver_id))) continue;

      // 관리자 요약과 DM 을 분리합니다 — 목적이 다릅니다.
      //   * 요약("누가 무엇을 안 들었나")은 미이수 전부를 싣습니다. 여기서
      //     빠지면 담당 팀장이 신규 입사자의 미이수를 놓칩니다.
      //   * DM("당사자에게 재촉")은 입사일 이후에 도래하는 기한만 보냅니다
      //     (isReminderDue 주석 참고).
      const dmTarget = isReminderDue(emp, t);
      const note = dmTarget ? "" : `, ${reminderSkipNote(emp, t)}`;
      adminLines.push(`• ${emp.name} — ${t.name} (${ddayPhrase(dday)}${note})`);
      if (!dmTarget) continue;

      const url = t.site_url || (base ? `${base}/profile/hr` : "/profile/hr");
      const bucket = perEmp.get(emp.driver_id) ?? { emp, items: [] };
      bucket.items.push({ name: t.name, dday, url });
      perEmp.set(emp.driver_id, bucket);
    }
  }

  const targets = [...perEmp.values()];
  // 요약 기준으로 판단합니다 — DM 대상이 0명이어도(전부 입사 전 교육 등)
  //   미이수가 있으면 관리자 요약은 보내야 합니다. targets 로 판단하면 그
  //   경우 요약이 통째로 빠져 분리한 의미가 없어집니다.
  if (adminLines.length === 0) return crimeOnly();

  // 4) 개인 DM.
  let dmSent = 0;
  let dmFailed = 0;
  const unreachable: string[] = [];
  let targetItems = 0;
  for (const { emp, items } of targets) {
    targetItems += items.length;
    const lines = items.map(
      (it) =>
        `• [${it.name}] 이수 마감 ${ddayPhrase(it.dday)} — ${slackLink(
          it.url,
          "지금 이수하기"
        )}`
    );
    const text = `⏰ 이수 마감이 임박한 법정 의무교육이 있습니다.\n${lines.join("\n")}`;
    const ok = await sendSlackDM(emp.email, text);
    if (ok) dmSent++;
    else {
      dmFailed++;
      unreachable.push(emp.name);
    }
  }

  // 5) 관리자 요약 — 미이수가 있으면 DM 대상이 없어도 보냅니다.
  const summaryLines = [`📋 의무교육 미이수 현황 (${today})`, ...adminLines];
  if (unreachable.length > 0) {
    summaryLines.push(`⚠️ 슬랙 미연결(DM 실패): ${unreachable.join(", ")}`);
  }
  summaryLines.push(...mutualBlock(mutual.lines));
  await sendSlack(summaryWebhookKey(), summaryLines.join("\n"));

  // 성범죄경력조회는 교육 요약과 분리 — 관리자 채널로 별도 1건.
  await sendCrimeCheckAlert(today, crimeLines);

  return {
    today,
    targetEmployees: targets.length,
    targetItems,
    dmSent,
    dmFailed,
    unreachable,
    crimeCheckTargets: crimeLines.length,
    mutualBirthdays: mutual.birthdays,
    mutualBonusProposed: mutual.bonusProposed,
  };
}
