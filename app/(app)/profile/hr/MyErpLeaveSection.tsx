"use client";

// =====================================================================
// 내 인사기록카드 › 연차·대휴 탭 — 본인 것만(ERP 복제 데이터, 조회 전용).
//   * 연차 잔여 원형 그래프: 잔여 / 사용(올해 erp_duties 연가 합계 — "ERP 사용 기록 기준").
//   * 대휴 잔여 카드, 올해 월별 내 연가 사용 막대, 이번 달 내 복무 미니 달력.
// =====================================================================

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MyErpLeave } from "@/lib/erp/view";
import { DUTY_COLOR_CLASS, DUTY_COLOR_HEX, ERP_NOTE, addDaysYmd, dayLabel } from "@/lib/erp/duty";
import { getHolidayName } from "@/lib/koreanHolidays";
import { badgeWarning, cardCls, noticeWarning } from "@/lib/ui";
import DutyRecordPanel from "@/app/(app)/profile/hr/DutyRecordPanel";

const fmt = (v: number | null | undefined) => (v == null ? "-" : Number.isInteger(v) ? String(v) : Number(v).toFixed(1));
const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "기록 없음";

function Note({ syncedAt, extra }: { syncedAt: string | null; extra?: string }) {
  return (
    <p className="mt-2 text-[11px] text-ink-hint">
      {extra ? `${extra} · ` : ""}
      {ERP_NOTE} · 마지막 동기화 {when(syncedAt)}
    </p>
  );
}

export default function MyErpLeaveSection({
  data,
  payout = null,
}: {
  data: MyErpLeave;
  // 올해 연차수당 예정(확정된 산정표의 본인 줄). 직원 노출 설정이 꺼져 있으면 서버가 null 을 줍니다.
  payout?: { days: number; amount: number } | null;
}) {
  if (!data.linked) return <p className={noticeWarning}>ERP 계정 연결이 필요합니다(관리자 문의).</p>;
  return (
    <div className="space-y-4">
      <LeaveCharts data={data} />
      {payout && (
        <section className={cardCls}>
          <p className="text-sm text-ink">
            올해 연차수당 예정 <b className="text-navy">{fmt(payout.days)}일</b> · <b className="text-navy">{payout.amount.toLocaleString("ko-KR")}원</b>
          </p>
        </section>
      )}
      <DutyRecordPanel thisYear={data.year} />
    </div>
  );
}

function LeaveCharts({ data }: { data: MyErpLeave }) {

  const remaining = data.annualRemaining ?? 0;
  const used = data.annualUsed;
  const pie = [
    { name: "잔여", value: Math.max(0, remaining) },
    { name: "사용", value: Math.max(0, used) },
  ];
  const monthly = data.monthlyUsed.map((v, i) => ({ month: `${i + 1}월`, days: v }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className={cardCls}>
          <h3 className="text-sm font-bold text-ink">연차</h3>
          <div className="relative h-44">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pie} dataKey="value" innerRadius="62%" outerRadius="90%" startAngle={90} endAngle={-270} stroke="none">
                  <Cell fill="#1e3a8a" />
                  <Cell fill="#cbd5e1" />
                </Pie>
                <Tooltip formatter={(v) => `${fmt(Number(v))}일`} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[11px] text-ink-muted">잔여</span>
              <span className="font-mono text-2xl font-bold text-navy">{fmt(data.annualRemaining)}일</span>
            </div>
          </div>
          <p className="text-center text-xs text-ink-muted">
            올해 사용 <b className="text-ink">{fmt(used)}일</b> · 잔여 <b className="text-navy">{fmt(data.annualRemaining)}일</b>
          </p>
          <Note syncedAt={data.syncedLeave} extra="사용은 ERP 사용 기록 기준(올해 연가 진행·완료 합계)" />
        </section>
        <section className={cardCls}>
          <h3 className="text-sm font-bold text-ink">대휴</h3>
          <p className="mt-6 text-center font-mono text-4xl font-bold text-navy">{fmt(data.compensatoryRemaining)}일</p>
          <p className="mt-1 text-center text-xs text-ink-muted">대휴 잔여</p>
          <Note syncedAt={data.syncedLeave} />
        </section>
      </div>

      <section className={cardCls}>
        <h3 className="mb-2 text-sm font-bold text-ink">{data.year}년 월별 내 연가 사용</h3>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthly} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => `${fmt(Number(v))}일`} />
              <Bar dataKey="days" name="연가" fill={DUTY_COLOR_HEX.leave} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <Note syncedAt={data.syncedDuties} extra="ERP 사용 기록 기준" />
      </section>

      <MiniMonth data={data} />
    </div>
  );
}

