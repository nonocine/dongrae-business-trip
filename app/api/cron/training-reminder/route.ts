import { runTrainingReminder } from "@/lib/trainingReminder";

// Vercel Cron 전용 — 매일 KST 09:00(UTC 00:00) 호출.
//   * 본인 DM(14일 전·3일 전·당일)은 매일, 공개 요약·기한 지남 DM 은 화요일만.
//   * 실제 발송은 TRAINING_NOTIFY_LIVE=1 일 때만. ?dry=1 이면 무조건 계획만 반환.
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
    const dryRun = new URL(request.url).searchParams.get("dry") === "1";
    const { rows: _rows, ...summary } = await runTrainingReminder({ dryRun });
    // 직원×교육 판정표(rows)는 응답에서 뺍니다 — 로그에 남길 필요가 없는 크기.
    void _rows;
    return Response.json({ ok: true, ...summary });
  } catch (e) {
    // 교육 데이터 조회 실패만 에러(슬랙 실패는 내부에서 격리됨).
    return new Response(
      e instanceof Error ? e.message : "독촉 처리 중 오류가 발생했습니다.",
      { status: 500 }
    );
  }
}
