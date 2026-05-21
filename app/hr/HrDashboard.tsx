"use client";

import { useState } from "react";

type TabKey = "records" | "contracts" | "certificates";

const cardCls =
  "rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5";

export default function HrDashboard() {
  const [tab, setTab] = useState<TabKey>("records");

  return (
    <div className="space-y-6">
      <Tabs current={tab} onChange={setTab} />

      {tab === "records" && (
        <PlaceholderCard
          icon="🗂"
          title="인사기록카드"
          desc="직원별 인사기록카드를 조회하고 작성할 수 있습니다."
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
