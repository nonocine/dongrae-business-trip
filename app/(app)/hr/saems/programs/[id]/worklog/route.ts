import { requireSaemAccess } from "@/lib/saemAccess";
import {
  loadProgramWorkLog,
  buildWorkLogPdf,
  workLogPdfFilename,
} from "@/lib/workLogPdf";

// pdf-lib + fs 폰트 로딩 → Node 런타임. 라우트는 layout 가드 밖이라 자체 재검증한다.
//   강사 휴대전화가 실려 나가는 문서다 — 게이트 통과 전에는 아무것도 읽지 않는다.
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

  const data = await loadProgramWorkLog(id);
  if (!data) return new Response("프로그램을 찾을 수 없습니다.", { status: 404 });

  const bytes = await buildWorkLogPdf(data);
  const filename = workLogPdfFilename(data);
  return new Response(bytes as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
        filename
      )}`,
      "Cache-Control": "no-store",
    },
  });
}
