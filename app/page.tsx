import Link from "next/link";
import Header from "@/app/components/Header";
import GateIntro from "@/app/components/GateIntro";
import EmployeeDashboard from "@/app/components/EmployeeDashboard";
import PinEntry from "@/app/components/PinEntry";
import PinSuggestBanner from "@/app/components/PinSuggestBanner";
import { getTrustedDeviceHint, getPinStatus } from "@/app/auth/pinActions";
import { enforcePasswordChange, getSession } from "@/app/actions";
import { listPublishedRecruitmentSummaries } from "@/app/recruitment/[slug]/actions";

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
    // 이 기기가 신뢰 등록돼 있으면 PIN 간편입력을 함께 노출합니다.
    const trustedDevice = await getTrustedDeviceHint();
    return (
      <main
        className="relative flex min-h-[100dvh] flex-1 flex-col items-center justify-center overflow-hidden px-5 py-12"
        style={{
          // 화면 전체를 딥네이비~블루로 채움(OG/아이콘 톤). 배경은 main 자체에 직접.
          background:
            "linear-gradient(160deg, #0f2547 0%, #16314f 50%, #1a3a5c 100%)",
        }}
      >
        {/* 첫 진입 인트로 — 서류가 스마트폰으로 빨려 들어가 정리되는 모션 */}
        <GateIntro />

        {/* 은은한 글로우 — 스플래시와 동일한 라디얼(콘텐츠 아래) */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-1/4 left-1/2 h-[120vmin] w-[120vmin] -translate-x-1/2 rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(37,99,235,0.20) 0%, rgba(15,38,68,0) 60%)",
          }}
        />

        <div className="relative z-10 w-full max-w-md">
          {/* 히어로 — 세로형 센터 로고(흰 타일) + 동업자씨 약자 강조 */}
          <div className="flex flex-col items-center text-center">
            <div className="rounded-2xl bg-white px-5 py-4 shadow-2xl ring-1 ring-white/20">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/logo2.png"
                alt="동래구청소년센터 로고"
                className="h-28 w-auto object-contain sm:h-32"
              />
            </div>

            {/* 브랜드명 — 네 글자를 로고 색감으로 강조.
                색 순서는 빨강→파랑→초록→노랑 — 동아리 결과보고서의 브랜드
                4색 띠(lib/clubReportDocx.ts BRAND)와 같은 순서이고, 헤더
                부제목(HeaderClient)도 이 순서를 씁니다.
                값은 어두운 배경용으로 맞춰 둔 것이라 그대로 둡니다. */}
            <h1 className="mt-5 text-4xl font-extrabold tracking-[0.04em] sm:text-5xl">
              <span style={{ color: "#e84040" }}>동</span>
              <span style={{ color: "#2f7be0" }}>업</span>
              <span style={{ color: "#3ab54a" }}>자</span>
              <span style={{ color: "#f0c030" }}>씨</span>
            </h1>

            {/* 풀네임 전개 — 앞글자 4개를 위 h1 과 같은 색·같은 순서로 매칭
                (= 동업자씨). 값만 어두운 배경용으로 밝게 올려 둔 것입니다. */}
            <p className="mt-3 text-[13px] leading-relaxed text-white/65 sm:text-sm">
              <b className="font-bold" style={{ color: "#ff6b66" }}>
                동
              </b>
              래구청소년센터{" "}
              <b className="font-bold" style={{ color: "#7ab3f5" }}>
                업
              </b>
              무{" "}
              <b className="font-bold" style={{ color: "#5fd06a" }}>
                자
              </b>
              동화{" "}
              <b className="font-bold" style={{ color: "#f5cf5e" }}>
                씨
              </b>
              스템
            </p>
          </div>

          {googleError && (
            <p className="mt-6 rounded-lg bg-stamp-soft px-3 py-2 text-center text-sm font-medium text-stamp">
              {googleError}
            </p>
          )}

          {/* 진입 카드 — 진행 중 공고가 있으면 채용+직원, 0건이면 직원만 */}
          <div className="mt-9 space-y-3.5">
            {/* ① 채용 공고 — 공개(지원자용). 진행 중 공고(N>=1)일 때만 노출.
                마감 시각이 지나 N==0 이 되면 카드 자체를 숨겨 직원 업무만 남김. */}
            {recruitmentCount > 0 && (
              <Link
                href="/recruitment"
                className="group flex items-center gap-4 rounded-2xl bg-white p-5 shadow-lg ring-1 ring-black/5 transition duration-200 hover:-translate-y-1 hover:shadow-2xl"
              >
                <span
                  aria-hidden
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-blue-soft text-2xl"
                >
                  📢
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-base font-bold text-ink">채용 공고</span>
                    <span className="rounded-full bg-brand-green/15 px-2 py-0.5 text-[10px] font-bold text-brand-green">
                      진행 중 {recruitmentCount}건
                    </span>
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
            )}

            {/* ①-b 신뢰 등록된 기기 — PIN 간편입력(SEC-3 2단계).
                 · 신뢰 기기 쿠키가 유효할 때만 노출됩니다.
                 · 이 입력만으로 로그인되는 것이 아니라, 서버가 신뢰 기기와
                   PIN 을 모두 검증해야 세션이 발급됩니다. */}
            {trustedDevice.trusted && (
              <div className="mb-4">
                <PinEntry name={trustedDevice.name} next="/" />
              </div>
            )}

            {/* ② 직원 업무 시스템 — 구글 로그인. 진한 네이비·블루 + 흰 글자 */}
            <a
              href="/api/auth/google/login?next=/"
              className="group flex items-center gap-4 rounded-2xl bg-gradient-to-br from-brand-blue-strong to-navy-strong p-5 shadow-lg ring-1 ring-white/15 transition duration-200 hover:-translate-y-1 hover:shadow-2xl"
            >
              <span
                aria-hidden
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white shadow"
              >
                {/* 구글 G 4색 로고 (인라인 SVG) */}
                <svg viewBox="0 0 48 48" className="h-6 w-6">
                  <path
                    fill="#4285F4"
                    d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
                  />
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 2.69 29.93 0 24 0 15.4 0 7.96 4.93 4.34 12.12l7.35 5.7C13.42 12.62 18.27 9.5 24 9.5z"
                  />
                </svg>
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
                className="shrink-0 text-lg text-white/70 transition group-hover:translate-x-0.5 group-hover:text-white"
              >
                →
              </span>
            </a>
          </div>

          <p className="mt-5 text-center text-[11px] text-white/45">
            직원 업무는{" "}
            <span className="text-white/70">@onnainna.kr</span> 구글 계정
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

  // PIN 설정 제안 — 아직 설정하지 않은 직원에게만, 배너로만(강제 이동 없음).
  const pinStatus = await getPinStatus();
  const suggestPin = pinStatus.eligible && !pinStatus.isSet;

  // 직원 로그인 후 첫 화면 = 직원 대시보드(프로필 위젯).
  //   * 활동일지(ActivityList)는 여기서 빼고 /activities 로 분리 — 헤더 네비로 접근.
  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-5 sm:py-6">
        {recruitmentCount > 0 && (
          <RecruitmentBanner count={recruitmentCount} />
        )}
        {suggestPin && <PinSuggestBanner />}
        <EmployeeDashboard name={session.name} />
      </main>
    </>
  );
}
