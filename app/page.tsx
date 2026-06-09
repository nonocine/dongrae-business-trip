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
      <main className="relative flex min-h-[100dvh] flex-1 flex-col items-center justify-center overflow-hidden px-5 py-12 text-white">
        {/* 브랜드 배경 — 스플래시(#0f2644)와 동일 톤의 딥네이비 그라데이션 */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10"
          style={{
            background:
              "linear-gradient(160deg, #0f2644 0%, #16314f 55%, #1e3a5f 100%)",
          }}
        />
        {/* 은은한 글로우 — 스플래시와 동일한 라디얼 */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-1/4 left-1/2 -z-10 h-[120vmin] w-[120vmin] -translate-x-1/2 rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(37,99,235,0.22) 0%, rgba(15,38,68,0) 60%)",
          }}
        />

        <div className="w-full max-w-md">
          {/* 히어로 — 스플래시 아이콘·타이포를 그대로 이어받아 진입 연속성 */}
          <div className="flex flex-col items-center text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icon-192.png"
              alt="동업자씨"
              className="h-20 w-20 rounded-[22px] shadow-2xl ring-1 ring-white/10 sm:h-24 sm:w-24"
            />
            <h1 className="mt-5 text-3xl font-extrabold tracking-tight sm:text-4xl">
              동업자씨
            </h1>
            <p className="mt-2 text-sm font-medium tracking-[0.18em] text-[#7aa8d0]">
              동래구청소년센터
            </p>
            <p className="mt-1 text-xs text-white/45">업무 자동화 씨스템</p>
          </div>

          {googleError && (
            <p className="mt-6 rounded-lg bg-stamp-soft px-3 py-2 text-center text-sm font-medium text-stamp">
              {googleError}
            </p>
          )}

          {/* 진입 카드 2개 — OG 의 색상 보더 글래스 카드 언어 재사용 */}
          <div className="mt-9 space-y-3.5">
            {/* ① 채용 공고 — 공개(지원자용). 글래스 + 블루 포인트 */}
            <Link
              href="/recruitment"
              className="group flex items-center gap-4 rounded-2xl border border-white/15 border-l-4 border-l-brand-blue bg-white/[0.08] p-5 shadow-lg backdrop-blur-md transition duration-200 hover:-translate-y-1 hover:bg-white/[0.14] hover:shadow-xl"
            >
              <span
                aria-hidden
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-blue text-2xl shadow-inner"
              >
                📢
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-base font-bold">채용 공고</span>
                  {recruitmentCount > 0 && (
                    <span className="rounded-full bg-brand-green/20 px-2 py-0.5 text-[10px] font-bold text-brand-green ring-1 ring-brand-green/40">
                      진행 중 {recruitmentCount}건
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-white/55">
                  지원자용 · 공고 확인 및 온라인 지원
                </span>
              </span>
              <span
                aria-hidden
                className="shrink-0 text-lg text-white/50 transition group-hover:translate-x-0.5 group-hover:text-white"
              >
                →
              </span>
            </Link>

            {/* ② 직원 업무 시스템 — 구글 로그인. 솔리드 네이비·블루 */}
            <a
              href="/api/auth/google/login?next=/"
              className="group flex items-center gap-4 rounded-2xl border border-white/10 bg-gradient-to-br from-brand-blue-strong to-navy-strong p-5 shadow-lg transition duration-200 hover:-translate-y-1 hover:shadow-xl"
            >
              <span
                aria-hidden
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white text-xl font-black text-navy shadow"
              >
                G
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-bold">
                  직원 업무 시스템
                </span>
                <span className="mt-0.5 block text-xs text-white/65">
                  직원 전용 · 구글 워크스페이스로 로그인
                </span>
              </span>
              <span
                aria-hidden
                className="shrink-0 text-lg text-white/60 transition group-hover:translate-x-0.5 group-hover:text-white"
              >
                →
              </span>
            </a>
          </div>

          <p className="mt-5 text-center text-[11px] text-white/40">
            직원 업무는{" "}
            <span className="text-white/60">@onnainna.kr</span> 구글 계정
            로그인이 필요합니다.
          </p>
        </div>

        {/* 하단 4색 스트립 — 스플래시/브랜드 시그니처 (파·빨·노·초) */}
        <div aria-hidden className="absolute bottom-0 left-0 flex h-2 w-full">
          <span className="h-full flex-1" style={{ backgroundColor: "#2563eb" }} />
          <span className="h-full flex-1" style={{ backgroundColor: "#e84040" }} />
          <span className="h-full flex-1" style={{ backgroundColor: "#f0c030" }} />
          <span className="h-full flex-1" style={{ backgroundColor: "#3ab54a" }} />
        </div>
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
