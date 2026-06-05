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

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <Link
            href="/hr"
            className="text-sm text-ink-muted hover:underline"
          >
            ← 인사 관리
          </Link>
          <div className="flex items-center gap-2">
            <a
              href={`/hr/recruitment/${slug}/export`}
              className="inline-flex items-center gap-1 rounded-lg border border-brand-blue bg-card px-3 py-1.5 text-xs font-semibold text-brand-blue hover:bg-brand-blue-soft"
            >
              📥 ERP용 Excel 다운로드
            </a>
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
