"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  cardCls,
  inputCls,
  labelCls,
  linkCls,
  badgeNavy,
  badgeNeutral,
  badgeSuccess,
  badgeWarning,
  noticeError,
  noticeSuccess,
  tabBarCls,
  tabNavCls,
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
  rentalFacility,
  rentalMonthLabel,
  rentalStatusLabel,
  rentalTypeLabel,
  RENTAL_FACILITY_LABELS,
  RENTAL_FACILITY_TAB_LABELS,
  RENTAL_PAGE_SIZE,
  type RentalPageData,
  type RentalRow,
  type RentalStatusFilter,
  type RentalTypeFilter,
  type RentalFacilityFilter,
} from "@/lib/rental";
import { syncRentalsNow } from "./actions";

// 표 스타일 — 운행기록·증명서 대장과 같은 값을 씁니다.
const thCls =
  "px-2 py-2 text-left text-xs font-semibold text-navy whitespace-nowrap";
// 행을 한 줄로 고정합니다 — 목적·사업명이 길어 두세 줄로 감기면 목록을
//   훑기가 어렵다는 관장 피드백. 넘치는 글자는 말줄임(…) 처리하고 전체
//   내용은 그 칸에 마우스를 올리면 title 로 보입니다.
const tdCls = "px-2 py-2 align-middle text-sm text-ink-body whitespace-nowrap";

const BASE_PATH = "/hr/facility/rentals";

// 1차 축 = 시설. 온나는 사실상 청소년 공간이 대부분이라, 구분(대관/공간)과
//   시설을 둘 다 탭으로 두면 오히려 복잡해집니다 — 구분은 셀렉트로 내렸습니다.
const FACILITY_TABS: RentalFacilityFilter[] = ["all", "center", "onna"];

const TYPE_OPTIONS: { value: RentalTypeFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "rental", label: "시설 대관" },
  { value: "room", label: "청소년 공간" },
];

// 빈 값은 회색 '-' 로 — 값이 있는 칸과 한눈에 구분되게.
function Dash() {
  return <span className="text-ink-hint">-</span>;
}

