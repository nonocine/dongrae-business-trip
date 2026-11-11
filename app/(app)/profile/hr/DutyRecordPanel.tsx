"use client";

// 복무 기록 — 하위 탭(연차 사용일 / 대휴 사용일 / 공가·병가 / 출장·외근·교육), 연도 선택, 합계 일수·시간, 목록.
//   본인 카드(driverId 없음) 또는 관장·hr 이 보는 직원 카드(driverId)에서 같은 모양으로 씁니다.
import { useEffect, useState } from "react";
import { getDutyRecord } from "@/app/(app)/profile/hr/dutyRecordActions";
import type { DutyRecord, DutyRecordKind } from "@/lib/erp/view";
import { ERP_NOTE, dayLabel } from "@/lib/erp/duty";
import { badgeWarning, noticeError, noticeWarning } from "@/lib/ui";

const KINDS: { key: DutyRecordKind; label: string }[] = [
  { key: "annual", label: "연차 사용일" },
  { key: "comp", label: "대휴 사용일" },
  { key: "publicSick", label: "공가·병가" },
  { key: "field", label: "출장·외근·교육" },
];
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const when = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function DutyRecordPanel({ driverId, thisYear }: { driverId?: string | null; thisYear: number }) {
  const [year, setYear] = useState(thisYear);
  const [kind, setKind] = useState<DutyRecordKind>("annual");
  const [res, setRes] = useState<{ key: string; record: DutyRecord | null; error: string | null } | null>(null);
  const key = `${driverId ?? "me"}:${year}`;

  useEffect(() => {
    let alive = true;
    getDutyRecord({ driverId: driverId ?? null, year }).then((r) => {
      if (!alive) return;
      setRes(r.ok ? { key, record: r.record, error: null } : { key, record: null, error: r.message });
    });
    return () => {
      alive = false;
    };
  }, [driverId, year, key]);

  const cur = res && res.key === key ? res : null;
  const rec = cur?.record ?? null;
  const g = rec ? rec.groups[kind] : null;

  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold text-ink">복무 기록</h3>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="rounded-md border border-line bg-card px-2 py-1 text-sm"
          aria-label="연도"
        >
          {[thisYear, thisYear - 1, thisYear - 2].map((y) => (
            <option key={y} value={y}>
              {y}년
            </option>
          ))}
        </select>
      </div>
      <div className="mt-2 flex flex-wrap gap-1" role="tablist">
        {KINDS.map((k) => (
          <button
            key={k.key}
            type="button"
            role="tab"
            aria-selected={kind === k.key}
            onClick={() => setKind(k.key)}
            className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${
              kind === k.key ? "bg-navy text-white" : "border border-line text-ink-muted hover:bg-surface"
            }`}
          >
            {k.label}
            {rec && <span className="ml-1 opacity-80">{rec.groups[k.key].rows.length}</span>}
          </button>
        ))}
      </div>

      {!cur ? (
        <p className="py-6 text-center text-sm text-ink-hint">불러오는 중…</p>
      ) : cur.error ? (
        <p className={`mt-3 ${noticeError}`}>{cur.error}</p>
      ) : !rec || !rec.linked || !g ? (
        <p className={`mt-3 ${noticeWarning}`}>ERP 계정 연결이 필요합니다(관리자 문의).</p>
      ) : (
        <>
          <p className="mt-3 text-sm text-ink-body">
            {year}년 합계 <b className="text-navy">{fmt(g.days)}일</b>
            {g.hours > 0 && (
              <>
                {" "}
                · <b className="text-navy">{fmt(g.hours)}시간</b>
              </>
            )}{" "}
            · {g.rows.length}건
          </p>
          {g.rows.length === 0 ? (
            <p className="py-4 text-center text-xs text-ink-hint">기록이 없습니다.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line/60">
              {g.rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5 text-sm">
                  <span className="w-36 shrink-0 text-xs text-ink-muted">
                    {r.start === r.end ? dayLabel(r.start) : `${dayLabel(r.start)} ~ ${dayLabel(r.end)}`}
                  </span>
                  <span className="font-medium text-ink">{r.type}</span>
                  <span className="text-xs text-ink-muted">{r.time}</span>
                  <span className="text-xs text-ink-body">
                    {fmt(r.days)}일{r.hours != null && r.hours > 0 ? ` · ${fmt(r.hours)}시간` : ""}
                  </span>
                  {r.location && <span className="text-xs text-ink-body">· {r.location}</span>}
                  {r.inProgress && <span className={badgeWarning}>결재 중</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <p className="mt-2 text-[11px] text-ink-hint">
        시작일 기준 · ERP 결재 진행·완료만 · {ERP_NOTE}
        {rec?.syncedAt ? ` · 마지막 동기화 ${when(rec.syncedAt)}` : ""}
      </p>
    </div>
  );
}
