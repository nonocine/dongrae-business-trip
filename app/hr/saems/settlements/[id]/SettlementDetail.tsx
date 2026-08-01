"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  recalcSettlement,
  confirmSettlement,
  unconfirmSettlement,
  deleteSettlement,
  adjustSettlementItem,
  type SettlementDetail as SettlementDetailData,
} from "@/app/hr/saems/settlementActions";
import {
  ProgramLine,
  AdjustControl,
} from "@/app/hr/saems/settlements/ProgramLine";
import { formatKRW } from "@/lib/saem";
import { deductionRateLabel, detailMethod } from "@/lib/settlement";
import { fmtKstDateTime } from "@/lib/datetime";
import {
  cardCls,
  btnPrimary,
  btnSecondary,
  btnDanger,
  badgeSuccess,
  badgeNeutral,
  badgeWarning,
  noticeError,
  noticeSuccess,
  noticeWarning,
} from "@/lib/ui";

const thCls = "px-2 py-2 text-left text-xs font-semibold text-navy whitespace-nowrap";
const tdCls = "px-2 py-2 align-top text-sm text-ink-body";
// 지급조서 다운로드(라우트) — next 페이지링크 규칙 회피용 상수.
const EXCEL_HREF = (id: string) => `/hr/saems/settlements/${id}/excel`;

