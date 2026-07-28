"use client";

import { useMemo, useState } from "react";
import {
  ASSET_STATUS_OPTIONS,
  BUDGET_SOURCES,
  formatNum,
  lifeBadge,
  type AssetStatus,
  type FacilityAsset,
  type FacilityLocation,
} from "@/lib/facility";
import {
  cardCls,
  badgeNeutral,
  badgeWarning,
  badgeDanger,
} from "@/lib/ui";

const selCls =
  "rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const thCls = "px-2 py-2 text-left text-xs font-semibold text-navy whitespace-nowrap";
const tdCls = "px-2 py-2 align-middle text-sm text-ink-body whitespace-nowrap";

type SortKey = "acquired_on" | "amount";
type SortDir = "asc" | "desc";

export default function AssetManager({
  assets,
  locations,
  todayYmd,
}: {
  assets: FacilityAsset[];
  locations: FacilityLocation[];
  todayYmd: string;
  // isM0 은 F-3(삭제 버튼)에서 사용 — page 가 전달하며 타입에는 유지.
  isM0: boolean;
}) {
  const [year, setYear] = useState<string>("all");
  const [loc, setLoc] = useState<string>("all");
  const [budget, setBudget] = useState<string>("all");
  const [status, setStatus] = useState<AssetStatus>("all");
  const [q, setQ] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("acquired_on");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // 취득일 기준 연도 목록(데이터에서 동적 생성, 내림차순).
  const years = useMemo(() => {
    const set = new Set<string>();
    for (const a of assets) {
      const y = (a.acquired_on ?? "").slice(0, 4);
      if (y) set.add(y);
    }
    return Array.from(set).sort((x, y2) => Number(y2) - Number(x));
  }, [assets]);

  const filtered = useMemo(() => {
    let rows = assets.slice();
    if (year !== "all")
      rows = rows.filter((a) => (a.acquired_on ?? "").slice(0, 4) === year);
    if (loc !== "all") rows = rows.filter((a) => a.location === loc);
    if (budget !== "all") rows = rows.filter((a) => a.budget_source === budget);
    if (status !== "all")
      rows =
        status === "disposed"
          ? rows.filter((a) => !!a.disposed_on)
          : rows.filter((a) => !a.disposed_on);
    const kw = q.trim().toLowerCase();
    if (kw)
      rows = rows.filter(
        (a) =>
          a.item_name.toLowerCase().includes(kw) ||
          (a.spec ?? "").toLowerCase().includes(kw)
      );

    rows.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "amount") cmp = a.amount - b.amount;
      else cmp = (a.acquired_on ?? "").localeCompare(b.acquired_on ?? "");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [assets, year, loc, budget, status, q, sortKey, sortDir]);

  // 집계 — 현재 필터 결과.
  const agg = useMemo(() => {
    let qty = 0;
    let amount = 0;
    for (const a of filtered) {
      qty += a.quantity;
      amount += a.amount;
    }
    return { count: filtered.length, qty, amount };
  }, [filtered]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "amount" ? "desc" : "desc");
    }
  }
  const sortMark = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const activeFilter =
    year !== "all" ||
    loc !== "all" ||
    budget !== "all" ||
    status !== "all" ||
    q.trim() !== "";
  function resetFilters() {
    setYear("all");
    setLoc("all");
    setBudget("all");
    setStatus("all");
    setQ("");
  }

  return (
    <div className="space-y-5">
      {/* 필터 바 */}
      <section className={cardCls}>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className={selCls}
            aria-label="취득연도"
          >
            <option value="all">전체 연도</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>

          <select
            value={loc}
            onChange={(e) => setLoc(e.target.value)}
            className={selCls}
            aria-label="장소"
          >
            <option value="all">전체 장소</option>
            {locations.map((l) => (
              <option key={l.id} value={l.name}>
                {l.name}
              </option>
            ))}
          </select>

          <select
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            className={selCls}
            aria-label="예산출처"
          >
            <option value="all">전체 예산출처</option>
            {BUDGET_SOURCES.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>

          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as AssetStatus)}
            className={selCls}
            aria-label="상태"
          >
            {ASSET_STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>

          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="품목·규격 검색"
            className={`${selCls} min-w-[160px] flex-1`}
          />

          {activeFilter && (
            <button
              type="button"
              onClick={resetFilters}
              className="text-xs text-ink-muted hover:underline"
            >
              필터 초기화
            </button>
          )}
        </div>

        {/* 집계 카드 */}
        <div className="mt-3 grid grid-cols-3 gap-3">
          <StatTile label="건수" value={`${agg.count.toLocaleString("ko-KR")}건`} />
          <StatTile label="수량 합" value={`${agg.qty.toLocaleString("ko-KR")}`} />
          <StatTile label="취득가액 합" value={`${formatNum(agg.amount)}원`} />
        </div>
      </section>

      {/* 목록 */}
      <section className={cardCls}>
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-ink-hint">
            {assets.length === 0
              ? "등록된 비품이 없습니다."
              : "조건에 맞는 비품이 없습니다. 필터를 조정하세요."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th
                    className={`${thCls} cursor-pointer select-none hover:text-navy-strong`}
                    onClick={() => toggleSort("acquired_on")}
                  >
                    취득일자{sortMark("acquired_on")}
                  </th>
                  <th className={thCls}>품목</th>
                  <th className={thCls}>규격</th>
                  <th className={thCls}>장소</th>
                  <th className={thCls}>단위</th>
                  <th className={`${thCls} text-right`}>수량</th>
                  <th className={`${thCls} text-right`}>단가</th>
                  <th
                    className={`${thCls} cursor-pointer select-none text-right hover:text-navy-strong`}
                    onClick={() => toggleSort("amount")}
                  >
                    금액{sortMark("amount")}
                  </th>
                  <th className={thCls}>내구연한</th>
                  <th className={thCls}>폐기예정일</th>
                  <th className={thCls}>예산출처</th>
                  <th className={thCls}>상태</th>
                  <th className={thCls}>비고</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <AssetRow key={a.id} asset={a} todayYmd={todayYmd} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface/60 px-3 py-2">
      <p className="text-[11px] text-ink-muted">{label}</p>
      <p className="mt-0.5 font-mono text-base font-bold text-ink">{value}</p>
    </div>
  );
}

