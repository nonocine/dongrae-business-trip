import { getActivity } from "@/app/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isTripBucket, tripRefPath } from "@/lib/tripStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 활동 첨부 열람 — GET /api/activity-file?id=<활동>&bucket=trip-photos|trip-receipts&ref=<저장된 값>[&raw=1]
//   · getActivity 가 로그인과 보기 권한(작성자 본인 + 관장·부장·master)을 확인합니다.
//   · ref 는 그 활동에 실제로 붙은 파일이어야 합니다(다른 파일 경로를 넣어 여는 것 방지).
//   · 기본: 1시간 서명 URL 로 이동 / raw=1: 서버가 내려받아 그대로 돌려줌(보고서 PDF 사진).
const SIGNED_SECONDS = 60 * 60;

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const id = q.get("id") ?? "";
  const bucket = q.get("bucket");
  const ref = q.get("ref") ?? "";
  if (!id || !isTripBucket(bucket)) return new Response("잘못된 요청입니다.", { status: 400 });
  const path = tripRefPath(ref, bucket);
  if (!path) return new Response("파일 경로를 확인할 수 없습니다.", { status: 400 });

  const activity = await getActivity(id);
  if (!activity) return new Response("볼 수 있는 활동이 아닙니다.", { status: 403 });
  const attached = bucket === "trip-photos" ? activity.photos : [...activity.receipts, ...activity.certificate];
  if (!attached.some((r) => tripRefPath(r, bucket) === path)) {
    return new Response("이 활동의 첨부가 아닙니다.", { status: 404 });
  }

  if (q.get("raw") === "1") {
    const { data, error } = await supabaseAdmin.storage.from(bucket).download(path);
    if (error || !data) return new Response("파일을 찾지 못했습니다.", { status: 404 });
    return new Response(Buffer.from(await data.arrayBuffer()), {
      headers: { "Content-Type": data.type || "application/octet-stream", "Cache-Control": "private, no-store" },
    });
  }
  const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(path, SIGNED_SECONDS);
  if (error || !data?.signedUrl) return new Response("파일을 찾지 못했습니다.", { status: 404 });
  return new Response(null, {
    status: 302,
    headers: { Location: data.signedUrl, "Cache-Control": "private, no-store" },
  });
}
