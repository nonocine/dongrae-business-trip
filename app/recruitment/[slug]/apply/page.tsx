import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getApplyPosting,
  getKakaoSession,
  getApplicationDraft,
} from "./actions";
import ApplyForm from "./ApplyForm";
import {
  cardCls,
  noticeWarning,
  splitRecruitmentFields,
  fieldBadgeCls,
} from "@/lib/ui";

// 임시저장 후 페이지 재방문 시 최신 상태가 반영되도록 동적 렌더.
export const dynamic = "force-dynamic";

function fmtKST(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function RecruitmentApplyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const posting = await getApplyPosting(slug);
  // published 가 아니거나 존재하지 않는 공고는 404.
  if (!posting) notFound();

  // 서버 컴포넌트(force-dynamic)는 요청마다 1회 렌더되므로 Date.now() 가 안전.
  // eslint-disable-next-line react-hooks/purity
  const closed = new Date(posting.application_end).getTime() < Date.now();

  const session = await getKakaoSession();
  // 로그인 된 경우에만 기존 지원서를 미리 불러옵니다.
  const draft = session ? await getApplicationDraft(slug) : null;

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      {/* 상단 헤더 — 센터 로고 + "직원채용공고" + 공고 제목 */}
      <header className="mb-6 border-b border-line pb-5 sm:mb-8 sm:pb-6">
        <Link
          href={`/recruitment/${slug}`}
          className="text-xs text-ink-muted hover:underline sm:text-sm"
        >
          ← 공고로 돌아가기
        </Link>
        <div className="mt-3 flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/dongrae-logo.png"
            alt="동래구청소년센터"
            className="h-12 w-auto shrink-0 object-contain sm:h-14 lg:h-16"
          />
          <div className="min-w-0 border-l border-line pl-4">
            <p className="text-sm font-bold tracking-[0.2em] text-brand-blue sm:text-base lg:text-lg">
              직원채용공고
            </p>
            <h1 className="mt-1 truncate text-base font-semibold leading-tight text-ink sm:text-lg lg:text-xl">
              {posting.title}
            </h1>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted sm:text-sm">
          {splitRecruitmentFields(posting.field).map((f, i) => (
            <span key={`${f}-${i}`} className={fieldBadgeCls(i)}>
              {f}
            </span>
          ))}
          <span>마감 {fmtKST(posting.application_end)}</span>
        </div>
      </header>

      {closed ? (
        <section className={cardCls}>
          <p className={noticeWarning}>접수가 마감되었습니다.</p>
          <p className="mt-3 text-xs text-ink-muted sm:text-sm">
            마감 시각 이후에는 새 지원서를 접수할 수 없습니다. 이미 임시저장된
            지원서가 있더라도 제출은 불가합니다.
          </p>
        </section>
      ) : !session ? (
        <KakaoLoginGate slug={slug} />
      ) : (
        <ApplyForm
          posting={posting}
          initialApplicant={draft?.applicant ?? null}
          initialApplication={draft?.application ?? null}
          kakaoNickname={session.nickname}
        />
      )}
    </main>
  );
}

// =====================================================================
// 카카오 로그인 게이트 — 비로그인 상태에서 노출되는 안내 + 시작 버튼
// =====================================================================
function KakaoLoginGate({ slug }: { slug: string }) {
  const href = `/api/auth/kakao?slug=${encodeURIComponent(slug)}`;
  return (
    <section className={cardCls}>
      <h2 className="text-base font-bold text-ink sm:text-lg">
        지원하려면 본인 확인이 필요합니다
      </h2>
      <p className="mt-2 text-xs text-ink-muted sm:text-sm">
        카카오 계정으로 본인을 인증하면 지원서 작성을 시작할 수 있습니다.
        작성하신 내용은 카카오 계정에 연결되어 임시저장 · 이어 작성이 가능합니다.
      </p>
      <a
        href={href}
        className="mt-5 inline-flex h-[44px] items-center justify-center gap-2 rounded-lg bg-[#FEE500] px-5 text-sm font-semibold text-[#191919] shadow-sm transition hover:brightness-95"
      >
        <span aria-hidden="true" className="text-base">💬</span>
        카카오로 시작하기
      </a>
    </section>
  );
}