function StatusBadge({
  asset,
  todayYmd,
}: {
  asset: FacilityAsset;
  todayYmd: string;
}) {
  const b = lifeBadge(asset, todayYmd);
  const cls =
    b.kind === "expired"
      ? badgeDanger
      : b.kind === "soon"
        ? badgeWarning
        : badgeNeutral;
  return <span className={cls}>{b.label}</span>;
}

function AssetRow({
  asset,
  todayYmd,
}: {
  asset: FacilityAsset;
  todayYmd: string;
}) {
  return (
    <tr className="border-b border-line/60">
      <td className={`${tdCls} font-mono text-xs`}>{asset.acquired_on ?? "—"}</td>
      <td className={`${tdCls} font-medium text-ink`}>{asset.item_name}</td>
      <td className={`${tdCls} max-w-[220px] truncate`} title={asset.spec ?? ""}>
        {asset.spec ?? "—"}
      </td>
      <td className={tdCls}>{asset.location ?? "—"}</td>
      <td className={tdCls}>{asset.unit ?? "—"}</td>
      <td className={`${tdCls} text-right font-mono`}>
        {asset.quantity.toLocaleString("ko-KR")}
      </td>
      <td className={`${tdCls} text-right font-mono`}>
        {formatNum(asset.unit_price)}
      </td>
      <td className={`${tdCls} text-right font-mono font-semibold`}>
        {formatNum(asset.amount)}
      </td>
      <td className={tdCls}>
        {asset.useful_life_years != null ? `${asset.useful_life_years}년` : "—"}
      </td>
      <td className={`${tdCls} font-mono text-xs`}>
        {asset.disposal_scheduled_on ?? "—"}
      </td>
      <td className={tdCls}>{asset.budget_source ?? "—"}</td>
      <td className={tdCls}>
        <StatusBadge asset={asset} todayYmd={todayYmd} />
      </td>
      <td className={`${tdCls} max-w-[200px] truncate`} title={asset.note ?? ""}>
        {asset.note ?? "—"}
      </td>
    </tr>
  );
}
