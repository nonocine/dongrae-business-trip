import { listInstructors } from "@/app/(app)/hr/saems/instructorActions";
import { resolveSaemView } from "@/lib/saemAccess";
import InstructorsManager from "@/app/(app)/hr/saems/instructors/InstructorsManager";

export const dynamic = "force-dynamic";

// 강사 목록 — 열람은 로그인 직원 누구나. 등록·엑셀·상세는 관리 권한만.
//   (레이아웃에서 로그인 가드를 이미 통과한 상태)
export default async function InstructorsPage() {
  const view = await resolveSaemView();
  const instructors = await listInstructors();
  return (
    <InstructorsManager
      instructors={instructors}
      isM0={view?.isM0 ?? false}
      canManage={view?.canManage ?? false}
    />
  );
}
