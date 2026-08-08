import { runMailDigest } from "@/lib/mailDigest";

// Vercel Cron 전용 — 매일 KST 09:00(UTC 00:00) 호출.
//   * 인증: Authorization === `Bearer ${CRON_SECRET}` (기존 Cron 과 동일 패턴).
//   * 하는 일 두 가지: 어제 도착분 요약을 관리자 채널에 1건 발송(ML-6),
//     30일 지난 휴지통 메일을 실제 삭제(ML-7).
//   * ★ 네이버 원본은 건드리지 않습니다 — 삭제 대상은 우리 DB/Storage 뿐입니다.
//   * 슬랙 실패는 내부에서 격리되므로, 집계·정리가 끝나면 200 입니다.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response(
      "CRON_SECRET 미설정 — Vercel 환경변수에 CRON_SECRET 을 등록하세요.",
      { status: 500 },
    );
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const summary = await runMailDigest();
    return Response.json({ ok: true, ...summary });
  } catch (e) {
    return new Response(
      e instanceof Error ? e.message : "다이제스트 처리 중 오류가 발생했습니다.",
      { status: 500 },
    );
  }
}
