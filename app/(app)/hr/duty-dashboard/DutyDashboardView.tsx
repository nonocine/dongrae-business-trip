"use client";

// 복무·연차 대시보드(관장·hr) — 요약 카드 + recharts 그래프 + 재직자 연차 표.
//   데이터는 서버(lib/erp/view dutyDashboardData)가 ERP 복제 표에서 계산해 내려 줍니다(조회 전용).
import Link from "next/link";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DutyDashboard } from "@/lib/erp/view";
import { DUTY_COLOR_HEX, dutyColorKey, ERP_NOTE } from "@/lib/erp/duty";
import { cardCls } from "@/lib/ui";

const fmt = (v: number | null | undefined) => (v == null ? "-" : Number.isInteger(v) ? String(v) : Number(v).toFixed(1));
const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "기록 없음";

// 유형별 색 — 같은 색 묶음(예: 연가·대휴 = 휴가 계열)은 명도를 달리합니다.
const SHADES = ["", "cc", "99", "77"];
function typeColors(types: string[]): Record<string, string> {
  const used: Record<string, number> = {};
  const out: Record<string, string> = {};
  for (const t of types) {
    const k = dutyColorKey(t);
    const n = used[k] ?? 0;
    used[k] = n + 1;
    out[t] = `${DUTY_COLOR_HEX[k]}${SHADES[Math.min(n, SHADES.length - 1)]}`;
  }
  return out;
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className={cardCls}>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-1 font-mono text-2xl font-bold text-navy">
        {value}
        {unit && <span className="ml-0.5 text-sm font-semibold text-ink-muted">{unit}</span>}
      </p>
    </div>
  );
}

export default function DutyDashboardView({ data }: { data: DutyDashboard }) {
  const [otScope, setOtScope] = useState<"month" | "year">("month");
  const colors = typeColors(data.types);
  const byAnnual = data.people
    .filter((p) => p.annual != null)
    .sort((a, b) => (b.annual ?? 0) - (a.annual ?? 0))
    .map((p) => ({ name: p.name, 연차잔여: p.annual ?? 0 }));
  const overtime = data.people
    .map((p) => ({ name: p.name, 시간: otScope === "month" ? p.overtimeMonth : p.overtimeYear }))
    .filter((p) => p.시간 > 0)
    .sort((a, b) => b.시간 - a.시간);
  const comp = data.people
    .filter((p) => (p.compensatory ?? 0) > 0)
    .sort((a, b) => (b.compensatory ?? 0) - (a.compensatory ?? 0))
    .slice(0, 10)
    .map((p) => ({ name: p.name, 대휴잔여: p.compensatory ?? 0 }));
  const hFor = (n: number) => Math.max(160, n * 26 + 40);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="오늘 부재 인원" value={String(data.todayAbsent)} unit="명" />
        <Stat label={`이번 달 출장 (${Number(data.month.slice(5))}월)`} value={String(data.monthTrips)} unit="건" />
        <Stat label="이번 달 초과근무 합계" value={fmt(data.monthOvertimeHours)} unit="시간" />
        <Stat label="재직자 연차 잔여 평균" value={fmt(data.avgAnnualRemaining)} unit="일" />
      </div>

      <section className={cardCls}>
        <h3 className="mb-2 text-sm font-bold text-ink">{data.year}년 월별 유형별 복무 건수</h3>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.monthlyByType} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {data.types.map((t) => (
                <Bar key={t} dataKey={t} stackId="a" fill={colors[t]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-1 text-[11px] text-ink-hint">시작일 기준 · 결재 진행·완료만 · {ERP_NOTE} · 마지막 동기화 {when(data.syncedDuties)}</p>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className={cardCls}>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-bold text-ink">직원별 연차 잔여</h3>
            <Link href="/hr/leave-plans" className="text-xs font-semibold text-navy hover:underline">
              연차 사용촉진 →
            </Link>
          </div>
          <div style={{ height: hFor(byAnnual.length) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byAnnual} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={64} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => `${fmt(Number(v))}일`} />
                <Bar dataKey="연차잔여" fill="#1e3a8a" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-[11px] text-ink-hint">많은 순 · 마지막 동기화 {when(data.syncedLeave)}</p>
        </section>

        <section className={cardCls}>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-bold text-ink">직원별 초과근무 시간</h3>
            <div className="flex gap-1" role="tablist">
              {(["month", "year"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={otScope === s}
                  onClick={() => setOtScope(s)}
                  className={`rounded px-2 py-1 text-xs font-semibold ${otScope === s ? "bg-navy text-white" : "border border-line text-ink-muted"}`}
                >
                  {s === "month" ? "이번 달" : "올해"}
                </button>
              ))}
            </div>
          </div>
          {overtime.length === 0 ? (
            <p className="py-8 text-center text-xs text-ink-hint">초과근무 기록이 없습니다.</p>
          ) : (
            <div style={{ height: hFor(overtime.length) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={overtime} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={64} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => `${fmt(Number(v))}시간`} />
                  <Bar dataKey="시간" fill={DUTY_COLOR_HEX.overtime} radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <p className="mt-1 text-[11px] text-ink-hint">ERP &lsquo;초과&rsquo; 신고 시간(시작일 기준) 합계</p>
        </section>

        <section className={cardCls}>
          <h3 className="mb-2 text-sm font-bold text-ink">대휴 잔여 상위</h3>
          {comp.length === 0 ? (
            <p className="py-8 text-center text-xs text-ink-hint">대휴 잔여가 있는 직원이 없습니다.</p>
          ) : (
            <div style={{ height: hFor(comp.length) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={comp} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={64} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => `${fmt(Number(v))}일`} />
                  <Bar dataKey="대휴잔여" fill={DUTY_COLOR_HEX.leave} radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className={cardCls}>
          <h3 className="mb-2 text-sm font-bold text-ink">
            재직자 연차·대휴 <span className="text-xs font-normal text-ink-muted">({data.people.length}명)</span>
          </h3>
          <div className="max-h-96 overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-line text-xs text-navy">
                  <th className="px-2 py-1.5 text-left font-semibold">이름</th>
                  <th className="px-2 py-1.5 text-left font-semibold">부서</th>
                  <th className="px-2 py-1.5 text-right font-semibold">연차 잔여</th>
                  <th className="px-2 py-1.5 text-right font-semibold">올해 연가 사용</th>
                  <th className="px-2 py-1.5 text-right font-semibold">대휴 잔여</th>
                </tr>
              </thead>
              <tbody>
                {data.people.map((p) => (
                  <tr key={p.id} className="border-b border-line/60">
                    <td className="px-2 py-1.5 text-ink">{p.name}</td>
                    <td className="px-2 py-1.5 text-xs text-ink-muted">{p.department ?? "-"}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{fmt(p.annual)}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{fmt(p.annualUsed)}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{fmt(p.compensatory)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[11px] text-ink-hint">연가 사용은 ERP 사용 기록 기준 · 마지막 동기화 {when(data.syncedLeave)}</p>
        </section>
      </div>
    </div>
  );
}
