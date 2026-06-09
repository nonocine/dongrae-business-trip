import Link from "next/link";
import { listPublishedRecruitmentSummaries } from "@/app/recruitment/[slug]/actions";
import { RecruitmentHeader } from "@/app/recruitment/[slug]/PublicUi";
import { fmtKstDate } from "@/lib/datetime";
import { splitRecruitmentFields, fieldBadgeCls } from "@/lib/ui";

// DB 조회 기반이므로 매 요청마다 최신 공고 목록을 렌더링합니다.
export const dynamic = "force-dynamic";

// =====================================================================
// 공개 채용공고 목록 — "진행 중"(접수중) 공고만 카드로 노출.
//   * listPublishedRecruitmentSummaries 가 status='published' AND
//     application_end >= now 만, 마감 임박순으로 반환 → 마감/비공개 공고는
//     여기 도달하지 않습니다.
// =====================================================================
export default async function RecruitmentListPage() {
  const postings = await listPublishedRecruitmentSummaries();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <RecruitmentHeader title="직원 채용 공고">
        <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-semibold text-white">
          진행 중 {postings.length}건
        </span>
      </RecruitmentHeader>

      {postings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface p-10 text-center">
          <p className="text-sm text-ink-muted">
            현재 진행 중인 채용공고가 없습니다.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {postings.map((p) => (
            <li key={p.slug}>
              <Link
                href={`/recruitment/${p.slug}`}
                className="block rounded-xl border border-line bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-blue hover:shadow-md sm:p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-brand-green/15 px-2.5 py-0.5 text-[11px] font-bold text-brand-green">
                        접수중
                      </span>
                      {splitRecruitmentFields(p.field).map((f, i) => (
                        <span key={`${f}-${i}`} className={fieldBadgeCls(i)}>
                          {f}
                        </span>
                      ))}
                    </div>
                    <h2 className="mt-2 break-keep text-base font-bold leading-snug text-ink sm:text-lg">
                      {p.title}
                    </h2>
                    <dl className="mt-2 space-y-0.5 text-xs text-ink-muted sm:text-sm">
                      <div className="flex gap-2">
                        <dt className="shrink-0 text-ink-hint">접수기간</dt>
                        <dd>
                          {fmtKstDate(p.application_start)} ~{" "}
                          {fmtKstDate(p.application_end)}
                        </dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="shrink-0 text-ink-hint">모집인원</dt>
                        <dd>{p.recruit_count}명</dd>
                      </div>
                    </dl>
                  </div>
                  <span
                    aria-hidden
                    className="mt-1 shrink-0 self-center text-lg text-brand-blue"
                  >
                    →
                  </span>
                </div>
                <span className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg bg-gradient-to-r from-brand-blue to-navy py-2 text-sm font-semibold text-white">
                  지원하기
                  <span aria-hidden>→</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
