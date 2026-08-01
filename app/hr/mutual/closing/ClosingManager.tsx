"use client";

// =====================================================================
// MU-4. 연마감 탭 — 연도 엑셀 다운로드 + 과거 장부 업로드(미리보기→적용)
// =====================================================================

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getClosingSummary,
  previewMutualImport,
  applyMutualImport,
  clearMutualYear,
  type ClosingYear,
  type ImportPreviewResult,
} from "@/app/hr/mutual/importActions";
import { formatKRW } from "@/lib/mutual";
import {
  cardCls,
  btnPrimary,
  btnSecondary,
  btnDanger,
  badgeSuccess,
  badgeDanger,
  badgeWarning,
  badgeNeutral,
  noticeError,
  noticeSuccess,
  noticeWarning,
} from "@/lib/ui";

const thCls = "px-2 py-1.5 text-left text-xs font-semibold text-navy whitespace-nowrap";
const tdCls = "px-2 py-1.5 align-middle text-sm text-ink-body whitespace-nowrap";

const EXCEL_HREF = (year: number) => `/hr/mutual/excel?year=${year}`;

// 파일 → base64(급여 EDI·명단 업로드와 동일 방식).
async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk)
    bin += String.fromCharCode(...buf.subarray(i, i + chunk));
  return btoa(bin);
}

