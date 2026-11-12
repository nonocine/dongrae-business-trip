"use client";

import { useState } from "react";
import { fmtKstDateTime } from "@/lib/datetime";
import type { SmsLogRow, SmsResultSummary } from "@/lib/sms/text";
import { badgeDanger, badgeNeutral, badgeSuccess, badgeWarning, btnSecondary, tableHeadCls, tableRowCls } from "@/lib/ui";
import { stepBox } from "./ui";

type ResultState = { loading: boolean; summary?: SmsResultSummary };

// 발송 이력(최근 50건) — 전 직원이 같은 목록. 본문 전체는 보낸 사람·관장·부장만(서버가 자름).
export default function SmsHistory({ logs }: { logs: SmsLogRow[] }) {
  const [results, setResults] = useState<Record<string, ResultState>>({});

  async function checkResult(row: SmsLogRow) {
    if (!row.provider_msg_id) return;
    setResults((p) => ({ ...p, [row.id]: { loading: true } }));
    let summary: SmsResultSummary;
    try {
      const r = await fetch(`/api/sms/result/${encodeURIComponent(row.provider_msg_id)}`, { cache: "no-store" });
      const d = (await r.json().catch(() => ({ ok: false, error: `조회 실패(${r.status})` }))) as Partial<SmsResultSummary>;
      summary = { ok: d.ok === true, sent: d.sent ?? 0, failed: d.failed ?? 0, pending: d.pending ?? 0, error: d.error };
    } catch {
      summary = { ok: false, sent: 0, failed: 0, pending: 0, error: "조회 실패" };
    }
    setResults((p) => ({ ...p, [row.id]: { loading: false, summary } }));
  }

  return (
    // id — 관리자 대시보드 문자 카드가 /sms#sms-history 로 바로 여기로 옵니다.
    <section id="sms-history" className={`${stepBox} scroll-mt-4`}>
      <h3 className="text-base font-bold text-ink">발송 이력 (최근 50건)</h3>
      <p className="mb-3 mt-1 text-xs text-ink-muted">
        전 직원이 같은 이력을 봅니다. 본문 전체는 보낸 사람·관장·부장만, 다른 직원에게는 앞 20자만 보입니다.
        [결과 조회]는 그 시점의 성공·실패 수이고, 최종 확정은 발송 24시간 뒤입니다.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className={tableHeadCls}>
              <th className="px-2 py-2 text-left">일시</th>
              <th className="px-2 py-2 text-left">보낸 사람</th>
              <th className="px-2 py-2 text-left">대상</th>
              <th className="px-2 py-2 text-left">본문</th>
              <th className="px-2 py-2 text-right">인원</th>
              <th className="px-2 py-2 text-left">유형</th>
              <th className="px-2 py-2 text-left">결과</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr>
                <td colSpan={8} className="px-2 py-4 text-center text-ink-muted">
                  아직 보낸 문자가 없습니다.
                </td>
              </tr>
            )}
            {logs.map((row) => {
              const rs = results[row.id];
              const s = rs?.summary;
              return (
                <tr key={row.id} className={tableRowCls}>
                  <td className="whitespace-nowrap px-2 py-1.5">{fmtKstDateTime(row.created_at)}</td>
                  <td className="px-2 py-1.5">{row.sender_name ?? "-"}</td>
                  <td className="px-2 py-1.5">{row.audience_desc ?? "-"}</td>
                  <td className="max-w-[18rem] px-2 py-1.5">
                    <span
                      className="whitespace-pre-wrap break-words text-xs text-ink-body"
                      title={row.text_truncated ? "본문 전체는 보낸 사람·관장·부장만 볼 수 있습니다." : undefined}
                    >
                      {row.text_body || "-"}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right">{row.recipient_count}</td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    {row.msg_type ?? "-"} {row.is_test && <span className={badgeNeutral}>점검</span>}
                    {row.program === "self" && <span className={badgeWarning}>본인 확인용</span>}
                  </td>
                  <td className="px-2 py-1.5">
                    {!row.ok ? (
                      <span className={badgeDanger} title={row.error ?? ""}>
                        실패{row.error ? ` · ${row.error}` : ""}
                      </span>
                    ) : s ? (
                      s.ok ? (
                        <span className={badgeSuccess}>
                          성공 {s.sent} · 실패 {s.failed}
                          {s.pending > 0 ? ` · 대기 ${s.pending}` : ""}
                        </span>
                      ) : (
                        <span className={badgeDanger}>{s.error ?? "조회 실패"}</span>
                      )
                    ) : (
                      <span className={row.error ? badgeWarning : badgeSuccess} title={row.error ?? ""}>
                        성공 {row.sent_count ?? 0} · 실패 {row.failed_count ?? 0}
                        {row.error ? " · 일부 실패" : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {row.provider_msg_id && (
                      <button type="button" className={btnSecondary} disabled={rs?.loading} onClick={() => checkResult(row)}>
                        {rs?.loading ? "조회 중…" : "결과 조회"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
