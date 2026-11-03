"use client";

import { useCallback, useEffect, useState } from "react";
import type { SmsOptionItem } from "@/lib/sms/text";
import { btnPrimary, btnSecondary, inputCls, noticeError } from "@/lib/ui";
import { fetchOptions, type PickerProps } from "./types";

// 'search' 선택기 — 검색어 → 묶음(group, 예: 거래처명)별 사람 체크. 선택값 = { ids }.
export default function SearchPicker({ meta, onAdd }: PickerProps) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SmsOptionItem[]>([]);
  const [note, setNote] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const apply = useCallback((r: Awaited<ReturnType<typeof fetchOptions>>) => {
    setLoading(false);
    if (!r.ok) return setError(r.error);
    setError(null);
    setItems(r.data.items);
    setNote(r.data.note);
  }, []);
  // 처음 한 번 — 이후 검색은 버튼·엔터로.
  useEffect(() => {
    let alive = true;
    fetchOptions({ source: meta.key, query: "" }).then((r) => {
      if (alive) apply(r);
    });
    return () => {
      alive = false;
    };
  }, [meta.key, apply]);
  function search(q: string) {
    setLoading(true);
    fetchOptions({ source: meta.key, query: q }).then(apply);
  }

  const groups = [...new Set(items.map((i) => i.group ?? ""))];
  const toggle = (id: string) =>
    setChecked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="space-y-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          search(query);
        }}
      >
        <input
          className={inputCls}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이름으로 검색"
        />
        <button type="submit" className={btnSecondary}>
          검색
        </button>
      </form>
      {error && <p className={noticeError}>{error}</p>}
      {note && <p className="text-xs text-ink-muted">{note}</p>}
      <div className="max-h-80 space-y-2 overflow-y-auto">
        {loading && <p className="py-3 text-center text-sm text-ink-muted">찾는 중…</p>}
        {!loading && items.length === 0 && (
          <p className="py-3 text-center text-sm text-ink-muted">결과가 없습니다.</p>
        )}
        {!loading &&
          groups.map((g) => {
            const mine = items.filter((i) => (i.group ?? "") === g);
            const selectable = mine.filter((i) => i.hasPhone);
            const allOn = selectable.length > 0 && selectable.every((i) => checked.has(i.id));
            return (
              <div key={g} className="rounded-lg border border-rule p-2">
                <label className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <input
                    type="checkbox"
                    checked={allOn}
                    disabled={selectable.length === 0}
                    onChange={() =>
                      setChecked((p) => {
                        const n = new Set(p);
                        for (const i of selectable) {
                          if (allOn) n.delete(i.id);
                          else n.add(i.id);
                        }
                        return n;
                      })
                    }
                  />
                  {g || "(이름 없음)"}
                </label>
                <ul className="mt-1 space-y-0.5 pl-6">
                  {mine.map((i) => (
                    <li key={i.id} className={i.hasPhone ? "text-sm" : "text-sm text-ink-hint"}>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked.has(i.id)}
                          disabled={!i.hasPhone}
                          onChange={() => toggle(i.id)}
                        />
                        {i.name}
                        {i.sub && <span className="text-xs text-ink-muted">{i.sub}</span>}
                        {!i.hasPhone && <span className="text-xs">(번호 없음)</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          className={btnPrimary}
          disabled={checked.size === 0}
          onClick={() => {
            onAdd({ ids: [...checked] });
            setChecked(new Set());
          }}
        >
          선택 담기{checked.size > 0 ? ` (${checked.size})` : ""}
        </button>
      </div>
    </div>
  );
}
