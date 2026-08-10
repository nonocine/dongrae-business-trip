import { notFound } from "next/navigation";
import {
  getApplyPosting,
  getKakaoSession,
  getApplicationDraft,
} from "./actions";
import ApplyForm from "./ApplyForm";
import { RecruitmentHeader } from "@/app/recruitment/[slug]/PublicUi";
import {
  noticeWarning,
  splitRecruitmentFields,
  fieldBadgeCls,
} from "@/lib/ui";
import { recruitmentTiming } from "@/lib/recruitmentStatus";

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
  const now = Date.now();
  const timing = recruitmentTiming(
    posting.application_start,
    posting.application_end,
    now
  );
  const upcoming = timing === "upcoming";
  const closed = timing === "closed";
  const endTime = new Date(posting.application_end).getTime();
  // D-Day — KST 달력일 기준. 접수중일 때만 노출.
  const kstDay = (ms: number) => Math.floor((ms + 9 * 3600 * 1000) / 86400000);
  const daysLeft = kstDay(endTime) - kstDay(now);
  const ddayLabel =
    timing !== "open" ? null : daysLeft <= 0 ? "오늘 마감" : `D-${daysLeft}`;

  // 접수 시작 전이면 본인 인증/지원서 조회 없이 안내만 노출.
  const session = upcoming ? null : await getKakaoSession();
  // 로그인 된 경우에만 기존 지원서를 미리 불러옵니다.
  //   * getApplicationDraft 는 접수 기간 제한이 없으므로(조회 전용) 마감 후에도
  //     본인 지원서를 그대로 읽어옵니다.
  const draft = session ? await getApplicationDraft(slug) : null;

  // 제출 완료(= draft 아님) 여부. 마감 후 열람 허용 대상은 이 경우뿐입니다.
  //   * 임시저장만 하고 제출하지 않은 건은 열람시키지 않습니다(접수 안 된 상태라
  //     "접수됐다"는 오해를 줄 수 있음).
  const submitted =
    !!draft?.application && draft.application.status !== "draft";

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <RecruitmentHeader title={posting.title} backHref={`/recruitment/${slug}`}>
        {splitRecruitmentFields(posting.field).map((f, i) => (
          <span key={`${f}-${i}`} className={fieldBadgeCls(i)}>
            {f}
          </span>
        ))}
        <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium text-white/90">
          마감 {fmtKST(posting.application_end)}
        </span>
        {ddayLabel && (
          <span className="rounded-full bg-stamp px-2.5 py-0.5 text-xs font-bold text-white shadow-sm">
            {ddayLabel}
          </span>
        )}
      </RecruitmentHeader>

      {upcoming ? (
        <section className="rounded-xl border border-line border-l-4 border-l-brand-blue bg-card p-5 shadow-sm">
          <p className="text-base font-bold text-ink">
            아직 접수 기간이 아닙니다.
          </p>
          <p className="mt-2 text-xs text-ink-muted sm:text-sm">
            {fmtKST(posting.application_start)} 접수 시작 예정입니다. 접수 시작
            후에 지원서를 작성할 수 있습니다.
          </p>
        </section>
      ) : closed && submitted ? (
        // 마감 후 본인 열람 — 제출 완료된 지원서를 읽기전용으로 보여줍니다.
        //   * 공고가 종결(status ≠ published)되면 위 getApplyPosting 이 null 을
        //     반환해 이미 notFound() 로 빠지므로, 여기까지 오지 않습니다.
        <ApplyForm
          posting={posting}
          initialApplicant={draft?.applicant ?? null}
          initialApplication={draft?.application ?? null}
          kakaoNickname={session?.nickname ?? ""}
          viewOnly
        />
      ) : closed ? (
        <section className="rounded-xl border border-line border-l-4 border-l-stamp bg-card p-5 shadow-sm">
          <p className={noticeWarning}>접수가 마감되었습니다.</p>
          <p className="mt-3 text-xs text-ink-muted sm:text-sm">
            마감 시각 이후에는 새 지원서를 접수할 수 없습니다. 이미 임시저장된
            지원서가 있더라도 제출은 불가합니다.
          </p>
          {!session && (
            <div className="mt-5 border-t border-line pt-5">
              <p className="text-sm font-bold text-ink">
                이미 지원하셨나요?
              </p>
              <p className="mt-1.5 text-xs text-ink-muted sm:text-sm">
                지원 당시 사용한 카카오 계정으로 로그인하면 제출하신 지원서와
                접수번호를 다시 확인할 수 있습니다.
              </p>
              <KakaoLoginButton slug={slug} className="mt-4" />
            </div>
          )}
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
  return (
    <section className="rounded-xl border border-line border-l-4 border-l-brand-blue bg-card p-5 shadow-sm sm:p-6">
      <h2 className="text-base font-bold text-ink sm:text-lg">
        지원하려면 본인 확인이 필요합니다
      </h2>
      <p className="mt-2 text-xs text-ink-muted sm:text-sm">
        카카오 계정으로 본인을 인증하면 지원서 작성을 시작할 수 있습니다.
        작성하신 내용은 카카오 계정에 연결되어 임시저장 · 이어 작성이 가능합니다.
      </p>
      <KakaoLoginButton slug={slug} className="mt-5" />
    </section>
  );
}

// 카카오 로그인 버튼 — 접수 중 게이트와 마감 후 열람 안내가 공유합니다.
function KakaoLoginButton({
  slug,
  className = "",
}: {
  slug: string;
  className?: string;
}) {
  const href = `/api/auth/kakao?slug=${encodeURIComponent(slug)}`;
  return (
    <a
      href={href}
      className={`inline-flex h-[44px] items-center justify-center gap-2 rounded-lg bg-[#FEE500] px-5 text-sm font-semibold text-[#191919] shadow-sm transition hover:brightness-95 ${className}`}
    >
      <span aria-hidden="true" className="text-base">💬</span>
      카카오로 시작하기
    </a>
  );
}
