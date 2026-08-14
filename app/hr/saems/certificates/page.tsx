import { listLectureCertificates } from "@/app/hr/saems/certificateActions";
import CertificatesManager from "@/app/hr/saems/certificates/CertificatesManager";

export const dynamic = "force-dynamic";

// 강의확인증 발급대장 — 담당자 검토·승인/반려. (2부-a, 출력 PDF 는 2부-b)
//   레이아웃(app/hr/saems/layout.tsx)에서 resolveSaemAccess 가드를 이미 통과한다.
//   액션도 각자 requireSaemAccess 로 다시 확인한다.
export default async function LectureCertificatesPage() {
  const initial = await listLectureCertificates();
  return <CertificatesManager initial={initial} />;
}