export default function ClosingManager({
  initial,
}: {
  initial: { years: ClosingYear[]; isM0: boolean };
}) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [file, setFile] = useState<File | null>(null);
  const [base64, setBase64] = useState("");
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [showSkipped, setShowSkipped] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  async function reload() {
    setData(await getClosingSummary());
  }

  function onFile(f: File | null) {
    setFile(f);
    setBase64("");
    setPreview(null);
    setPicked(new Set());
    setMsg(null);
  }

  function doPreview() {
    if (!file) return setMsg({ ok: false, text: "엑셀 파일을 선택하세요." });
    setMsg(null);
    start(async () => {
      const b64 = await fileToBase64(file);
      setBase64(b64);
      const res = await previewMutualImport({ base64: b64 });
      if (!res.ok) {
        setPreview(null);
        return setMsg({ ok: false, text: res.message });
      }
      setPreview(res);
      // 기본 선택 = 가장 최근 연속 구간 중 아직 장부에 없는 연도.
      const lastRun = res.runs[res.runs.length - 1];
      setPicked(
        new Set(
          res.sheets
            .filter(
              (s) =>
                s.existingRows === 0 &&
                lastRun &&
                s.year >= lastRun.from &&
                s.year <= lastRun.to
            )
            .map((s) => s.year)
        )
      );
    });
  }

  function toggleYear(y: number) {
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(y)) n.delete(y);
      else n.add(y);
      return n;
    });
  }

  // 선택이 여러 구간에 걸치면 뒤 구간 잔액이 어긋난다(연도 공백 때문).
  const runsTouched =
    preview?.ok && picked.size > 0
      ? preview.runs.filter((r) =>
          [...picked].some((y) => y >= r.from && y <= r.to)
        )
      : [];
  const spanning = runsTouched.length > 1;

  function doApply() {
    if (!preview?.ok || picked.size === 0) return;
    const years = [...picked].sort((a, b) => a - b);
    if (
      !confirm(
        `${years.join(", ")}년 장부를 이관합니다. 계속할까요?${
          spanning ? "\n\n※ 선택이 끊긴 구간에 걸쳐 있어 뒤 구간 잔액이 시트와 달라집니다." : ""
        }`
      )
    )
      return;
    setMsg(null);
    start(async () => {
      const res = await applyMutualImport({ base64, years });
      if (!res.ok) return setMsg({ ok: false, text: res.message });
      const parts = [`${res.years.join(", ")}년 ${res.inserted}행`];
      if (res.carryOversAdded > 0) parts.push(`이월금 ${res.carryOversAdded}행`);
      if (res.skippedRows > 0) parts.push(`건너뜀 ${res.skippedRows}행`);
      setMsg({
        ok: true,
        text: `이관했습니다. (${parts.join(" · ")})${
          res.rangeWarning ? ` ⚠ ${res.rangeWarning}` : ""
        }`,
      });
      setPreview(null);
      setFile(null);
      setBase64("");
      await reload();
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {/* 연도별 요약 + 엑셀 다운로드 */}
      <section className={cardCls}>
        <h3 className="mb-1 text-sm font-bold text-ink">연도별 장부</h3>
        <p className="mb-3 text-xs text-ink-hint">
          엑셀은 기존 양식(세입 2열 | 세출 3열 | 우측 회원명단·퇴사자)으로
          내려갑니다. 장부는 이월을 세입과 분리해 그 연도 이전 전체 순액으로
          계산하고, 엑셀에는 원본처럼 <b>이월금</b>을 세입 첫 행으로 되살려
          합계가 기존 시트와 같아집니다.
        </p>
        {data.years.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-hint">
            기입된 장부가 없습니다. 아래에서 과거 장부를 이관하거나 [장부] 탭에서
            직접 기입하세요.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th className={thCls}>연도</th>
                  <th className={`${thCls} text-right`}>건수</th>
                  <th className={`${thCls} text-right`}>이월</th>
                  <th className={`${thCls} text-right`}>세입</th>
                  <th className={`${thCls} text-right`}>세출</th>
                  <th className={`${thCls} text-right`}>잔액</th>
                  <th className={`${thCls} text-right`}>관리</th>
                </tr>
              </thead>
              <tbody>
                {data.years.map((y) => (
                  <tr key={y.year} className="border-b border-line/60">
                    <td className={`${tdCls} font-medium text-ink`}>{y.year}년</td>
                    <td className={`${tdCls} text-right`}>{y.rows}</td>
                    <td className={`${tdCls} text-right font-mono text-xs`}>
                      {formatKRW(y.carryOver)}
                    </td>
                    <td className={`${tdCls} text-right font-mono text-navy`}>
                      {formatKRW(y.income)}
                    </td>
                    <td className={`${tdCls} text-right font-mono text-stamp`}>
                      {formatKRW(y.expense)}
                    </td>
                    <td className={`${tdCls} text-right font-mono font-bold`}>
                      {formatKRW(y.balance)}
                    </td>
                    <td className={`${tdCls} text-right`}>
                      <div className="flex justify-end gap-1">
                        <a
                          href={EXCEL_HREF(y.year)}
                          className="rounded border border-line px-2 py-1 text-xs text-navy hover:bg-surface"
                        >
                          엑셀
                        </a>
                        {data.isM0 && (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => {
                              if (
                                !confirm(
                                  `${y.year}년 장부 ${y.rows}행을 모두 삭제할까요? (되돌릴 수 없습니다)`
                                )
                              )
                                return;
                              setMsg(null);
                              start(async () => {
                                const res = await clearMutualYear(y.year);
                                if (!res.ok)
                                  return setMsg({ ok: false, text: res.message });
                                setMsg({
                                  ok: true,
                                  text: `${y.year}년 ${res.deleted}행을 삭제했습니다.`,
                                });
                                await reload();
                                router.refresh();
                              });
                            }}
                            className="rounded border border-stamp px-2 py-1 text-xs text-stamp hover:bg-stamp-soft"
                            title="이관을 잘못했을 때 되돌리는 수단(관장·부장 전용)"
                          >
                            연도 삭제
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {msg && <p className={msg.ok ? noticeSuccess : noticeError}>{msg.text}</p>}

      {/* 과거 장부 업로드 */}
      <section className={cardCls}>
        <h3 className="mb-1 text-sm font-bold text-ink">과거 장부 이관</h3>
        <p className="mb-3 text-xs text-ink-hint">
          연도별 시트가 있는 기존 엑셀(&apos;세 입&apos;/&apos;세 출&apos; 구조)을
          올리면 연도별 건수·합계·잔액을 시트값과 대조해 보여 줍니다. 확인 후
          선택한 연도만 적용됩니다. 읽지 못한 행은 목록으로 보여 주고 건너뜁니다.
        </p>

        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1">
            <label className="block text-[11px] font-semibold text-navy">
              엑셀 파일
            </label>
            <input
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-ink-body file:mr-2 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-ink-body"
            />
          </div>
          <button
            type="button"
            onClick={doPreview}
            disabled={pending || !file}
            className={btnSecondary}
          >
            미리보기
          </button>
        </div>

        {preview?.ok && (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-line bg-surface/60 px-3 py-2 text-xs text-ink-body">
              시트 {preview.sheets.length}개 · 이관 대상 {preview.totalRows}행
              {preview.inferredDates > 0 && (
                <> · 날짜 추정 {preview.inferredDates}행</>
              )}
              {preview.skipped.length > 0 && (
                <> · 건너뜀 {preview.skipped.length}행</>
              )}
              {preview.runs.length > 1 && (
                <>
                  {" "}
                  · 연속 구간{" "}
                  {preview.runs
                    .map((r) => (r.from === r.to ? `${r.from}` : `${r.from}~${r.to}`))
                    .join(", ")}
                </>
              )}
            </div>

            {preview.warnings.length > 0 && (
              <div className={noticeWarning}>
                <ul className="list-inside list-disc space-y-0.5">
                  {preview.warnings.slice(0, 6).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* 연도별 대조표 */}
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[900px] border-collapse">
                <thead className="bg-surface">
                  <tr>
                    <th className={`${thCls} w-8`}></th>
                    <th className={thCls}>연도</th>
                    <th className={`${thCls} text-right`}>행</th>
                    <th className={`${thCls} text-right`}>세입(시트→파싱)</th>
                    <th className={`${thCls} text-right`}>세출(시트→파싱)</th>
                    <th className={`${thCls} text-right`}>잔액(시트→파싱)</th>
                    <th className={thCls}>이월금</th>
                    <th className={thCls}>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sheets.map((s) => {
                    const allMatch =
                      s.incomeMatches && s.expenseMatches && s.balanceMatches;
                    return (
                      <tr key={s.year} className="border-t border-line/60">
                        <td className={tdCls}>
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            disabled={s.existingRows > 0}
                            checked={picked.has(s.year)}
                            onChange={() => toggleYear(s.year)}
                            aria-label={`${s.year}년 선택`}
                          />
                        </td>
                        <td className={`${tdCls} font-medium text-ink`}>
                          {s.year}년
                          <span className="ml-1 text-[10px] text-ink-hint">
                            머리글 {s.headerRow}행
                          </span>
                        </td>
                        <td className={`${tdCls} text-right`}>
                          {s.incomeRows + s.expenseRows}
                        </td>
                        <Compare
                          sheet={s.sheetIncomeTotal}
                          parsed={s.parsedIncome}
                          ok={s.incomeMatches}
                        />
                        <Compare
                          sheet={s.sheetExpenseTotal}
                          parsed={s.parsedExpense}
                          ok={s.expenseMatches}
                        />
                        <Compare
                          sheet={s.sheetBalance}
                          parsed={s.parsedNet}
                          ok={s.balanceMatches}
                        />
                        <td className={`${tdCls} text-xs`}>
                          {s.carryOverAmount == null ? (
                            <span className="text-ink-hint">없음</span>
                          ) : s.carryOverIncluded ? (
                            <span className={badgeSuccess} title={s.carryOverReason ?? ""}>
                              기입 {formatKRW(s.carryOverAmount)}
                            </span>
                          ) : (
                            <span className={badgeNeutral} title={s.carryOverReason ?? ""}>
                              자동 계산
                            </span>
                          )}
                        </td>
                        <td className={tdCls}>
                          {s.existingRows > 0 ? (
                            <span
                              className={badgeWarning}
                              title="이미 장부에 있는 연도는 덮지 않습니다."
                            >
                              장부에 {s.existingRows}행 있음
                            </span>
                          ) : allMatch ? (
                            <span className={badgeSuccess}>합계 일치</span>
                          ) : (
                            <span className={badgeDanger}>합계 불일치</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {spanning && (
              <p className={noticeWarning}>
                선택한 연도가 {runsTouched.length}개 구간에 걸쳐 있습니다. 사이 연도
                자료가 없어 앞 구간 잔액이 뒤 구간에 더해집니다 — 시트에 적힌 잔액과
                맞추려면 한 구간만 고르세요.
              </p>
            )}

            {/* 사유 분포 — 분류가 엉뚱하지 않은지 눈으로 확인 */}
            {preview.categoryBreakdown.length > 0 && (
              <div className="rounded-lg border border-line px-3 py-2">
                <p className="mb-1 text-[11px] font-semibold text-navy">
                  사유별 분포(자동 분류)
                </p>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-muted">
                  {preview.categoryBreakdown.map((c) => (
                    <span key={c.label}>
                      {c.label} {c.count}건 · {formatKRW(c.amount)}원
                    </span>
                  ))}
                </div>
                <p className="mt-1 text-[10px] text-ink-hint">
                  적요 원문은 그대로 저장되므로, 분류가 애매한 건은 기타로 두었습니다.
                </p>
              </div>
            )}

            {/* 건너뛴 행 */}
            {preview.skipped.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowSkipped((v) => !v)}
                  className="text-[11px] font-semibold text-ink-muted hover:underline"
                >
                  읽지 못한 행 {preview.skipped.length}건{" "}
                  {showSkipped ? "접기 ▲" : "보기 ▼"}
                </button>
                {showSkipped && (
                  <ul className="mt-1 space-y-0.5 text-[11px] text-ink-hint">
                    {preview.skipped.map((s, i) => (
                      <li key={i}>
                        {s.sheet} {s.row}행 [{s.side === "income" ? "세입" : "세출"}]{" "}
                        {s.text} → {s.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <p className="text-xs text-ink-muted">
                선택 {picked.size}개 연도
              </p>
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  className={btnSecondary}
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={doApply}
                  disabled={pending || picked.size === 0}
                  className={spanning ? btnDanger : btnPrimary}
                >
                  {pending ? "이관 중…" : "적용"}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// 시트값 → 파싱값 비교 칸. 다르면 붉게 둘 다 보여 준다.
function Compare({
  sheet,
  parsed,
  ok,
}: {
  sheet: number | null;
  parsed: number;
  ok: boolean;
}) {
  return (
    <td className={`${tdCls} text-right font-mono text-xs`}>
      {ok ? (
        <span>{formatKRW(parsed)}</span>
      ) : (
        <span className="text-stamp">
          {sheet == null ? "?" : formatKRW(sheet)} → {formatKRW(parsed)}
        </span>
      )}
    </td>
  );
}
