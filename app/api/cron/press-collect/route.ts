import { runPressCollectAndRecord } from "@/lib/pressCollect/run";
import { PRESS_COLLECT_DAYS } from "@/lib/pressCollect/config";

// Vercel Cron 전용 — 평일 08:00 KST(vercel.json "0 23 * * 0-4" = UTC 일~목 23:00).
//   docs/PRESS_COLLECT_동업자씨이전.md ①~⑦
//   * 인증: Authorization === `Bearer ${CRON_SECRET}` (기존 Cron 과 같은 패턴). 아니면 401.
//   * 최근 7일 수집 → 저장 → 새 기사만 슬랙 #14_보도자료관련 → 실행 기록.
//     실패·확인 필요 기사는 관장 텔레그램(슬랙에는 기사 외 아무것도 보내지 않음).
//   * 응답에는 개수만 담습니다(키·기자 정보 없음).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// 실측: 최근 7일 16초, 9/1 부터 두 달치 + Haiku 15회 70초. 여유를 둡니다.
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response("CRON_SECRET 미설정 — Vercel 환경변수에 CRON_SECRET 을 등록하세요.", { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const report = await runPressCollectAndRecord({
      trigger: "cron",
      since: new Date(Date.now() - PRESS_COLLECT_DAYS * 86_400_000),
    });
    const line =
      `[press-collect] ${report.status} · 후보 ${report.candidates.length} · ` +
      `저장 ${JSON.stringify(report.saved)} · 슬랙 ${report.slackSent ? "보냄" : "안 보냄"} · ` +
      `네이버 ${report.naverCalls} 구글 ${report.googleCalls} Haiku ${report.haikuCalls}`;
    if (report.status === "ok") console.log(line);
    else console.warn(`${line} · 오류 ${report.errors.length}건`);
    return Response.json({
      status: report.status,
      found: report.candidates.length,
      saved: report.saved,
      slackSent: report.slackSent,
      errors: report.errors.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[press-collect] 실패: ${msg}`);
    return new Response(`언론 보도 수집 실패: ${msg}`, { status: 500 });
  }
}
