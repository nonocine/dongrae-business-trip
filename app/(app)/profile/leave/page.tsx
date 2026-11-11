import Link from "next/link";
import { redirect } from "next/navigation";
import { enforcePasswordChange } from "@/app/actions";
import {
  employedErpNames,
  erpLastSyncedAt,
  leaveBalancesOf,
  loadDutiesOverlapping,
  resolveErpViewer,
} from "@/lib/erp/view";
import { dayLabel, dutyDisplayType, dutyTimeText, kstTodayYmd, kstYmdOf, monthRange, FIELD_TYPES } from "@/lib/erp/duty";
import ErpNote from "@/app/components/ErpNote";
import { badgeNeutral, badgeWarning, cardCls, noticeWarning } from "@/lib/ui";

export const dynamic = "force-dynamic";

// =====================================================================
// 내 연차·대휴 — 본인: ERP 연차·대휴 잔여 + 이번 달 내 복무.
//   ERP 계정(employee_profiles.erp_employee_id)이 연결 안 됐으면 안내만.
//   관장(M0): 재직자 전체 잔여 표를 함께.
// =====================================================================

const days = (v: number | null | undefined) =>
  v == null ? "-" : `${Number.isInteger(v) ? v : Number(v).toFixed(1)}일`;

export default async function MyLeavePage() {
  await enforcePasswordChange();
  const viewer = await resolveErpViewer();
  if (!viewer) redirect("/");

  const today = kstTodayYmd();
  const month = monthRange(today);
  const [syncedLeave, syncedDuties] = await Promise.all([erpLastSyncedAt("leaveBalances"), erpLastSyncedAt("duties")]);

  const mine = viewer.erpEmployeeId ? (await leaveBalancesOf([viewer.erpEmployeeId])).get(viewer.erpEmployeeId) ?? null : null;
  const myDuties = viewer.erpEmployeeId
    ? await loadDutiesOverlapping(month.start, month.end, { employeeId: viewer.erpEmployeeId })
    : [];

  // 관장 — 재직자 전체.
  let all: { id: string; name: string; annual: number | null; compensatory: number | null }[] = [];
  if (viewer.isM0) {
    const names = await employedErpNames();
    const bal = await leaveBalancesOf([...names.keys()]);
    all = [...names]
      .map(([id, name]) => ({ id, name, annual: bal.get(id)?.annual ?? null, compensatory: bal.get(id)?.compensatory ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-ink">내 연차·대휴</h2>
        <Link href="/" className="text-sm text-ink-muted hover:underline">
          ← 메인
        </Link>
      </div>

      <section className={cardCls}>
        {!viewer.erpEmployeeId ? (
          <p className={noticeWarning}>ERP 계정 연결이 필요합니다(관리자 문의).</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-line bg-surface/60 px-3 py-3">
                <p className="text-xs text-ink-muted">연차 잔여</p>
                <p className="mt-0.5 font-mono text-2xl font-bold text-navy">{days(mine?.annual)}</p>
              </div>
              <div className="rounded-lg border border-line bg-surface/60 px-3 py-3">
                <p className="text-xs text-ink-muted">대휴 잔여</p>
                <p className="mt-0.5 font-mono text-2xl font-bold text-navy">{days(mine?.compensatory)}</p>
              </div>
            </div>
            {!mine && <p className="mt-2 text-xs text-ink-hint">ERP 에 잔여 정보가 아직 없습니다.</p>}
          </>
        )}
        <ErpNote syncedAt={syncedLeave} className="mt-3" />
      </section>

      {viewer.erpEmployeeId && (
        <section className={cardCls}>
          <h3 className="mb-2 text-sm font-bold text-ink">
            이번 달 내 복무 <span className="text-xs font-normal text-ink-muted">({month.start.slice(0, 7)})</span>
          </h3>
          {myDuties.length === 0 ? (
            <p className="text-xs text-ink-hint">이번 달 복무 기록이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-line/60">
              {myDuties.map((d) => (
                <li key={d.duty_id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                  <span className="w-20 shrink-0 text-xs text-ink-muted">{d.start_at ? dayLabel(kstYmdOf(d.start_at)) : "-"}</span>
                  {/* 본인 기록이라 원래 유형 그대로 */}
                  <span className={badgeNeutral}>{dutyDisplayType(d.type_name, d.declared_amount, true)}</span>
                  <span className="text-xs text-ink-muted">{dutyTimeText(d.start_at, d.end_at)}</span>
                  {FIELD_TYPES.has((d.type_name ?? "").trim()) && d.location && (
                    <span className="text-xs text-ink-body">· {d.location}</span>
                  )}
                  {d.process_code === 1 && <span className={badgeWarning}>결재 중</span>}
                </li>
              ))}
            </ul>
          )}
          <ErpNote syncedAt={syncedDuties} className="mt-3" />
        </section>
      )}

      {viewer.isM0 && (
        <section className={cardCls}>
          <h3 className="mb-2 text-sm font-bold text-ink">
            재직자 연차·대휴 잔여 <span className="text-xs font-normal text-ink-muted">(관장 전용 · {all.length}명)</span>
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-navy">
                  <th className="px-2 py-1.5 text-left font-semibold">이름</th>
                  <th className="px-2 py-1.5 text-right font-semibold">연차 잔여</th>
                  <th className="px-2 py-1.5 text-right font-semibold">대휴 잔여</th>
                </tr>
              </thead>
              <tbody>
                {all.map((r) => (
                  <tr key={r.id} className="border-b border-line/60">
                    <td className="px-2 py-1.5 text-ink">{r.name}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{days(r.annual)}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{days(r.compensatory)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ErpNote syncedAt={syncedLeave} className="mt-3" />
        </section>
      )}
    </div>
  );
}
