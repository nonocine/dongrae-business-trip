import { requireSaemAccess } from "@/lib/saemAccess";
import {
  loadProgramWorkLog,
  buildWorkLogPdf,
  workLogPdfFilename,
} from "@/lib/workLogPdf";
import { parsePeriodParams } from "@/lib/workLogPeriod";

// pdf-lib + fs 폰트 로딩 → Node 런타임. 라우트는 layout 가드 밖이라 자체 재검증한다.
//   강사 휴대전화가 실려 나가는 문서다 — 게이트 통과 전에는 아무것도 읽지 않는다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSaemAccess();
  } catch {
    return new Response("권한이 없습니다.", { status: 403 });
  }
  const { id } = await params;
  // 기간(from·to, YYYY-MM-DD) — 둘 다 없으면 전체(예전과 같은 PDF).
  const parsed = parsePeriodParams(new URL(req.url).searchParams);
  if (!parsed.ok) return new Response(parsed.error, { status: 400 });

  const data = await loadProgramWorkLog(id, parsed.period);
  if (!data) return new Response("프로그램을 찾을 수 없습니다.", { status: 404 });
  if (parsed.period && data.sessions.length === 0)
    return new Response("선택한 기간에 회차가 없습니다.", { status: 404 });

  const bytes = await buildWorkLogPdf(data);
  const filename = workLogPdfFilename(data, parsed.period);
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
