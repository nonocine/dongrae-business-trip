"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  cardCls,
  inputCls,
  linkCls,
  badgeNavy,
  badgeNeutral,
  badgeSuccess,
  badgeWarning,
  noticeError,
  noticeSuccess,
  tabItemCls,
} from "@/lib/ui";
import Button from "@/app/components/Button";
import { fmtKstDateTime } from "@/lib/datetime";
import {
  formatPersons,
  formatRentalDate,
  formatSpace,
  formatTimeRange,
  isCancelled,
  isConfirmed,
  rentalMonthLabel,
  rentalStatusLabel,
  rentalTypeLabel,
  RENTAL_PAGE_SIZE,
  type RentalPageData,
  type RentalRow,
  type RentalStatusFilter,
  type RentalTypeFilter,
} from "@/lib/rental";
import { syncRentalsNow } from "./actions";

// 표 스타일 — 운행기록·증명서 대장과 같은 값을 씁니다.
const thCls =
  "px-2 py-2 text-left text-xs font-semibold text-navy whitespace-nowrap";
const tdCls = "px-2 py-2 align-middle text-sm text-ink-body";

const BASE_PATH = "/hr/facility/rentals";

const TYPE_TABS: { value: RentalTypeFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "rental", label: "시설 대관" },
  { value: "room", label: "청소년 공간" },
];

function SummaryTile({
  label,
  value,
  unit,
  hint,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
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
      {hint && <p className="mt-0.5 text-[11px] text-ink-hint">{hint}</p>}
    </div>
  );
}

// 상태 배지 — 취소는 회색으로 눌러 표시합니다(있는데 없는 것처럼 보이지
//   않도록 숨기지는 않되, 확정과 한눈에 구분되게).
function StatusBadge({ row }: { row: RentalRow }) {
  const label = rentalStatusLabel(row);
  if (isConfirmed(row)) return <span className={badgeSuccess}>{label}</span>;
  if (isCancelled(row)) return <span className={badgeNeutral}>{label}</span>;
  return <span className={badgeWarning}>{label}</span>;
}

