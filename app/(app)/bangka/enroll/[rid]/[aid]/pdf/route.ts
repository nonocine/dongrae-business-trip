import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveBangkaAccess } from "@/lib/bangkaAccess";
import { T_APPS, T_RECRUIT, T_RECS, logStaffAccess, metaFromHeaders } from "@/lib/bangkaEnrollServer";
import { ENROLL_BUCKET, normalizeData, normalizeSensitive, parseStops } from "@/lib/bangkaEnroll";
import { buildApplicationPdf } from "@/lib/bangkaApplicationPdf";
import { formatBkPhone } from "@/lib/bangka";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 신청서 PDF — GET /bangka/enroll/{rid}/{aid}/pdf
//   권한: 상세 화면과 같음(M0 + 방카 직무 — resolveBangkaAccess).
//   받을 때마다 bk_application_access_logs(action='pdf_download') 한 줄. 기록을 못 남기면 내려주지 않음.
//   파일명: 신청서_{접수번호}_{청소년이름}.pdf
const UUID = /^[0-9a-f-]{36}$/i;
const safeName = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, "_");

async function fileBytes(path: string | null | undefined): Promise<Uint8Array | null> {
  if (!path) return null;
  const { data, error } = await supabaseAdmin.storage.from(ENROLL_BUCKET).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

export async function GET(request: Request, ctx: { params: Promise<{ rid: string; aid: string }> }) {
  const me = await resolveBangkaAccess();
  if (!me) return new Response("방과후아카데미 관리 권한이 없습니다.", { status: 403 });
  const { rid, aid } = await ctx.params;
  if (!UUID.test(rid) || !UUID.test(aid)) return new Response("잘못된 요청입니다.", { status: 400 });

  const { data: a, error } = await supabaseAdmin
    .from(T_APPS)
    .select("id, recruitment_id, app_no, data, sensitive, guardian_phone, photo_path, guardian_signature_path, youth_signature_path, submitted_at")
    .eq("id", aid)
    .eq("recruitment_id", rid)
    .maybeSingle();
  if (error) return new Response(error.message, { status: 500 });
  if (!a) return new Response("신청서를 찾을 수 없습니다.", { status: 404 });
  const app = a as {
    id: string;
    recruitment_id: string;
    app_no: string | null;
    data: unknown;
    sensitive: unknown;
    guardian_phone: string | null;
    photo_path: string | null;
    guardian_signature_path: string | null;
    youth_signature_path: string | null;
    submitted_at: string | null;
  };
  if (!app.submitted_at) return new Response("아직 제출하지 않은 신청서입니다.", { status: 400 });

  const [recruitRes, recRes] = await Promise.all([
    supabaseAdmin.from(T_RECRUIT).select("title, shuttle_stops").eq("id", rid).maybeSingle(),
    supabaseAdmin
      .from(T_RECS)
      .select("org, position, writer_name, writer_phone, reasons, opinion, notes, signature_path, submitted_at")
      .eq("application_id", aid)
      .not("submitted_at", "is", null)
      .is("revoked_at", null)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (recruitRes.error) return new Response(recruitRes.error.message, { status: 500 });
  if (recRes.error) return new Response(recRes.error.message, { status: 500 });
  const r = recruitRes.data as { title: string; shuttle_stops: unknown } | null;
  const rec = recRes.data as {
    org: string | null;
    position: string | null;
    writer_name: string | null;
    writer_phone: string | null;
    reasons: unknown;
    opinion: string | null;
    notes: string | null;
    signature_path: string | null;
    submitted_at: string | null;
  } | null;

  const d = normalizeData(app.data);
  const [photo, guardianSig, youthSig, recSig] = await Promise.all([
    fileBytes(app.photo_path),
    fileBytes(app.guardian_signature_path),
    fileBytes(app.youth_signature_path),
    fileBytes(rec?.signature_path),
  ]);

  const pdf = await buildApplicationPdf({
    appNo: app.app_no,
    recruitmentTitle: r?.title ?? "",
    data: d,
    sensitive: app.sensitive != null ? normalizeSensitive(app.sensitive) : null,
    guardianPhone: formatBkPhone(app.guardian_phone ?? ""),
    submittedAt: app.submitted_at,
    stops: parseStops(r?.shuttle_stops),
    photo,
    guardianSig,
    youthSig,
    recommendation: rec
      ? {
          org: rec.org,
          position: rec.position,
          writer_name: rec.writer_name,
          writer_phone: rec.writer_phone ? formatBkPhone(rec.writer_phone) : null,
          reasons: Array.isArray(rec.reasons) ? (rec.reasons as string[]) : [],
          opinion: rec.opinion,
          notes: rec.notes,
          submitted_at: rec.submitted_at,
          signature: recSig,
        }
      : null,
  });

  const filename = `신청서_${safeName(app.app_no ?? "번호없음")}_${safeName(d.youth.name || "이름없음")}.pdf`;
  const logged = await logStaffAccess(me, metaFromHeaders(request.headers), {
    applicationId: app.id,
    recruitmentId: app.recruitment_id,
    action: "pdf_download",
    target: filename,
    detail: { app_no: app.app_no, recommendation: !!rec, shuttle: d.ret.method === "shuttle" },
  });
  if (!logged) return new Response("열람 기록을 남기지 못해 다운로드를 멈췄습니다. 잠시 뒤 다시 해 주세요.", { status: 500 });

  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
