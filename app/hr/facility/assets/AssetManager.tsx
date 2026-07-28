"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ASSET_STATUS_OPTIONS,
  BUDGET_SOURCES,
  UNIT_OPTIONS,
  calcAmount,
  calcDisposalScheduled,
  formatNum,
  lifeBadge,
  type AssetInput,
  type AssetStatus,
  type FacilityAsset,
  type FacilityLocation,
} from "@/lib/facility";
import {
  createAsset,
  updateAsset,
  disposeAsset,
  restoreAsset,
  deleteAsset,
} from "@/app/hr/facility/actions";
import {
  cardCls,
  btnPrimary,
  btnSecondary,
  badgeNeutral,
  badgeWarning,
  badgeDanger,
  noticeError,
} from "@/lib/ui";

const selCls =
  "rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const inCls =
  "block w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const thCls = "px-2 py-2 text-left text-xs font-semibold text-navy whitespace-nowrap";
const tdCls = "px-2 py-2 align-middle text-sm text-ink-body whitespace-nowrap";
const rowBtn =
  "rounded border border-line px-1.5 py-1 text-xs text-ink-muted hover:bg-surface disabled:opacity-50";

// 모달 모드 — create/duplicate 는 신규 저장, edit 는 기존 수정.
type ModalState =
  | { mode: "create" | "duplicate" | "edit"; asset: FacilityAsset | null }
  | null;

type SortKey = "acquired_on" | "amount";
type SortDir = "asc" | "desc";

