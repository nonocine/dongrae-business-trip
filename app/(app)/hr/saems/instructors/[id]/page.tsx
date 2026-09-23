import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getInstructorDetail } from "@/app/(app)/hr/saems/instructorActions";
import { resolveSaemAccess } from "@/lib/saemAccess";
import InstructorDetail from "@/app/(app)/hr/saems/instructors/[id]/InstructorDetail";
import { kstTodayYmd } from "@/lib/trainings";

export const dynamic = "force-dynamic";

export default async function InstructorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // 상세는 수정 화면이다 — 계좌·주민번호·서류함·초대링크가 모두 여기에 있어
  //   목록이 전 직원에게 열린 뒤에도 기존 권한(M0 또는 saem 직무)을 유지한다.
  //   탭에서 오는 동선은 목록의 행 클릭뿐이고 그 행은 열람자에게 비활성이라,
  //   여기 오는 건 주소를 직접 친 경우다. 오류 대신 목록으로 돌려보낸다.
  if (!(await resolveSaemAccess())) redirect("/hr/saems/instructors");

  const { id } = await params;
  const detail = await getInstructorDetail(id);
  if (!detail) notFound();

  return (
    <div className="space-y-4">
      <Link
        href="/hr/saems/instructors"
        className="text-sm text-ink-muted hover:underline"
      >
        ← 강사 목록
      </Link>
      <InstructorDetail
        instructor={detail.instructor}
        programs={detail.programs}
        docs={detail.docs}
        isM0={detail.isM0}
        today={kstTodayYmd()}
      />
    </div>
  );
}
