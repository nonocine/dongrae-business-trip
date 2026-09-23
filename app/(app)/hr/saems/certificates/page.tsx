import { listLectureCertificates } from "@/app/(app)/hr/saems/certificateActions";
import { resolveSaemView } from "@/lib/saemAccess";
import CertificatesManager from "@/app/(app)/hr/saems/certificates/CertificatesManager";

export const dynamic = "force-dynamic";

// 강의확인증 발급대장 — 담당자 검토·승인/반려. (2부-a, 출력 PDF 는 2부-b)
//   레이아웃(app/(app)/hr/saems/layout.tsx)에서 로그인 가드를 이미 통과한다.
//   2026-09: 대장 조회는 직원 누구나. 승인·반려·수정·미리보기는 관리 권한만.
export default async function LectureCertificatesPage() {
  const [initial, view] = await Promise.all([
    listLectureCertificates(),
    resolveSaemView(),
  ]);
  return (
    <CertificatesManager initial={initial} canManage={view?.canManage ?? false} />
  );
}
