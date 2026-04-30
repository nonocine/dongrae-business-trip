"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  addEmployee,
  deleteActivity,
  deleteEmployee,
  updateEmployee,
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

type TabKey = "dashboard" | "activities" | "employees";

const inputCls =
  "mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const cardCls =
  "rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5";

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
      <StatCard
        icon="🗓"
        label="이번달 활동"
        value={`${stats.thisMonth}건`}
        accent="bg-blue-500"
        ring="from-blue-500 to-blue-600"
      />
      <StatCard
        icon="📋"
        label="전체 활동"
        value={`${stats.total}건`}
        accent="bg-violet-500"
        ring="from-violet-500 to-violet-600"
      />
      <StatCard
        icon="💸"
        label="이번달 비용"
        value={`${stats.thisMonthCost.toLocaleString("ko-KR")}원`}
        accent="bg-emerald-500"
        ring="from-emerald-500 to-emerald-600"
      />
      <StatCard
        icon="👥"
        label="활동자 수"
        value={`${stats.uniqueAuthors}명`}
        accent="bg-amber-500"
        ring="from-amber-500 to-amber-600"
      />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  accent,
  ring,
}: {
  icon: string;
  label: string;
  value: string;
  accent: string;
  ring: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${ring}`} />
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
            {value}
          </p>
        </div>
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xl text-white ${accent}`}
        >
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
    <div className="overflow-x-auto border-b border-slate-200">
      <nav className="flex min-w-max gap-1">
        {tabs.map((t) => {
          const active = t.key === current;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onChange(t.key)}
              className={`relative -mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
                active
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {t.label}
            </button>
          );
        })}
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
    </div>
  );
}

function ByKindCard({ stats }: { stats: ActivityAdminStats }) {
  const total = stats.byKind.reduce((s, k) => s + k.count, 0);
  return (
    <section className={cardCls}>
      <h3 className="text-sm font-semibold text-slate-900">활동 유형별 통계</h3>
      <ul className="mt-4 space-y-3">
        {stats.byKind.map((it) => {
          const pct = total > 0 ? (it.count / total) * 100 : 0;
          return (
            <li key={it.kind}>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-slate-800">
                  {ACTIVITY_ICON[it.kind]} {ACTIVITY_LABEL[it.kind]}
                </span>
                <span className="text-xs font-semibold text-slate-700">
                  {it.count}건
                  <span className="ml-1 text-slate-400">
                    ({pct.toFixed(0)}%)
                  </span>
                </span>
              </div>
              <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-slate-100">
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
        <h3 className="text-sm font-semibold text-slate-900">작성자 TOP 5</h3>
        <p className="mt-3 text-xs text-slate-500">활동 기록이 없습니다.</p>
      </section>
    );
  }
  const max = stats.byAuthor.reduce((m, t) => Math.max(m, t.count), 0) || 1;
  return (
    <section className={cardCls}>
      <h3 className="text-sm font-semibold text-slate-900">작성자 TOP 5</h3>
      <ul className="mt-4 space-y-3">
        {stats.byAuthor.map((it, i) => {
          const pct = Math.max(4, (it.count / max) * 100);
          return (
            <li key={it.name}>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-violet-100 text-[10px] font-bold text-violet-700">
                    {i + 1}
                  </span>
                  <span className="font-medium text-slate-800">{it.name}</span>
                </span>
                <span className="text-xs font-bold text-violet-700">
                  {it.count}건
                </span>
              </div>
              <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-400 to-violet-600"
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
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
        <span aria-hidden>📋</span>
        최근 활동 5건
      </h3>
      {stats.recent.length === 0 ? (
        <div className="mt-2 flex flex-col items-center justify-center gap-2 py-12 text-center">
          <div
            aria-hidden
            className="text-5xl text-slate-300"
            style={{ filter: "grayscale(100%) opacity(0.6)" }}
          >
            📂
          </div>
          <p className="text-sm font-medium text-slate-400">
            아직 등록된 활동이 없습니다.
          </p>
          <p className="text-xs text-slate-400">새로운 활동을 등록해보세요!</p>
        </div>
      ) : (
        <ul className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {stats.recent.map((it) => (
            <li key={it.id}>
              <Link
                href={`/activities/${it.id}`}
                className="flex h-full flex-col gap-1 rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${ACTIVITY_BADGE_CLASS[it.kind]}`}
                  >
                    {ACTIVITY_ICON[it.kind]} {ACTIVITY_LABEL[it.kind]}
                  </span>
                  {it.start_date && (
                    <span className="text-xs font-semibold text-blue-600">
                      {it.start_date.replaceAll("-", ".")}
                    </span>
                  )}
                </div>
                <p className="mt-1 truncate text-sm font-semibold text-slate-900">
                  {it.location ?? "-"}
                </p>
                <p className="text-xs text-slate-500">👤 {it.author}</p>
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
        <h3 className="text-sm font-semibold text-slate-900">
          활동 목록{" "}
          <span className="ml-1 text-xs font-medium text-slate-400">
            {filtered.length}건
          </span>
        </h3>
        <a
          href={downloadHref}
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-600"
        >
          <span aria-hidden>📊</span>
          엑셀 다운로드
        </a>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
        <div>
          <label className="text-xs font-medium text-slate-600">유형</label>
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
          <label className="text-xs font-medium text-slate-600">월</label>
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
          <label className="text-xs font-medium text-slate-600">작성자</label>
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
              className="h-[38px] w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              필터 초기화
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
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
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-8 text-center text-sm text-slate-500"
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
    <tr className="hover:bg-slate-50">
      <td className="whitespace-nowrap px-3 py-2 text-slate-700">{date}</td>
      <td className="whitespace-nowrap px-3 py-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${ACTIVITY_BADGE_CLASS[a.kind]}`}
        >
          {ACTIVITY_ICON[a.kind]} {ACTIVITY_LABEL[a.kind]}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-900">
        {a.author}
      </td>
      <td className="px-3 py-2 text-slate-700">{locationOf(a)}</td>
      <td className="px-3 py-2 text-slate-700">
        {a.companion.length > 0 ? a.companion.join(", ") : "-"}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right">
        <Link
          href={`/activities/${a.id}`}
          className="mr-2 inline-block rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
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
            className="rounded-md border border-red-500 bg-white px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-red-50 disabled:opacity-60"
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
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
      <EmployeeListCard employees={employees} />
      <AddEmployeeCard />
    </div>
  );
}

