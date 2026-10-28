import { countAwaitingEvidence, listAbsences, listActiveStudents, type AbsenceFilter } from "@/app/(app)/bangka/absences/actions";
import AbsencesManager from "@/app/(app)/bangka/absences/AbsencesManager";
import { canApproveAbsence, resolveBangkaAccess } from "@/lib/bangkaAccess";
import { kstTodayYmd } from "@/lib/trainings";

export const dynamic = "force-dynamic";

// 공결 — ?view=pending(처리할 것, 기본)|evidence(증빙 대기)|all|phone(전화공결관리대장) &ym=2026-10
export default async function BangkaAbsencesPage({ searchParams }: { searchParams: Promise<{ view?: string; ym?: string }> }) {
  const sp = await searchParams;
  const view: AbsenceFilter["view"] = sp.view === "all" || sp.view === "phone" || sp.view === "evidence" ? sp.view : "pending";
  const monthly = view === "all" || view === "phone";
  const ym = monthly ? (sp.ym && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.ym) ? sp.ym : kstTodayYmd().slice(0, 7)) : null;
  const [me, rows, students, evidenceCount] = await Promise.all([
    resolveBangkaAccess(),
    listAbsences({ view, ym }),
    listActiveStudents(),
    countAwaitingEvidence(),
  ]);
  return (
    <AbsencesManager
      key={`${view}-${ym}`}
      view={view}
      ym={ym}
      rows={rows}
      students={students}
      canApprove={!!me && canApproveAbsence(me)}
      todayYmd={kstTodayYmd()}
      evidenceCount={evidenceCount}
    />
  );
}
