import sharp from "sharp";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveBangkaAccess } from "@/lib/bangkaAccess";
import { bucket } from "@/lib/bangkaMedia";
import { absenceReasonLabel, type AbsenceRow } from "@/lib/bangkaAbsence";
import { buildAbsencePdf } from "@/lib/bangkaFormPdf";
import { bkClassLabel } from "@/lib/bangka";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// [필수 운영서식 15] 공결확인서 PDF — 원본 양식 + 확인자 서명, 뒤 장에 증빙자료(사진·PDF).
//   학년/반 은 학생 정보의 학년(grade)·방과후 반(class_code → 이음반·지음반). 학년이 비어 있으면 빈칸(손으로 적음).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await resolveBangkaAccess())) return new Response("방과후아카데미 관리 권한이 없습니다.", { status: 403 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("잘못된 요청입니다.", { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("bk_absences")
    .select("*, bk_students(name, school, grade, class_code), bk_absence_files(name, mime, path, created_at)")
    .eq("id", id)
    .maybeSingle();
  if (error) return new Response(error.message, { status: 500 });
  if (!data) return new Response("공결 신청을 찾지 못했습니다.", { status: 404 });
  const a = data as AbsenceRow & {
    bk_students: { name: string; school: string | null; grade: string | null; class_code: string | null } | null;
    bk_absence_files: { name: string | null; mime: string | null; path: string; created_at: string }[];
  };

  const download = async (path: string) => {
    const { data: blob } = await bucket().download(path);
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  };
  // pdf-lib 는 JPG·PNG 만 넣을 수 있어 그 밖(WebP 등)은 JPG 로 바꿉니다.
  const asEmbeddable = async (bytes: Uint8Array, mime: string | null) => {
    if (mime === "application/pdf" || mime === "image/jpeg" || mime === "image/png") return { bytes, mime };
    return { bytes: new Uint8Array(await sharp(bytes).rotate().jpeg({ quality: 85 }).toBuffer()), mime: "image/jpeg" };
  };

  const files = [...a.bk_absence_files].sort((x, y) => x.created_at.localeCompare(y.created_at));
  const evidence = [];
  for (const f of files) {
    const bytes = await download(f.path);
    if (!bytes) continue;
    try {
      evidence.push({ name: f.name ?? "증빙", ...(await asEmbeddable(bytes, f.mime)) });
    } catch {
      evidence.push({ name: f.name ?? "증빙", bytes, mime: "application/octet-stream" });
    }
  }
  const sigBytes = a.signature_path ? await download(a.signature_path) : null;

  const pdf = await buildAbsencePdf({
    name: a.bk_students?.name ?? "",
    school: a.bk_students?.school ?? null,
    grade: a.bk_students?.grade ?? null,
    afterClass: a.bk_students?.class_code ? bkClassLabel(a.bk_students.class_code) : null,
    startDate: a.start_date,
    endDate: a.end_date,
    confirmerType: a.confirmer_type,
    confirmerOther: a.confirmer_other,
    confirmerName: a.confirmer_name ?? "",
    reasonLabel: absenceReasonLabel(a.reason_type),
    reason: a.reason,
    confirmedOn: a.confirmed_on ?? a.created_at.slice(0, 10),
    signature: sigBytes ? { bytes: sigBytes, mime: a.signature_path!.endsWith(".png") ? "image/png" : "image/jpeg" } : null,
    evidence,
  });
  const filename = `공결확인서_${a.bk_students?.name ?? ""}_${a.start_date}.pdf`;
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
