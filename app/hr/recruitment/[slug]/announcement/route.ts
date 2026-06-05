import { requireHrAdmin } from "@/app/hr/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  buildAnnouncementDoc,
  type AnnouncementPosting,
} from "@/lib/recruitmentDocBuilders";
import { docxResponse } from "@/lib/recruitmentDocx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const s = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  await requireHrAdmin(); // 미인증 시 '/' redirect
  const { slug } = await params;

  // select("*") — salary_grade 등 없는 컬럼이 있어도 안전(undefined → 빈칸).
  const { data, error } = await supabaseAdmin
    .from("recruitment_postings")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return new Response("공고를 찾을 수 없습니다.", { status: 404 });

  const r = data as Record<string, unknown>;
  const posting: AnnouncementPosting = {
    slug: String(r.slug ?? slug),
    title: String(r.title ?? ""),
    field: String(r.field ?? ""),
    recruit_count: Number(r.recruit_count ?? 0),
    qualifications: s(r.qualifications),
    preferred: s(r.preferred),
    salary_grade: s(r.salary_grade), // 컬럼 없으면 null → 빈칸
    work_contract_period: s(r.work_contract_period),
    work_location: s(r.work_location),
    work_hours: s(r.work_hours),
    work_duties: s(r.work_duties),
    salary_info: s(r.salary_info),
    application_start: String(r.application_start ?? ""),
    application_end: String(r.application_end ?? ""),
    screening_criteria: s(r.screening_criteria),
    interview_criteria: s(r.interview_criteria),
    notice: s(r.notice),
    origin: new URL(request.url).origin,
  };

  const buffer = await buildAnnouncementDoc(posting);
  const filename = `채용공고_${posting.field || "직원"}_${posting.slug}.docx`;
  return docxResponse(buffer, filename);
}
