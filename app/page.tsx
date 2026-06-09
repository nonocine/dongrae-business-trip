import Link from "next/link";
import Header from "@/app/components/Header";
import ActivityList from "@/app/components/ActivityList";
import {
  enforcePasswordChange,
  getSession,
  listActivities,
} from "@/app/actions";
import { listPublishedRecruitmentSummaries } from "@/app/recruitment/[slug]/actions";
import { cardCls } from "@/lib/ui";

export const dynamic = "force-dynamic";

// 메인 화면 배너 — published 공고가 1건 이상일 때만 노출.
//   * 건수(N)만 요약해 공개 목록 페이지(/recruitment)로 보냄.
function RecruitmentBanner({ count }: { count: number }) {
  return (
    <Link
      href="/recruitment"
      className="flex items-center justify-between gap-2 rounded-lg border border-brand-blue bg-brand-blue-soft/40 px-4 py-2.5 text-sm font-semibold text-brand-blue shadow-sm transition hover:bg-brand-blue-soft"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className="rounded-full bg-brand-blue px-2 py-0.5 text-[10px] font-bold text-white"
        >
          채용
        </span>
        <span className="truncate">채용 진행 중 {count}건 보기</span>
      </span>
      <span aria-hidden className="shrink-0">→</span>
    </Link>
  );
}

// 구글 로그인 콜백 실패 코드 → 사용자 안내 문구.
function googleErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  if (code === "domain_not_allowed") {
    return "onnainna.kr 워크스페이스 계정으로만 로그인할 수 있습니다.";
  }
  if (code === "not_registered") {
    return "등록되지 않은 계정입니다. 관리자에게 문의하세요.";
  }
  return "구글 로그인에 실패했습니다. 다시 시도해주세요.";
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ google_error?: string }>;
}) {
  // 임시 비밀번호 사용자는 비번 변경 페이지로 강제 이동
  await enforcePasswordChange();
  const session = await getSession();

  const published = await listPublishedRecruitmentSummaries();
  const recruitmentCount = published.length;

  // 비로그인 → 공개 관문(landing). 누구나 접근 가능, 내부 데이터 비노출.
  //   ① 채용 공고: 공개(지원자용) → /recruitment
  //   ② 직원 업무 시스템: 구글 로그인 후 직원 메인(/)으로 복귀.
  if (!session) {
    const googleError = googleErrorMessage((await searchParams).google_error);
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-12 sm:py-16">
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/dongrae-logo.png"
            alt="동래구청소년센터"
            className="mx-auto h-16 w-auto object-contain sm:h-20"
          />
          <h1 className="mt-4 text-xl font-extrabold tracking-tight text-ink sm:text-2xl">
            동래구청소년센터
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            동업자씨 · 업무 자동화 시스템
          </p>
        </div>

        {googleError && (
          <p className="mt-6 rounded-lg bg-stamp-soft px-3 py-2 text-center text-sm text-stamp">
            {googleError}
          </p>
        )}

        <div className="mt-8 space-y-3">
          {/* ① 채용 공고 — 공개(지원자용) */}
          <Link
            href="/recruitment"
            className="group flex items-center gap-4 rounded-2xl border border-line bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-blue hover:shadow-md"
          >
            <span
              aria-hidden
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-blue-soft text-2xl"
            >
              📢
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-base font-bold text-ink">채용 공고</span>
                {recruitmentCount > 0 && (
                  <span className="rounded-full bg-brand-green/15 px-2 py-0.5 text-[10px] font-bold text-brand-green">
                    진행 중 {recruitmentCount}건
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-xs text-ink-muted">
                지원자용 · 채용 공고 확인 및 지원
              </span>
            </span>
            <span
              aria-hidden
              className="shrink-0 text-lg text-brand-blue transition group-hover:translate-x-0.5"
            >
              →
            </span>
          </Link>

          {/* ② 직원 업무 시스템 — 구글 워크스페이스 로그인 */}
          <a
            href="/api/auth/google/login?next=/"
            className="group flex items-center gap-4 rounded-2xl border border-navy/20 bg-navy p-5 shadow-sm transition hover:-translate-y-0.5 hover:bg-navy-strong hover:shadow-md"
          >
            <span
              aria-hidden
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/15 text-xl font-bold text-white"
            >
              G
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-bold text-white">
                직원 업무 시스템
              </span>
              <span className="mt-0.5 block text-xs text-white/70">
                직원 전용 · 구글 워크스페이스로 로그인
              </span>
            </span>
            <span
              aria-hidden
              className="shrink-0 text-lg text-white/80 transition group-hover:translate-x-0.5"
            >
              →
            </span>
          </a>
        </div>

        <p className="mt-4 text-center text-[11px] text-ink-hint">
          직원 업무는 @onnainna.kr 구글 계정 로그인이 필요합니다.
        </p>
      </main>
    );
  }

  const activities = await listActivities();

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-5 sm:py-6">
        {recruitmentCount > 0 && (
          <RecruitmentBanner count={recruitmentCount} />
        )}
        <section className={cardCls}>
          <h2 className="text-lg font-bold tracking-tight text-ink">
            {session.kind === "admin"
              ? "전체 활동 일지"
              : `${session.name} 님의 활동 일지`}
          </h2>
          <p className="mt-1 text-xs text-ink-muted">
            외근 · 출장 · 국내연수 · 해외연수 · 교육 모두 한곳에서 관리하세요.
          </p>
        </section>

        <Link
          href="/new"
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-navy px-4 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-navy-strong"
        >
          <span aria-hidden>＋</span>
          활동 작성
        </Link>

        <ActivityList activities={activities} />
      </main>
    </>
  );
}
