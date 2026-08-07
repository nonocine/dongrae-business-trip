import { runMailFetch } from "@/lib/mailCollector";

// Vercel Cron 전용 — 10분 간격 호출(vercel.json).
//   * 인증: Authorization === `Bearer ${CRON_SECRET}` (기존 Cron 과 동일 패턴).
//   * 네이버 원본은 삭제하지 않습니다(수집기에 DELE 없음).
//   * 개별 메일 실패는 수집기 내부에서 격리되고, 접속 자체가 실패한 경우에만 500.
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
    const summary = await runMailFetch();
    return Response.json(summary);
  } catch (e) {
    return new Response(
      e instanceof Error ? e.message : "메일 수집 중 오류가 발생했습니다.",
      { status: 500 },
    );
  }
}
