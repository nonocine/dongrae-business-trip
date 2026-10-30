import { requireSaemAccess } from "@/lib/saemAccess";
import { canBulkPrint } from "@/lib/bulkPrintAccess";
import { loadProgramWorkLog } from "@/lib/workLogPdf";
import { loadAttendanceSheet } from "@/lib/attendancePdf";

// 일괄 출력(프로그램 관리 "선택 출력")용 — PDF 대신 양식에 들어갈 데이터를 JSON 으로 준다.
//   브라우저가 여러 프로그램을 받아 lib/*PdfDraw 로 한 문서에 그린다(폰트는 한 번만 임베드).
//   개별 출력 라우트(worklog·attendance-sheet)와 같은 게이트·같은 조회 함수를 쓴다.
//   ⚠️ 강사 휴대전화·미성년자 연락처가 실린다 — 게이트 통과 전에는 아무것도 읽지 않는다.
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
  // 선택 출력 시험 개방 — 관장 + BULK_PRINT_EMAILS 만(lib/bulkPrintAccess).
  if (!(await canBulkPrint()))
    return new Response("권한이 없습니다.", { status: 403 });
  const { id } = await params;
  const doc = new URL(req.url).searchParams.get("doc");

  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    // 개인정보가 든 응답 — 중간 캐시·브라우저 캐시에 남기지 않는다.
    "Cache-Control": "no-store, private",
  };

  if (doc === "worklog") {
    const data = await loadProgramWorkLog(id);
    if (!data) return new Response("프로그램을 찾을 수 없습니다.", { status: 404 });
    return new Response(JSON.stringify(data), { headers });
  }
  if (doc === "attendance") {
    const data = await loadAttendanceSheet(id);
    if (!data) return new Response("프로그램을 찾을 수 없습니다.", { status: 404 });
    // 도장 바이트(Uint8Array)는 JSON 에 그대로 못 싣는다 → base64. 브라우저가 되돌린다.
    const staffStamps: Record<string, string | null> = {};
    for (const [name, bytes] of Object.entries(data.staffStamps))
      staffStamps[name] = bytes ? Buffer.from(bytes).toString("base64") : null;
    return new Response(JSON.stringify({ ...data, staffStamps }), { headers });
  }
  return new Response("doc 는 worklog 또는 attendance 입니다.", { status: 400 });
}
