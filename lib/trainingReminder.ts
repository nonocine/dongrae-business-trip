// =====================================================================
// 의무교육 D-7 독촉 로직 — Cron / 수동버튼 공용 코어(권한 게이트 없음).
//   * 재직자의 미이수 의무교육 중 마감 D-7 이내(초과 포함) 건을 스캔.
//   * 개인: 이메일로 슬랙 DM. 관리자: SLACK_WEBHOOK_ADMIN 요약 1건.
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
} from "@/lib/trainings";

const DUE_WITHIN_DAYS = 7; // D-7 이내(초과 포함)

export type TrainingReminderSummary = {
  today: string;
  targetEmployees: number; // 독촉 대상 직원 수
  targetItems: number; // (직원×교육) 미이수 건 수
  dmSent: number; // DM 성공
  dmFailed: number; // DM 미연결/실패
  unreachable: string[]; // DM 실패 직원 이름
};

type Emp = { driver_id: string; name: string; email: string | null };

// 재직자 명단(+이메일). drivers.is_active && employment_status != resigned.
async function loadRosterWithEmail(): Promise<Emp[]> {
  const [{ data: drivers, error: dErr }, { data: profiles, error: pErr }] =
    await Promise.all([
      supabaseAdmin.from("drivers").select("id, name, is_active"),
      supabaseAdmin
        .from("employee_profiles")
        .select("driver_id, employment_status, email"),
    ]);
  if (dErr) throw new Error(dErr.message);
  if (pErr) throw new Error(pErr.message);

  const profByDriver = new Map<
    string,
    { status: string; email: string | null }
  >();
  for (const p of profiles ?? []) {
    const r = p as Record<string, unknown>;
    profByDriver.set(String(r.driver_id ?? ""), {
      status: String(r.employment_status ?? "active"),
      email: (r.email as string | null) ?? null,
    });
  }

  const out: Emp[] = [];
  for (const d of drivers ?? []) {
    const r = d as Record<string, unknown>;
    const id = String(r.id ?? "");
    if (r.is_active === false) continue;
    const prof = profByDriver.get(id);
    if (prof?.status === "resigned") continue;
    out.push({ driver_id: id, name: String(r.name ?? ""), email: prof?.email ?? null });
  }
  return out;
}

// dday 를 사람이 읽는 문구로.
function ddayPhrase(dday: number): string {
  if (dday > 0) return `D-${dday} (${dday}일 남음)`;
  if (dday === 0) return "D-DAY (오늘 마감)";
  return `${-dday}일 초과`;
}

export async function runTrainingReminder(): Promise<TrainingReminderSummary> {
  const today = kstTodayYmd();
  const year = Number(today.slice(0, 4));

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

  const emptySummary: TrainingReminderSummary = {
    today,
    targetEmployees: 0,
    targetItems: 0,
    dmSent: 0,
    dmFailed: 0,
    unreachable: [],
  };
  if (dueTrainings.length === 0) return emptySummary;

  // 2) 재직자 + 이수기록.
  const roster = await loadRosterWithEmail();
  if (roster.length === 0) return emptySummary;

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
      if (done.has(cellKey(t.id, emp.driver_id))) continue;
      const url = t.site_url || (base ? `${base}/profile/hr` : "/profile/hr");
      const bucket = perEmp.get(emp.driver_id) ?? { emp, items: [] };
      bucket.items.push({ name: t.name, dday, url });
      perEmp.set(emp.driver_id, bucket);
      adminLines.push(`• ${emp.name} — ${t.name} (${ddayPhrase(dday)})`);
    }
  }

  const targets = [...perEmp.values()];
  if (targets.length === 0) return emptySummary;

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

  // 5) 관리자 요약(대상 있을 때만).
  const summaryLines = [`📋 의무교육 미이수 현황 (${today})`, ...adminLines];
  if (unreachable.length > 0) {
    summaryLines.push(`⚠️ 슬랙 미연결(DM 실패): ${unreachable.join(", ")}`);
  }
  await sendSlack("SLACK_WEBHOOK_ADMIN", summaryLines.join("\n"));

  return {
    today,
    targetEmployees: targets.length,
    targetItems,
    dmSent,
    dmFailed,
    unreachable,
  };
}
