import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveBangkaAccess } from "@/lib/bangkaAccess";
import { T_APPS, T_RECS, logStaffAccess, metaFromHeaders, signedFileUrl } from "@/lib/bangkaEnrollServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 청소년 사진·서명 열람 — GET /bangka/enroll/media/{aid}/{photo|guardian_signature|youth_signature|recommendation}
//   recommendation 은 ?rec={추천서 id}. [?download=1]
//   권한 재확인 → 기록(view_file / download_file) → 5분 서명 URL 로 이동.
const COLS: Record<string, string> = {
  photo: "photo_path",
  guardian_signature: "guardian_signature_path",
  youth_signature: "youth_signature_path",
};

export async function GET(request: Request, ctx: { params: Promise<{ aid: string; kind: string }> }) {
  const me = await resolveBangkaAccess();
  if (!me) return new Response("방과후아카데미 관리 권한이 없습니다.", { status: 403 });
  const { aid, kind } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(aid)) return new Response("잘못된 요청입니다.", { status: 400 });
  const sp = new URL(request.url).searchParams;
  const download = sp.get("download") === "1";

  const { data: a, error } = await supabaseAdmin
    .from(T_APPS)
    .select("id, recruitment_id, app_no, photo_path, guardian_signature_path, youth_signature_path")
    .eq("id", aid)
    .maybeSingle();
  if (error) return new Response(error.message, { status: 500 });
  if (!a) return new Response("신청서를 찾을 수 없습니다.", { status: 404 });
  const app = a as Record<string, string | null>;

  let path: string | null = null;
  let target: string = kind;
  if (kind in COLS) {
    path = app[COLS[kind]] ?? null;
  } else if (kind === "recommendation") {
    const rec = sp.get("rec") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(rec)) return new Response("잘못된 요청입니다.", { status: 400 });
    const { data: r } = await supabaseAdmin
      .from(T_RECS)
      .select("id, signature_path")
      .eq("id", rec)
      .eq("application_id", aid)
      .maybeSingle();
    path = (r as { signature_path: string | null } | null)?.signature_path ?? null;
    target = `recommendation:${rec}`;
  } else {
    return new Response("잘못된 요청입니다.", { status: 400 });
  }
  if (!path) return new Response("파일이 없습니다.", { status: 404 });

  const ext = path.split(".").pop() ?? "jpg";
  const url = await signedFileUrl(path, { download, name: `${app.app_no ?? "신청서"}_${kind}.${ext}` });
  if (!url) return new Response("파일을 찾지 못했습니다.", { status: 404 });
  await logStaffAccess(me, metaFromHeaders(request.headers), {
    applicationId: aid,
    recruitmentId: app.recruitment_id,
    action: download ? "download_file" : "view_file",
    target,
    detail: { kind },
  });
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, no-store" } });
}
