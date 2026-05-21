"use client";

import { useMemo, useState } from "react";
import EmployeeProfileForm from "@/app/hr/EmployeeProfileForm";
import type { Driver, EmployeeProfile } from "@/lib/supabase";

type TabKey = "records" | "contracts" | "certificates";

const cardCls =
  "rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5";
const inputCls =
  "mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

export default function HrDashboard({
  drivers,
  profiles,
}: {
  drivers: Driver[];
  profiles: EmployeeProfile[];
}) {
  const [tab, setTab] = useState<TabKey>("records");

  return (
    <div className="space-y-6">
      <Tabs current={tab} onChange={setTab} />

      {tab === "records" && (
        <RecordsTab drivers={drivers} profiles={profiles} />
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
// 인사기록카드 탭
// =====================================================================
function RecordsTab({
  drivers,
  profiles,
}: {
  drivers: Driver[];
  profiles: EmployeeProfile[];
}) {
  const [selectedId, setSelectedId] = useState("");

  const profileMap = useMemo(() => {
    const m = new Map<string, EmployeeProfile>();
    for (const p of profiles) m.set(p.driver_id, p);
    return m;
  }, [profiles]);

  const selectedDriver =
    drivers.find((d) => d.id === selectedId) ?? null;
  const selectedProfile = selectedId
    ? profileMap.get(selectedId) ?? null
    : null;

  return (
    <div className="space-y-5">
      {/* 직원 선택 */}
      <section className={cardCls}>
        <label className="block text-xs font-medium text-slate-600">
          인사기록카드를 편집할 직원 선택
        </label>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className={inputCls}
        >
          <option value="">직원을 선택해주세요</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {profileMap.has(d.id) ? "✅" : "❌"} {d.name}
              {d.rank ? ` (${d.rank})` : ""}
              {d.is_active ? "" : " — 퇴사"}
            </option>
          ))}
        </select>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        {/* 좌측: 폼 */}
        <div className="space-y-5">
          {selectedDriver ? (
            <>
              <EmployeeProfileForm
                key={selectedDriver.id}
                driver={selectedDriver}
                profile={selectedProfile}
              />
              <section className={cardCls}>
                <h3 className="text-sm font-semibold text-slate-900">
                  추가 항목
                </h3>
                <p className="mt-2 text-xs text-slate-500">
                  학력 · 가족 · 자격증 · 경력 · 수상 · 교육이수 · 인사발령
                  입력은 다음 단계에서 제공될 예정입니다.
                </p>
              </section>
            </>
          ) : (
            <section className={cardCls}>
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                <div
                  aria-hidden
                  className="text-5xl text-slate-300"
                  style={{ filter: "grayscale(100%) opacity(0.6)" }}
                >
                  🗂
                </div>
                <p className="text-sm font-medium text-slate-400">
                  위에서 직원을 선택하면 인사기록카드 입력 폼이 표시됩니다.
                </p>
              </div>
            </section>
          )}
        </div>

        {/* 우측: 직원 목록 체크리스트 */}
        <EmployeeChecklistCard
          drivers={drivers}
          profileMap={profileMap}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>
    </div>
  );
}

function EmployeeChecklistCard({
  drivers,
  profileMap,
  selectedId,
  onSelect,
}: {
  drivers: Driver[];
  profileMap: Map<string, EmployeeProfile>;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const done = drivers.filter((d) => profileMap.has(d.id)).length;
  return (
    <section className={`${cardCls} h-fit`}>
      <h3 className="text-sm font-semibold text-slate-900">
        직원 목록{" "}
        <span className="ml-1 text-xs font-medium text-slate-400">
          입력 완료 {done} / {drivers.length}
        </span>
      </h3>
      {drivers.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">
          등록된 직원이 없습니다.
        </p>
      ) : (
        <ul className="mt-3 space-y-1">
          {drivers.map((d) => {
            const has = profileMap.has(d.id);
            const active = d.id === selectedId;
            return (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => onSelect(d.id)}
                  className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition ${
                    active
                      ? "bg-blue-50 ring-1 ring-blue-300"
                      : "hover:bg-slate-50"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden>{has ? "✅" : "❌"}</span>
                    <span className="font-medium text-slate-800">
                      {d.name}
                    </span>
                    {d.rank && (
                      <span className="text-xs text-slate-400">
                        {d.rank}
                      </span>
                    )}
                    {!d.is_active && (
                      <span className="text-[10px] text-slate-400">
                        (퇴사)
                      </span>
                    )}
                  </span>
                  <span
                    className={`text-[10px] font-semibold ${
                      has ? "text-emerald-600" : "text-slate-400"
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
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <div className="mt-2 flex flex-col items-center justify-center gap-2 py-16 text-center">
        <div
          aria-hidden
          className="text-5xl text-slate-300"
          style={{ filter: "grayscale(100%) opacity(0.6)" }}
        >
          {icon}
        </div>
        <p className="text-sm font-medium text-slate-400">{desc}</p>
        <p className="text-xs text-slate-400">곧 제공될 예정입니다.</p>
      </div>
    </section>
  );
}
