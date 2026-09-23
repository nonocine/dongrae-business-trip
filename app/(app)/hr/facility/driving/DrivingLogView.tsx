"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { cardCls, inputCls, btnSecondary, linkCls, badgeNavy } from "@/lib/ui";
import {
  formatPeriod,
  formatPassengers,
  formatRoute,
  formatKm,
  monthLabel,
  type DrivingLogRow,
  type DrivingSummary,
} from "@/lib/driving";

// 표 스타일 — 다른 인사 화면(CertificateLedger 등)과 같은 값을 씁니다.
const thCls =
  "px-2 py-2 text-left text-xs font-semibold text-navy whitespace-nowrap";
const tdCls = "px-2 py-2 align-middle text-sm text-ink-body";

const BASE_PATH = "/hr/facility/driving";

function SummaryTile({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2.5">
      <p className="text-[11px] font-medium text-ink-muted">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-ink">
        {value}
        {unit && (
          <span className="ml-0.5 text-xs font-semibold text-ink-muted">
            {unit}
          </span>
        )}
      </p>
    </div>
  );
}

export default function DrivingLogView({
  logs,
  summary,
  month,
}: {
  logs: DrivingLogRow[];
  summary: DrivingSummary;
  month: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // month 를 빈 값으로 두면 전체 기간. 파라미터를 아예 지우면 기본(이번 달)로
  // 돌아가 버리므로, 전체보기는 ?month= 를 명시적으로 남깁니다.
  function goto(next: string) {
    startTransition(() => {
      router.push(`${BASE_PATH}?month=${next}`);
    });
  }

  const exportHref = month
    ? `${BASE_PATH}/export?month=${month}`
    : `${BASE_PATH}/export`;

  return (
    <div className="space-y-4">
      <section className={cardCls}>
        {/* 상단 요약 — 건수·거리는 조회 기간, 누적거리는 차량 전체 기준 */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <SummaryTile
            label={`${monthLabel(month)} 운행 건수`}
            value={String(summary.count)}
            unit="건"
          />
          <SummaryTile
            label={`${monthLabel(month)} 운행거리`}
            value={formatKm(summary.distance)}
            unit="km"
          />
          <SummaryTile
            label="현재 누적거리"
            value={
              summary.cumulative == null ? "-" : formatKm(summary.cumulative)
            }
            unit={summary.cumulative == null ? undefined : "km"}
          />
        </div>

        {/* 월 선택 + 대장 다운로드 */}
        <div className="mt-4 flex flex-col gap-3 border-t border-line pt-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <label htmlFor="driving-month" className="block text-xs font-medium text-ink-muted">
              월별 조회
            </label>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <input
                id="driving-month"
                type="month"
                value={month}
                onChange={(e) => goto(e.target.value)}
                className={`${inputCls} mt-0 w-auto`}
              />
              {month ? (
                <button type="button" onClick={() => goto("")} className={linkCls}>
                  전체보기
                </button>
              ) : (
                <span className={badgeNavy}>전체 기간</span>
              )}
              {pending && (
                <span className="text-xs text-ink-hint">불러오는 중…</span>
              )}
            </div>
          </div>

          <a href={exportHref} className={btnSecondary}>
            운행대장 XLSX
          </a>
        </div>
      </section>

      <section className={cardCls}>
        {logs.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-muted">
            {month
              ? `${monthLabel(month)}에 등록된 운행 기록이 없습니다.`
              : "등록된 운행 기록이 없습니다."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th className={thCls}>운행일자</th>
                  <th className={thCls}>운전자</th>
                  <th className={thCls}>용무</th>
                  <th className={thCls}>출발 › 경유 › 도착</th>
                  <th className={`${thCls} text-right`}>운행거리</th>
                  <th className={thCls}>동승자</th>
                  <th className={thCls}>확인자</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-line/60">
                    {/* 다일 운행은 formatPeriod 가 "시작 ~ 종료 (N박 N일)" 로 냅니다. */}
                    <td className={`${tdCls} whitespace-nowrap`}>
                      {formatPeriod(log)}
                    </td>
                    <td className={`${tdCls} whitespace-nowrap font-medium text-ink`}>
                      {log.driver}
                    </td>
                    <td className={tdCls}>{log.purpose}</td>
                    <td className={tdCls}>{formatRoute(log)}</td>
                    <td className={`${tdCls} whitespace-nowrap text-right`}>
                      {formatKm(log.distance)} km
                      <span className="block text-[11px] text-ink-muted">
                        누적 {formatKm(log.total_distance)}
                      </span>
                    </td>
                    <td className={tdCls}>{formatPassengers(log)}</td>
                    <td className={`${tdCls} whitespace-nowrap`}>
                      {log.confirmed_by ?? "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
