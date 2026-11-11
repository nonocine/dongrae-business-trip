"use client";

// 직원별 연차·대휴 잔여 표 — 복무·연차 대시보드 맨 위. 열 머리를 눌러 정렬(기본: 잔여 많은 순).
//   잔여 5일 이상 노랑, 10일 이상 주황(연말 소멸 위험). 올해 입사자 '첫해' 배지.
//   ERP 미연결 직원은 맨 아래 회색 줄. 이름을 누르면 그 직원 인사기록카드(복무 기록)로.
import Link from "next/link";
import { useMemo, useState } from "react";
import type { LeaveTable, LeaveTableRow } from "@/lib/erp/leaveTable";
import { ERP_NOTE } from "@/lib/erp/duty";
import { btnSecondary, cardCls } from "@/lib/ui";

type SortKey = "name" | "rank" | "joinDate" | "allocation" | "used" | "remaining" | "compensatory" | "syncedAt";
const COLS: { key: SortKey; label: string; num?: boolean }[] = [
  { key: "name", label: "이름" },
  { key: "rank", label: "직급" },
  { key: "joinDate", label: "입사일" },
  { key: "allocation", label: "연차 부여", num: true },
  { key: "used", label: "사용", num: true },
  { key: "remaining", label: "잔여", num: true },
  { key: "compensatory", label: "대휴 잔여", num: true },
  { key: "syncedAt", label: "마지막 동기화" },
];

const fmt = (v: number | null | undefined) => (v == null ? "-" : Number.isInteger(v) ? String(v) : Number(v).toFixed(1));
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-";

function remainTone(v: number | null): string {
  if (v == null) return "";
  if (v >= 10) return "bg-orange-100 text-orange-900 font-semibold";
  if (v >= 5) return "bg-yellow-100 text-yellow-900 font-semibold";
  return "";
}

export default function LeaveBalanceTable({ data }: { data: LeaveTable }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "remaining", desc: true });
  const rows = useMemo(() => {
    const v = (r: LeaveTableRow) => r[sort.key];
    return [...data.rows].sort((a, b) => {
      const x = v(a);
      const y = v(b);
      // 빈 값은 늘 아래로.
      if (x == null && y == null) return a.name.localeCompare(b.name, "ko");
      if (x == null) return 1;
      if (y == null) return -1;
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "ko");
      return (sort.desc ? -c : c) || a.name.localeCompare(b.name, "ko");
    });
  }, [data.rows, sort]);

  const nameCell = (driverId: string | null, name: string) =>
    driverId ? (
      <Link href={`/hr?tab=records&driver=${driverId}`} className="font-medium text-navy hover:underline" title="인사기록카드 · 복무 기록">
        {name}
      </Link>
    ) : (
      <span className="font-medium text-ink" title="동업자씨 직원과 연결 안 된 ERP 계정">
        {name}
      </span>
    );

  return (
    <section className={cardCls}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold text-ink">
          직원별 연차·대휴 잔여 <span className="text-xs font-normal text-ink-muted">({data.rows.length}명 · {data.year}년)</span>
        </h3>
        <span className="text-[11px] text-ink-hint">
          <span className="rounded bg-yellow-100 px-1">5일 이상</span> <span className="rounded bg-orange-100 px-1">10일 이상</span> — 연말 소멸 위험
        </span>
        <a href="/hr/duty-dashboard/excel" className={`${btnSecondary} ml-auto`}>
          엑셀 내보내기
        </a>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-navy">
              {COLS.map((c) => (
                <th
                  key={c.key}
                  className={`px-2 py-1.5 font-semibold ${c.num ? "text-right" : "text-left"}`}
                  aria-sort={sort.key === c.key ? (sort.desc ? "descending" : "ascending") : "none"}
                >
                  <button
                    type="button"
                    onClick={() => setSort((s) => (s.key === c.key ? { key: c.key, desc: !s.desc } : { key: c.key, desc: !!c.num }))}
                    className="hover:underline"
                  >
                    {c.label}
                    {sort.key === c.key && (sort.desc ? " ▼" : " ▲")}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.erpEmployeeId} className="border-b border-line/60">
                <td className="px-2 py-1.5">
                  {nameCell(r.driverId, r.name)}
                  {r.firstYear && <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] font-semibold text-sky-900">첫해</span>}
                </td>
                <td className="px-2 py-1.5 text-xs text-ink-muted">{r.rank ?? "-"}</td>
                <td className="px-2 py-1.5 text-xs text-ink-muted">{r.joinDate ?? "-"}</td>
                <td className="px-2 py-1.5 text-right font-mono">{fmt(r.allocation)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{fmt(r.used)}</td>
                <td className={`px-2 py-1.5 text-right font-mono ${remainTone(r.remaining)}`}>{fmt(r.remaining)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{fmt(r.compensatory)}</td>
                <td className="px-2 py-1.5 text-xs text-ink-hint">{when(r.syncedAt)}</td>
              </tr>
            ))}
            {data.unlinked.map((u) => (
              <tr key={`u-${u.driverId}`} className="border-b border-line/60 bg-surface text-ink-hint">
                <td className="px-2 py-1.5">
                  <Link href={`/hr?tab=records&driver=${u.driverId}`} className="hover:underline">
                    {u.name}
                  </Link>
                </td>
                <td className="px-2 py-1.5 text-xs">{u.rank ?? "-"}</td>
                <td className="px-2 py-1.5 text-xs">{u.joinDate ?? "-"}</td>
                <td colSpan={5} className="px-2 py-1.5 text-xs">
                  ERP 연결 필요 <span className="text-[10px]">(관리자 대시보드 › ERP 동기화 › 직원 연결)</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-ink-hint">
        연차 부여는 ERP 지정 부여일수(없으면 빈칸), 사용은 올해 ERP 연가(결재 진행·완료) 합계 · {ERP_NOTE}
      </p>
    </section>
  );
}
