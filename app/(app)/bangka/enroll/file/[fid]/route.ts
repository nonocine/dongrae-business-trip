import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveBangkaAccess } from "@/lib/bangkaAccess";
import { T_FILES, logStaffAccess, metaFromHeaders, signedFileUrl } from "@/lib/bangkaEnrollServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 신규 접수 증빙 파일 열람 — GET /bangka/enroll/file/{fid}[?download=1]
//   권한 재확인(lib/bangkaAccess) → 기록(view_file / download_file) → 5분 서명 URL 로 이동.
//   비공개 버킷 bk-applications — 공개 URL 은 만들지 않습니다.
export async function GET(request: Request, ctx: { params: Promise<{ fid: string }> }) {
  const me = await resolveBangkaAccess();
  if (!me) return new Response("방과후아카데미 관리 권한이 없습니다.", { status: 403 });
  const { fid } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(fid)) return new Response("잘못된 요청입니다.", { status: 400 });
  const download = new URL(request.url).searchParams.get("download") === "1";

  const { data, error } = await supabaseAdmin
    .from(T_FILES)
    .select("id, application_id, recruitment_id, doc_kind, path, name, purged_at")
    .eq("id", fid)
    .maybeSingle();
  if (error) return new Response(error.message, { status: 500 });
  if (!data) return new Response("파일을 찾을 수 없습니다.", { status: 404 });
  const f = data as {
    id: string;
    application_id: string;
    recruitment_id: string;
    doc_kind: string;
    path: string;
    name: string | null;
    purged_at: string | null;
  };
  if (f.purged_at) return new Response("보관기간이 지나 삭제된 파일입니다.", { status: 410 });

  const url = await signedFileUrl(f.path, { download, name: f.name });
  if (!url) return new Response("파일을 찾지 못했습니다.", { status: 404 });
  await logStaffAccess(me, metaFromHeaders(request.headers), {
    applicationId: f.application_id,
    recruitmentId: f.recruitment_id,
    action: download ? "download_file" : "view_file",
    target: f.id,
    detail: { doc_kind: f.doc_kind },
  });
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, no-store" } });
}
