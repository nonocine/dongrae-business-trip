import { runErpSync, formatErpSyncSummary } from "@/lib/erp/sync";

// Vercel Cron 전용 — 하루 3회(한국시간 07:00·12:00·18:00 = UTC 22:00·03:00·09:00, vercel.json).
//   * 인증: Authorization === `Bearer ${CRON_SECRET}` (기존 Cron 과 동일 패턴).
//   * ERP 가 원본, 우리는 erp_* 표에 복제만 합니다(ERP 로 쓰지 않음).
//   * API 하나가 실패해도 나머지는 계속하고, 하나라도 실패하면 500 으로 로그에 드러냅니다.
//   * 로그에는 API 별 건수·성공 여부만(키·금액·계좌·이름 없음).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response("CRON_SECRET 미설정 — Vercel 환경변수에 CRON_SECRET 을 등록하세요.", { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const summary = await runErpSync("cron");
  const line = formatErpSyncSummary(summary);
  const failed = summary.results.filter((r) => !r.ok).map((r) => r.api);
  if (failed.length || summary.linkError) {
    console.error(`${line} · 실패 ${failed.join(",") || "-"}${summary.linkError ? " · 직원연결 오류" : ""}`);
    return Response.json(
      { ok: false, failed, results: summary.results.map(({ api, ok, fetched, upserted, removed }) => ({ api, ok, fetched, upserted, removed })) },
      { status: 500 }
    );
  }
  console.log(line);
  return Response.json({
    ok: true,
    results: summary.results.map(({ api, ok, fetched, upserted, removed }) => ({ api, ok, fetched, upserted, removed })),
    link: summary.link,
  });
}
