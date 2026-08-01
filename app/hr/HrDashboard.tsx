"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import EmployeeProfileForm from "@/app/hr/EmployeeProfileForm";
import RecruitmentPostingsTab from "@/app/hr/RecruitmentPostingsTab";
import RowChevron from "@/app/components/RowChevron";
import type { Driver, EmployeeProfile } from "@/lib/supabase";
import type { RecruitmentPostingAdmin } from "@/app/hr/actions";
import { cardCls, inputCls, tabBarCls, tabNavCls, tabItemCls } from "@/lib/ui";

export type TabKey = "records" | "contracts" | "certificates" | "recruitment";

export default function HrDashboard({
  drivers,
  profiles,
  recruitmentPostings,
  initialTab = "records",
  canManageAuth,
}: {
  drivers: Driver[];
  profiles: EmployeeProfile[];
  recruitmentPostings: RecruitmentPostingAdmin[];
  initialTab?: TabKey;
  canManageAuth: boolean;
}) {
  const [tab, setTab] = useState<TabKey>(initialTab);

  return (
    <div className="space-y-6">
      <QuickAccess onTab={setTab} />
      <Tabs current={tab} onChange={setTab} />

      {tab === "records" && (
        <RecordsTab
          drivers={drivers}
          profiles={profiles}
          canManageAuth={canManageAuth}
        />
      )}
      {tab === "contracts" && (
        <PlaceholderCard
          icon="📝"
          title="계약서"
          desc="근로계약서·연봉계약서를 관리할 수 있습니다."
        />
      )}
      {tab === "certificates" && (
        <PlaceholderCard
          icon="📄"
          title="증명서 발급"
          desc="재직·경력증명서를 발급하고 발급 내역을 관리할 수 있습니다."
        />
      )}
      {tab === "recruitment" && (
        <RecruitmentPostingsTab postings={recruitmentPostings} />
      )}
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
    { key: "records", label: "인사기록카드" },
    { key: "contracts", label: "계약서" },
    { key: "certificates", label: "증명서 발급" },
    { key: "recruitment", label: "채용공고" },
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
// 빠른 진입 카드 — HR 관리 핵심 기능 바로가기
// =====================================================================
function QuickAccess({ onTab }: { onTab: (t: TabKey) => void }) {
  const base =
    "group flex items-start gap-3 rounded-xl border border-line bg-card p-4 text-left shadow-sm transition hover:border-navy hover:bg-navy-soft/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2";
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <button type="button" onClick={() => onTab("recruitment")} className={base}>
        <span aria-hidden className="text-2xl">
          📢
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-ink">
            채용 공고 관리
          </span>
          <span className="mt-0.5 block text-xs text-ink-muted">
            공고 작성·게시, 지원자 전형 관리
          </span>
        </span>
        <RowChevron className="ml-auto self-center" />
      </button>

      <Link href="/hr/external-judges" className={base}>
        <span aria-hidden className="text-2xl">
          👥
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-ink">
            외부 심사위원 등록
          </span>
          <span className="mt-0.5 block text-xs text-ink-muted">
            심사위원 명단 관리·채용별 배정
          </span>
        </span>
        <RowChevron className="ml-auto self-center" />
      </Link>

      <button type="button" onClick={() => onTab("records")} className={base}>
        <span aria-hidden className="text-2xl">
          🗂
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-ink">
            직원 인사 관리
          </span>
          <span className="mt-0.5 block text-xs text-ink-muted">
            인사기록카드 입력·열람
          </span>
        </span>
        <RowChevron className="ml-auto self-center" />
      </button>
    </div>
  );
}

// =====================================================================
// 인사기록카드 탭
// =====================================================================
function RecordsTab({
  drivers,
  profiles,
  canManageAuth,
}: {
  drivers: Driver[];
  profiles: EmployeeProfile[];
  canManageAuth: boolean;
}) {
  const [selectedId, setSelectedId] = useState("");
  // 재직/퇴사 필터 — 기본은 재직만 노출(퇴사자는 분리). 기록은 삭제하지 않고 보존.
  const [statusFilter, setStatusFilter] = useState<"active" | "resigned">(
    "active"
  );

  const profileMap = useMemo(() => {
    const m = new Map<string, EmployeeProfile>();
    for (const p of profiles) m.set(p.driver_id, p);
    return m;
  }, [profiles]);

  // DP-1. 조직 전체 발령에 쓰인 부서명 — 인사발령 탭 부서 셀렉트의 선택지로
  //   내려보낸다(상수 DEPARTMENTS 에 없는 과거 표기도 고를 수 있게).
  const knownDepartments = useMemo(() => {
    const out: string[] = [];
    for (const p of profiles) {
      for (const a of p.appointments ?? []) {
        const d = (a?.department ?? "").trim();
        if (d) out.push(d);
      }
    }
    return out;
  }, [profiles]);

  // 직원의 재직 상태 — 인사기록카드의 employment_status 기준(없으면 재직).
  const statusOf = (driverId: string): "active" | "resigned" =>
    profileMap.get(driverId)?.employment_status ?? "active";

  const resignedCount = useMemo(
    () => drivers.filter((d) => statusOf(d.id) === "resigned").length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drivers, profileMap]
  );

  const visibleDrivers = useMemo(
    () => drivers.filter((d) => statusOf(d.id) === statusFilter),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drivers, profileMap, statusFilter]
  );

  const selectedDriver =
    drivers.find((d) => d.id === selectedId) ?? null;
  const selectedProfile = selectedId
    ? profileMap.get(selectedId) ?? null
    : null;

  return (
    <div className="space-y-5">
      {/* 직원 선택 + 재직/퇴사 필터 */}
      <section className={cardCls}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="block text-xs font-medium text-ink-muted">
            인사기록카드를 편집할 직원 선택
          </label>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setStatusFilter("active")}
              className={filterBtnCls(statusFilter === "active")}
            >
              재직
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("resigned")}
              className={filterBtnCls(statusFilter === "resigned")}
            >
              퇴사 {resignedCount > 0 && `(${resignedCount})`}
            </button>
          </div>
        </div>
        <select
          value={visibleDrivers.some((d) => d.id === selectedId) ? selectedId : ""}
          onChange={(e) => setSelectedId(e.target.value)}
          className={inputCls}
        >
          <option value="">직원을 선택해주세요</option>
          {visibleDrivers.map((d) => (
            <option key={d.id} value={d.id}>
              {profileMap.has(d.id) ? "✅" : "❌"} {d.name}
              {d.rank ? ` (${d.rank})` : ""}
              {statusOf(d.id) === "resigned" ? " — 퇴사" : ""}
            </option>
          ))}
        </select>
        {visibleDrivers.length === 0 && (
          <p className="mt-2 text-xs text-ink-hint">
            {statusFilter === "resigned"
              ? "퇴사 처리된 직원이 없습니다."
              : "재직 중인 직원이 없습니다."}
          </p>
        )}
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        {/* 좌측: 폼 */}
        <div className="space-y-5">
          {selectedDriver ? (
            <EmployeeProfileForm
              key={selectedDriver.id}
              driver={selectedDriver}
              profile={selectedProfile}
              canManageAuth={canManageAuth}
              knownDepartments={knownDepartments}
              onDeleted={() => setSelectedId("")}
            />
          ) : (
            <section className={cardCls}>
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                <div
                  aria-hidden
                  className="text-5xl text-ink-hint"
                  style={{ filter: "grayscale(100%) opacity(0.6)" }}
                >
                  🗂
                </div>
                <p className="text-sm font-medium text-ink-muted">
                  위에서 직원을 선택하면 인사기록카드 입력 폼이 표시됩니다.
                </p>
              </div>
            </section>
          )}
        </div>

        {/* 우측: 직원 목록 체크리스트 (현재 필터 기준) */}
        <EmployeeChecklistCard
          drivers={visibleDrivers}
          profileMap={profileMap}
          statusOf={statusOf}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>
    </div>
  );
}

