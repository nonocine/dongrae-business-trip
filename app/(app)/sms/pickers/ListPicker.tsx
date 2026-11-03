"use client";

import { useCallback, useEffect, useState } from "react";
import type { SmsOptionsResult, SmsSelection } from "@/lib/sms/text";
import { btnPrimary, btnSecondary, inputCls, labelCls, noticeError } from "@/lib/ui";
import type { PickerProps } from "./types";
import { fetchOptions } from "./types";

// 'list' · 'term-program' 공용 선택기 — 필터(select/radio) + 체크 목록.
//   grouped(묶음 단위: 프로그램·그룹)면 인원 수를 같이 보여 줍니다.
//   선택값 = { filter: 지금 필터, ids: 체크한 항목 }.
export default function ListPicker({ meta, onAdd }: PickerProps) {
  const [filter, setFilter] = useState<Record<string, string>>({});
  const [data, setData] = useState<SmsOptionsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const apply = useCallback((r: Awaited<ReturnType<typeof fetchOptions>>) => {
    setLoading(false);
    if (!r.ok) return setError(r.error);
    setError(null);
    setData(r.data);
    // 서버가 정한 기본값(예: 진행 중 차시)을 필터에 반영합니다.
    setFilter(Object.fromEntries(r.data.filters.map((d) => [d.key, d.value])));
    setChecked(new Set());
  }, []);
  useEffect(() => {
    let alive = true;
    fetchOptions({ source: meta.key, filter: {} }).then((r) => {
      if (alive) apply(r);
    });
    return () => {
      alive = false;
    };
  }, [meta.key, apply]);
  function load(f: Record<string, string>) {
    setLoading(true);
    fetchOptions({ source: meta.key, filter: f }).then(apply);
  }

  const items = data?.items ?? [];
  const selectable = items.filter((i) => i.hasPhone);
  const allOn = selectable.length > 0 && selectable.every((i) => checked.has(i.id));
  const grouped = data?.grouped === true || meta.pickerType === "term-program";

  function add(ids: string[]) {
    if (ids.length === 0) return;
    const sel: SmsSelection = { filter, ids };
    onAdd(sel);
    setChecked(new Set());
  }

  function toggle(id: string) {
    setChecked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  return (
    <div className="space-y-3">
      {data && data.filters.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          {data.filters.map((f) =>
            f.kind === "select" ? (
              <label key={f.key} className="min-w-[9rem]">
                <span className={labelCls}>{f.label}</span>
                <select
                  className={inputCls}
                  value={filter[f.key] ?? f.value}
                  onChange={(e) => load({ ...filter, [f.key]: e.target.value })}
                >
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <fieldset key={f.key} className="flex flex-wrap items-center gap-3 pb-2 text-sm text-ink-body">
                <span className="text-xs font-medium text-ink-muted">{f.label}</span>
                {f.options.map((o) => (
                  <label key={o.value} className="flex items-center gap-1">
                    <input
                      type="radio"
                      name={`${meta.key}-${f.key}`}
                      checked={(filter[f.key] ?? f.value) === o.value}
                      onChange={() => load({ ...filter, [f.key]: o.value })}
                    />
                    {o.label}
                  </label>
                ))}
              </fieldset>
            ),
          )}
        </div>
      )}

      {error && <p className={noticeError}>{error}</p>}
      {data?.note && <p className="text-xs text-ink-muted">{data.note}</p>}

      <div className="max-h-80 overflow-y-auto rounded-lg border border-rule">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-rule text-left text-xs text-ink-muted">
              <th className="w-10 px-2 py-2">
                <input
                  type="checkbox"
                  aria-label="모두 선택"
                  checked={allOn}
                  disabled={selectable.length === 0}
                  onChange={() =>
                    setChecked(allOn ? new Set() : new Set(selectable.map((i) => i.id)))
                  }
                />
              </th>
              <th className="px-2 py-2">{grouped ? "이름" : "이름"}</th>
              <th className="px-2 py-2">{grouped ? "정보" : "소속"}</th>
              {grouped && <th className="px-2 py-2 text-right">인원</th>}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4} className="px-2 py-4 text-center text-ink-muted">
                  불러오는 중…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-2 py-4 text-center text-ink-muted">
                  목록이 없습니다.
                </td>
              </tr>
            )}
            {!loading &&
              items.map((i) => (
                <tr
                  key={i.id}
                  className={`border-b border-rule/70 last:border-0 ${i.hasPhone ? "" : "text-ink-hint"}`}
                >
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      aria-label={`${i.name} 선택`}
                      checked={checked.has(i.id)}
                      disabled={!i.hasPhone}
                      onChange={() => toggle(i.id)}
                    />
                  </td>
                  <td className="px-2 py-1.5">{i.name}</td>
                  <td className="px-2 py-1.5 text-xs">
                    {i.sub ?? ""}
                    {!grouped && !i.hasPhone && <span className="ml-1">(번호 없음)</span>}
                  </td>
                  {grouped && (
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">
                      {i.count ?? 0}명
                      {i.reachable != null && i.reachable !== i.count && (
                        <span className="ml-1 text-xs text-ink-hint">(번호 {i.reachable})</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {data?.bulkLabel && (
          <button
            type="button"
            className={btnSecondary}
            disabled={selectable.length === 0}
            onClick={() => add(selectable.map((i) => i.id))}
          >
            {data.bulkLabel}
          </button>
        )}
        <button
          type="button"
          className={`${btnPrimary} ml-auto`}
          disabled={checked.size === 0}
          onClick={() => add([...checked])}
        >
          선택 담기{checked.size > 0 ? ` (${checked.size})` : ""}
        </button>
      </div>
    </div>
  );
}
