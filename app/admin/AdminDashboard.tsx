"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  addDriver,
  deleteActivity,
  deleteDriver,
  resetEmployeePassword,
  restoreDriver,
  updateDriver,
  type ActivityAdminStats,
} from "@/app/actions";
import {
  ACTIVITY_BADGE_CLASS,
  ACTIVITY_BAR_CLASS,
  ACTIVITY_ICON,
  ACTIVITY_KINDS,
  ACTIVITY_LABEL,
  EMPLOYEE_RANKS,
  type Activity,
  type ActivityKind,
  type Employee,
  type EmployeeRank,
} from "@/lib/supabase";
import {
  cardCls,
  inputCls,
  btnPrimary,
  btnSecondary,
  tabBarCls,
  tabNavCls,
  tabItemCls,
  badgeSuccess,
  badgeNeutral,
  noticeError,
  noticeSuccess,
} from "@/lib/ui";

type TabKey = "dashboard" | "activities" | "employees";

// 직원 편집 행 전용 소형 입력
const smallInputCls =
  "block w-full rounded-md border border-line bg-card px-2 py-1 text-xs text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
// 표 안 소형 버튼
const rowBtnNeutral =
  "rounded-md border border-line bg-card px-2.5 py-1 text-xs font-medium text-ink-body hover:bg-surface disabled:opacity-60";

export default function AdminDashboard({
  employees,
  stats,
  activities,
}: {
  employees: Employee[];
  stats: ActivityAdminStats;
  activities: Activity[];
}) {
  const [tab, setTab] = useState<TabKey>("dashboard");

  return (
    <div className="space-y-6">
      <StatCardsGrid stats={stats} />

      <Tabs current={tab} onChange={setTab} />

      {tab === "dashboard" && <DashboardTab stats={stats} />}
      {tab === "activities" && <ActivityListTab activities={activities} />}
      {tab === "employees" && <EmployeeTab employees={employees} />}
    </div>
  );
}

