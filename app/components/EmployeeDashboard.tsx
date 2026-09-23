import { Fragment, type ReactNode } from "react";
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
import {
  MENU_GROUP_LABEL,
  menuItemDesc,
  menuItemsFor,
  roleMenuGroupsFor,
  type MenuContext,
  type MenuItem,
} from "@/lib/menu";
import { cardCls } from "@/lib/ui";

// =====================================================================
// 직원 첫 접속 대시보드 — 권한등급(M0)·직무(employee_roles)별 메뉴 분기.
//   * "그릇" 역할: 카드는 기능이 생기면 켜지고, 없으면 "준비 중" 비활성.
//   * 데이터는 읽기만(쓰기·DB변경 없음). 본인↔driver 매칭은 세션 기반 헬퍼 재사용.
//   * 팀(team) 컬럼은 현재 employee_profiles 에 없어 표시하지 않습니다.
// =====================================================================

// ISO 타임스탬프 → "2026.06.30" (공지 목록 미리보기용 컴팩트 표기).
function fmtDay(iso: string): string {
  return iso ? iso.slice(0, 10).replaceAll("-", ".") : "";
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

// lib/menu.ts 의 항목 하나 → 카드 하나.
//   문구는 menuItemDesc 가 정합니다(배지 숫자 → 화면이 덮은 문구 → 기본 문구).
function MenuItemCard({
  item,
  badges,
  descOverrides,
}: {
  item: MenuItem;
  badges?: Record<string, number | undefined>;
  descOverrides?: Record<string, string>;
}) {
  const desc = menuItemDesc(item, badges, descOverrides);
  if (item.pending) {
    return <PendingCard icon={item.icon} title={item.label} desc={desc} />;
  }
  return (
    <MenuCard
      href={item.href}
      icon={item.icon}
      title={item.label}
      desc={desc}
    />
  );
}

// 한 그룹의 카드들 — 대시보드 전역에서 같은 2열 격자를 씁니다.
//   * after: "이 항목 바로 뒤에 끼워 넣을 카드" (키는 MenuItem.key).
//     데이터가 있을 때만 나타나는 알림은 메뉴가 아니라 화면이 넣는데, 그렇다고
//     격자 끝으로 몰면 안 됩니다 — '내 의무교육' 은 원래 거래처관리 다음
//     자리입니다. 끝에 붙이면 카드 구성은 같아도 순서가 바뀝니다.
//   * children: 격자 맨 뒤(연차 사용계획서 알림).
function MenuGrid({
  items,
  badges,
  descOverrides,
  after,
  children,
}: {
  items: MenuItem[];
  badges?: Record<string, number | undefined>;
  descOverrides?: Record<string, string>;
  after?: Record<string, ReactNode>;
  children?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <Fragment key={item.key}>
          <MenuItemCard
            item={item}
            badges={badges}
            descOverrides={descOverrides}
          />
          {after?.[item.key]}
        </Fragment>
      ))}
      {children}
    </div>
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

  // 권한등급 M0(관장·부장·master) 판정 — rank/이메일/auth_level 중 하나라도 해당.
  const isM0 = isM0Grant({
    rank,
    email: g?.email,
    authLevel: profile?.auth_level,
  });

  // 증명서 승인 대기 건수(M0만 — 관리자 영역 배지).
  const pendingCertCount = isM0 ? await getPendingCertRequestCount() : 0;

  // --- 메뉴 구성 (lib/menu.ts 단일 출처) ---
  //   메뉴 '정의' 는 menu.ts 가, '데이터' 는 여기가 담당합니다.
  const menuCtx: MenuContext = { isM0, roles };
  const commonItems = menuItemsFor("common", menuCtx);
  const roleGroups = roleMenuGroupsFor(menuCtx);
  const adminItems = menuItemsFor("admin", menuCtx);

  // 배지 — 경로별 숫자. 값이 없으면(undefined) "아직 못 셌다" 는 뜻이라
  //   0건과 구분됩니다(의무교육 문구가 둘을 다르게 씁니다).
  const badges: Record<string, number | undefined> = {
    "/mail": unreadMailCount,
    "/hr/trainings": trainingAdminSummary?.totalNotMet,
    "/hr/certificates": pendingCertCount,
  };

  // 숫자 하나로 표현되지 않는 문구만 화면이 덮습니다(키는 MenuItem.key).
  const descOverrides: Record<string, string> = {};
  if (credentialSummary) {
    descOverrides["common-credentials"] = credentialSummary.canManage
      ? `전 ${credentialSummary.count}건 관리 — 등록·열람자 지정`
      : credentialSummary.count > 0
        ? `열람 가능 ${credentialSummary.count}건 — 비밀번호 확인·복사`
        : "열람 가능한 항목이 없습니다 — 내 계정 비번을 등록할 수 있습니다";
  }

  // 핵심 인사정보가 모두 비어있으면 입력 안내를 강조.
  //   ★ '내 프로필' 카드는 첫 화면에서 내렸지만(내 인사기록카드에서 봅니다),
  //     "아직 안 채웠다" 는 알림은 남깁니다 — 이건 표시가 아니라 할 일입니다.
  const profileEmpty =
    !profile ||
    (!profile.email &&
      !profile.phone &&
      !profile.join_date &&
      !profile.address);
  const profileTodo = [
    profileEmpty ? "인사정보" : null,
    photoUrl ? null : "증명사진",
  ].filter((v): v is string => v !== null);

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
        {/* 미입력 안내 — 예전 '내 프로필' 카드 안에 있던 안내를 여기로 옮겼습니다.
            카드 전체(사진·이름·직급·이메일·입사일·연락처·직무)는 매일 확인할
            것이 아니라 '내 인사기록카드'(/profile/hr)에서 봅니다. */}
        {profileTodo.length > 0 && (
          <p className="mt-3 rounded-lg bg-warning-soft px-3 py-2.5 text-sm font-medium text-warning">
            아직 {profileTodo.join("·")}이(가) 없습니다.{" "}
            <Link
              href="/profile/hr"
              className="font-bold underline underline-offset-2"
            >
              내 인사기록카드에서 입력하기 →
            </Link>
          </p>
        )}
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

      {/* 공통 영역 — 전 직원 동일. 카드 목록은 lib/menu.ts(group="common"). */}
      <section className={cardCls}>
        <SectionHeading>{MENU_GROUP_LABEL.common}</SectionHeading>
        <MenuGrid
          items={commonItems}
          badges={badges}
          descOverrides={descOverrides}
          after={{
            // 내 의무교육 — 올해 교육이 1개 이상일 때만. 메뉴가 아니라 '있을 때만
            //   보이는 안내' 라 menu.ts 에 넣지 않되, 자리는 원래대로 거래처관리
            //   바로 뒤입니다.
            "common-partners":
              trainingSummary && trainingSummary.total > 0 ? (
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
                                trainingSummary.nearest.dday,
                              )}`
                            : ""
                        }`
                  }
                />
              ) : null,
          }}
        >
          {/* LP-2. 연차 사용계획서 — 발부됐고 아직 제출 안 한 건이 있을 때만. */}
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
        </MenuGrid>
      </section>

      {/* 담당 업무 — 가진 직무가 있을 때만. 그룹·순서는 lib/menu.ts 가 정합니다. */}
      {roleGroups.length > 0 && (
        <section className={cardCls}>
          <SectionHeading>담당 업무</SectionHeading>
          <div className="space-y-4">
            {roleGroups.map((g) => (
              <div key={g.group}>
                <p className="mb-2 text-xs font-semibold text-ink-muted">
                  {g.label}
                </p>
                <MenuGrid
                  items={g.items}
                  badges={badges}
                  descOverrides={descOverrides}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 관리자 영역 — M0(관장·부장·마스터)만. lib/menu.ts(group="admin"). */}
      {adminItems.length > 0 && (
        <section className={cardCls}>
          <SectionHeading>{MENU_GROUP_LABEL.admin}</SectionHeading>
          <MenuGrid
            items={adminItems}
            badges={badges}
            descOverrides={descOverrides}
          />
        </section>
      )}
    </div>
  );
}
