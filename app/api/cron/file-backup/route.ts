import { runFileBackup } from "@/lib/fileBackupEngine";

// Vercel Cron 전용 — 매일 UTC 19:00 = KST 04:00. hr-documents 파일 증분 백업
//   (lib/fileBackupEngine). 할 일이 없으면 바로 끝나고, 많으면 240초만 하고 다음 날 이어갑니다.
//   * 인증: Authorization === `Bearer ${CRON_SECRET}` (기존 Cron 과 동일 패턴).
//   * Storage 원본은 읽기만 합니다.
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

  const summary = await runFileBackup({ triggeredBy: "cron" });
  return Response.json(
    { ...summary, failed: summary.failed.length },
    { status: summary.errorMessage && summary.uploaded + summary.updated === 0 ? 500 : 200 },
  );
}