// =====================================================================
// 통계 카드 (4개)
// =====================================================================
function StatCardsGrid({ stats }: { stats: ActivityAdminStats }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <StatCard icon="🗓" label="이번달 활동" value={`${stats.thisMonth}건`} />
      <StatCard icon="📋" label="전체 활동" value={`${stats.total}건`} />
      <StatCard
        icon="💸"
        label="이번달 비용"
        value={`${stats.thisMonthCost.toLocaleString("ko-KR")}원`}
      />
      <StatCard
        icon="👥"
        label="활동자 수"
        value={`${stats.uniqueAuthors}명`}
      />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-ink-muted">{label}</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-ink">
            {value}
          </p>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-navy-soft text-xl text-navy">
          {icon}
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// 탭
// =====================================================================
function Tabs({
  current,
  onChange,
}: {
  current: TabKey;
  onChange: (t: TabKey) => void;
}) {
  const tabs: { key: TabKey; label: string }[] = [
    { key: "dashboard", label: "대시보드" },
    { key: "activities", label: "활동 목록" },
    { key: "employees", label: "직원 관리" },
  ];
  return (
    <div className={tabBarCls}>
      <nav className={tabNavCls}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={tabItemCls(t.key === current)}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

// =====================================================================
// 대시보드 탭
// =====================================================================
function DashboardTab({ stats }: { stats: ActivityAdminStats }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ByKindCard stats={stats} />
        <ByTravelerCard stats={stats} />
      </div>
      <RecentActivitiesCard stats={stats} />
      <BackupCard />
    </div>
  );
}

// 데이터 백업 바로가기 — 실제 실행·이력은 /hr/backup(M0 전용)에서.
function BackupCard() {
  return (
    <Link
      href="/hr/backup"
      className={`${cardCls} flex items-center justify-between gap-3 transition hover:-translate-y-0.5 hover:border-navy hover:shadow-md`}
    >
      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <span aria-hidden>💾</span>
          데이터 백업
        </h3>
        <p className="mt-1 text-xs text-ink-muted">
          센터 데이터를 ZIP 으로 묶어 구글 드라이브에 보관합니다. 매월 2일 새벽
          자동 실행 · 즉시 실행과 이력 확인.
        </p>
      </div>
      <span aria-hidden className="shrink-0 text-lg text-ink-hint">
        →
      </span>
    </Link>
  );
}

function ByKindCard({ stats }: { stats: ActivityAdminStats }) {
  const total = stats.byKind.reduce((s, k) => s + k.count, 0);
  return (
    <section className={cardCls}>
      <h3 className="text-sm font-semibold text-ink">활동 유형별 통계</h3>
      <ul className="mt-4 space-y-3">
        {stats.byKind.map((it) => {
          const pct = total > 0 ? (it.count / total) * 100 : 0;
          return (
            <li key={it.kind}>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-ink">
                  {ACTIVITY_ICON[it.kind]} {ACTIVITY_LABEL[it.kind]}
                </span>
                <span className="text-xs font-semibold text-ink-body">
                  {it.count}건
                  <span className="ml-1 text-ink-hint">
                    ({pct.toFixed(0)}%)
                  </span>
                </span>
              </div>
              <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-surface">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${ACTIVITY_BAR_CLASS[it.kind]}`}
                  style={{ width: `${Math.max(2, pct)}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ByTravelerCard({ stats }: { stats: ActivityAdminStats }) {
  if (stats.byAuthor.length === 0) {
    return (
      <section className={cardCls}>
        <h3 className="text-sm font-semibold text-ink">작성자 TOP 5</h3>
        <p className="mt-3 text-xs text-ink-muted">활동 기록이 없습니다.</p>
      </section>
    );
  }
  const max = stats.byAuthor.reduce((m, t) => Math.max(m, t.count), 0) || 1;
  return (
    <section className={cardCls}>
      <h3 className="text-sm font-semibold text-ink">작성자 TOP 5</h3>
      <ul className="mt-4 space-y-3">
        {stats.byAuthor.map((it, i) => {
          const pct = Math.max(4, (it.count / max) * 100);
          return (
            <li key={it.name}>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-navy-soft text-[10px] font-bold text-navy">
                    {i + 1}
                  </span>
                  <span className="font-medium text-ink">{it.name}</span>
                </span>
                <span className="text-xs font-bold text-navy">
                  {it.count}건
                </span>
              </div>
              <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-surface">
                <div
                  className="h-full rounded-full bg-navy"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RecentActivitiesCard({ stats }: { stats: ActivityAdminStats }) {
  return (
    <section className={cardCls}>
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        <span aria-hidden>📋</span>
        최근 활동 5건
      </h3>
      {stats.recent.length === 0 ? (
        <div className="mt-2 flex flex-col items-center justify-center gap-2 py-12 text-center">
          <div
            aria-hidden
            className="text-5xl text-ink-hint"
            style={{ filter: "grayscale(100%) opacity(0.6)" }}
          >
            📂
          </div>
          <p className="text-sm font-medium text-ink-muted">
            아직 등록된 활동이 없습니다.
          </p>
          <p className="text-xs text-ink-hint">새로운 활동을 등록해보세요!</p>
        </div>
      ) : (
        <ul className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {stats.recent.map((it) => (
            <li key={it.id}>
              <Link
                href={`/activities/${it.id}`}
                className="flex h-full flex-col gap-1 rounded-lg border border-line bg-card p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-navy hover:shadow-md"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${ACTIVITY_BADGE_CLASS[it.kind]}`}
                  >
                    {ACTIVITY_ICON[it.kind]} {ACTIVITY_LABEL[it.kind]}
                  </span>
                  {it.start_date && (
                    <span className="text-xs font-semibold text-navy">
                      {it.start_date.replaceAll("-", ".")}
                    </span>
                  )}
                </div>
                <p className="mt-1 truncate text-sm font-semibold text-ink">
                  {it.location ?? "-"}
                </p>
                <p className="text-xs text-ink-muted">👤 {it.author}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// =====================================================================
// 활동 목록 탭 (필터 + 테이블 + 엑셀)
// =====================================================================
function ActivityListTab({ activities }: { activities: Activity[] }) {
  const [kindFilter, setKindFilter] = useState<ActivityKind | "">("");
  const [monthFilter, setMonthFilter] = useState("");
  const [authorFilter, setAuthorFilter] = useState("");

  const months = useMemo(() => {
    const set = new Set<string>();
    for (const a of activities) {
      if (a.start_date) set.add(a.start_date.slice(0, 7));
    }
    return [...set].sort().reverse();
  }, [activities]);

  const authors = useMemo(() => {
    const set = new Set<string>();
    for (const a of activities) set.add(a.author);
    return [...set].sort();
  }, [activities]);

  const filtered = useMemo(() => {
    return activities.filter((a) => {
      if (kindFilter && a.kind !== kindFilter) return false;
      if (monthFilter && a.start_date?.slice(0, 7) !== monthFilter) return false;
      if (authorFilter && a.author !== authorFilter) return false;
      return true;
    });
  }, [activities, kindFilter, monthFilter, authorFilter]);

  const downloadHref = monthFilter
    ? `/api/export?month=${encodeURIComponent(monthFilter)}`
    : `/api/export`;

  return (
    <section className={cardCls}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">
          활동 목록{" "}
          <span className="ml-1 text-xs font-medium text-ink-hint">
            {filtered.length}건
          </span>
        </h3>
        <a
          href={downloadHref}
          className="inline-flex items-center gap-1.5 rounded-lg bg-success px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
        >
          <span aria-hidden>📊</span>
          엑셀 다운로드
        </a>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
        <div>
          <label className="text-xs font-medium text-ink-muted">유형</label>
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as ActivityKind | "")}
            className={inputCls}
          >
            <option value="">전체</option>
            {ACTIVITY_KINDS.map((k) => (
              <option key={k} value={k}>
                {ACTIVITY_ICON[k]} {ACTIVITY_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-ink-muted">월</label>
          <select
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className={inputCls}
          >
            <option value="">전체</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {m.slice(0, 4)}년 {Number(m.slice(5, 7))}월
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-ink-muted">작성자</label>
          <select
            value={authorFilter}
            onChange={(e) => setAuthorFilter(e.target.value)}
            className={inputCls}
          >
            <option value="">전체</option>
            {authors.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        {(kindFilter || monthFilter || authorFilter) && (
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => {
                setKindFilter("");
                setMonthFilter("");
                setAuthorFilter("");
              }}
              className={`${btnSecondary} w-full`}
            >
              필터 초기화
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full divide-y divide-line text-sm">
          <thead className="bg-surface text-xs uppercase text-ink-muted">
            <tr>
              <th className="whitespace-nowrap px-3 py-2 text-left font-medium">
                날짜
              </th>
              <th className="whitespace-nowrap px-3 py-2 text-left font-medium">
                유형
              </th>
              <th className="whitespace-nowrap px-3 py-2 text-left font-medium">
                작성자
              </th>
              <th className="whitespace-nowrap px-3 py-2 text-left font-medium">
                장소
              </th>
              <th className="whitespace-nowrap px-3 py-2 text-left font-medium">
                동행자
              </th>
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                작업
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-8 text-center text-sm text-ink-muted"
                >
                  조건에 맞는 활동이 없습니다.
                </td>
              </tr>
            ) : (
              filtered.map((a) => <ActivityRow key={a.id} activity={a} />)
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function locationOf(a: Activity) {
  if (a.kind === "overseas_training") {
    return [a.country, a.city].filter(Boolean).join(" / ") || "-";
  }
  return a.location ?? "-";
}

function ActivityRow({ activity }: { activity: Activity }) {
  const [pending, startTransition] = useTransition();
  const a = activity;
  const date = a.start_date
    ? a.start_date.replaceAll("-", ".") +
      (a.end_date && a.end_date !== a.start_date
        ? ` ~ ${a.end_date.replaceAll("-", ".")}`
        : "")
    : "-";

  return (
    <tr className="hover:bg-surface">
      <td className="whitespace-nowrap px-3 py-2 text-ink-body">{date}</td>
      <td className="whitespace-nowrap px-3 py-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${ACTIVITY_BADGE_CLASS[a.kind]}`}
        >
          {ACTIVITY_ICON[a.kind]} {ACTIVITY_LABEL[a.kind]}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2 font-medium text-ink">
        {a.author}
      </td>
      <td className="px-3 py-2 text-ink-body">{locationOf(a)}</td>
      <td className="px-3 py-2 text-ink-body">
        {a.companion.length > 0 ? a.companion.join(", ") : "-"}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right">
        <Link
          href={`/activities/${a.id}`}
          className={`mr-2 inline-block ${rowBtnNeutral}`}
        >
          보기
        </Link>
        <form
          action={(formData) => {
            if (
              !confirm(
                `${a.start_date ?? ""} ${locationOf(a)} 활동을 삭제하시겠습니까?\n첨부된 사진/영수증/수료증도 함께 삭제됩니다.`
              )
            )
              return;
            startTransition(async () => {
              await deleteActivity(formData);
            });
          }}
          className="inline-block"
        >
          <input type="hidden" name="id" value={a.id} />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md border border-stamp bg-card px-2.5 py-1 text-xs font-medium text-stamp hover:bg-stamp-soft disabled:opacity-60"
          >
            {pending ? "삭제 중…" : "삭제"}
          </button>
        </form>
      </td>
    </tr>
  );
}

// =====================================================================
// 직원 관리 탭
// =====================================================================
function EmployeeTab({ employees }: { employees: Employee[] }) {
  const [showInactive, setShowInactive] = useState(false);
  const visible = useMemo(
    () => (showInactive ? employees : employees.filter((e) => e.is_active)),
    [employees, showInactive]
  );
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
      <EmployeeListCard
        employees={visible}
        showInactive={showInactive}
        onToggle={setShowInactive}
      />
      <AddEmployeeCard />
    </div>
  );
}

function EmployeeListCard({
  employees,
  showInactive,
  onToggle,
}: {
  employees: Employee[];
  showInactive: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <section className={cardCls}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">
          직원 목록{" "}
          <span className="ml-1 text-xs font-medium text-ink-hint">
            {employees.length}명
          </span>
        </h3>
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-ink-muted">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => onToggle(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-line text-navy focus:ring-navy"
          />
          퇴사자 보기
        </label>
      </div>
      {employees.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-line bg-surface p-4 text-center text-sm text-ink-muted">
          {showInactive
            ? "등록된 직원이 없습니다."
            : "활성 직원이 없습니다."}
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full divide-y divide-line text-sm">
            <thead className="bg-surface text-xs uppercase text-ink-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">이름</th>
                <th className="px-3 py-2 text-left font-medium">직급</th>
                <th className="px-3 py-2 text-left font-medium">비밀번호</th>
                <th className="px-3 py-2 text-left font-medium">상태</th>
                <th className="px-3 py-2 text-right font-medium">작업</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {employees.map((e) => (
                <EmployeeRow key={e.id} employee={e} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EmployeeRow({ employee }: { employee: Employee }) {
  const [editing, setEditing] = useState(false);
  const [rank, setRank] = useState<EmployeeRank | "">(
    (employee.rank as EmployeeRank | null) ?? ""
  );
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [delPending, delTransition] = useTransition();
  const [restorePending, restoreTransition] = useTransition();
  const [resetPending, resetTransition] = useTransition();
  const [resetResult, setResetResult] = useState<{
    name: string;
    tempPassword: string;
  } | null>(null);

  function reset() {
    setEditing(false);
    setError(null);
    setPassword("");
    setRank((employee.rank as EmployeeRank | null) ?? "");
  }

  if (editing) {
    return (
      <tr className="bg-navy-soft">
        <td className="px-3 py-2 font-medium text-ink">{employee.name}</td>
        <td className="px-3 py-2">
          <select
            value={rank}
            onChange={(e) => setRank(e.target.value as EmployeeRank)}
            className={smallInputCls}
          >
            <option value="" disabled>
              직급 선택
            </option>
            {EMPLOYEE_RANKS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </td>
        <td className="px-3 py-2">
          <input
            type="text"
            inputMode="numeric"
            maxLength={4}
            placeholder="비밀번호 (변경 시)"
            value={password}
            onChange={(e) =>
              setPassword(e.target.value.replace(/\D/g, "").slice(0, 4))
            }
            className={smallInputCls}
          />
        </td>
        <td className="px-3 py-2 text-ink-muted" />
        <td className="px-3 py-2 text-right">
          <form
            action={(formData) => {
              setError(null);
              startTransition(async () => {
                try {
                  await updateDriver(formData);
                  reset();
                } catch (e) {
                  setError(
                    e instanceof Error
                      ? e.message
                      : "수정 중 오류가 발생했습니다."
                  );
                }
              });
            }}
            className="inline-flex gap-1.5"
          >
            <input type="hidden" name="id" value={employee.id} />
            <input type="hidden" name="rank" value={rank} />
            <input type="hidden" name="password" value={password} />
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-navy px-2.5 py-1 text-xs font-medium text-white shadow-sm hover:bg-navy-strong disabled:opacity-60"
            >
              {pending ? "저장 중…" : "저장"}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={pending}
              className={rowBtnNeutral}
            >
              취소
            </button>
          </form>
          {error && (
            <p className="mt-1 text-right text-xs text-stamp">{error}</p>
          )}
        </td>
      </tr>
    );
  }

  const inactive = !employee.is_active;

  return (
    <tr className={inactive ? "bg-surface text-ink-muted" : "hover:bg-surface"}>
      <td className="px-3 py-2 font-medium text-ink">
        {employee.name}
        {inactive && (
          <span className="ml-1 text-xs font-normal text-ink-hint">(퇴사)</span>
        )}
      </td>
      <td className="px-3 py-2 text-ink-body">{employee.rank ?? "-"}</td>
      {/* SEC-1: 비밀번호 값은 서버 밖으로 나오지 않습니다. 설정 여부만 표시. */}
      <td className="px-3 py-2 text-ink-muted">
        {employee.has_password ? "설정됨" : "미설정"}
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        <span className={inactive ? badgeNeutral : badgeSuccess}>
          {inactive ? "퇴사" : "활성"}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right">
        {inactive ? (
          <form
            action={(formData) => {
              if (!confirm(`${employee.name} 직원을 복귀시키시겠습니까?`)) return;
              restoreTransition(async () => {
                await restoreDriver(formData);
              });
            }}
            className="inline-block"
          >
            <input type="hidden" name="id" value={employee.id} />
            <button
              type="submit"
              disabled={restorePending}
              className="rounded-md border border-success bg-card px-2.5 py-1 text-xs font-medium text-success hover:bg-success-soft disabled:opacity-60"
            >
              {restorePending ? "복귀 중…" : "복귀"}
            </button>
          </form>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className={`mr-1.5 ${rowBtnNeutral}`}
            >
              수정
            </button>
            <button
              type="button"
              disabled={resetPending}
              onClick={() => {
                if (
                  !confirm(
                    `${employee.name} 직원의 비밀번호를 임시 비번으로 재설정하시겠습니까?\n직원은 다음 로그인 시 새 비밀번호를 설정해야 합니다.`
                  )
                )
                  return;
                resetTransition(async () => {
                  const fd = new FormData();
                  fd.set("id", employee.id);
                  const res = await resetEmployeePassword(fd);
                  if (res.ok) {
                    setResetResult({
                      name: res.name,
                      tempPassword: res.tempPassword,
                    });
                  } else {
                    alert(res.message);
                  }
                });
              }}
              className="mr-1.5 rounded-md border border-warning bg-card px-2.5 py-1 text-xs font-medium text-warning hover:bg-warning-soft disabled:opacity-60"
            >
              {resetPending ? "재설정 중…" : "비번 재설정"}
            </button>
            <form
              action={(formData) => {
                if (
                  !confirm(
                    `${employee.name} 직원을 퇴사 처리하시겠습니까?\n(소프트 삭제 — 복귀 가능)`
                  )
                )
                  return;
                delTransition(async () => {
                  await deleteDriver(formData);
                });
              }}
              className="inline-block"
            >
              <input type="hidden" name="id" value={employee.id} />
              <button
                type="submit"
                disabled={delPending}
                className="rounded-md border border-stamp bg-card px-2.5 py-1 text-xs font-medium text-stamp hover:bg-stamp-soft disabled:opacity-60"
              >
                {delPending ? "퇴사 처리 중…" : "퇴사"}
              </button>
            </form>
            {resetResult && (
              <ResetPasswordModal
                name={resetResult.name}
                tempPassword={resetResult.tempPassword}
                onClose={() => setResetResult(null)}
              />
            )}
          </>
        )}
      </td>
    </tr>
  );
}

// =====================================================================
// 임시 비밀번호 발급 결과 모달
// =====================================================================
function ResetPasswordModal({
  name,
  tempPassword,
  onClose,
}: {
  name: string;
  tempPassword: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-line bg-card p-5 text-left shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-ink">
          🔑 임시 비밀번호 발급 완료
        </h3>
        <p className="mt-1 text-xs text-ink-muted">
          <span className="font-medium text-ink-body">{name}</span> 직원에게
          아래 임시 비밀번호를 직접 전달해주세요.
        </p>

        <div className="mt-3 flex items-center gap-2">
          <code className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-center font-mono text-lg font-bold tracking-widest text-ink">
            {tempPassword}
          </code>
          <button
            type="button"
            onClick={copy}
            className="shrink-0 rounded-lg bg-navy px-3 py-2 text-xs font-semibold text-white hover:bg-navy-strong"
          >
            {copied ? "복사됨" : "복사"}
          </button>
        </div>

        <p className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
          직원이 이 비밀번호로 로그인하면 즉시 새 비밀번호를 설정해야 합니다.
        </p>

        <button
          type="button"
          onClick={onClose}
          className={`mt-3 w-full ${btnSecondary}`}
        >
          닫기
        </button>
      </div>
    </div>
  );
}

function AddEmployeeCard() {
  const [name, setName] = useState("");
  const [rank, setRank] = useState<EmployeeRank | "">("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const passwordValid = /^\d{4}$/.test(password);

  return (
    <section className={cardCls}>
      <h3 className="text-sm font-semibold text-ink">직원 추가</h3>
      <p className="mt-1 text-xs text-ink-muted">
        등록하면 활동자 드롭다운 + 직원 로그인이 가능해집니다.
      </p>
      <form
        action={(formData) => {
          setError(null);
          setOk(null);
          if (!name.trim()) {
            setError("이름을 입력해주세요.");
            return;
          }
          if (!rank) {
            setError("직급을 선택해주세요.");
            return;
          }
          if (!passwordValid) {
            setError("4자리 숫자 비밀번호를 입력해주세요.");
            return;
          }
          startTransition(async () => {
            try {
              await addDriver(formData);
              setOk(`${name.trim()} 추가됨`);
              setName("");
              setRank("");
              setPassword("");
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "추가 중 오류가 발생했습니다."
              );
            }
          });
        }}
        className="mt-3 space-y-2"
      >
        <div>
          <label className="block text-xs font-medium text-ink-muted">
            이름
          </label>
          <input
            name="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="홍길동"
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-muted">
            직급
          </label>
          <select
            name="rank"
            required
            value={rank}
            onChange={(e) => setRank(e.target.value as EmployeeRank)}
            className={inputCls}
          >
            <option value="" disabled>
              직급을 선택해주세요
            </option>
            {EMPLOYEE_RANKS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-muted">
            비밀번호 (4자리 숫자)
          </label>
          <input
            name="password"
            type="text"
            inputMode="numeric"
            maxLength={4}
            required
            placeholder="0000"
            value={password}
            onChange={(e) =>
              setPassword(e.target.value.replace(/\D/g, "").slice(0, 4))
            }
            className={`${inputCls} font-mono tracking-widest`}
          />
          {password.length > 0 && !passwordValid && (
            <p className="mt-1 text-xs text-stamp">4자리 숫자를 입력하세요.</p>
          )}
        </div>
        <button
          type="submit"
          disabled={pending}
          className={`${btnPrimary} mt-2 w-full`}
        >
          {pending ? "추가 중…" : "＋ 추가"}
        </button>
      </form>
      {error && <p className={`mt-2 ${noticeError}`}>{error}</p>}
      {ok && <p className={`mt-2 ${noticeSuccess}`}>{ok}</p>}
    </section>
  );
}