// 이번 달 내 복무 미니 달력(월~일) + 고른 날 목록.
function MiniMonth({ data }: { data: MyErpLeave }) {
  const first = `${data.month}-01`;
  const dow = (ymd: string) => (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDaysYmd(first, -dow(first));
  const nextFirst = (() => {
    const d = new Date(`${first}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 1);
    return d.toISOString().slice(0, 10);
  })();
  const last = addDaysYmd(nextFirst, -1);
  const end = addDaysYmd(last, 6 - dow(last));
  const days: string[] = [];
  for (let d = start; d <= end; d = addDaysYmd(d, 1)) days.push(d);
  const [sel, setSel] = useState<string | null>(null);
  const on = (d: string) => data.monthDuties.filter((x) => x.start <= d && x.end >= d);
  const list = sel ? on(sel) : data.monthDuties;

  return (
    <section className={cardCls}>
      <h3 className="mb-2 text-sm font-bold text-ink">
        이번 달 내 복무 <span className="text-xs font-normal text-ink-muted">({data.month})</span>
      </h3>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px]">
        {["월", "화", "수", "목", "금", "토", "일"].map((w, i) => (
          <span key={w} className={i === 6 ? "text-stamp" : i === 5 ? "text-blue-600" : "text-ink-muted"}>
            {w}
          </span>
        ))}
        {days.map((d) => {
          const items = on(d);
          const inMonth = d.slice(0, 7) === data.month;
          const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
          const tone = getHolidayName(d) || wd === 0 ? "text-stamp" : wd === 6 ? "text-blue-600" : "text-ink";
          return (
            <button
              key={d}
              type="button"
              onClick={() => setSel(sel === d ? null : d)}
              className={`flex h-11 flex-col items-center justify-start rounded-md border pt-0.5 ${
                sel === d ? "border-navy bg-navy-soft/40" : "border-line/60"
              } ${inMonth ? "" : "opacity-40"}`}
              aria-label={`${dayLabel(d)} ${items.length}건`}
            >
              <span className={`text-xs font-semibold ${tone}`}>{Number(d.slice(8, 10))}</span>
              <span className="mt-0.5 flex gap-0.5">
                {items.slice(0, 3).map((x) => (
                  <span key={x.id} className="h-1.5 w-1.5 rounded-full" style={{ background: DUTY_COLOR_HEX[x.color] }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <ul className="mt-3 divide-y divide-line/60">
        {list.length === 0 ? (
          <li className="py-2 text-xs text-ink-hint">{sel ? "이 날 복무가 없습니다." : "이번 달 복무 기록이 없습니다."}</li>
        ) : (
          list.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
              <span className="w-20 shrink-0 text-xs text-ink-muted">{dayLabel(x.start)}</span>
              <span className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${DUTY_COLOR_CLASS[x.color]}`}>{x.type}</span>
              <span className="text-xs text-ink-muted">{x.time}</span>
              {x.location && <span className="text-xs text-ink-body">· {x.location}</span>}
              {x.inProgress && <span className={badgeWarning}>결재 중</span>}
            </li>
          ))
        )}
      </ul>
      <Note syncedAt={data.syncedDuties} />
    </section>
  );
}
