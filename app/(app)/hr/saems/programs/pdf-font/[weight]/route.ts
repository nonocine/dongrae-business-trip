import { regularFont, boldFont } from "@/lib/pdfFont";
import { requireSaemAccess } from "@/lib/saemAccess";
import { canBulkPrint } from "@/lib/bulkPrintAccess";

// 일괄 출력이 브라우저에서 PDF 를 그릴 때 쓰는 나눔고딕(개별 출력과 같은 파일).
//   폰트 자체는 OFL 공개지만 선택 출력 시험 기간엔 print-data 와 같은 게이트를 둔다.
//   바뀔 일이 거의 없어 브라우저에 오래 캐시한다(private — 공유 캐시엔 안 남김).
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ weight: string }> }
) {
  try {
    await requireSaemAccess();
  } catch {
    return new Response("권한이 없습니다.", { status: 403 });
  }
  if (!(await canBulkPrint()))
    return new Response("권한이 없습니다.", { status: 403 });
  const { weight } = await params;
  if (weight !== "regular" && weight !== "bold")
    return new Response("Not found", { status: 404 });
  const bytes = weight === "bold" ? boldFont() : regularFont();
  return new Response(new Uint8Array(bytes) as BodyInit, {
    headers: {
      "Content-Type": "font/ttf",
      "Cache-Control": "private, max-age=604800",
    },
  });
}
