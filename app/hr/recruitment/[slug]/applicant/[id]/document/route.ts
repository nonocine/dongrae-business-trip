import { requireHrAdmin } from "@/app/hr/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { buildApplicantDoc } from "@/lib/applicantDocxBuilder";
import {
  mapApplicantRow,
  resolveApplicantDocInput,
  safeFileBase,
} from "@/lib/recruitmentApplicantDocData";
import { docxResponse } from "@/lib/recruitmentDocx";

// docx(Packer) + Storage 다운로드는 Node 런타임. 매 요청 최신값.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =====================================================================
// 개별 입사지원서 docx 다운로드 — /hr/recruitment/[slug]/applicant/[id]/document
//   * [id] = recruitment_applicants.id (지원자 id)
//   * 공고(slug) 소속 검증 후 해당 지원자 1명의 지원서를 docx 1개로 반환.
// =====================================================================
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  await requireHrAdmin(); // 미인증 시 '/' redirect
  const { slug, id } = await params;
  if (!id) return new Response("지원자 정보가 누락되었습니다.", { status: 400 });

  // 공고 id 해석.
  const { data: postingRow, error: pErr } = await supabaseAdmin
    .from("recruitment_postings")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (pErr) throw new Error(pErr.message);
  if (!postingRow)
    return new Response("공고를 찾을 수 없습니다.", { status: 404 });
  const postingId = String((postingRow as { id: unknown }).id);

  // 소속 검증 — 이 지원자가 본 공고에 접수(draft 제외)했는지 확인.
  const { data: appRow, error: aErr } = await supabaseAdmin
    .from("recruitment_applications")
    .select("id, status")
    .eq("posting_id", postingId)
    .eq("applicant_id", id)
    .neq("status", "draft")
    .maybeSingle();
  if (aErr) throw new Error(aErr.message);
  if (!appRow)
    return new Response("이 공고의 지원자가 아닙니다.", { status: 404 });

  // 지원자 전체 행 로드.
  const { data: app, error: appErr } = await supabaseAdmin
    .from("recruitment_applicants")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (appErr) throw new Error(appErr.message);
  if (!app)
    return new Response("지원자를 찾을 수 없습니다.", { status: 404 });

  const mapped = mapApplicantRow(app as Record<string, unknown>);
  const input = await resolveApplicantDocInput(mapped);
  const buffer = await buildApplicantDoc(input);

  const base = safeFileBase(input.name, input.applicant_number || "지원자");
  return docxResponse(buffer, `지원서_${base}.docx`);
}