export default function SettlementDetail({
  detail,
}: {
  detail: SettlementDetailData;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [askRecalc, setAskRecalc] = useState(false);
  const [pending, start] = useTransition();
  const isDraft = detail.status === "draft";

  // ST-5. 재계산 — 조정된 항목이 있으면 유지/초기화를 먼저 묻는다.
  function onRecalc() {
    if (detail.adjustedCount > 0) {
      setMsg(null);
      setAskRecalc(true);
      return;
    }
    doRecalc(false);
  }
  function doRecalc(keepAdjusted: boolean) {
    setAskRecalc(false);
    setMsg(null);
    start(async () => {
      const res = await recalcSettlement(detail.id, { keepAdjusted });
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      const extra = keepAdjusted
        ? ` 조정 ${res.kept}건 유지` +
          (res.adjustedLost > 0
            ? `, ${res.adjustedLost}건은 대상이 사라져 반영되지 않았습니다.`
            : ".")
        : detail.adjustedCount > 0
          ? ` 조정 ${detail.adjustedCount}건을 자동 계산으로 초기화했습니다.`
          : "";
      setMsg({
        ok: true,
        text: `재계산했습니다. (기간 내 확정 일지·등록 인원 반영)${extra}`,
      });
      router.refresh();
    });
  }

  function run(
    fn: () => Promise<{ ok: true } | { ok: false; message: string }>,
    okText: string,
    confirmText?: string
  ) {
    if (confirmText && !confirm(confirmText)) return;
    setMsg(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      setMsg({ ok: true, text: okText });
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <section className={cardCls}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-lg font-bold text-ink">
              {detail.title}
              <span className="ml-2 align-middle">
                {detail.status === "confirmed" ? (
                  <span className={badgeSuccess}>확정</span>
                ) : (
                  <span className={badgeNeutral}>작성중</span>
                )}
              </span>
            </h3>
            <p className="mt-1 text-sm text-ink-muted">
              {detail.projectName} · {detail.period_start ?? "?"} ~{" "}
              {detail.period_end ?? "?"}
            </p>
            {detail.status === "confirmed" && detail.confirmed_at && (
              <p className="mt-0.5 text-xs text-ink-hint">
                확정: {fmtKstDateTime(detail.confirmed_at)}
                {detail.confirmed_by ? ` · ${detail.confirmed_by}` : ""}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {isDraft ? (
              <>
                <button
                  type="button"
                  onClick={onRecalc}
                  disabled={pending}
                  className={btnSecondary}
                >
                  재계산
                  {detail.adjustedCount > 0 && (
                    <span className="ml-1 text-[10px] font-normal opacity-70">
                      (조정 {detail.adjustedCount})
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    run(
                      () => confirmSettlement(detail.id),
                      "확정했습니다.",
                      "정산을 확정할까요? 확정 후에는 묶인 근무일지가 잠깁니다."
                    )
                  }
                  disabled={pending}
                  className={btnPrimary}
                >
                  확정
                </button>
                <button
                  type="button"
                  onClick={() =>
                    run(
                      async () => {
                        const res = await deleteSettlement(detail.id);
                        if (res.ok) router.push("/hr/saems/settlements");
                        return res;
                      },
                      "삭제했습니다.",
                      "이 정산(작성중)을 삭제할까요? 묶인 세션은 해제됩니다."
                    )
                  }
                  disabled={pending}
                  className={btnDanger}
                >
                  삭제
                </button>
              </>
            ) : (
              <>
                <a href={EXCEL_HREF(detail.id)} className={btnPrimary}>
                  엑셀 다운로드
                </a>
                {detail.isM0 && (
                  <button
                    type="button"
                    onClick={() =>
                      run(
                        () => unconfirmSettlement(detail.id),
                        "확정을 취소했습니다. (묶인 세션 해제)",
                        "확정을 취소할까요? 묶인 세션이 해제되어 다시 정산 대상이 됩니다."
                      )
                    }
                    disabled={pending}
                    className={btnSecondary}
                  >
                    확정 취소
                  </button>
                )}
                {!detail.isM0 && (
                  // 회계로 넘어간 문서의 번복은 상위 승인 — 급여 확정취소와 같은 설계.
                  <span className="self-center text-xs text-ink-hint">
                    확정 취소는 관장·부장만 할 수 있습니다.
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        {msg && (
          <p className={`mt-3 ${msg.ok ? noticeSuccess : noticeError}`}>
            {msg.text}
          </p>
        )}

        {/* ST-5. 재계산 시 조정 유지/초기화 확인 */}
        {askRecalc && (
          <div className={`mt-3 ${noticeWarning}`}>
            <p className="font-semibold">
              담당자가 조정한 항목이 {detail.adjustedCount}건 있습니다.
            </p>
            <p className="mt-1 text-xs">
              <b>유지</b>하면 조정한 인원·금액을 다시 적용합니다(대상 프로그램이
              사라진 조정은 반영되지 않습니다). <b>초기화</b>하면 전부 자동 계산
              (등록 인원 × 수강료 × 비율)으로 되돌립니다.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => doRecalc(true)}
                className={btnPrimary}
              >
                조정 유지하고 재계산
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => doRecalc(false)}
                className={btnDanger}
              >
                초기화하고 재계산
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setAskRecalc(false)}
                className={btnSecondary}
              >
                취소
              </button>
            </div>
          </div>
        )}

        {isDraft && (
          <p className="mt-3 text-xs text-ink-hint">
            <b>시급제</b> 항목은 수동 조정하지 않습니다 — 금액이 틀리면
            근무일지(근무시간)를 고친 뒤 <b>재계산</b>하세요(단일 진실 원칙).
            <b> 수강료 분배제</b> 항목은 아래 [조정]으로 인원·금액을 직접 지정할 수
            있습니다.
          </p>
        )}
      </section>

      <section className={cardCls}>
        <h3 className="mb-3 text-base font-bold text-ink">
          강사별 내역 ({detail.items.length}명)
        </h3>
        {detail.items.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-hint">
            항목이 없습니다.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-sm">
              <thead className="bg-surface">
                <tr>
                  <th className={thCls}>강사</th>
                  <th className={thCls}>프로그램별 내역</th>
                  <th className={`${thCls} text-right`}>지급총액</th>
                  <th className={`${thCls} text-right`}>공제</th>
                  <th className={`${thCls} text-right`}>차인지급</th>
                </tr>
              </thead>
              <tbody>
                {detail.items.map((it) => (
                  <tr key={it.instructor_id} className="border-t border-line/60">
                    <td className={`${tdCls} font-medium text-ink`}>
                      {it.instructorName}
                      {it.adjusted && (
                        <span className={`ml-1.5 ${badgeWarning}`}>조정됨</span>
                      )}
                    </td>
                    <td className={tdCls}>
                      <ul className="space-y-1">
                        {it.detail.map((d, i) => (
                          <li key={d.program_id ?? i}>
                            <ProgramLine d={d} />
                            {/* 분배제만 조정 가능. 확정된 정산은 읽기 전용. */}
                            {isDraft && detailMethod(d) === "revenue_share" && (
                              <AdjustControl
                                d={d}
                                disabled={pending}
                                onApply={(enrolled, amount) =>
                                  run(
                                    () =>
                                      adjustSettlementItem({
                                        settlementId: detail.id,
                                        instructorId: it.instructor_id,
                                        programId: d.program_id ?? "",
                                        enrolled,
                                        amount,
                                      }),
                                    enrolled == null && amount == null
                                      ? "조정을 해제했습니다. (자동 계산)"
                                      : "조정을 반영했습니다."
                                  )
                                }
                              />
                            )}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className={`${tdCls} text-right`}>
                      {formatKRW(it.gross_amount)}
                    </td>
                    <td className={`${tdCls} text-right text-stamp`}>
                      -{formatKRW(it.deduction_amount)}
                      <span className="ml-1 text-[10px] text-ink-hint">
                        ({deductionRateLabel(it.detail, it.deduction_rate)}%)
                      </span>
                    </td>
                    <td className={`${tdCls} text-right font-semibold text-navy`}>
                      {formatKRW(it.net_amount)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-line bg-surface font-semibold">
                  <td className={tdCls} colSpan={2}>
                    합계
                  </td>
                  <td className={`${tdCls} text-right`}>
                    {formatKRW(detail.totalGross)}
                  </td>
                  <td className={`${tdCls} text-right text-stamp`}>
                    -{formatKRW(detail.totalDeduction)}
                  </td>
                  <td className={`${tdCls} text-right text-navy`}>
                    {formatKRW(detail.totalNet)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
