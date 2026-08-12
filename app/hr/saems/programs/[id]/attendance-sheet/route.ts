import { requireSaemAccess } from "@/lib/saemAccess";
import {
  loadAttendanceSheet,
  buildAttendancePdf,
  attendancePdfFilename,
} from "@/lib/attendancePdf";

// pdf-lib + fs 폰트 로딩 → Node 런타임. 라우트는 layout 가드 밖이라 자체 재검증한다.
//   ⚠️ 미성년자 연락처·비상연락처·생년월일 기반 학년이 실려 나가는 문서다.
//      게이트를 통과하기 전에는 명단을 한 줄도 읽지 않는다.
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
  // blank=1 → 출결 칸이 빈 출석부(강사가 손으로 체크). 개인정보는 URL 에 싣지 않는다.
  const blank = new URL(req.url).searchParams.get("blank") === "1";

  const data = await loadAttendanceSheet(id);
  if (!data) return new Response("프로그램을 찾을 수 없습니다.", { status: 404 });

  const bytes = await buildAttendancePdf(data, { blank });
  const filename = attendancePdfFilename(data, blank);
  return new Response(bytes as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
        filename
      )}`,
      // 개인정보가 든 문서 — 중간 캐시·브라우저 캐시에 남기지 않는다.
      "Cache-Control": "no-store, private",
    },
  });
}
