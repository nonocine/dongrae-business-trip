import { refreshInstagramTokenIfDue } from "@/lib/instagramToken";

// Vercel Cron 전용 — 매일 한국 06:00(UTC 21:00) 호출.
//   * 인증: Authorization === `Bearer ${CRON_SECRET}` (기존 Cron 과 동일 패턴).
//   * 인스타그램 장기 토큰(60일)을 마지막 발급·연장 후 50일이 지났을 때만 연장합니다.
//     매일 부르는 건 하루 실패해도 다음 날 다시 시도하게 하려는 것입니다.
//   * 응답에는 상태·만료일만(토큰 값은 절대 안 실음).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response("CRON_SECRET 미설정 — Vercel 환경변수에 CRON_SECRET 을 등록하세요.", { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const r = await refreshInstagramTokenIfDue();
  if (r.status === "failed") console.warn("[instagram-token] 연장 실패:", r.reason);
  return Response.json({ ok: r.status !== "failed", ...r }, { status: r.status === "failed" ? 500 : 200 });
}
