import { runEnrollOrphanCleanup, runEnrollPurge } from "@/lib/bangkaEnrollServer";

// Vercel Cron 전용 — 매일 KST 02:00(UTC 17:00). 신규 접수 보관기간 삭제(설계 8장).
//   * retention_until 이 지난 신청서의 증빙 파일·민감정보·추천서 서명 삭제,
//     합격이 아니면 사진·서명도 삭제. 신청서 행·기록은 남깁니다.
//   * 이어서 버려진 업로드(어디에도 연결 안 된 24시간 넘은 객체·신청서 없는 폴더) 정리.
//   * ?dry=1 이면 지우지 않고 대상 수만 셉니다.
//   * 인증: Authorization === `Bearer ${CRON_SECRET}` (Vercel Cron 이 자동 첨부).
//   * 한 건 실패해도 다음 건을 계속합니다(실패 건은 다음 날 다시).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response("CRON_SECRET 미설정 — Vercel 환경변수에 CRON_SECRET 을 등록하세요.", { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    const dryRun = new URL(request.url).searchParams.get("dry") === "1";
    const summary = await runEnrollPurge({ dryRun });
    if (summary.failed > 0) console.error(`[bk-enroll-purge] 실패 ${summary.failed}건: ${summary.errors.join(" | ")}`);
    // 정리는 보관기간 삭제와 따로 — 한쪽이 실패해도 다른 쪽 결과는 돌려줍니다.
    let orphans: Awaited<ReturnType<typeof runEnrollOrphanCleanup>> | { error: string };
    try {
      orphans = await runEnrollOrphanCleanup({ dryRun });
      if (orphans.errors.length > 0) console.error(`[bk-enroll-purge] 정리 오류: ${orphans.errors.join(" | ")}`);
      orphans = { ...orphans, errors: orphans.errors.slice(0, 20) };
    } catch (e) {
      orphans = { error: e instanceof Error ? e.message : String(e) };
      console.error(`[bk-enroll-purge] 정리 실패: ${orphans.error}`);
    }
    return Response.json({ ok: true, ...summary, errors: summary.errors.slice(0, 20), orphans });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "보관기간 삭제 중 오류가 발생했습니다.", { status: 500 });
  }
}
