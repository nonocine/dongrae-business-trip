import { runPendingDigest } from "@/lib/pendingDigest";

// Vercel Cron 전용 — 한국 평일 08:30(UTC 일~목 23:30) 호출.
//   * 인증: Authorization === `Bearer ${CRON_SECRET}` (기존 Cron 과 동일 패턴).
//   * 대상자(M0·hr 직무)별 '확인할 일'(lib/pendingTasks)이 1건 이상이면 슬랙 DM.
//   * ?dry=1 이면 보내지 않고 미리보기만 돌려줍니다(인증은 같음).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response("CRON_SECRET 미설정 — Vercel 환경변수에 CRON_SECRET 을 등록하세요.", { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const dryRun = new URL(request.url).searchParams.get("dry") === "1";
  try {
    const r = await runPendingDigest({ dryRun });
    // 응답에는 사람·건수만(본문 미리보기는 dry 일 때만).
    return Response.json({
      ok: true,
      dryRun,
      sent: r.sent,
      skipped: r.skipped,
      failed: r.failed,
      ...(dryRun ? { preview: r.preview } : {}),
    });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "확인할 일 알림 처리 중 오류", { status: 500 });
  }
}
