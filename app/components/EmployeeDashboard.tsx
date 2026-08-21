import type { ReactNode } from "react";
import Link from "next/link";
import {
  getMyProfile,
  getMyPhotoUrl,
  getMyEmployeeRoles,
} from "@/app/profile/hr/actions";
import { getMyTrainingSummary } from "@/app/profile/hr/trainingActions";
import { getMyLeavePlanNotice } from "@/app/profile/hr/leavePlanActions";
import { getTrainingsAdminSummary } from "@/app/hr/trainings/actions";
import { getPendingCertRequestCount } from "@/app/hr/certificates/actions";
import { getGoogleSession } from "@/app/actions";
import { listAnnouncements } from "@/app/announcements/actions";
import { getMyJudgeAssignments } from "@/app/hr/recruitment/[slug]/actions";
import { getUnreadMailCount } from "@/app/mail/actions";
import { getMyCredentialSummary } from "@/app/hr/credentials/actions";
import { isM0Grant } from "@/lib/authLevels";
import { ddayLabel } from "@/lib/trainings";
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
      className="group flex items-start gap-3 rounded-xl border border-line bg-card p-4 text-left shadow-sm transition hover:border-navy hover:bg-navy-soft/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2"
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

// 일수 표기(0.5 단위) — lib/leavePlan 의 formatDays 와 같은 규칙.
function formatLeaveDays(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

// 조치가 필요한 카드 — 미제출 연차 계획서처럼 "해야 할 일"을 눈에 띄게.
//   urgent(마감 임박)면 붉게, 아니면 주의색.
function AlertCard({
  href,
  icon,
  title,
  desc,
  urgent,
}: {
  href: string;
  icon: string;
  title: string;
  desc: string;
  urgent?: boolean;
}) {
  const tone = urgent
    ? "border-stamp/50 bg-stamp-soft/50 hover:border-stamp"
    : "border-warning/50 bg-warning-soft/60 hover:border-warning";
  return (
    <Link
      href={href}
      className={`group flex items-start gap-3 rounded-xl border p-4 text-left shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 ${tone}`}
    >
      <span aria-hidden className="text-2xl">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-semibold text-ink">{title}</span>
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
              urgent ? "bg-stamp text-white" : "bg-warning text-white"
            }`}
          >
            {urgent ? "기한 임박" : "미제출"}
          </span>
        </span>
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
function AdminArea({
  trainingNotMet,
  pendingCertCount = 0,
  unreadMailCount = 0,
}: {
  trainingNotMet: number | null;
  pendingCertCount?: number;
  unreadMailCount?: number;
}) {
  return (
    <section className={cardCls}>
      <SectionHeading>관리자 영역</SectionHeading>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MenuCard
          href="/mail"
          icon="📬"
          title="공용 메일함"
          desc={
            unreadMailCount > 0
              ? `미처리 ${unreadMailCount}건 — 센터 대표 메일 확인·담당 지정`
              : "센터 대표 메일 확인·담당 지정 (미처리 없음)"
          }
        />
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
          href="/hr/trainings"
          icon="🎓"
          title="의무교육 현황"
          desc={
            trainingNotMet == null
              ? "법정 의무교육 등록·이수 현황"
              : trainingNotMet > 0
                ? `미이수 총 ${trainingNotMet}건 — 등록·현황판`
                : "올해 모두 이수 완료 ✓"
          }
        />
        <MenuCard
          href="/hr/external-judges"
          icon="🧑‍⚖️"
          title="외부 심사위원"
          desc="심사위원 명단 관리·채용별 배정"
        />
        <MenuCard
          href="/hr/mutual/ledger"
          icon="🤲"
          title="상조회"
          desc="회비·장부, 경조사 지출 (상조회 담당과 공유)"
        />
        <MenuCard
          href="/hr/certificates"
          icon="🧾"
          title="증명서 발급대장"
          desc={
            pendingCertCount > 0
              ? `승인 대기 ${pendingCertCount}건 — 발급·기록`
              : "재직·경력증명서 발급·발급 기록"
          }
        />
        <MenuCard
          href="/hr/saems/instructors"
          icon="🧑‍🏫"
          title="강사·프로그램 관리"
          desc="외부 강사 등록·초대, 프로그램·근무일지(동래샘들)"
        />
        <MenuCard
          href="/business-results"
          icon="📊"
          title="사업실적"
          desc="월별 실적 취합·검토·결과보고서"
        />
      </div>
    </section>
  );
}

export default async function EmployeeDashboard({
  name,
}: {
  name: string | null;
}) {
  // 본인 인사정보·사진·직무·구글세션(M0 판정용)·최신 공지·심사 배정·의무교육 요약을 병렬 조회.
  const [
    my,
    photoUrl,
    roles,
    g,
    recentAnnouncements,
    judgeAssignments,
    trainingSummary,
    trainingAdminSummary,
    leavePlanNotice,
  ] = await Promise.all([
    getMyProfile(),
    getMyPhotoUrl(),
    getMyEmployeeRoles(),
    getGoogleSession(),
    listAnnouncements(3),
    getMyJudgeAssignments(),
    getMyTrainingSummary(),
    getTrainingsAdminSummary(),
    getMyLeavePlanNotice(),
  ]);

  // 공용 메일함 미처리 건수 — 테이블 미적용이면 0 으로 폴백합니다.
  const unreadMailCount = await getUnreadMailCount();

  // 공용 비밀번호 — 내가 열람 가능한 건수만(항목 이름·비번은 받지 않습니다).
  const credentialSummary = await getMyCredentialSummary();

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

  // 증명서 승인 대기 건수(M0만 — 관리자 영역 배지).
  const pendingCertCount = isM0 ? await getPendingCertRequestCount() : 0;

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
                  className="group flex items-center gap-3 rounded-xl border border-brand-blue/40 bg-brand-blue-soft/30 p-4 text-left transition hover:border-brand-blue hover:bg-brand-blue-soft/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2"
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
            href="/mail"
            icon="📬"
            title="공용 메일함"
            desc={
              unreadMailCount > 0
                ? `미처리 ${unreadMailCount}건 — 센터 대표 메일 확인·담당 지정`
                : "센터 대표 메일 확인·담당 지정 (미처리 없음)"
            }
          />
          <MenuCard
            href="/business-results"
            icon="📊"
            title="사업실적"
            desc="담당 사업의 월별 실적·홍보내용 입력"
          />
          <MenuCard
            href="/profile/hr"
            icon="🗂"
            title="내 인사기록카드"
            desc="내 인사정보·증명사진·첨부서류 입력/수정"
          />
          {/* 명함첩·거래처 — 관장 결정으로 전 직원 열람(협업 자산)이 되어 관리자
              영역에서 여기로 내렸습니다. 비공개(🔒)로 표시된 항목만 관장·부장·인사
              담당자에게 보이며, 그 필터는 서버에서 겁니다.
              거래처관리는 시설관리 그룹에도 있어, 그 그룹을 보는 facility 직무
              보유자에게는 여기서 빼 중복 노출을 막습니다. */}
          <MenuCard
            href="/hr/cards"
            icon="💳"
            title="명함첩"
            desc="명함 촬영·AI 판독으로 거래처 연락처 보관"
          />
          {!roleSet.has("facility") && (
            <MenuCard
              href="/hr/partners"
              icon="🤝"
              title="거래처관리"
              desc="분야별 거래처·담당자 주소록 (인수인계용)"
            />
          )}
          {/* 내 의무교육 — 올해 교육이 1개 이상일 때만 노출. */}
          {trainingSummary && trainingSummary.total > 0 && (
            <MenuCard
              href="/profile/hr#my-trainings"
              icon="🎓"
              title="내 의무교육"
              desc={
                trainingSummary.notMet === 0
                  ? "올해 교육 모두 완료 ✓"
                  : `${trainingSummary.done}/${trainingSummary.total} 완료 · 미이수 ${trainingSummary.notMet}건${
                      trainingSummary.nearest
                        ? ` · 가장 임박: ${trainingSummary.nearest.name} ${ddayLabel(
                            trainingSummary.nearest.dday
                          )}`
                        : ""
                    }`
              }
            />
          )}
          <MenuCard
            href="/profile/hr#my-certificates"
            icon="🧾"
            title="증명서 발급"
            desc="재직증명서 즉시 발급 · 발급 이력"
          />
          {/* 공용 비밀번호 — 전 직원에게 보이되, 목록은 본인이 열람 가능한 항목만
              나옵니다(지정 안 된 항목은 존재 자체가 보이지 않음). */}
          <MenuCard
            href="/hr/credentials"
            icon="🔐"
            title="비밀번호 관리"
            desc={
              credentialSummary == null
                ? "앱·메일·구매·은행 계정 비밀번호 (암호화 보관)"
                : credentialSummary.canManage
                  ? `전 ${credentialSummary.count}건 관리 — 등록·열람자 지정`
                  : credentialSummary.count > 0
                    ? `열람 가능 ${credentialSummary.count}건 — 비밀번호 확인·복사`
                    : "열람 가능한 항목이 없습니다 — 내 계정 비번을 등록할 수 있습니다"
            }
          />
          {/* MU-5. 상조회는 직원 자치 조직 — 장부·회원·규정은 전 직원 열람. */}
          <MenuCard
            href="/hr/mutual/ledger"
            icon="🤲"
            title="상조회 현황"
            desc="회비 장부·회원 명단·규정 열람 (기입은 담당자)"
          />
          {/* LP-2. 연차 사용계획서 — 발부됐고 아직 제출 안 한 건이 있을 때만 노출. */}
          {leavePlanNotice && (
            <AlertCard
              href="/profile/hr#leave-plan"
              icon="🌴"
              title={`${leavePlanNotice.year}년 연차 사용계획서 작성`}
              desc={`미사용 연차 ${formatLeaveDays(leavePlanNotice.unusedDays)}일${
                leavePlanNotice.periodEnd
                  ? ` · 잔여기간 ${leavePlanNotice.periodEnd}까지`
                  : ""
              } — 아직 제출하지 않았습니다`}
              urgent={leavePlanNotice.dueSoon}
            />
          )}
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
                  <MenuCard
                    href="/hr/facility/assets"
                    icon="📦"
                    title="비품관리"
                    desc="비품 대장·장소 관리·엑셀"
                  />
                  <MenuCard
                    href="/hr/facility/safety"
                    icon="🦺"
                    title="안전점검"
                    desc="월별 안전점검표·PDF 출력"
                  />
                  {/* 거래처관리 — 관장 결정으로 열람이 전 직원에게 열려 M0·hr
                      조건을 없앴습니다. 시설 담당에게는 "시설 거래처"가 곧 담당
                      업무라 이 그룹에 그대로 둡니다. 시설 직무가 없는 직원을 위한
                      진입점은 아래 공통 영역에 있습니다(중복 노출은 안 되도록
                      공통 쪽에서 facility 보유자를 제외). */}
                  <MenuCard
                    href="/hr/partners"
                    icon="🤝"
                    title="거래처관리"
                    desc="분야별 거래처·담당자 주소록 (인수인계용)"
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
                  <MenuCard
                    href="/hr/leave-plans"
                    icon="🌴"
                    title="연차 사용촉진"
                    desc="미사용 연차 사용계획서 발부·수합·서식 출력"
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
                  <MenuCard
                    href="/hr/certificates"
                    icon="🧾"
                    title="증명서 발급대장"
                    desc="재직·경력증명서 발급·발급 기록"
                  />
                  <MenuCard
                    href="/hr/trainings"
                    icon="🎓"
                    title="의무교육 현황"
                    desc={
                      trainingAdminSummary && trainingAdminSummary.totalNotMet > 0
                        ? `미이수 총 ${trainingAdminSummary.totalNotMet}건 — 등록·현황판`
                        : "법정 의무교육 등록·이수 현황"
                    }
                  />
                </div>
              </div>
            )}

            {roleSet.has("saem") && (
              <div>
                <p className="mb-2 text-xs font-semibold text-ink-muted">
                  강사관리
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <MenuCard
                    href="/hr/saems/instructors"
                    icon="🧑‍🏫"
                    title="강사·프로그램 관리"
                    desc="외부 강사 등록·초대, 프로그램·근무일지"
                  />
                </div>
              </div>
            )}

            {roleSet.has("mutual") && (
              <div>
                <p className="mb-2 text-xs font-semibold text-ink-muted">
                  상조회
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <MenuCard
                    href="/hr/mutual/ledger"
                    icon="🤲"
                    title="상조회 관리"
                    desc="회비·장부, 경조사 지출, 연도 마감"
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
      {isM0 && (
        <AdminArea
          trainingNotMet={trainingAdminSummary?.totalNotMet ?? null}
          pendingCertCount={pendingCertCount}
          unreadMailCount={unreadMailCount}
        />
      )}
    </div>
  );
}
