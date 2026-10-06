"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getEmployeeRecord, type EmployeeRecord } from "@/app/(app)/hr/discipline/actions";
import { AWARD_SOURCE_LABEL, DISCIPLINE_LABEL, fmtDotPlain } from "@/lib/hrDiscipline";
import { panelToneCls, sectionTitleCls, badgeDanger, badgeNavy, badgeNeutral, badgeSuccess, badgeWarning, noticeError, linkCls } from "@/lib/ui";

// =====================================================================
// 인사기록카드의 '상벌' 구역 — 관장·부장 화면에서만 그립니다(부모가 isM0 일 때만).
//   데이터는 마운트 후 M0 전용 액션으로 받습니다 — 인사 담당(hr 직무)이 여는
//   인사기록카드 페이로드에는 상벌이 실리지 않습니다. 액션도 M0 가 아니면 거부.
// =====================================================================

export default function DisciplineSummaryPanel({ driverId }: { driverId: string }) {
  const [record, setRecord] = useState<EmployeeRecord | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getEmployeeRecord(driverId).then((r) => {
      if (!alive) return;
      if (r.ok) setRecord(r.record);
      else setErr(r.message);
    });
    return () => {
      alive = false;
    };
  }, [driverId]);

  return (
    <section className={panelToneCls("red")} data-testid="profile-discipline">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={sectionTitleCls("red")}>상벌 (관장·부장만 보임)</h3>
        <Link href={`/hr/discipline?driver=${driverId}`} className={`text-sm ${linkCls}`}>
          상벌 관리에서 열기 →
        </Link>
      </div>
      {err && <p className={`mt-2 ${noticeError}`}>{err}</p>}
      {!record && !err && <p className="mt-2 text-xs text-ink-hint">불러오는 중…</p>}
      {record && (
        <>
          <div className="mt-2 flex flex-wrap gap-2">
            {record.promotionBlockUntil ? (
              <span className={badgeWarning}>{fmtDotPlain(record.promotionBlockUntil)}까지 승진제한</span>
            ) : (
              <span className={badgeNeutral}>승진제한 없음</span>
            )}
            {record.warnings.reached && <span className={badgeDanger}>경고 {record.warnings.count}회 — 견책 처리 검토 대상(운영규정 40조)</span>}
          </div>
          {record.timeline.length === 0 ? (
            <p className="mt-2 text-sm text-ink-hint">포상·징계 기록이 없습니다.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {record.timeline.slice(0, 8).map((t) =>
                t.type === "award" ? (
                  <li key={`a-${t.award.id}`}>
                    <span className="text-xs text-ink-muted">{fmtDotPlain(t.date)}</span> <span className={badgeSuccess}>{AWARD_SOURCE_LABEL[t.award.award_source]}</span>{" "}
                    {t.award.title}
                  </li>
                ) : (
                  <li key={`d-${t.discipline.id}`}>
                    <span className="text-xs text-ink-muted">{fmtDotPlain(t.date)}</span>{" "}
                    <span className={t.discipline.kind === "warning" ? badgeNavy : badgeDanger}>{DISCIPLINE_LABEL[t.discipline.kind]}</span>{" "}
                    {t.discipline.reason}
                  </li>
                )
              )}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
