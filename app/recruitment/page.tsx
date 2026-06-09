import Link from "next/link";
import { listPublishedRecruitmentSummaries } from "@/app/recruitment/[slug]/actions";
import { RecruitmentHeader } from "@/app/recruitment/[slug]/PublicUi";
import { fmtKstDate } from "@/lib/datetime";
import { splitRecruitmentFields, fieldBadgeCls } from "@/lib/ui";

// DB 조회 기반이므로 매 요청마다 최신 공고 목록을 렌더링합니다.
export const dynamic = "force-dynamic";

// =====================================================================
// 공개 채용공고 목록 — status='published' 공고 전체를 카드로 노출.
//   * 마감(application_end < now)인 공고도 목록엔 남기고 "마감" 배지만 표시.
//   * draft/closed 는 listPublishedRecruitmentSummaries 단계에서 이미 제외됨.
//   * 정렬은 마감 임박순(서버 쿼리 order)을 유지.
// =====================================================================
export default async function RecruitmentListPage() {
  const postings = await listPublishedRecruitmentSummaries();

  // force-dynamic 서버 컴포넌트는 요청마다 1회 렌더되므로 Date.now() 가 안전.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

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
          {postings.map((p) => {
            const closed = new Date(p.application_end).getTime() < now;
            return (
              <li key={p.slug}>
                <Link
                  href={`/recruitment/${p.slug}`}
                  className="block rounded-xl border border-line bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-blue hover:shadow-md sm:p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                            closed
                              ? "bg-surface text-ink-muted"
                              : "bg-brand-green/15 text-brand-green"
                          }`}
                        >
                          {closed ? "마감" : "접수중"}
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
                  <span
                    className={`mt-3 flex w-full items-center justify-center gap-1 rounded-lg py-2 text-sm font-semibold ${
                      closed
                        ? "bg-surface text-ink-muted"
                        : "bg-gradient-to-r from-brand-blue to-navy text-white"
                    }`}
                  >
                    {closed ? "공고 보기" : "지원하기"}
                    <span aria-hidden>→</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
