import { listStudents } from "@/app/(app)/bangka/members/actions";
import { kstTodayYmd } from "@/lib/trainings";
import StudentsManager from "@/app/(app)/bangka/members/StudentsManager";

export const dynamic = "force-dynamic";

// 학생 목록 — 반·재원 필터는 주소(?class=&status=)로. 기본은 재원생 전체.
export default async function BangkaStudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ class?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const classCode = sp.class === "ieum" || sp.class === "jieum" ? sp.class : "all";
  const status = sp.status === "left" || sp.status === "all" ? sp.status : "active";
  const students = await listStudents({
    classCode: classCode === "all" ? undefined : classCode,
    status: status === "all" ? undefined : status,
  });

  return (
    <StudentsManager
      students={students}
      classFilter={classCode}
      statusFilter={status}
      todayYmd={kstTodayYmd()}
    />
  );
}
