// 대관 차이 대조 결과(서버 컴포넌트) — 기간 선택은 GET 폼(?tab=rentals&from=&to=).
import type { RentalDiffResult, RentalDiffRow, RentalSide } from "@/app/(app)/admin/erp/actions";
import ErpNote from "@/app/components/ErpNote";
import { cardCls } from "@/lib/ui";

const STATUS: Record<string, string> = { Y: "확정", N: "신청 중", C: "취소" };
const st = (s: string | null) => (s ? STATUS[s] ?? s : "-");
const tm = (r: RentalSide) => `${(r.start ?? "").slice(0, 5) || "?"}~${(r.end ?? "").slice(0, 5) || "?"}`;
const brief = (r: RentalSide) =>
  `${r.date ?? "-"} ${tm(r)} · ${st(r.status)} · ${r.persons ?? "-"}명 · ${[r.space, r.program, r.team].filter(Boolean).join(" / ")}`;

function List({ title, rows, kind }: { title: string; rows: RentalDiffRow[]; kind: "erp" | "ours" | "diff" }) {
  return (
    <section className={cardCls}>
      <h3 className="mb-2 text-sm font-bold text-ink">
        {title} <span className="text-xs font-normal text-ink-muted">{rows.length}건</span>
      </h3>
      {rows.length === 0 ? (
        <p className="text-xs text-ink-hint">없습니다.</p>
      ) : (
        <ul className="divide-y divide-line/60 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="py-1.5">
              <span className="mr-2 font-mono text-xs text-ink-muted">#{r.id}</span>
              {kind === "diff" ? (
                <>
                  <span className="text-xs font-semibold text-stamp">다름: {r.diffs.join("·")}</span>
                  <span className="block text-xs text-ink-body">ERP: {brief(r.erp!)}</span>
                  <span className="block text-xs text-ink-body">동업자씨: {brief(r.ours!)}</span>
                </>
              ) : (
                <span className="text-xs text-ink-body">{brief((kind === "erp" ? r.erp : r.ours)!)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function RentalDiffView({ result }: { result: RentalDiffResult }) {
  return (
    <div className="space-y-4">
      <section className={cardCls}>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="tab" value="rentals" />
          <label className="text-xs text-navy">
            시작
            <input type="date" name="from" defaultValue={result.start} className="ml-1 rounded-md border border-line bg-card px-2 py-1 text-sm" />
          </label>
          <label className="text-xs text-navy">
            끝
            <input type="date" name="to" defaultValue={result.end} className="ml-1 rounded-md border border-line bg-card px-2 py-1 text-sm" />
          </label>
          <button type="submit" className="rounded-md bg-navy px-3 py-1.5 text-sm font-semibold text-white">
            대조
          </button>
        </form>
        <p className="mt-3 text-sm text-ink-body">
          ERP {result.erpCount}건 · 동업자씨 시설대관 {result.oursCount}건 → 일치 {result.bothSame}건 · ERP에만 {result.erpOnly.length}건 · 동업자씨에만{" "}
          {result.oursOnly.length}건 · 값이 다름 {result.different.length}건
        </p>
        <p className="mt-1 text-[11px] text-ink-hint">
          기준: ERP 대관(erp_rentals) ↔ 동업자씨 대관예약 중 시설대관(rental). 번호(rental_id = reservation_no)로 맞추고 날짜·시간·상태·인원을 비교합니다.
          방(room) 예약은 ERP 범위 밖이라 빼고 비교합니다.
        </p>
        <ErpNote syncedAt={result.erpSyncedAt} className="mt-1" />
      </section>
      <List title="ERP에만 있음" rows={result.erpOnly} kind="erp" />
      <List title="동업자씨에만 있음" rows={result.oursOnly} kind="ours" />
      <List title="양쪽 다 있는데 값이 다름" rows={result.different} kind="diff" />
    </div>
  );
}
