"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { previewMenuXlsx, saveMenuXlsx, type CellEdit } from "@/app/(app)/bangka/meals/upload/actions";
import { BK_ALLERGENS, parseVendorWeek } from "@/lib/bangkaMenuParse";
import {
  btnPrimary,
  btnSecondary,
  inputCls,
  linkCls,
  noticeError,
  noticeSuccess,
  noticeWarning,
  panelToneCls,
  sectionTitleCls,
} from "@/lib/ui";

// =====================================================================
// 식단표 올리기 — 파일 고르기 → 미리보기(날짜별 표) → 확인 → 저장.
//   · 노란 칸: 알레르기 번호가 1~19 밖이거나 이름에 숫자가 남은 칸 등 사람이 볼 칸.
//     칸을 누르면 원문을 고칠 수 있고, 고친 대로 바로 다시 해석합니다(저장 때 서버도 같은 해석).
//   · 회색 열: 날짜가 없거나 메뉴가 전부 빈 날(급식 없음) — 저장하지 않습니다.
// =====================================================================

export default function MenuUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [grid, setGrid] = useState<string[][] | null>(null);
  const [edits, setEdits] = useState<Map<string, CellEdit>>(new Map());
  const [existing, setExisting] = useState<string[]>([]);
  const [overwrite, setOverwrite] = useState(false);
  const [editing, setEditing] = useState<{ r: number; c: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string[] | null>(null);
  const [pending, start] = useTransition();

  const merged = useMemo(() => {
    if (!grid) return null;
    const g = grid.map((r) => [...r]);
    for (const e of edits.values()) {
      while (g.length <= e.r) g.push([]);
      while (g[e.r].length <= e.c) g[e.r].push("");
      g[e.r][e.c] = e.value;
    }
    return g;
  }, [grid, edits]);
  const week = useMemo(() => (merged ? parseVendorWeek(merged) : null), [merged]);

  function preview(f: File) {
    setFile(f);
    setErr(null);
    setDone(null);
    setGrid(null);
    setEdits(new Map());
    setOverwrite(false);
    start(async () => {
      const fd = new FormData();
      fd.set("file", f);
      const res = await previewMenuXlsx(fd);
      if (!res.ok) return setErr(res.message);
      setGrid(res.grid);
      setExisting(res.existing);
    });
  }

  function setCell(r: number, c: number, value: string) {
    setEdits((m) => new Map(m).set(`${r}:${c}`, { r, c, value }));
  }

  function save() {
    if (!file || !week) return;
    setErr(null);
    start(async () => {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("edits", JSON.stringify([...edits.values()]));
      fd.set("overwrite", overwrite ? "1" : "0");
      const res = await saveMenuXlsx(fd);
      if (!res.ok) return setErr(res.message);
      setDone(res.saved);
      setGrid(null);
      setFile(null);
    });
  }

  const mealDays = week?.days.filter((d) => d.hasMeal) ?? [];
  const warnCount =
    week?.days.filter((d) => d.hasMeal).reduce((n, d) => n + d.items.filter((i) => i.warn).length + (d.nutritionWarn ? 1 : 0), 0) ?? 0;
  const needsOverwrite = existing.some((d) => mealDays.some((m) => m.date === d));

  return (
    <div className="space-y-4">
      <div className={panelToneCls("yellow")}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className={sectionTitleCls("yellow")}>업체 식단표 올리기</h3>
          <Link href="/bangka/meals" className={`ml-auto text-sm ${linkCls}`}>
            ← 급식 달력
          </Link>
        </div>
        <p className="mt-2 text-sm text-ink-muted">
          위탁업체가 보낸 주간 식단표 <b>엑셀(xlsx)</b> 을 고르세요. 메뉴 끝 숫자는 알레르기 번호로 읽고, 영양표시(kcal)와 원산지도
          함께 저장합니다. 이미 올린 급식 사진은 그대로 둡니다.
        </p>
        <input
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={pending}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) preview(f);
            e.target.value = "";
          }}
          className="mt-3 block w-full text-sm"
        />
        {pending && !week && <p className="mt-2 text-sm text-ink-muted">읽는 중…</p>}
      </div>

      {err && <p className={noticeError}>{err}</p>}
      {done && (
        <p className={noticeSuccess}>
          {done.length}일 저장했습니다 ({done.map((d) => d.slice(5).replace("-", "/")).join(", ")}).{" "}
          <Link href={`/bangka/meals?ym=${done[0].slice(0, 7)}`} className={linkCls}>
            급식 달력에서 보기
          </Link>
        </p>
      )}

      {week && merged && (
        <div className={`${panelToneCls("blue")} space-y-3`}>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
            <b className="text-ink">{week.title || file?.name}</b>
            {week.dietitian && <span className="text-ink-muted">영양사 {week.dietitian}</span>}
            {week.vendor && <span className="text-ink-muted">{week.vendor}</span>}
          </div>
          {week.errors.map((e) => (
            <p key={e} className={noticeError}>
              {e}
            </p>
          ))}
          {week.warnings.map((w) => (
            <p key={w} className={noticeWarning}>
              {w}
            </p>
          ))}
          {warnCount > 0 && (
            <p className={noticeWarning}>노란 칸 {warnCount}곳을 확인하세요. 칸을 누르면 고칠 수 있습니다(고치지 않아도 저장은 됩니다).</p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="w-14 border border-rule bg-surface p-1.5 text-xs">구분</th>
                  {week.days.map((d) => (
                    <th key={d.col} className={`border border-rule p-1.5 ${d.hasMeal ? "bg-surface" : "bg-surface/40 text-ink-muted"}`}>
                      <div>{d.label || "(빈 칸)"}</div>
                      <div className="text-[11px] font-normal text-ink-muted">{d.hasMeal ? d.date : "급식 없음"}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {week.slots.map((slot, i) => (
                  <tr key={`${slot}-${i}`}>
                    <th className="border border-rule bg-surface p-1.5 text-xs">{slot}</th>
                    {week.days.map((d) => {
                      const it = d.items[i];
                      const r = week.slotRows[i];
                      const isEd = editing?.r === r && editing.c === d.col;
                      return (
                        <td
                          key={d.col}
                          title={it.warn ?? undefined}
                          onClick={() => d.date && setEditing({ r, c: d.col })}
                          className={`cursor-pointer border border-rule p-1.5 align-top ${
                            !d.hasMeal ? "bg-surface/40 text-ink-muted" : it.warn ? "bg-warning-soft" : ""
                          }`}
                        >
                          {isEd ? (
                            <CellInput
                              value={merged[r]?.[d.col] ?? ""}
                              onDone={(v) => {
                                if (v !== (merged[r]?.[d.col] ?? "")) setCell(r, d.col, v);
                                setEditing(null);
                              }}
                            />
                          ) : (
                            <>
                              <div className="text-ink">{it.name || <span className="text-ink-muted">—</span>}</div>
                              {it.allergens.length > 0 && (
                                <div className="text-[11px] text-ink-muted">{it.allergens.map((n) => BK_ALLERGENS[n]).join("·")}</div>
                              )}
                              {it.warn && <div className="text-[11px] text-warning">⚠ {it.warn}</div>}
                            </>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <th className="border border-rule bg-surface p-1.5 text-xs">열량</th>
                  {week.days.map((d) => {
                    const r = week.nutritionRow;
                    const isEd = r >= 0 && editing?.r === r && editing.c === d.col;
                    return (
                      <td
                        key={d.col}
                        title={d.nutritionWarn ?? undefined}
                        onClick={() => r >= 0 && d.date && setEditing({ r, c: d.col })}
                        className={`cursor-pointer border border-rule p-1.5 align-top ${
                          !d.hasMeal ? "bg-surface/40 text-ink-muted" : d.nutritionWarn ? "bg-warning-soft" : ""
                        }`}
                      >
                        {isEd ? (
                          <CellInput
                            value={merged[r]?.[d.col] ?? ""}
                            onDone={(v) => {
                              if (v !== (merged[r]?.[d.col] ?? "")) setCell(r, d.col, v);
                              setEditing(null);
                            }}
                          />
                        ) : d.nutrition.kcal != null ? (
                          <>
                            <b>{d.nutrition.kcal}</b> kcal
                            <div className="text-[11px] text-ink-muted">
                              단백질 {d.nutrition.protein_pct ?? "-"}% · 칼슘 {d.nutrition.calcium_mg ?? "-"} · 철분 {d.nutrition.iron_mg ?? "-"}
                            </div>
                          </>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                        {d.nutritionWarn && <div className="text-[11px] text-warning">⚠ {d.nutritionWarn}</div>}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>

          {week.originText && (
            <details className="text-xs text-ink-muted">
              <summary className="cursor-pointer">원산지 표시 (함께 저장)</summary>
              <p className="mt-1 whitespace-pre-wrap">{week.originText}</p>
            </details>
          )}

          {needsOverwrite && (
            <label className={`${noticeWarning} flex items-start gap-2`}>
              <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} className="mt-1" />
              <span>
                이미 식단이 있는 날짜가 있습니다: {existing.join(", ")} — 업체 식단으로 <b>덮어씁니다</b>(사진은 그대로).
              </span>
            </label>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={pending || week.errors.length > 0 || mealDays.length === 0 || (needsOverwrite && !overwrite)}
              className={btnPrimary}
            >
              {pending ? "저장 중…" : `${mealDays.length}일 저장`}
            </button>
            <button
              type="button"
              onClick={() => {
                setGrid(null);
                setFile(null);
              }}
              className={btnSecondary}
            >
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CellInput({ value, onDone }: { value: string; onDone: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <input
      autoFocus
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onDone(v)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onDone(v);
        if (e.key === "Escape") onDone(value);
      }}
      onClick={(e) => e.stopPropagation()}
      className={`${inputCls} h-8 px-1.5 py-0 text-sm`}
    />
  );
}