// 재직/퇴사 필터 버튼 스타일.
function filterBtnCls(active: boolean): string {
  return `rounded-full px-3 py-1 text-xs font-semibold transition ${
    active
      ? "bg-navy text-white"
      : "border border-line bg-card text-ink-muted hover:bg-surface"
  }`;
}

function EmployeeChecklistCard({
  drivers,
  profileMap,
  statusOf,
  selectedId,
  onSelect,
}: {
  drivers: Driver[];
  profileMap: Map<string, EmployeeProfile>;
  statusOf: (driverId: string) => "active" | "resigned";
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const done = drivers.filter((d) => profileMap.has(d.id)).length;
  return (
    <section className={`${cardCls} h-fit`}>
      <h3 className="text-sm font-semibold text-ink">
        직원 목록{" "}
        <span className="ml-1 text-xs font-medium text-ink-hint">
          입력 완료 {done} / {drivers.length}
        </span>
      </h3>
      {drivers.length === 0 ? (
        <p className="mt-3 text-xs text-ink-muted">
          표시할 직원이 없습니다.
        </p>
      ) : (
        <ul className="mt-3 space-y-1">
          {drivers.map((d) => {
            const has = profileMap.has(d.id);
            const active = d.id === selectedId;
            const resigned = statusOf(d.id) === "resigned";
            return (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => onSelect(d.id)}
                  className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition ${
                    active
                      ? "bg-navy-soft ring-1 ring-navy"
                      : "hover:bg-surface"
                  } ${resigned ? "opacity-60" : ""}`}
                >
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden>{has ? "✅" : "❌"}</span>
                    <span className="font-medium text-ink">{d.name}</span>
                    {d.rank && (
                      <span className="text-xs text-ink-hint">{d.rank}</span>
                    )}
                    {resigned && (
                      <span className="rounded-full bg-warning-soft px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                        퇴사
                      </span>
                    )}
                  </span>
                  <span
                    className={`text-[10px] font-semibold ${
                      has ? "text-success" : "text-ink-hint"
                    }`}
                  >
                    {has ? "입력됨" : "미입력"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// =====================================================================
// 빈 탭 placeholder
// =====================================================================
function PlaceholderCard({
  icon,
  title,
  desc,
}: {
  icon: string;
  title: string;
  desc: string;
}) {
  return (
    <section className={cardCls}>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <div className="mt-2 flex flex-col items-center justify-center gap-2 py-16 text-center">
        <div
          aria-hidden
          className="text-5xl text-ink-hint"
          style={{ filter: "grayscale(100%) opacity(0.6)" }}
        >
          {icon}
        </div>
        <p className="text-sm font-medium text-ink-muted">{desc}</p>
        <p className="text-xs text-ink-hint">곧 제공될 예정입니다.</p>
      </div>
    </section>
  );
}
