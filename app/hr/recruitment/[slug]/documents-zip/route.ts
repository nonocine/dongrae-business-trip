import JSZip from "jszip";
import { requireHrAdmin } from "@/app/hr/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { buildApplicantDoc } from "@/lib/applicantDocxBuilder";
import {
  mapApplicantRow,
  resolveApplicantDocInput,
  safeFileBase,
} from "@/lib/recruitmentApplicantDocData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =====================================================================
// 전체 입사지원서 일괄 다운로드(ZIP) — /hr/recruitment/[slug]/documents-zip
//   * 접수(draft 제외)된 모든 지원자의 docx 를 각각 만들어 ZIP 으로 묶습니다.
//   * 내부 파일명: "지원서_{이름}.docx" (동명이인은 (2),(3)… 으로 구분)
// =====================================================================
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  await requireHrAdmin(); // 미인증 시 '/' redirect
  const { slug } = await params;

  const { data: postingRow, error: pErr } = await supabaseAdmin
    .from("recruitment_postings")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (pErr) throw new Error(pErr.message);
  if (!postingRow)
    return new Response("공고를 찾을 수 없습니다.", { status: 404 });
  const postingId = String((postingRow as { id: unknown }).id);

  // 접수 완료 지원자 + 지원서 본문 join.
  const { data: apps, error: aErr } = await supabaseAdmin
    .from("recruitment_applications")
    .select("id, status, submitted_at, applicant:recruitment_applicants(*)")
    .eq("posting_id", postingId)
    .neq("status", "draft")
    .order("submitted_at", { ascending: true });
  if (aErr) throw new Error(aErr.message);

  const rows = (apps ?? []) as unknown[];
  if (rows.length === 0)
    return new Response("접수된 지원자가 없습니다.", { status: 404 });

  const zip = new JSZip();
  const usedNames = new Map<string, number>();

  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const app = r.applicant as Record<string, unknown> | null;
    if (!app) continue;

    const mapped = mapApplicantRow(app);
    const input = await resolveApplicantDocInput(mapped);
    const buffer = await buildApplicantDoc(input);

    // 파일명 — 동명이인 충돌 방지.
    const base = safeFileBase(input.name, input.applicant_number || "지원자");
    const seen = usedNames.get(base) ?? 0;
    usedNames.set(base, seen + 1);
    const fileName = seen === 0 ? `지원서_${base}.docx` : `지원서_${base}(${seen + 1}).docx`;

    zip.file(fileName, buffer);
  }

  const out = await zip.generateAsync({ type: "nodebuffer" });
  const zipName = `지원서_전체_${slug}.zip`;

  return new Response(out as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
        zipName
      )}`,
      "Cache-Control": "no-store",
    },
  });
}
