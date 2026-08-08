import { runBackup } from "@/lib/backupEngine";

// Vercel Cron 전용 — 월 1회, UTC 매월 1일 18:00 = KST 매월 2일 03:00 호출.
//   * 인증: Authorization === `Bearer ${CRON_SECRET}` (기존 Cron 과 동일 패턴).
//   * 백업은 읽기 전용입니다(backup_logs 기록 제외).
//   * 엔진이 실패를 내부에서 잡아 backup_logs·슬랙에 남기므로, 라우트는
//     결과 요약을 그대로 돌려주고 실패 시 500 으로 표시합니다.
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

  const summary = await runBackup("cron");
  return Response.json(summary, { status: summary.ok ? 200 : 500 });
}
