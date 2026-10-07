"use client";

import { useEffect, useState, useTransition } from "react";
import {
  deleteClubExpense,
  getClubExpenses,
  updateClubExpense,
  type ClubExpenseData,
  type ClubExpenseRow,
} from "./actions";
import {
  badgeWarning,
  blockCls,
  btnDanger,
  btnPrimary,
  btnSecondary,
  inputCls,
  labelCls,
  noticeError,
  noticeSuccess,
  tableHeadCls,
  tableRowCls,
} from "@/lib/ui";

// =====================================================================
// 동아리 예산 '집행' 내역 — 수정·삭제 (2026-10, 김준호 선생님 요청)
//
//   ★ 실제로 쓴 돈(saem_club_expenses)입니다. 계획(예산 사용 계획)은 계획서
//     편집기에서 따로 관리합니다 — 여기서는 합계 비교용으로만 보여줍니다.
//   ★ 직원이면 누구나 고칠 수 있습니다(담당 교체·대신 처리). 그래서 각 건에
//     최초 입력자를 보여 줍니다. 수정해도 입력자는 바뀌지 않습니다.
//   ★ 월간보고가 확정된 달의 건은 확인란을 거쳐야 고치거나 지울 수 있습니다
//     (확정된 보고의 집행 합계는 그대로 남기 때문).
// =====================================================================

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const CATEGORIES = ["사업비", "운영비"]; // 동래샘들 계획서와 같은 구분
const DEFAULT_FUNDING = "동래구동아리지원사업비";

function fmtStamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function ClubExpenseEditor({
  programId,
  year,
  reloadToken,
  onChanged,
}: {
  programId: string;
  year: number;
  // 위 '활동·예산 추가' 에서 새 건을 넣으면 부모가 값을 올려 다시 읽게 합니다.
  reloadToken: number;
  // 고치거나 지운 뒤 대시보드·계획서 합계를 새로 읽게 부모에게 알립니다.
  onChanged: () => void;
}) {
  const [data, setData] = useState<ClubExpenseData | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [editId, setEditId] = useState<string | null>(null);
  const [fDate, setFDate] = useState("");
  const [fFunding, setFFunding] = useState("");
  const [fCategory, setFCategory] = useState("");
  const [fDescription, setFDescription] = useState("");
  const [fAmount, setFAmount] = useState("");
  const [fConfirmReport, setFConfirmReport] = useState(false);

  const key = `${programId}|${year}`;

  useEffect(() => {
    let alive = true;
    getClubExpenses(programId, year).then((d) => {
      if (!alive) return;
      setData(d);
      setLoadedFor(`${programId}|${year}`);
    });
    return () => {
      alive = false;
    };
  }, [programId, year, reloadToken]);

  async function load() {
    setData(await getClubExpenses(programId, year));
    setLoadedFor(key);
  }

  function openEdit(r: ClubExpenseRow) {
    setMsg(null);
    setEditId(r.id);
    setFDate(r.date);
    setFFunding(r.fundingSource);
    setFCategory(r.budgetCategory);
    setFDescription(r.description);
    setFAmount(String(r.amount));
    setFConfirmReport(false);
  }

  function after(text: string) {
    return async () => {
      setEditId(null);
      await load();
      onChanged();
      setMsg({ ok: true, text });
    };
  }

  function save(r: ClubExpenseRow) {
    setMsg(null);
    start(async () => {
      const result = await updateClubExpense({
        id: r.id,
        date: fDate,
        fundingSource: fFunding,
        budgetCategory: fCategory,
        description: fDescription,
        amount: Number(fAmount),
        confirmReport: fConfirmReport,
      });
      if (!result.ok) {
        setMsg({ ok: false, text: result.message ?? "수정하지 못했습니다." });
        return;
      }
      await after("집행 내역을 수정했습니다.")();
    });
  }

  function remove(r: ClubExpenseRow) {
    const lines = [
      "이 집행 내역을 삭제할까요? 되돌릴 수 없습니다.",
      "",
      `${r.date} · ${r.budgetCategory} · ${r.description} · ${won(r.amount)}`,
      `입력: ${r.createdBy || "기록 없음"}`,
    ];
    if (r.monthReportConfirmed)
      lines.push(
        "",
        "⚠ 월간보고가 확정된 달입니다. 지워도 확정된 보고의 집행 합계는 그대로 남습니다."
      );
    if (!window.confirm(lines.join("\n"))) return;
    setMsg(null);
    start(async () => {
      const result = await deleteClubExpense({
        id: r.id,
        confirmReport: r.monthReportConfirmed,
      });
      if (!result.ok) {
        setMsg({ ok: false, text: result.message ?? "삭제하지 못했습니다." });
        return;
      }
      await after("집행 내역을 삭제했습니다.")();
    });
  }

  if (loadedFor !== key) {
    return (
      <p className="py-6 text-center text-sm text-ink-hint">
        집행 내역을 불러오는 중…
      </p>
    );
  }
  if (!data) {
    return (
      <p className="py-6 text-center text-sm text-ink-muted">
        집행 내역을 불러오지 못했습니다.
      </p>
    );
  }

  const balance = data.planTotal - data.expenseTotal;

  return (
    <div className="space-y-3">
      {/* 계획서의 '계획 대비 실적' 과 같은 쿼리·같은 숫자입니다. */}
      <dl className={`${blockCls} grid grid-cols-3 gap-2 text-sm`}>
        <div>
          <dt className="text-xs text-ink-hint">계획 합계</dt>
          <dd className="font-semibold text-ink">{won(data.planTotal)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-hint">사용 합계</dt>
          <dd className="font-semibold text-ink">{won(data.expenseTotal)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-hint">잔액</dt>
          <dd className={`font-semibold ${balance < 0 ? "text-stamp" : "text-ink"}`}>
            {won(balance)}
          </dd>
        </div>
      </dl>

      {msg && <p className={msg.ok ? noticeSuccess : noticeError}>{msg.text}</p>}

      {data.rows.length === 0 ? (
        <p className="text-xs text-ink-muted">
          {data.year}년 집행 내역이 없습니다. 위 &lsquo;활동·예산 추가&rsquo; 에서
          등록합니다.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className={tableHeadCls}>
                <th className="py-1.5 pr-2 font-medium">집행일</th>
                <th className="py-1.5 pr-2 font-medium">재원</th>
                <th className="py-1.5 pr-2 font-medium">구분</th>
                <th className="py-1.5 pr-2 font-medium">내역</th>
                <th className="py-1.5 pr-2 text-right font-medium">금액</th>
                <th className="py-1.5 pr-2 font-medium">입력</th>
                <th className="py-1.5 font-medium">관리</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) =>
                editId === r.id ? (
                  <tr key={r.id} className={tableRowCls}>
                    <td colSpan={7} className="py-2">
                      <div className={`${blockCls} space-y-2`}>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <label className={labelCls}>
                            집행일
                            <input
                              type="date"
                              value={fDate}
                              onChange={(e) => setFDate(e.target.value)}
                              className={inputCls}
                            />
                          </label>
                          <label className={labelCls}>
                            재원
                            <input
                              value={fFunding}
                              onChange={(e) => setFFunding(e.target.value)}
                              placeholder={DEFAULT_FUNDING}
                              className={inputCls}
                            />
                          </label>
                          <label className={labelCls}>
                            구분
                            <input
                              list={`expense-cat-${programId}`}
                              value={fCategory}
                              onChange={(e) => setFCategory(e.target.value)}
                              placeholder="사업비"
                              className={inputCls}
                            />
                            <datalist id={`expense-cat-${programId}`}>
                              {CATEGORIES.map((c) => (
                                <option key={c} value={c} />
                              ))}
                            </datalist>
                          </label>
                          <label className={`${labelCls} sm:col-span-2`}>
                            내역
                            <input
                              value={fDescription}
                              onChange={(e) => setFDescription(e.target.value)}
                              className={inputCls}
                            />
                          </label>
                          <label className={labelCls}>
                            금액(원)
                            <input
                              type="number"
                              min={0}
                              step={1}
                              value={fAmount}
                              onChange={(e) => setFAmount(e.target.value)}
                              className={inputCls}
                            />
                          </label>
                        </div>
                        <p className="text-[11px] text-ink-hint">
                          최초 입력: {r.createdBy || "기록 없음"} ({fmtStamp(r.createdAt)}) —
                          수정해도 입력자는 바뀌지 않습니다.
                        </p>
                        {r.monthReportConfirmed ? (
                          <label className="flex items-start gap-2 text-xs text-stamp">
                            <input
                              type="checkbox"
                              checked={fConfirmReport}
                              onChange={(e) => setFConfirmReport(e.target.checked)}
                              className="mt-0.5"
                            />
                            월간보고가 확정된 달입니다. 고쳐도 확정된 보고의 집행
                            합계는 그대로 남습니다 — 확인했습니다.
                          </label>
                        ) : null}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => save(r)}
                            className={btnPrimary}
                          >
                            저장
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditId(null)}
                            className={btnSecondary}
                          >
                            취소
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id} className={`${tableRowCls} align-top`}>
                    <td className="py-2 pr-2 text-ink-body">
                      {r.date}
                      {r.monthReportConfirmed ? (
                        <span className={`${badgeWarning} mt-0.5 block w-fit`}>
                          월간보고 확정
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-2 text-xs text-ink-muted">
                      {r.fundingSource || "-"}
                    </td>
                    <td className="py-2 pr-2 text-ink-body">{r.budgetCategory || "-"}</td>
                    <td className="py-2 pr-2 text-ink-body">{r.description}</td>
                    <td className="py-2 pr-2 text-right text-ink-body">{won(r.amount)}</td>
                    <td className="py-2 pr-2 text-xs text-ink-muted">
                      {r.createdBy || "기록 없음"}
                      <span className="block text-[11px] text-ink-hint">
                        {fmtStamp(r.createdAt)}
                      </span>
                      {r.updatedAt ? (
                        <span className="block text-[11px] text-ink-hint">
                          수정 {fmtStamp(r.updatedAt)}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2">
                      <div className="flex gap-1">
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => openEdit(r)}
                          className={btnSecondary}
                        >
                          수정
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => remove(r)}
                          className={btnDanger}
                        >
                          삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              )}
              <tr className="font-semibold text-ink">
                <td className="py-2 pr-2" colSpan={4}>
                  합계 ({data.rows.length}건)
                </td>
                <td className="py-2 pr-2 text-right">{won(data.expenseTotal)}</td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
