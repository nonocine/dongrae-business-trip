import { runBackup } from "@/lib/backupEngine";
import { runBackupCoverageCheck } from "@/lib/backupCoverage";

// Vercel Cron 전용 — 주 1회, UTC 토요일 18:00 = KST 일요일 03:00 호출.
//   (2026-10 관장 지시로 월 1회 → 주 1회)
//   * 인증: Authorization === `Bearer ${CRON_SECRET}` (기존 Cron 과 동일 패턴).
//   * 백업은 읽기 전용입니다(backup_logs 기록 제외).
//   * 엔진이 실패를 내부에서 잡아 backup_logs·슬랙에 남기므로, 라우트는
//     결과 요약을 그대로 돌려주고 실패 시 500 으로 표시합니다.
//   * 백업 뒤 백업 목록 점검(lib/backupCoverage) — 목록 밖 테이블이 있으면 관장 DM.
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

  // 백업 목록 점검(lib/backupCoverage) — 백업과 격리. 실패해도 백업 결과는 그대로.
  let coverage: { unlisted: string[]; missingInDb: string[]; dm: string } | { error: string };
  try {
    const c = await runBackupCoverageCheck({ dryRun: false });
    coverage = { unlisted: c.unlisted, missingInDb: c.missingInDb, dm: c.dm };
  } catch (e) {
    coverage = { error: e instanceof Error ? e.message : String(e) };
  }

  return Response.json({ ...summary, coverage }, { status: summary.ok ? 200 : 500 });
}
