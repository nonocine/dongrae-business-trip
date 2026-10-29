import { regularFont, boldFont } from "@/lib/pdfFont";

// 일괄 출력이 브라우저에서 PDF 를 그릴 때 쓰는 나눔고딕(개별 출력과 같은 파일).
//   OFL 공개 폰트라 게이트는 두지 않는다. 바뀔 일이 거의 없어 브라우저에 오래 캐시한다
//   (두 번째 일괄 출력부터는 4MB 를 다시 받지 않는다).
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ weight: string }> }
) {
  const { weight } = await params;
  if (weight !== "regular" && weight !== "bold")
    return new Response("Not found", { status: 404 });
  const bytes = weight === "bold" ? boldFont() : regularFont();
  return new Response(new Uint8Array(bytes) as BodyInit, {
    headers: {
      "Content-Type": "font/ttf",
      "Cache-Control": "public, max-age=604800",
    },
  });
}
