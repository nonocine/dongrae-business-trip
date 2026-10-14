"use client";

import { useMemo, useState } from "react";
import { yearOf, type OrgRecordKind } from "@/lib/orgRecords";
import { getOrgRecordFileUrl } from "@/app/(app)/hr/org-records/actions";
import { btnSecondary, labelCls, linkCls, panelToneCls, sectionTitleCls } from "@/lib/ui";

// 기관 대장 탭들이 함께 쓰는 조각 — 연도 필터·출력 패널·첨부 링크.

export const selCls =
  "mt-1 block rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";


// 연도 목록(내림차순) — 기록이 있는 연도만.
export function useYears(dates: string[]): number[] {
  return useMemo(() => {
    const s = new Set<number>();
    for (const d of dates) {
      const y = yearOf(d);
      if (y != null) s.add(y);
    }
    return [...s].sort((a, b) => b - a);
  }, [dates]);
}

export function YearFilter({
  years,
  value,
  onChange,
}: {
  years: number[];
  value: number | null;
  onChange: (y: number | null) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink-muted">
      연도
      <select
        className={selCls.replace("mt-1 ", "")}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">전체</option>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}년
          </option>
        ))}
      </select>
    </label>
  );
}

// 출력 — 연도 범위 + (수상만) 청소년 이름 가리기. PDF·Word 둘 다.
export function ExportPanel({ kind, years }: { kind: OrgRecordKind; years: number[] }) {
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [mask, setMask] = useState(false);

  const href = (format: "pdf" | "docx") => {
    const p = new URLSearchParams({ kind, format });
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (kind === "awards" && mask) p.set("mask", "1");
    return `/hr/org-records/export?${p.toString()}`;
  };
  const asc = [...years].sort((a, b) => a - b);

  return (
    <section className={panelToneCls("blue")}>
      <h3 className={sectionTitleCls("blue")}>출력 (수기 양식)</h3>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className={labelCls}>
          시작 연도
          <select className={selCls} value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">처음부터</option>
            {asc.map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
        </label>
        <label className={labelCls}>
          끝 연도
          <select className={selCls} value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">끝까지</option>
            {asc.map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
        </label>
        {kind === "awards" && (
          <label className="flex items-center gap-1.5 pb-2 text-sm text-ink-body">
            <input type="checkbox" checked={mask} onChange={(e) => setMask(e.target.checked)} />
            청소년 이름 가리기 <span className="text-xs text-ink-hint">(행감 제출용)</span>
          </label>
        )}
        <div className="flex gap-2">
          <a className={btnSecondary} href={href("pdf")}>
            PDF 내려받기
          </a>
          <a className={btnSecondary} href={href("docx")}>
            Word 내려받기
          </a>
        </div>
      </div>
    </section>
  );
}

// 첨부 열기 — 1시간 서명 URL 을 받아 새 창으로.
export function FileLink({ kind, id }: { kind: OrgRecordKind; id: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={`${linkCls} text-xs`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const r = await getOrgRecordFileUrl(kind, id);
        setBusy(false);
        if (r.ok) window.open(r.url, "_blank", "noopener");
        else alert(r.message);
      }}
    >
      📎 파일
    </button>
  );
}
