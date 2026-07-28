import { runTrainingReminder } from "@/lib/trainingReminder";

// Vercel Cron 전용 — 매일 KST 09:00(UTC 00:00) 호출.
//   * 인증: Authorization === `Bearer ${CRON_SECRET}` (Vercel Cron 이 자동 첨부).
//   * 슬랙 발송이 전부 실패해도 200(알림은 부가기능). 교육 데이터 조회 실패만 500.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response(
      "CRON_SECRET 미설정 — Vercel 환경변수에 CRON_SECRET 을 등록하세요.",
      { status: 500 }
    );
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const summary = await runTrainingReminder();
    return Response.json({ ok: true, ...summary });
  } catch (e) {
    // 교육 데이터 조회 실패만 에러(슬랙 실패는 내부에서 격리됨).
    return new Response(
      e instanceof Error ? e.message : "독촉 처리 중 오류가 발생했습니다.",
      { status: 500 }
    );
  }
}
