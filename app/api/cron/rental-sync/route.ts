import { runRentalSync } from "@/lib/rentalSync";

// Vercel Cron 전용 — 1일 1회 호출(vercel.json).
//   * 인증: Authorization === `Bearer ${CRON_SECRET}` (기존 Cron 과 동일 패턴).
//   * 홈페이지가 원본이고 우리는 복제만 합니다 — 예약을 만들거나 고치지 않습니다.
//   * 기본 창은 과거 180일까지 되돌아봅니다. 이유는 "취소 갱신" 입니다:
//     확정이던 예약이 나중에 취소로 바뀌므로, 지난 기간을 다시 받아 덮어야
//     우리 화면의 확정 건수가 홈페이지와 어긋나지 않습니다.
//   * 동기화 실패는 runRentalSync 안에서 슬랙 알림(하루 1회)까지 처리하고
//     ok:false 로 돌아옵니다. 여기서는 Cron 실패가 로그에 드러나도록 500.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// 365일 창을 분할 호출하면 1만건대 upsert 까지 합쳐 수십 초 걸립니다
// (실측 12,851건 / 5회 호출 / 13.5초). 여유를 두고 상한을 올려둡니다.
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

  const summary = await runRentalSync();
  // 한 줄 요약 — 화면에 데이터가 안 보일 때 "동기화가 돌았는지" 와
  //   "받아왔는데 비어 있는지" 를 로그만 보고 구분할 수 있도록 남깁니다.
  const line =
    `[rental-sync] ${summary.window.start}~${summary.window.end} · ` +
    `호출 ${summary.calls}회 · 저장 ${summary.upserted}건 · ` +
    `구분 ${JSON.stringify(summary.byType)}` +
    (summary.incomplete.length > 0
      ? ` · 불완전 ${summary.incomplete.join(",")}`
      : "");

  if (!summary.ok) {
    console.error(`${line} · 실패: ${summary.message}`);
    return new Response(
      summary.message ?? "대관예약을 동기화하지 못했습니다.",
      { status: 500 },
    );
  }

  console.log(line);
  return Response.json(summary);
}