function EmployeeListCard({ employees }: { employees: Employee[] }) {
  return (
    <section className={cardCls}>
      <h3 className="text-sm font-semibold text-slate-900">
        직원 목록{" "}
        <span className="ml-1 text-xs font-medium text-slate-400">
          {employees.length}명
        </span>
      </h3>
      {employees.length === 0 ? (
        <p className="mt-3 rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm text-slate-500">
          등록된 직원이 없습니다.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">이름</th>
                <th className="px-3 py-2 text-left font-medium">직급</th>
                <th className="px-3 py-2 text-left font-medium">비밀번호</th>
                <th className="px-3 py-2 text-right font-medium">작업</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
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

  function reset() {
    setEditing(false);
    setError(null);
    setPassword("");
    setRank((employee.rank as EmployeeRank | null) ?? "");
  }

  if (editing) {
    return (
      <tr className="bg-blue-50/40">
        <td className="px-3 py-2 font-medium text-slate-900">{employee.name}</td>
        <td className="px-3 py-2">
          <select
            value={rank}
            onChange={(e) => setRank(e.target.value as EmployeeRank)}
            className="block w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
            className="block w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </td>
        <td className="px-3 py-2 text-right">
          <form
            action={(formData) => {
              setError(null);
              startTransition(async () => {
                try {
                  await updateEmployee(formData);
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
              className="rounded-md bg-blue-500 px-2.5 py-1 text-xs font-medium text-white shadow-sm hover:bg-blue-600 disabled:opacity-60"
            >
              {pending ? "저장 중…" : "저장"}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={pending}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              취소
            </button>
          </form>
          {error && (
            <p className="mt-1 text-right text-xs text-red-600">{error}</p>
          )}
        </td>
      </tr>
    );
  }

  return (
    <tr className="hover:bg-slate-50">
      <td className="px-3 py-2 font-medium text-slate-900">{employee.name}</td>
      <td className="px-3 py-2 text-slate-700">{employee.rank ?? "-"}</td>
      <td className="px-3 py-2 font-mono text-slate-500">
        {employee.password ? "****" : "—"}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mr-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          수정
        </button>
        <form
          action={(formData) => {
            if (!confirm(`${employee.name} 직원을 삭제하시겠습니까?`)) return;
            delTransition(async () => {
              await deleteEmployee(formData);
            });
          }}
          className="inline-block"
        >
          <input type="hidden" name="id" value={employee.id} />
          <button
            type="submit"
            disabled={delPending}
            className="rounded-md border border-red-500 bg-white px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-red-50 disabled:opacity-60"
          >
            {delPending ? "삭제 중…" : "삭제"}
          </button>
        </form>
      </td>
    </tr>
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
      <h3 className="text-sm font-semibold text-slate-900">직원 추가</h3>
      <p className="mt-1 text-xs text-slate-500">
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
              await addEmployee(formData);
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
          <label className="block text-xs font-medium text-slate-600">
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
          <label className="block text-xs font-medium text-slate-600">
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
          <label className="block text-xs font-medium text-slate-600">
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
            <p className="mt-1 text-xs text-red-600">4자리 숫자를 입력하세요.</p>
          )}
        </div>
        <button
          type="submit"
          disabled={pending}
          className="mt-2 h-[38px] w-full rounded-md bg-blue-500 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-600 disabled:opacity-60"
        >
          {pending ? "추가 중…" : "＋ 추가"}
        </button>
      </form>
      {error && (
        <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </p>
      )}
      {ok && (
        <p className="mt-2 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {ok}
        </p>
      )}
    </section>
  );
}
