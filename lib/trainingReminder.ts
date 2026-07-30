// =====================================================================
// 의무교육 D-7 독촉 로직 — Cron / 수동버튼 공용 코어(권한 게이트 없음).
//   * 재직자의 미이수 의무교육 중 마감 D-7 이내(초과 포함) 건을 스캔.
//   * 개인: 이메일로 슬랙 DM. 관리자: SLACK_WEBHOOK_ADMIN 요약 1건.
//   * SA-14: 같은 Cron 에 성범죄경력조회 만료 스캔을 얹어 관리자 요약에 덧붙인다
//     (별도 Cron 만들지 않음). 강사는 슬랙 미가입 → 개인 DM 없음.
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
import {
  CRIME_CHECK_SLOT,
  crimeCheckState,
  needsCrimeCheckAction,
} from "@/lib/saemDocExpiry";

const DUE_WITHIN_DAYS = 7; // D-7 이내(초과 포함)

export type TrainingReminderSummary = {
  today: string;
  targetEmployees: number; // 독촉 대상 직원 수
  targetItems: number; // (직원×교육) 미이수 건 수
  dmSent: number; // DM 성공
  dmFailed: number; // DM 미연결/실패
  unreachable: string[]; // DM 실패 직원 이름
  crimeCheckTargets: number; // 성범죄경력조회 만료·임박·미제출 강사 수
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

// 관리자 요약에 덧붙일 성범죄경력조회 블록(대상 0명이면 빈 배열 → 블록 생략).
function crimeBlock(lines: string[]): string[] {
  return lines.length ? ["", "⚠️ 성범죄경력조회", ...lines] : [];
}

export async function runTrainingReminder(): Promise<TrainingReminderSummary> {
  const today = kstTodayYmd();
  const year = Number(today.slice(0, 4));

  // SA-14 — 의무교육 대상 유무와 무관하게 항상 스캔한다(같은 Cron 재사용).
  const crimeLines = await scanCrimeCheckLines(today);

  // 의무교육 독촉 대상이 없을 때: 성범죄경력조회 블록만 보내고 끝낸다.
  const crimeOnly = async (): Promise<TrainingReminderSummary> => {
    if (crimeLines.length > 0) {
      await sendSlack(
        "SLACK_WEBHOOK_ADMIN",
        [`⚠️ 성범죄경력조회 갱신 필요 (${today})`, ...crimeLines].join("\n")
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
    };
  };

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
  const roster = await loadRosterWithEmail();
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
      if (done.has(cellKey(t.id, emp.driver_id))) continue;
      const url = t.site_url || (base ? `${base}/profile/hr` : "/profile/hr");
      const bucket = perEmp.get(emp.driver_id) ?? { emp, items: [] };
      bucket.items.push({ name: t.name, dday, url });
      perEmp.set(emp.driver_id, bucket);
      adminLines.push(`• ${emp.name} — ${t.name} (${ddayPhrase(dday)})`);
    }
  }

  const targets = [...perEmp.values()];
  if (targets.length === 0) return crimeOnly();

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
  summaryLines.push(...crimeBlock(crimeLines));
  await sendSlack("SLACK_WEBHOOK_ADMIN", summaryLines.join("\n"));

  return {
    today,
    targetEmployees: targets.length,
    targetItems,
    dmSent,
    dmFailed,
    unreachable,
    crimeCheckTargets: crimeLines.length,
  };
}
