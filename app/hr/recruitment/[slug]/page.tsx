import Link from "next/link";
import { notFound } from "next/navigation";
import Header from "@/app/components/Header";
import { enforcePasswordChange } from "@/app/actions";
import { requireHrAdmin } from "@/app/hr/actions";
import ScreeningDashboard from "./ScreeningDashboard";
import {
  getPostingForAdmin,
  listApplicantsForAdmin,
  listScoresForPosting,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function RecruitmentAdminPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await enforcePasswordChange();
  const me = await requireHrAdmin();

  const { slug } = await params;
  const adm = await getPostingForAdmin(slug);
  if (!adm) notFound();

  const [applicants, scores] = await Promise.all([
    listApplicantsForAdmin(slug),
    listScoresForPosting(slug),
  ]);

  // 최종합격자(면접합격→최종합격 처리) 수 — 최종합격자 공고 버튼 활성 여부.
  const finalPassedCount = applicants.filter(
    (a) => a.status === "final_passed"
  ).length;

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <Link
            href="/hr"
            className="text-sm text-ink-muted hover:underline"
          >
            ← 채용 관리
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`/hr/recruitment/${slug}/announcement`}
              className="inline-flex items-center gap-1 rounded-lg border border-navy bg-card px-3 py-1.5 text-xs font-semibold text-navy hover:bg-navy-soft"
            >
              📄 공고문 다운로드
            </a>
            <a
              href={`/hr/recruitment/${slug}/export`}
              className="inline-flex items-center gap-1 rounded-lg border border-brand-blue bg-card px-3 py-1.5 text-xs font-semibold text-brand-blue hover:bg-brand-blue-soft"
            >
              📥 ERP용 Excel 다운로드
            </a>
            <a
              href={`/hr/recruitment/${slug}/documents-zip`}
              className="inline-flex items-center gap-1 rounded-lg border border-brand-green bg-card px-3 py-1.5 text-xs font-semibold text-brand-green hover:bg-brand-green/10"
            >
              📦 전체 지원서 일괄 다운로드
            </a>
            <a
              href={`/hr/recruitment/${slug}/screening-summary`}
              className="inline-flex items-center gap-1 rounded-lg border border-navy bg-card px-3 py-1.5 text-xs font-semibold text-navy hover:bg-navy-soft"
            >
              📄 1차 서류 총괄표
            </a>
            <a
              href={`/hr/recruitment/${slug}/summary`}
              className="inline-flex items-center gap-1 rounded-lg border border-navy bg-card px-3 py-1.5 text-xs font-semibold text-navy hover:bg-navy-soft"
            >
              📄 최종심사 총괄표
            </a>
            <a
              href={`/hr/recruitment/${slug}/interview-notice`}
              className="inline-flex items-center gap-1 rounded-lg border border-navy bg-card px-3 py-1.5 text-xs font-semibold text-navy hover:bg-navy-soft"
            >
              📄 면접 대상자 공고
            </a>
            {finalPassedCount > 0 ? (
              <a
                href={`/hr/recruitment/${slug}/final-notice`}
                className="inline-flex items-center gap-1 rounded-lg border border-navy bg-card px-3 py-1.5 text-xs font-semibold text-navy hover:bg-navy-soft"
              >
                📄 최종합격자 공고
              </a>
            ) : (
              <span
                title="최종합격자가 없습니다 (최종 집계 탭에서 최종 합격 처리 후 생성됩니다)"
                className="inline-flex cursor-not-allowed items-center gap-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-hint"
              >
                📄 최종합격자 공고 (없음)
              </span>
            )}
            <Link
              href={`/hr/recruitment/${slug}/judges`}
              className="inline-flex items-center gap-1 rounded-lg border border-navy bg-card px-3 py-1.5 text-xs font-semibold text-navy hover:bg-navy-soft"
            >
              👥 외부위원 배정
            </Link>
            <a
              href={`/recruitment/${slug}/interview`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-brand-green bg-card px-3 py-1.5 text-xs font-semibold text-brand-green hover:bg-brand-green/10"
            >
              📝 면접 채점 페이지 ↗
            </a>
          </div>
        </div>
        <ScreeningDashboard
          posting={adm.posting}
          applicants={applicants}
          scores={scores}
          myReviewerName={me.name}
        />
      </main>
    </>
  );
}