export default function RentalReservationsView({
  data,
  month,
  type,
  status,
}: {
  data: RentalPageData;
  month: string;
  type: RentalTypeFilter;
  status: RentalStatusFilter;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // 동기화는 서버 액션 — useTransition 과 별도로 자체 pending 을 둡니다
  // (전환 중 표시와 "동기화 중" 표시가 섞이면 버튼 상태를 읽을 수 없습니다).
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 필터를 바꾸면 1페이지로 돌아갑니다 — 3페이지를 보다 구분을 바꾸면
  //   결과가 3페이지보다 짧아 빈 화면이 나올 수 있습니다.
  function goto(next: {
    month?: string;
    type?: RentalTypeFilter;
    status?: RentalStatusFilter;
    page?: number;
  }) {
    const q = new URLSearchParams();
    // month 를 빈 값으로 두면 전체 기간. 파라미터를 아예 지우면 기본(이번 달)로
    //   돌아가 버리므로, 전체보기는 ?month= 를 명시적으로 남깁니다.
    q.set("month", next.month ?? month);
    q.set("type", next.type ?? type);
    q.set("status", next.status ?? status);
    const page = next.page ?? 1;
    if (page > 1) q.set("page", String(page));
    startTransition(() => {
      router.push(`${BASE_PATH}?${q.toString()}`);
    });
  }

  function runSync() {
    if (syncing) return; // 중복 클릭 방지(버튼 비활성과 이중 안전장치)
    setSyncing(true);
    setMsg(null);
    void (async () => {
      try {
        const res = await syncRentalsNow();
        if (!res.ok) {
          setMsg({ ok: false, text: res.message });
          return;
        }
        const parts = Object.entries(res.byType)
          .map(([k, v]) => `${rentalTypeLabel(k)} ${v}건`)
          .join(" · ");
        const tail = res.incomplete.length > 0 ? ` ⚠️ ${res.message}` : "";
        setMsg({
          ok: true,
          text: `홈페이지에서 ${res.upserted.toLocaleString("ko-KR")}건을 가져왔습니다${
            parts ? ` (${parts})` : ""
          }.${tail}`,
        });
        // 목록·요약을 새 데이터로 다시 그립니다.
        router.refresh();
      } finally {
        setSyncing(false);
      }
    })();
  }

  const { rows, summary, filtered, page, totalPages, lastSyncAt } = data;
  const label = rentalMonthLabel(month);
  const busy = pending || syncing;

  return (
    <div className="space-y-4">
      <section className={cardCls}>
        {/* 요약 — 건수·이용인원은 확정 건 기준입니다. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryTile
            label={`${label} 확정 건수`}
            value={summary.confirmed.toLocaleString("ko-KR")}
            unit="건"
          />
          <SummaryTile
            label="이용인원 합계"
            value={summary.personTotal.toLocaleString("ko-KR")}
            unit="명"
            hint={
              summary.personDisabled > 0
                ? `장애인 ${summary.personDisabled.toLocaleString("ko-KR")}명 포함`
                : undefined
            }
          />
          <SummaryTile
            label="신청 중"
            value={summary.pending.toLocaleString("ko-KR")}
            unit="건"
          />
          <SummaryTile
            label="취소"
            value={summary.cancelled.toLocaleString("ko-KR")}
            unit="건"
          />
        </div>
        <p className="mt-2 text-[11px] text-ink-hint">
          건수·이용인원 합계는 확정 건만 셉니다(신청 중·취소 제외).
        </p>

        {/* 월 선택 + 동기화 */}
        <div className="mt-4 flex flex-col gap-3 border-t border-line pt-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <label
              htmlFor="rental-month"
              className="block text-xs font-medium text-ink-muted"
            >
              월별 조회
            </label>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <input
                id="rental-month"
                type="month"
                value={month}
                onChange={(e) => goto({ month: e.target.value })}
                className={`${inputCls} mt-0 w-auto`}
              />
              {month ? (
                <button
                  type="button"
                  onClick={() => goto({ month: "" })}
                  className={linkCls}
                >
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

          <div className="flex flex-col items-start gap-1 sm:items-end">
            <Button variant="secondary" onClick={runSync} loading={syncing}>
              {syncing ? "동기화 중…" : "지금 동기화"}
            </Button>
            <p className="text-[11px] text-ink-hint">
              마지막 동기화{" "}
              {lastSyncAt ? (
                <>{fmtKstDateTime(lastSyncAt)} (KST)</>
              ) : (
                <span className="font-semibold text-warning">기록 없음</span>
              )}
            </p>
          </div>
        </div>

        {msg && (
          <p className={`mt-3 ${msg.ok ? noticeSuccess : noticeError}`}>
            {msg.text}
          </p>
        )}
      </section>

      <section className={cardCls}>
        {/* 구분·상태 필터 */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-max gap-1">
            {TYPE_TABS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => goto({ type: t.value })}
                className={tabItemCls(type === t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-ink-body">
            <input
              type="checkbox"
              checked={status === "all"}
              onChange={(e) =>
                goto({ status: e.target.checked ? "all" : "confirmed" })
              }
              className="h-4 w-4 rounded border-line text-navy focus:ring-navy"
            />
            신청 중·취소도 보기
          </label>
        </div>

        <p className="mt-3 text-xs text-ink-muted">
          {filtered.toLocaleString("ko-KR")}건
          {filtered > RENTAL_PAGE_SIZE && ` · ${page}/${totalPages}페이지`}
          {status === "confirmed" && " (확정만)"}
        </p>

        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-muted">
            {month
              ? `${label}에 ${status === "confirmed" ? "확정된 " : ""}대관예약이 없습니다.`
              : "대관예약이 없습니다."}
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th className={thCls}>대관일</th>
                  <th className={thCls}>시간</th>
                  <th className={thCls}>구분</th>
                  <th className={thCls}>공간(세부교실)</th>
                  <th className={thCls}>목적</th>
                  <th className={thCls}>사업명</th>
                  <th className={thCls}>신청자</th>
                  <th className={thCls}>단체</th>
                  <th className={`${thCls} text-right`}>인원</th>
                  <th className={thCls}>상태</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  // 취소 건은 줄 전체를 회색으로 눌러, 확정 건과 섞여 있어도
                  //   실제 이용 건으로 잘못 읽지 않게 합니다.
                  const dim = isCancelled(r);
                  return (
                    <tr
                      key={r.reservation_no}
                      className={`border-b border-line/60 ${
                        dim ? "text-ink-hint opacity-60" : ""
                      }`}
                    >
                      <td className={`${tdCls} whitespace-nowrap`}>
                        {formatRentalDate(r.reservation_date)}
                      </td>
                      <td className={`${tdCls} whitespace-nowrap`}>
                        {formatTimeRange(r)}
                      </td>
                      <td className={`${tdCls} whitespace-nowrap`}>
                        {rentalTypeLabel(r.reservation_type)}
                      </td>
                      <td className={`${tdCls} ${dim ? "" : "font-medium text-ink"}`}>
                        {formatSpace(r)}
                      </td>
                      <td className={tdCls}>{r.purpose ?? "-"}</td>
                      <td className={tdCls}>{r.program_name ?? "-"}</td>
                      <td className={`${tdCls} whitespace-nowrap`}>
                        {r.applicant ?? "-"}
                      </td>
                      <td className={tdCls}>{r.team_name ?? "-"}</td>
                      <td className={`${tdCls} whitespace-nowrap text-right`}>
                        {formatPersons(r)}
                      </td>
                      <td className={`${tdCls} whitespace-nowrap`}>
                        <StatusBadge row={r} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="mt-3 flex items-center justify-center gap-2 border-t border-line pt-3">
            <Button
              variant="secondary"
              onClick={() => goto({ page: page - 1 })}
              disabled={page <= 1 || busy}
            >
              이전
            </Button>
            <span className="text-xs text-ink-muted">
              {page} / {totalPages}
            </span>
            <Button
              variant="secondary"
              onClick={() => goto({ page: page + 1 })}
              disabled={page >= totalPages || busy}
            >
              다음
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
