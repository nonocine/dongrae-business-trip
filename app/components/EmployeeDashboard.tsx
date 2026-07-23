import type { ReactNode } from "react";
import Link from "next/link";
import {
  getMyProfile,
  getMyPhotoUrl,
  getMyEmployeeRoles,
} from "@/app/profile/hr/actions";
import { getGoogleSession } from "@/app/actions";
import { listAnnouncements } from "@/app/announcements/actions";
import { getMyJudgeAssignments } from "@/app/hr/recruitment/[slug]/actions";
import { isM0Grant } from "@/lib/authLevels";
import { roleLabel } from "@/lib/employeeRoles";
import { cardCls } from "@/lib/ui";

// =====================================================================
// 직원 첫 접속 대시보드 — 권한등급(M0)·직무(employee_roles)별 메뉴 분기.
//   * "그릇" 역할: 카드는 기능이 생기면 켜지고, 없으면 "준비 중" 비활성.
//   * 데이터는 읽기만(쓰기·DB변경 없음). 본인↔driver 매칭은 세션 기반 헬퍼 재사용.
//   * 팀(team) 컬럼은 현재 employee_profiles 에 없어 표시하지 않습니다.
// =====================================================================

// "1984-02-24" → "1984년 2월 24일". 형식이 다르면 원본 그대로.
function formatDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const [y, m, day] = d.split("-");
  if (!y || !m || !day) return d;
  return `${Number(y)}년 ${Number(m)}월 ${Number(day)}일`;
}

// ISO 타임스탬프 → "2026.06.30" (공지 목록 미리보기용 컴팩트 표기).
function fmtDay(iso: string): string {
  return iso ? iso.slice(0, 10).replaceAll("-", ".") : "";
}

// 정보 한 줄(라벨 + 값). 값이 없으면 흐리게 "-".
function InfoRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline gap-3 py-1.5">
      <span className="w-16 shrink-0 text-xs font-semibold text-navy">
        {label}
      </span>
      <span
        className={`min-w-0 break-words text-sm ${
          value ? "text-ink-body" : "text-ink-hint"
        }`}
      >
        {value || "-"}
      </span>
    </div>
  );
}

// 동작하는 메뉴 카드(링크).
function MenuCard({
  href,
  icon,
  title,
  desc,
}: {
  href: string;
  icon: string;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-3 rounded-xl border border-line bg-card p-4 text-left shadow-sm transition hover:border-navy hover:bg-navy-soft/40"
    >
      <span aria-hidden className="text-2xl">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-xs text-ink-muted">{desc}</span>
      </span>
      <span
        aria-hidden
        className="ml-auto shrink-0 self-center text-ink-hint transition group-hover:translate-x-0.5 group-hover:text-navy"
      >
        →
      </span>
    </Link>
  );
}

// 아직 기능이 없는 카드 — 클릭 비활성 + "준비 중" 배지.
function PendingCard({
  icon,
  title,
  desc,
}: {
  icon: string;
  title: string;
  desc: string;
}) {
  return (
    <div
      aria-disabled
      className="flex cursor-not-allowed items-start gap-3 rounded-xl border border-dashed border-line bg-surface p-4 text-left opacity-70"
    >
      <span aria-hidden className="text-2xl grayscale">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-ink-muted">{title}</span>
          <span className="rounded-full bg-line px-1.5 py-0.5 text-[10px] font-semibold text-ink-hint">
            준비 중
          </span>
        </span>
        <span className="mt-0.5 block text-xs text-ink-hint">{desc}</span>
      </span>
    </div>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-2 text-sm font-bold tracking-wide text-navy">
      {children}
    </h3>
  );
}

// 관리자(M0) 영역 — 채용·인사·권한/직무·외부위원 진입점. admin/M0 공용.
function AdminArea() {
  return (
    <section className={cardCls}>
      <SectionHeading>관리자 영역</SectionHeading>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MenuCard
          href="/hr?tab=recruitment"
          icon="📢"
          title="채용 관리"
          desc="공고 작성·게시, 지원자 전형·합격자 전환"
        />
        <MenuCard
          href="/hr?tab=records"
          icon="👥"
          title="전 직원 인사관리"
          desc="인사기록카드 열람·입력, 첨부서류"
        />
        <MenuCard
          href="/hr?tab=records"
          icon="🔑"
          title="권한·직무 지정"
          desc="권한등급·담당 직무 변경 (인사기록카드 편집)"
        />
        <MenuCard
          href="/hr/external-judges"
          icon="🧑‍⚖️"
          title="외부 심사위원"
          desc="심사위원 명단 관리·채용별 배정"
        />
      </div>
    </section>
  );
}

