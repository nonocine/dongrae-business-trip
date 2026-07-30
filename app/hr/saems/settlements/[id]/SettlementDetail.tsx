"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  recalcSettlement,
  confirmSettlement,
  unconfirmSettlement,
  deleteSettlement,
  type SettlementDetail as SettlementDetailData,
} from "@/app/hr/saems/settlementActions";
import { formatKRW } from "@/lib/saem";
import { fmtKstDateTime } from "@/lib/datetime";
import {
  cardCls,
  btnPrimary,
  btnSecondary,
  btnDanger,
  badgeSuccess,
  badgeNeutral,
  noticeError,
  noticeSuccess,
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
  const [pending, start] = useTransition();
  const isDraft = detail.status === "draft";

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
                  onClick={() =>
                    run(
                      () => recalcSettlement(detail.id),
                      "재계산했습니다. (기간 내 확정 일지 반영)"
                    )
                  }
                  disabled={pending}
                  className={btnSecondary}
                >
                  재계산
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
              </>
            )}
          </div>
        </div>

        {msg && (
          <p className={`mt-3 ${msg.ok ? noticeSuccess : noticeError}`}>
            {msg.text}
          </p>
        )}

        {isDraft && (
          <p className="mt-3 text-xs text-ink-hint">
            항목 수동 조정은 없습니다. 금액이 틀리면 근무일지(수강인원·근무시간)를
            고친 뒤 <b>재계산</b>하세요. (단일 진실 원칙)
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
                    </td>
                    <td className={tdCls}>
                      <ul className="space-y-0.5">
                        {it.detail.map((d, i) => (
                          <li key={i} className="text-xs text-ink-muted">
                            {d.program_name} · {d.sessions}회 · {d.hours}h ×{" "}
                            {formatKRW(d.rate)} = {formatKRW(d.amount)}
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
                        ({it.deduction_rate}%)
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
