import { requireSaemAccess } from "@/lib/saemAccess";
import {
  loadLectureCertData,
  generateLectureCertPdf,
  lectureCertPdfFilename,
} from "@/lib/lectureCertPdf";
import { kstTodayYmd } from "@/lib/trainings";

// 강의확인증 담당자 미리보기 — 승인 전 양식을 눈으로 확인하는 용도.
//   * 주민등록번호는 신청 데이터에 없다 → 미리보기는 그 칸이 공란으로 나간다.
//     실제 주민번호가 들어간 출력은 강사 화면(1부-B)에서만 한다.
//   * 출력 이력(printed_at)은 기록하지 않는다 — 미리보기는 '발급'이 아니다.
//   pdf-lib + fs 폰트 로딩 → Node 런타임. 라우트는 layout 가드 밖이라 자체 재검증한다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSaemAccess();
  } catch {
    return new Response("권한이 없습니다.", { status: 403 });
  }
  const { id } = await params;

  const cert = await loadLectureCertData(id);
  if (!cert) return new Response("신청을 찾을 수 없습니다.", { status: 404 });

  const bytes = await generateLectureCertPdf(cert, null, kstTodayYmd());
  const filename = lectureCertPdfFilename(cert);
  return new Response(bytes as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(
        filename
      )}`,
      "Cache-Control": "no-store",
    },
  });
}