export default async function EmployeeDashboard({
  kind,
  name,
}: {
  kind: "admin" | "employee";
  name: string | null;
}) {
  // 관리자(공유비번 세션)는 인사기록카드 개념이 없음 — 인사말 + 관리자 영역만.
  if (kind === "admin") {
    return (
      <div className="space-y-4">
        <section className={cardCls}>
          <h2 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">
            관리자 님, 안녕하세요 👋
          </h2>
          <p className="mt-1.5 text-sm text-ink-muted">
            아래에서 업무를 시작하세요.
          </p>
        </section>
        <AdminArea />
      </div>
    );
  }

  // 본인 인사정보·사진·직무·구글세션(M0 판정용)·최신 공지·심사 배정을 병렬 조회.
  const [my, photoUrl, roles, g, recentAnnouncements, judgeAssignments] =
    await Promise.all([
      getMyProfile(),
      getMyPhotoUrl(),
      getMyEmployeeRoles(),
      getGoogleSession(),
      listAnnouncements(3),
      getMyJudgeAssignments(),
    ]);

  const driver = my?.driver ?? null;
  const profile = my?.profile ?? null;

  const displayName = driver?.name ?? name ?? "";
  const rank = driver?.rank ?? null;
  const email = profile?.email ?? null;
  const phone = profile?.phone ?? null;
  const joinDate = formatDate(profile?.join_date);

  // 권한등급 M0(관장·부장·master) 판정 — rank/이메일/auth_level 중 하나라도 해당.
  const isM0 = isM0Grant({
    rank,
    email: g?.email,
    authLevel: profile?.auth_level,
  });

  const roleSet = new Set(roles);
  const roleLabels = roles.map((r) => roleLabel(r));

  // 핵심 인사정보가 모두 비어있으면 입력 안내를 강조.
  const profileEmpty =
    !profile ||
    (!profile.email &&
      !profile.phone &&
      !profile.join_date &&
      !profile.address);

  return (
    <div className="space-y-4">
      {/* 인사말 헤더 */}
      <section className={cardCls}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">
            {displayName} 님, 안녕하세요 👋
          </h2>
          {rank && (
            <span className="rounded-full bg-navy-soft px-2.5 py-0.5 text-xs font-bold text-navy">
              {rank}
            </span>
          )}
          {isM0 && (
            <span className="rounded-full bg-brand-blue-soft px-2.5 py-0.5 text-xs font-bold text-brand-blue">
              관리자
            </span>
          )}
        </div>
        <p className="mt-1.5 text-sm text-ink-muted">
          오늘도 좋은 하루 되세요. 내 정보와 담당 업무를 확인할 수 있습니다.
        </p>
      </section>

      {/* 내 심사 배정 — 면접 심사위원으로 배정된 공고가 1건 이상일 때만 노출.
          배정 없는 대다수 직원에겐 카드 자체가 안 보임. 클릭 시 심사화면으로 진입하고,
          거기서 기존 requireInterviewJudge 판정이 이어서 최종 검증합니다. */}
      {judgeAssignments.length > 0 && (
        <section className={cardCls}>
          <SectionHeading>내 심사 배정</SectionHeading>
          <p className="mb-3 text-sm text-ink-muted">
            면접 심사위원으로 배정되었습니다. 아래 채용의 심사화면으로 이동할 수
            있습니다.
          </p>
          <ul className="space-y-2.5">
            {judgeAssignments.map((a) => (
              <li key={a.slug}>
                <Link
                  href={`/recruitment/${a.slug}/interview`}
                  className="group flex items-center gap-3 rounded-xl border border-brand-blue/40 bg-brand-blue-soft/30 p-4 text-left transition hover:border-brand-blue hover:bg-brand-blue-soft/60"
                >
                  <span aria-hidden className="text-2xl">
                    🧑‍⚖️
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink">
                      {a.title}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-muted">
                      {a.field ? `${a.field} · 면접 채점` : "면접 채점"}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className="ml-auto shrink-0 self-center text-brand-blue transition group-hover:translate-x-0.5"
                  >
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 내 프로필 카드 */}
      <section className={cardCls}>
        <SectionHeading>내 프로필</SectionHeading>

        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          {/* 증명사진 (없으면 기본 아바타 + 안내) */}
          <div className="flex shrink-0 flex-col items-center gap-1.5">
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoUrl}
                alt={`${displayName} 증명사진`}
                className="h-28 w-24 rounded-lg border border-line object-cover shadow-sm"
              />
            ) : (
              <div className="flex h-28 w-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line bg-surface">
                <span aria-hidden className="text-4xl">
                  👤
                </span>
                <span className="text-[10px] font-medium text-ink-hint">
                  사진 없음
                </span>
              </div>
            )}
            {!photoUrl && (
              <Link
                href="/profile/hr"
                className="text-[11px] font-semibold text-brand-blue hover:underline"
              >
                사진 등록
              </Link>
            )}
          </div>

          {/* 인사정보 */}
          <div className="w-full min-w-0">
            <div className="divide-y divide-line/70">
              <InfoRow label="이름" value={displayName || null} />
              <InfoRow label="직급" value={rank} />
              <InfoRow label="이메일" value={email} />
              <InfoRow label="입사일" value={joinDate} />
              <InfoRow label="연락처" value={phone} />
              <div className="flex items-baseline gap-3 py-1.5">
                <span className="w-16 shrink-0 text-xs font-semibold text-navy">
                  담당 직무
                </span>
                {roleLabels.length > 0 ? (
                  <span className="flex min-w-0 flex-wrap gap-1.5">
                    {roleLabels.map((label, i) => (
                      <span
                        key={`${label}-${i}`}
                        className="rounded-full bg-navy-soft px-2 py-0.5 text-xs font-semibold text-navy"
                      >
                        {label}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="text-sm text-ink-hint">-</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 인사정보 미입력 안내 */}
        {profileEmpty && (
          <p className="mt-4 rounded-lg bg-warning-soft px-3 py-2.5 text-sm font-medium text-warning">
            아직 인사정보가 없습니다. 아래 “내 인사기록카드”에서 입력해주세요.
          </p>
        )}
      </section>

      {/* 공지사항 미리보기 — 최신 3건(고정 우선) */}
      <section className={cardCls}>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-bold tracking-wide text-navy">
            공지사항
          </h3>
          <Link
            href="/announcements"
            className="text-xs font-semibold text-brand-blue hover:underline"
          >
            전체 보기 →
          </Link>
        </div>
        {recentAnnouncements.length === 0 ? (
          <p className="py-3 text-center text-xs text-ink-hint">
            등록된 공지가 없습니다.
          </p>
        ) : (
          <ul className="divide-y divide-line/70">
            {recentAnnouncements.map((a) => (
              <li key={a.id}>
                <Link
                  href="/announcements"
                  className="flex items-center justify-between gap-2 rounded-md px-1 py-2 hover:bg-surface"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    {a.is_pinned && (
                      <span aria-hidden className="shrink-0 text-[11px]">
                        📌
                      </span>
                    )}
                    <span className="truncate text-sm text-ink-body">
                      {a.title}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] text-ink-hint">
                    {fmtDay(a.created_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 공통 영역 — 전 직원 동일 */}
      <section className={cardCls}>
        <SectionHeading>공통</SectionHeading>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <MenuCard
            href="/profile/hr"
            icon="🗂"
            title="내 인사기록카드"
            desc="내 인사정보·증명사진·첨부서류 입력/수정"
          />
          <PendingCard
            icon="🧾"
            title="증명서 신청"
            desc="재직·경력증명서 신청"
          />
        </div>
      </section>

      {/* 직무별 메뉴 — 가진 직무가 있을 때만 노출 */}
      {roleSet.size > 0 && (
        <section className={cardCls}>
          <SectionHeading>담당 업무</SectionHeading>
          <div className="space-y-4">
            {roleSet.has("facility") && (
              <div>
                <p className="mb-2 text-xs font-semibold text-ink-muted">
                  시설관리
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <PendingCard
                    icon="📦"
                    title="비품관리"
                    desc="비품 재고·신청"
                  />
                  <PendingCard
                    icon="🤝"
                    title="거래처관리"
                    desc="거래처 정보 관리"
                  />
                </div>
              </div>
            )}

            {roleSet.has("accounting") && (
              <div>
                <p className="mb-2 text-xs font-semibold text-ink-muted">
                  회계
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <MenuCard
                    href="/hr/salary"
                    icon="💰"
                    title="급여 기준 관리"
                    desc="호봉표·기준값·직원별 급여 설정"
                  />
                  <PendingCard icon="📊" title="예산" desc="예산 관리" />
                </div>
              </div>
            )}

            {roleSet.has("hr") && (
              <div>
                <p className="mb-2 text-xs font-semibold text-ink-muted">
                  인사
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <MenuCard
                    href="/hr?tab=records"
                    icon="👥"
                    title="직원 인사관리"
                    desc="직원 인사기록카드 열람·입력"
                  />
                  <PendingCard
                    icon="🧾"
                    title="증명서 발급"
                    desc="재직·경력증명서 발급"
                  />
                  <PendingCard
                    icon="🎓"
                    title="의무교육 현황"
                    desc="법정 의무교육 이수 현황"
                  />
                </div>
              </div>
            )}

            {roleSet.has("recruitment") && (
              <div>
                <p className="mb-2 text-xs font-semibold text-ink-muted">
                  채용
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <MenuCard
                    href="/hr?tab=recruitment"
                    icon="📢"
                    title="채용 관리"
                    desc="공고·지원자 전형 관리"
                  />
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* 관리자 영역 — M0(관장·부장·마스터)만 */}
      {isM0 && <AdminArea />}
    </div>
  );
}
