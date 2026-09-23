"use client";

// =====================================================================
// 강사비 지출표 화면.
//
//   보기가 둘입니다 — 둘 다 필요합니다(lib/instructorPayout.ts 머리말 참고).
//     ⓐ 재원별 : 지출 품의를 올리는 단위. 정산 하나 = 품의 하나.
//     ⓑ 사람별 : "이 사람에게 총 얼마" + 어느 재원에서 얼마씩.
//   실측(2026-09)에서 5명이 보조금·운영비 두 재원에 걸쳐 있어, 한 사람 한
//   줄로 합치면 ⓐ 가, 정산별로만 보면 ⓑ 가 불가능해집니다.
//
//   ★ 계산하지 않습니다. 서버가 내려준 값을 더하기만 합니다.
//   ★ 필터는 클라이언트에서 겁니다 — 줄 수가 정산 항목 수라 가볍고,
//     기간을 돌릴 때마다 서버를 때리면 조작감이 떨어집니다.
// =====================================================================

import { useMemo, useState } from "react";
import type { PayoutData } from "@/app/(app)/hr/payouts/actions";
import {
  filterPayoutRows,
  groupByPerson,
  groupBySource,
  sumTotals,
  monthRange,
  KRW,
  type PayoutRow,
  type PayoutPerson,
} from "@/lib/instructorPayout";
import {
  panelToneCls,
  sectionTitleCls,
  tableHeadCls,
  tableRowCls,
  inputCls,
  labelCls,
  btnSecondary,
  badgeNavy,
  badgeNeutral,
  badgeWarning,
  badgeDanger,
  badgeSuccess,
} from "@/lib/ui";

type View = "source" | "person";

const th = "px-2 py-2 text-left whitespace-nowrap";
const thR = "px-2 py-2 text-right whitespace-nowrap";
const td = "px-2 py-2 align-middle text-sm text-ink-body";
const tdR = `${td} text-right font-mono whitespace-nowrap`;

// 계좌번호 복사 — 이체할 때 손으로 옮겨 적다 틀리는 일을 막습니다.
//   clipboard API 가 막힌 환경(구형 브라우저·http)에서는 조용히 넘어갑니다.
function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  if (!text) return null;
  return (
    <button
      type="button"
      title={`${label} 복사`}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1200);
          })
          .catch(() => {});
      }}
      className="ml-1 rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-muted hover:bg-surface"
    >
      {done ? "복사됨" : "복사"}
    </button>
  );
}

function Account({ row }: { row: { bankAccount: string | null } }) {
  if (!row.bankAccount)
    return <span className={badgeDanger}>계좌 미등록</span>;
  return (
    <span className="inline-flex items-center">
      <span className="font-mono text-xs">{row.bankAccount}</span>
      <CopyButton text={row.bankAccount} label="계좌번호" />
    </span>
  );
}

function RowFlags({ row }: { row: PayoutRow }) {
  if (!row.blockers.length && !row.adjusted) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {row.blockers.length > 0 && (
        <span className={badgeDanger} title={row.blockers.join(", ")}>
          확인 필요
        </span>
      )}
      {row.adjusted && (
        <span className={badgeWarning} title="자동 계산이 아니라 담당자가 손으로 조정한 금액입니다">
          수동 조정
        </span>
      )}
    </span>
  );
}

function Totals({
  label,
  gross,
  deduction,
  net,
  people,
  count,
}: {
  label: string;
  gross: number;
  deduction: number;
  net: number;
  people?: number;
  count?: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div className="rounded-lg border border-rule bg-surface/60 px-3 py-2">
        <p className="text-[11px] text-ink-muted">{label}</p>
        <p className="mt-0.5 text-sm font-bold text-ink">
          {people != null ? `${people}명` : ""}
          {people != null && count != null ? " · " : ""}
          {count != null ? `${count}건` : ""}
        </p>
      </div>
      <div className="rounded-lg border border-rule bg-surface/60 px-3 py-2">
        <p className="text-[11px] text-ink-muted">총지급액</p>
        <p className="mt-0.5 font-mono text-sm font-bold text-ink">{KRW(gross)}원</p>
      </div>
      <div className="rounded-lg border border-rule bg-surface/60 px-3 py-2">
        <p className="text-[11px] text-ink-muted">공제액</p>
        <p className="mt-0.5 font-mono text-sm font-bold text-ink">{KRW(deduction)}원</p>
      </div>
      <div className="rounded-lg border border-navy bg-navy-soft px-3 py-2">
        <p className="text-[11px] font-semibold text-navy">실지급액</p>
        <p className="mt-0.5 font-mono text-sm font-bold text-navy">{KRW(net)}원</p>
      </div>
    </div>
  );
}