export default function AssetManager({
  assets,
  locations,
  todayYmd,
  isM0,
}: {
  assets: FacilityAsset[];
  locations: FacilityLocation[];
  todayYmd: string;
  isM0: boolean;
}) {
  const router = useRouter();
  const [modal, setModal] = useState<ModalState>(null);
  const [disposeTarget, setDisposeTarget] = useState<FacilityAsset | null>(null);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

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

  // 엑셀 다운로드 URL — 현재 필터를 쿼리로 전달(서버가 동일 적용).
  const exportHref = useMemo(() => {
    const p = new URLSearchParams();
    if (year !== "all") p.set("year", year);
    if (loc !== "all") p.set("location", loc);
    if (budget !== "all") p.set("budget", budget);
    if (status !== "all") p.set("status", status);
    if (q.trim()) p.set("q", q.trim());
    const qs = p.toString();
    return `/hr/facility/assets/export${qs ? `?${qs}` : ""}`;
  }, [year, loc, budget, status, q]);

  function resetFilters() {
    setYear("all");
    setLoc("all");
    setBudget("all");
    setStatus("all");
    setQ("");
  }

  // --- 행 액션(불용/되돌리기/삭제) — 성공 시 router.refresh 로 목록 갱신 ---
  function runRowAction(
    id: string,
    fn: () => Promise<{ ok: true } | { ok: false; message: string }>,
    okText: string
  ) {
    setMsg(null);
    setRowBusyId(id);
    startTransition(async () => {
      const res = await fn();
      setRowBusyId(null);
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      setMsg({ ok: true, text: okText });
      router.refresh();
    });
  }

  function onDelete(a: FacilityAsset) {
    if (
      !confirm(
        `[${a.item_name}] 비품을 완전히 삭제할까요? 되돌릴 수 없습니다.\n(기록 보존이 필요하면 '불용처리'를 쓰세요)`
      )
    )
      return;
    runRowAction(a.id, () => deleteAsset(a.id), "삭제했습니다.");
  }

  function onRestore(a: FacilityAsset) {
    if (!confirm(`[${a.item_name}] 불용을 되돌려 '사용중'으로 바꿀까요?`)) return;
    runRowAction(a.id, () => restoreAsset(a.id), "사용중으로 되돌렸습니다.");
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
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-xs text-ink-hint">
            {activeFilter
              ? `필터 결과 ${filtered.length}건 / 전체 ${assets.length}건`
              : `전체 ${assets.length}건`}
          </p>
          <div className="flex items-center gap-2">
            <a
              href={exportHref}
              className={btnSecondary}
              title="현재 필터가 적용된 목록을 엑셀로 내려받습니다"
            >
              엑셀 다운로드
            </a>
            <button
              type="button"
              onClick={() => {
                setMsg(null);
                setModal({ mode: "create", asset: null });
              }}
              className={btnPrimary}
            >
              + 비품 등록
            </button>
          </div>
        </div>

        {msg && (
          <p
            className={`mb-3 ${msg.ok ? "rounded-lg bg-success-soft px-3 py-2 text-xs text-success" : noticeError}`}
          >
            {msg.text}
          </p>
        )}

        {filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-ink-hint">
            {assets.length === 0
              ? "등록된 비품이 없습니다."
              : "조건에 맞는 비품이 없습니다. 필터를 조정하세요."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1240px] border-collapse">
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
                  <th className={`${thCls} text-right`}>관리</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <AssetRow
                    key={a.id}
                    asset={a}
                    todayYmd={todayYmd}
                    isM0={isM0}
                    busy={pending && rowBusyId === a.id}
                    onEdit={() => {
                      setMsg(null);
                      setModal({ mode: "edit", asset: a });
                    }}
                    onDuplicate={() => {
                      setMsg(null);
                      setModal({ mode: "duplicate", asset: a });
                    }}
                    onDispose={() => {
                      setMsg(null);
                      setDisposeTarget(a);
                    }}
                    onRestore={() => onRestore(a)}
                    onDelete={() => onDelete(a)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modal && (
        <AssetModal
          mode={modal.mode}
          asset={modal.asset}
          locations={locations}
          todayYmd={todayYmd}
          onClose={() => setModal(null)}
          onSaved={(text) => {
            setModal(null);
            setMsg({ ok: true, text });
            router.refresh();
          }}
        />
      )}

      {disposeTarget && (
        <DisposeModal
          asset={disposeTarget}
          todayYmd={todayYmd}
          onClose={() => setDisposeTarget(null)}
          onDone={(text) => {
            setDisposeTarget(null);
            setMsg({ ok: true, text });
            router.refresh();
          }}
        />
      )}
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
  isM0,
  busy,
  onEdit,
  onDuplicate,
  onDispose,
  onRestore,
  onDelete,
}: {
  asset: FacilityAsset;
  todayYmd: string;
  isM0: boolean;
  busy: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onDispose: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const disposed = !!asset.disposed_on;
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
      <td className={`${tdCls} text-right`}>
        <div className="flex justify-end gap-1">
          <button type="button" onClick={onEdit} disabled={busy} className={rowBtn}>
            수정
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            disabled={busy}
            className={rowBtn}
            title="이 행 값으로 등록 모달 열기(같은 물품 재구매)"
          >
            복제
          </button>
          {disposed ? (
            <button
              type="button"
              onClick={onRestore}
              disabled={busy}
              className={rowBtn}
            >
              되돌리기
            </button>
          ) : (
            <button
              type="button"
              onClick={onDispose}
              disabled={busy}
              className={rowBtn}
            >
              불용
            </button>
          )}
          {isM0 && (
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              className="rounded border border-stamp px-1.5 py-1 text-xs text-stamp hover:bg-stamp-soft disabled:opacity-50"
            >
              삭제
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// =====================================================================
// 등록/수정 모달 — 실시간 미리보기(금액·폐기예정일). create/duplicate=신규, edit=수정.
// =====================================================================
type FormValues = {
  acquired_on: string;
  item_name: string;
  spec: string;
  location: string;
  unit: string;
  quantity: string;
  unit_price: string;
  useful_life_years: string;
  budget_source: string;
  note: string;
};

function initialForm(
  mode: "create" | "duplicate" | "edit",
  asset: FacilityAsset | null,
  todayYmd: string
): FormValues {
  if (asset) {
    return {
      // 복제 시 취득일자는 오늘로(재구매 관행) — 나머지는 원본 값 유지.
      acquired_on:
        mode === "duplicate" ? todayYmd : asset.acquired_on ?? "",
      item_name: asset.item_name,
      spec: asset.spec ?? "",
      location: asset.location ?? "",
      unit: asset.unit ?? "",
      quantity: String(asset.quantity || 1),
      unit_price: String(asset.unit_price || 0),
      useful_life_years:
        asset.useful_life_years != null ? String(asset.useful_life_years) : "",
      budget_source: asset.budget_source ?? "",
      note: asset.note ?? "",
    };
  }
  return {
    acquired_on: todayYmd,
    item_name: "",
    spec: "",
    location: "",
    unit: "",
    quantity: "1",
    unit_price: "",
    useful_life_years: "",
    budget_source: "",
    note: "",
  };
}

function AssetModal({
  mode,
  asset,
  locations,
  todayYmd,
  onClose,
  onSaved,
}: {
  mode: "create" | "duplicate" | "edit";
  asset: FacilityAsset | null;
  locations: FacilityLocation[];
  todayYmd: string;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const [f, setF] = useState<FormValues>(() =>
    initialForm(mode, asset, todayYmd)
  );
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function patch(next: Partial<FormValues>) {
    setF((prev) => ({ ...prev, ...next }));
  }

  // 장소 드롭다운 — 활성 장소 + (편집 중 값이 비활성/레거시면 그 값도 유지).
  const locationOptions = useMemo(() => {
    const names = locations.map((l) => l.name);
    if (f.location && !names.includes(f.location)) return [f.location, ...names];
    return names;
  }, [locations, f.location]);

  const amount = calcAmount(Number(f.unit_price), Number(f.quantity));
  const disposal = calcDisposalScheduled(
    f.acquired_on || null,
    f.useful_life_years === "" ? null : Number(f.useful_life_years)
  );

  const title =
    mode === "edit"
      ? "비품 수정"
      : mode === "duplicate"
        ? "비품 복제 등록"
        : "비품 등록";

  function save() {
    setErr(null);
    if (!f.item_name.trim()) {
      setErr("품목을 입력하세요.");
      return;
    }
    const qty = Math.round(Number(f.quantity));
    if (!Number.isFinite(qty) || qty <= 0) {
      setErr("수량은 1 이상의 정수여야 합니다.");
      return;
    }
    const input: AssetInput = {
      acquired_on: f.acquired_on || null,
      item_name: f.item_name.trim(),
      spec: f.spec.trim() || null,
      location: f.location || null,
      unit: f.unit || null,
      quantity: qty,
      unit_price: Math.round(Number(f.unit_price) || 0),
      useful_life_years:
        f.useful_life_years === "" ? null : Math.round(Number(f.useful_life_years)),
      budget_source: f.budget_source || null,
      note: f.note.trim() || null,
    };
    start(async () => {
      const res =
        mode === "edit" && asset
          ? await updateAsset(asset.id, input)
          : await createAsset(input);
      if (!res.ok) {
        setErr(res.message);
        return;
      }
      onSaved(
        mode === "edit"
          ? "수정했습니다."
          : mode === "duplicate"
            ? "복제 등록했습니다."
            : "등록했습니다."
      );
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-line bg-card p-5 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-ink-muted hover:underline"
          >
            닫기
          </button>
        </div>

        {mode === "duplicate" && (
          <p className="mb-3 rounded-lg bg-navy-soft/40 px-3 py-2 text-xs text-navy">
            같은 물품 재구매용 복제입니다. 취득일자·수량만 확인·수정 후 저장하세요.
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="취득일자">
            <input
              type="date"
              value={f.acquired_on}
              onChange={(e) => patch({ acquired_on: e.target.value })}
              className={inCls}
            />
          </Field>
          <Field label="품목 *">
            <input
              value={f.item_name}
              onChange={(e) => patch({ item_name: e.target.value })}
              className={inCls}
              placeholder="예: LCD 모니터"
            />
          </Field>
          <Field label="규격" full>
            <input
              value={f.spec}
              onChange={(e) => patch({ spec: e.target.value })}
              className={inCls}
              placeholder="모델·사양 등"
            />
          </Field>
          <Field label="장소">
            <select
              value={f.location}
              onChange={(e) => patch({ location: e.target.value })}
              className={inCls}
            >
              <option value="">(미지정)</option>
              {locationOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
          <Field label="단위">
            <select
              value={f.unit}
              onChange={(e) => patch({ unit: e.target.value })}
              className={inCls}
            >
              <option value="">(선택)</option>
              {UNIT_OPTIONS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </Field>
          <Field label="수량 *">
            <input
              type="number"
              min={1}
              step={1}
              value={f.quantity}
              onChange={(e) => patch({ quantity: e.target.value })}
              className={`${inCls} text-right font-mono`}
            />
          </Field>
          <Field label="단가(원)">
            <input
              type="number"
              min={0}
              step={1}
              value={f.unit_price}
              onChange={(e) => patch({ unit_price: e.target.value })}
              className={`${inCls} text-right font-mono`}
            />
          </Field>
          <Field label="내구연한(년)">
            <input
              type="number"
              min={0}
              step={1}
              value={f.useful_life_years}
              onChange={(e) => patch({ useful_life_years: e.target.value })}
              className={`${inCls} text-right font-mono`}
              placeholder="선택"
            />
          </Field>
          <Field label="예산출처">
            <select
              value={f.budget_source}
              onChange={(e) => patch({ budget_source: e.target.value })}
              className={inCls}
            >
              <option value="">(선택)</option>
              {BUDGET_SOURCES.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </Field>
          <Field label="비고" full>
            <input
              value={f.note}
              onChange={(e) => patch({ note: e.target.value })}
              className={inCls}
            />
          </Field>
        </div>

        {/* 실시간 미리보기 — 저장값은 DB 자동계산 사용. */}
        <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-surface/60 p-3">
          <div>
            <p className="text-[11px] text-ink-muted">금액(단가×수량)</p>
            <p className="mt-0.5 font-mono text-base font-bold text-navy">
              {formatNum(amount)}원
            </p>
          </div>
          <div>
            <p className="text-[11px] text-ink-muted">폐기예정일(취득일+내구연한)</p>
            <p className="mt-0.5 font-mono text-base font-bold text-navy">
              {disposal ?? "—"}
            </p>
          </div>
        </div>

        {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className={btnPrimary}
          >
            {pending ? "저장 중…" : "저장"}
          </button>
          <button type="button" onClick={onClose} className={btnSecondary}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  full,
  children,
}: {
  label: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <label className="block text-[11px] font-semibold text-navy">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

// =====================================================================
// 불용 처리 모달 — 불용일자 입력(기본 오늘).
// =====================================================================
function DisposeModal({
  asset,
  todayYmd,
  onClose,
  onDone,
}: {
  asset: FacilityAsset;
  todayYmd: string;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [day, setDay] = useState<string>(asset.disposed_on ?? todayYmd);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function submit() {
    setErr(null);
    if (!day) {
      setErr("불용일자를 입력하세요.");
      return;
    }
    start(async () => {
      const res = await disposeAsset(asset.id, day);
      if (!res.ok) {
        setErr(res.message);
        return;
      }
      onDone("불용 처리했습니다.");
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl border border-line bg-card p-5 shadow-lg">
        <h3 className="mb-1 text-base font-bold text-ink">불용 처리</h3>
        <p className="mb-3 text-xs text-ink-muted">
          <b className="text-ink">{asset.item_name}</b> 을(를) 불용 처리합니다.
          목록에서 “불용” 상태로 표시되며, 되돌리기로 취소할 수 있습니다.
        </p>
        <label className="block text-[11px] font-semibold text-navy">
          불용일자
        </label>
        <input
          type="date"
          value={day}
          onChange={(e) => setDay(e.target.value)}
          className={`${inCls} mt-1`}
        />
        {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className={btnPrimary}
          >
            {pending ? "처리 중…" : "불용 처리"}
          </button>
          <button type="button" onClick={onClose} className={btnSecondary}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