// 말줄임 칸. 표 안에서 truncate 가 먹으려면 폭이 잡힌 블록이 필요합니다.
function Clamp({ text, width }: { text: string | null; width: string }) {
  const value = (text ?? "").trim();
  if (!value) return <Dash />;
  return (
    <div className={`${width} truncate`} title={value}>
      {value}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  unit,
  hint,
  split,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  split?: string;
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
      {/* '전체' 탭에서만 — 센터/온나 소계를 작게 병기합니다. */}
      {split && <p className="mt-0.5 text-[11px] text-ink-muted">{split}</p>}
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
  facility,
  type,
  status,
}: {
  data: RentalPageData;
  month: string;
  facility: RentalFacilityFilter;
  type: RentalTypeFilter;
  status: RentalStatusFilter;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // 동기화는 서버 액션 — useTransition 과 별도로 자체 pending 을 둡니다
  // (전환 중 표시와 "동기화 중" 표시가 섞이면 버튼 상태를 읽을 수 없습니다).
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 필터를 바꾸면 1페이지로 돌아갑니다 — 3페이지를 보다 시설을 바꾸면
  //   결과가 3페이지보다 짧아 빈 화면이 나올 수 있습니다.
  function goto(next: {
    month?: string;
    facility?: RentalFacilityFilter;
    type?: RentalTypeFilter;
    status?: RentalStatusFilter;
    page?: number;
  }) {
    const q = new URLSearchParams();
    // month 를 빈 값으로 두면 전체 기간. 파라미터를 아예 지우면 기본(이번 달)로
    //   돌아가 버리므로, 전체보기는 ?month= 를 명시적으로 남깁니다.
    q.set("month", next.month ?? month);
    q.set("facility", next.facility ?? facility);
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
  const showSplit = facility === "all";
  const onnaTab = facility === "onna";
  const sel = summary.selected;
  const n = (v: number) => v.toLocaleString("ko-KR");

  // '전체' 탭 카드에 병기할 센터/온나 소계 한 줄.
  const split = (pick: (s: typeof sel) => number) =>
    showSplit
      ? `센터 ${n(pick(summary.center))} · 온나 ${n(pick(summary.onna))}`
      : undefined;

  return (
    <div className="space-y-4">
      {/* 1차 축 — 시설(센터 본관 / 사직동 온나) */}
      <div className={tabBarCls}>
        <nav className={tabNavCls}>
          {FACILITY_TABS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => goto({ facility: f })}
              className={tabItemCls(facility === f)}
            >
              {RENTAL_FACILITY_TAB_LABELS[f]}
            </button>
          ))}
        </nav>
      </div>

      <section className={cardCls}>
        {/* 요약 — 선택한 시설 탭 기준. 건수·이용인원은 확정 건만 셉니다. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryTile
            label={`${label} 확정 건수`}
            value={n(sel.confirmed)}
            unit="건"
            split={split((s) => s.confirmed)}
          />
          <SummaryTile
            label="이용인원 합계"
            value={n(sel.personTotal)}
            unit="명"
            split={split((s) => s.personTotal)}
            hint={
              sel.personDisabled > 0
                ? `장애인 ${n(sel.personDisabled)}명 포함`
                : undefined
            }
          />
          <SummaryTile
            label="신청 중"
            value={n(sel.pending)}
            unit="건"
            split={split((s) => s.pending)}
          />
          <SummaryTile
            label="취소"
            value={n(sel.cancelled)}
            unit="건"
            split={split((s) => s.cancelled)}
          />
        </div>
        <p className="mt-2 text-[11px] text-ink-hint">
          건수·이용인원 합계는 확정 건만 셉니다(신청 중·취소 제외).
          {facility === "all"
            ? " 시설 구분은 공간명 기준입니다 — '온나'로 시작하는 공간이 사직동 온나입니다."
            : ` 지금은 ${RENTAL_FACILITY_LABELS[facility]} 만 보고 있습니다.`}
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
        {/* 2차 필터 — 구분(셀렉트) · 상태(체크박스) */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <label className={labelCls}>
            구분
            <select
              className={`${inputCls} min-w-32`}
              value={type}
              onChange={(e) =>
                goto({ type: e.target.value as RentalTypeFilter })
              }
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
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
          {n(filtered)}건
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
                  {/* 시설 탭을 고른 뒤에는 그 열이 한 값으로 고정되니 숨깁니다. */}
                  {facility === "all" && <th className={thCls}>시설</th>}
                  <th className={thCls}>구분</th>
                  <th className={thCls}>공간</th>
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
                      <td className={tdCls}>
                        {formatRentalDate(r.reservation_date)}
                      </td>
                      <td className={tdCls}>{formatTimeRange(r)}</td>
                      {facility === "all" && (
                        // 판정은 화면·요약이 공유하는 순수 함수 하나로만 합니다
                        //   — 여기서 '온나' 접두사를 다시 보지 않습니다.
                        <td className={tdCls}>
                          {RENTAL_FACILITY_TAB_LABELS[rentalFacility(r)]}
                        </td>
                      )}
                      <td className={tdCls}>
                        {rentalTypeLabel(r.reservation_type)}
                      </td>
                      {/* 공간명과 세부교실의 중복을 걷어낸 한 줄 표기 */}
                      <td className={`${tdCls} ${dim ? "" : "text-ink"}`}>
                        <Clamp
                          text={formatSpace(r, { onnaTab })}
                          width="max-w-[15rem]"
                        />
                      </td>
                      <td className={tdCls}>
                        <Clamp text={r.purpose} width="max-w-[13rem]" />
                      </td>
                      <td className={tdCls}>
                        <Clamp text={r.program_name} width="max-w-[11rem]" />
                      </td>
                      <td className={tdCls}>
                        {r.applicant ? r.applicant : <Dash />}
                      </td>
                      <td className={tdCls}>
                        <Clamp text={r.team_name} width="max-w-[9rem]" />
                      </td>
                      <td className={`${tdCls} text-right`}>
                        {formatPersons(r)}
                      </td>
                      <td className={tdCls}>
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
