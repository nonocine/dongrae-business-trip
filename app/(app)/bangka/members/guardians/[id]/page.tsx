import Link from "next/link";
import { notFound } from "next/navigation";
import { getGuardianDetail, listActiveStudentsBrief } from "@/app/(app)/bangka/members/actions";
import GuardianDetail from "@/app/(app)/bangka/members/guardians/[id]/GuardianDetail";
import { linkCls } from "@/lib/ui";

export const dynamic = "force-dynamic";

// 보호자 상세 — 가입 링크 발급, 잠금 해제, 정지/해제, 학생 연결.
export default async function BangkaGuardianPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [guardian, students] = await Promise.all([getGuardianDetail(id), listActiveStudentsBrief()]);
  if (!guardian) notFound();
  return (
    <div className="space-y-3">
      <Link href="/bangka/members/guardians" className={`text-sm ${linkCls}`}>
        ← 보호자 목록
      </Link>
      <GuardianDetail guardian={guardian} activeStudents={students} />
    </div>
  );
}