export default function PayoutManager({ data }: { data: PayoutData }) {
  const [view, setView] = useState<View>("source");
  const [from, setFrom] = useState(data.defaultRange.from);
  const [to, setTo] = useState(data.defaultRange.to);
  const [projectId, setProjectId] = useState("");
  const [settlementId, setSettlementId] = useState("");

  const rows = useMemo(
    () => filterPayoutRows(data.rows, { from, to, projectId, settlementId }),
    [data.rows, from, to, projectId, settlementId]
  );
  const totals = useMemo(() => sumTotals(rows), [rows]);
  const sources = useMemo(() => groupBySource(rows), [rows]);
  const people = useMemo(() => groupByPerson(rows), [rows]);
  const blocked = useMemo(() => rows.filter((r) => r.blockers.length > 0), [rows]);

  // 엑셀은 화면과 같은 조건으로 — 링크(<a>)라 팝업 차단에 안 걸립니다.
  const exportHref = `/hr/payouts/export?${new URLSearchParams({
    from,
    to,
    project: projectId,
    settlement: settlementId,
    mode: view,
  }).toString()}`;

  function setMonth(offset: number) {
    const [y, m] = data.today.slice(0, 7).split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + offset, 1));
    const r = monthRange(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
    );
    setFrom(r.from);
    setTo(r.to);
  }

  return (
    <div className="space-y-5">
      {/* 파랑: 조회 조건 */}
      <section className={panelToneCls("blue")}>
        <div className="flex flex-wrap items-end gap-2">
          <label className={labelCls}>
            시작일
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={`${inputCls} w-40`}
            />
          </label>
          <label className={labelCls}>
            종료일
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className={`${inputCls} w-40`}
            />
          </label>
          <label className={labelCls}>
            사업
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className={`${inputCls} min-w-44`}
            >
              <option value="">전체 사업</option>
              {data.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className={labelCls}>
            재원(정산)
            <select
              value={settlementId}
              onChange={(e) => setSettlementId(e.target.value)}
              className={`${inputCls} min-w-64`}
            >
              <option value="">전체 재원</option>
              {data.settlements.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={btnSecondary} onClick={() => setMonth(0)}>
            이번 달
          </button>
          <button type="button" className={btnSecondary} onClick={() => setMonth(-1)}>
            지난 달
          </button>
          <button
            type="button"
            className={btnSecondary}
            onClick={() => {
              setFrom(`${data.today.slice(0, 4)}-01-01`);
              setTo(`${data.today.slice(0, 4)}-12-31`);
            }}
          >
            올해
          </button>
          <button
            type="button"
            className={btnSecondary}
            onClick={() => {
              setFrom("");
              setTo("");
            }}
          >
            전체 기간
          </button>
          <span aria-hidden className="h-5 w-px bg-line" />
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setView("source")}
              className={
                view === "source"
                  ? "rounded-lg border border-navy bg-navy px-3 py-1.5 text-sm font-semibold text-white"
                  : "rounded-lg border border-line bg-card px-3 py-1.5 text-sm font-medium text-ink-body hover:bg-surface"
              }
            >
              재원별 보기
            </button>
            <button
              type="button"
              onClick={() => setView("person")}
              className={
                view === "person"
                  ? "rounded-lg border border-navy bg-navy px-3 py-1.5 text-sm font-semibold text-white"
                  : "rounded-lg border border-line bg-card px-3 py-1.5 text-sm font-medium text-ink-body hover:bg-surface"
              }
            >
              사람별 보기
            </button>
          </div>
          <a href={exportHref} className={`${btnSecondary} ml-auto`}>
            엑셀 내려받기
          </a>
        </div>

        <p className="mt-2 text-xs text-ink-hint">
          {view === "source"
            ? "재원(정산) 하나가 지출 품의 하나입니다. 품의를 올릴 단위로 보세요."
            : "한 사람에게 이 기간 동안 나가는 총액입니다. 재원이 둘 이상이면 내역이 함께 나옵니다."}
        </p>
      </section>

      {/* 빨강: 조치가 필요한 것 — 표보다 위에 둡니다 */}
      {blocked.length > 0 && (
        <section className={panelToneCls("red")}>
          <h3 className={sectionTitleCls("red")}>
            지급 전 확인 필요 {blocked.length}건
          </h3>
          <p className="mt-2 text-xs text-ink-muted">
            아래 항목은 이체·원천징수에 필요한 정보가 비어 있거나 금액이 0 입니다.
            강사 정보는 [강사·프로그램 관리 › 강사 관리]에서 채울 수 있습니다.
          </p>
          <ul className="mt-3 space-y-1.5">
            {blocked.map((r) => (
              <li
                key={r.key}
                className="flex flex-wrap items-center gap-2 rounded-md border border-rule bg-surface/60 px-3 py-2 text-sm"
              >
                <span className="font-bold text-stamp">{r.name}</span>
                {/* 제목만으로는 구분이 안 되는 정산이 실제로 있습니다
                    (같은 이름 '테스트용' 2건). 기간까지 붙여 줍니다. */}
                <span className="text-xs text-ink-muted">
                  {r.settlementTitle}
                  <span className="ml-1 text-ink-hint">
                    {r.periodStart ?? "-"} ~ {r.periodEnd ?? "-"}
                  </span>
                </span>
                <span className="font-mono text-xs text-ink-muted">
                  실지급 {KRW(r.net)}원
                </span>
                <span className="ml-auto flex flex-wrap gap-1">
                  {r.blockers.map((b) => (
                    <span key={b} className={badgeDanger}>
                      {b}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 초록: 집계된 결과 */}
      <section className={panelToneCls("green")}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className={sectionTitleCls("green")}>
            {view === "source" ? "재원별 지출 내역" : "사람별 지출 내역"}
          </h3>
          <span className="text-xs text-ink-hint">
            {from || to ? `${from || "처음"} ~ ${to || "끝"}` : "전체 기간"}
          </span>
        </div>

        <Totals
          label="전체 합계"
          gross={totals.gross}
          deduction={totals.deduction}
          net={totals.net}
          people={totals.people}
          count={totals.rows}
        />

        {rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-hint">
            이 조건에 해당하는 지급 내역이 없습니다. 기간을 넓혀 보세요
            (위의 [전체 기간]).
          </p>
        ) : view === "source" ? (
          <div className="mt-4 space-y-5">
            {sources.map((s) => (
              <div key={s.settlementId}>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-bold text-ink">{s.title}</h4>
                  <span className={badgeNavy}>{s.projectName}</span>
                  <span className="text-xs text-ink-muted">
                    {s.periodStart ?? "-"} ~ {s.periodEnd ?? "-"}
                  </span>
                  <span className={s.status === "confirmed" ? badgeSuccess : badgeWarning}>
                    {s.status === "confirmed" ? "확정" : "작성중"}
                  </span>
                  {s.blockerCount > 0 && (
                    <span className={badgeDanger}>확인 필요 {s.blockerCount}건</span>
                  )}
                  <span className="ml-auto font-mono text-sm font-bold text-navy">
                    실지급 {KRW(s.net)}원
                  </span>
                </div>
                <PayoutTable rows={s.rows} showSource={false} />
                <p className="mt-1 text-right text-xs text-ink-muted">
                  {s.rows.length}명 · 총지급 {KRW(s.gross)} · 공제 {KRW(s.deduction)} ·{" "}
                  <span className="font-semibold text-ink">실지급 {KRW(s.net)}</span>
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse">
              <thead>
                <tr className={`${tableHeadCls} bg-surface`}>
                  <th className={th}>성명</th>
                  <th className={th}>은행</th>
                  <th className={th}>계좌번호</th>
                  <th className={th}>예금주</th>
                  <th className={thR}>총지급액</th>
                  <th className={thR}>공제액</th>
                  <th className={thR}>실지급액</th>
                  <th className={th}>재원 내역</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <PersonRow key={p.instructorId} person={p} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// 재원별 보기의 표 — 한 정산 안의 지급 대상자.
function PayoutTable({
  rows,
  showSource,
}: {
  rows: PayoutRow[];
  showSource: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] border-collapse">
        <thead>
          <tr className={`${tableHeadCls} bg-surface`}>
            <th className={th}>성명</th>
            <th className={th}>은행</th>
            <th className={th}>계좌번호</th>
            <th className={th}>예금주</th>
            <th className={thR}>총지급액</th>
            <th className={thR}>공제액</th>
            <th className={thR}>실지급액</th>
            {showSource && <th className={th}>재원</th>}
            <th className={th}>비고</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={tableRowCls}>
              <td className={`${td} font-medium text-ink`}>
                {r.name}
                {!r.hasRrn && (
                  <span className={`${badgeDanger} ml-1`}>주민번호 없음</span>
                )}
              </td>
              <td className={td}>
                {r.bankName ?? <span className={badgeDanger}>미등록</span>}
              </td>
              <td className={td}>
                <Account row={r} />
              </td>
              <td className={td}>
                {r.accountHolder ?? <span className={badgeDanger}>미등록</span>}
              </td>
              <td className={tdR}>{KRW(r.gross)}</td>
              <td className={tdR}>{KRW(r.deduction)}</td>
              <td className={`${tdR} font-bold text-ink`}>{KRW(r.net)}</td>
              {showSource && <td className={td}>{r.settlementTitle}</td>}
              <td className={td}>
                <RowFlags row={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// 사람별 보기의 한 줄 — 재원이 둘 이상이면 내역을 펼칠 수 있습니다.
function PersonRow({ person }: { person: PayoutPerson }) {
  const [open, setOpen] = useState(person.sources > 1);
  return (
    <>
      <tr className={tableRowCls}>
        <td className={`${td} font-medium text-ink`}>
          {person.name}
          {person.sources > 1 && (
            <span className={`${badgeNavy} ml-1`} title="여러 재원에서 지급됩니다">
              재원 {person.sources}
            </span>
          )}
          {person.blockers.length > 0 && (
            <span className={`${badgeDanger} ml-1`} title={person.blockers.join(", ")}>
              확인 필요
            </span>
          )}
        </td>
        <td className={td}>
          {person.bankName ?? <span className={badgeDanger}>미등록</span>}
        </td>
        <td className={td}>
          <Account row={person} />
        </td>
        <td className={td}>
          {person.accountHolder ?? <span className={badgeDanger}>미등록</span>}
        </td>
        <td className={tdR}>{KRW(person.gross)}</td>
        <td className={tdR}>{KRW(person.deduction)}</td>
        <td className={`${tdR} font-bold text-ink`}>{KRW(person.net)}</td>
        <td className={td}>
          {person.sources > 1 ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="text-xs font-semibold text-navy hover:underline"
            >
              재원 {person.sources}건 {open ? "접기 ▲" : "보기 ▼"}
            </button>
          ) : (
            <span className="text-xs text-ink-muted">
              {person.rows[0]?.settlementTitle}
            </span>
          )}
        </td>
      </tr>
      {open &&
        person.sources > 1 &&
        person.rows.map((r) => (
          <tr key={r.key} className={`${tableRowCls} bg-surface/50`}>
            <td className={`${td} pl-6 text-xs text-ink-muted`}>└ {r.settlementTitle}</td>
            <td className={td} colSpan={3}>
              <span className={badgeNeutral}>{r.projectName}</span>
              <span className="ml-2 text-xs text-ink-hint">
                {r.periodStart ?? "-"} ~ {r.periodEnd ?? "-"}
              </span>
            </td>
            <td className={`${tdR} text-xs`}>{KRW(r.gross)}</td>
            <td className={`${tdR} text-xs`}>{KRW(r.deduction)}</td>
            <td className={`${tdR} text-xs`}>{KRW(r.net)}</td>
            <td className={td}>
              <RowFlags row={r} />
            </td>
          </tr>
        ))}
    </>
  );
}
