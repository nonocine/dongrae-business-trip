"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateResult,
  setInspector,
  setCheckedOn,
  completeCheck,
  reopenCheck,
} from "@/app/hr/facility/safetyActions";
import {
  groupSafetyItems,
  ymLabel,
  SAFETY_RESULTS,
  type SafetyCheck,
  type SafetyItemWithResult,
  type SafetyResult,
} from "@/lib/safetyCheck";
import {
  cardCls,
  btnPrimary,
  btnSecondary,
  badgeSuccess,
  badgeNeutral,
  badgeDanger,
  noticeError,
  noticeSuccess,
} from "@/lib/ui";

const inCls =
  "rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy disabled:opacity-60";

export default function SafetyDetail({
  check,
  items: initialItems,
}: {
  check: SafetyCheck;
  items: SafetyItemWithResult[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [inspector, setInspectorVal] = useState(check.inspector ?? "");
  const [checkedOn, setCheckedOnVal] = useState(check.checked_on ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const completed = check.status === "completed";
  const readOnly = completed;

  const failCount = useMemo(
    () => items.filter((i) => i.result === "fail").length,
    [items]
  );
  const groups = useMemo(() => groupSafetyItems(items), [items]);

  function patchLocal(itemId: string, patch: Partial<SafetyItemWithResult>) {
    setItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, ...patch } : i))
    );
  }

  function setResult(item: SafetyItemWithResult, result: SafetyResult) {
    if (readOnly || result === item.result) return;
    const prevResult = item.result;
    patchLocal(item.id, { result });
    setMsg(null);
    start(async () => {
      const res = await updateResult(check.id, item.id, result, item.note);
      if (!res.ok) {
        patchLocal(item.id, { result: prevResult }); // 롤백
        setMsg({ ok: false, text: res.message });
      }
    });
  }

  function saveNote(item: SafetyItemWithResult, note: string) {
    if (readOnly || note === (item.note ?? "")) return;
    patchLocal(item.id, { note: note || null });
    start(async () => {
      const res = await updateResult(check.id, item.id, item.result, note || null);
      if (!res.ok) setMsg({ ok: false, text: res.message });
    });
  }

  function saveInspector() {
    if (readOnly || inspector === (check.inspector ?? "")) return;
    start(async () => {
      const res = await setInspector(check.id, inspector);
      if (!res.ok) setMsg({ ok: false, text: res.message });
    });
  }
  function saveCheckedOn() {
    if (readOnly || checkedOn === (check.checked_on ?? "")) return;
    start(async () => {
      const res = await setCheckedOn(check.id, checkedOn);
      if (!res.ok) setMsg({ ok: false, text: res.message });
    });
  }

  function complete() {
    setMsg(null);
    start(async () => {
      const res = await completeCheck(check.id);
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      router.refresh();
    });
  }
  function reopen() {
    setMsg(null);
    start(async () => {
      const res = await reopenCheck(check.id);
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <section className={cardCls}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-ink">
              {ymLabel(check.check_year, check.check_month)} 안전점검
            </h3>
            <span className={completed ? badgeSuccess : badgeNeutral}>
              {completed ? "완료" : "작성중"}
            </span>
            <span className={failCount > 0 ? badgeDanger : badgeNeutral}>
              부적합 {failCount}건
            </span>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`/hr/facility/safety/${check.id}/export`}
              className={btnSecondary}
              title={
                completed
                  ? "점검표 PDF 다운로드"
                  : "작성중 미리보기(완료 후 다운로드 권장)"
              }
            >
              PDF {completed ? "다운로드" : "미리보기"}
            </a>
            {completed ? (
              <button
                type="button"
                onClick={reopen}
                disabled={pending}
                className={btnSecondary}
              >
                수정 재개
              </button>
            ) : (
              <button
                type="button"
                onClick={complete}
                disabled={pending}
                className={btnPrimary}
              >
                점검 완료
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-[11px] font-semibold text-navy">
              점검일시
            </label>
            <input
              type="date"
              value={checkedOn}
              onChange={(e) => setCheckedOnVal(e.target.value)}
              onBlur={saveCheckedOn}
              disabled={readOnly}
              className={`${inCls} mt-1 w-full`}
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-navy">
              점검자
            </label>
            <input
              value={inspector}
              onChange={(e) => setInspectorVal(e.target.value)}
              onBlur={saveInspector}
              disabled={readOnly}
              placeholder="점검자 성명"
              className={`${inCls} mt-1 w-full`}
            />
          </div>
        </div>

        {msg && (
          <p className={`mt-3 ${msg.ok ? noticeSuccess : noticeError}`}>{msg.text}</p>
        )}
        {readOnly && (
          <p className="mt-3 rounded-lg bg-surface px-3 py-2 text-xs text-ink-muted">
            완료된 점검표입니다. 수정하려면 “수정 재개”를 누르세요.
          </p>
        )}
      </section>

      {/* 항목 */}
      {groups.map((g) => (
        <section key={g.section} className={cardCls}>
          <h4 className="mb-2 text-sm font-bold text-navy">{g.section}</h4>
          <div className="space-y-3">
            {g.categories.map((cat) => (
              <div key={cat.category}>
                <p className="mb-1 text-xs font-semibold text-ink-muted">
                  {cat.category}
                </p>
                <div className="divide-y divide-line/60">
                  {cat.items.map((it) => (
                    <ItemRow
                      key={it.id}
                      item={it}
                      readOnly={readOnly}
                      onResult={(r) => setResult(it, r)}
                      onNote={(n) => saveNote(it, n)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ItemRow({
  item,
  readOnly,
  onResult,
  onNote,
}: {
  item: SafetyItemWithResult;
  readOnly: boolean;
  onResult: (r: SafetyResult) => void;
  onNote: (n: string) => void;
}) {
  const [note, setNote] = useState(item.note ?? "");
  return (
    <div className="py-2">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-ink-body">
          <span className="mr-1.5 font-mono text-xs text-ink-hint">
            {item.item_no}.
          </span>
          {item.content}
        </p>
        <div className="flex shrink-0 gap-1">
          {SAFETY_RESULTS.map((r) => {
            const active = item.result === r.value;
            const activeCls =
              r.value === "fail"
                ? "border-stamp bg-stamp text-white"
                : r.value === "pass"
                  ? "border-navy bg-navy text-white"
                  : "border-ink-muted bg-ink-muted text-white";
            return (
              <button
                key={r.value}
                type="button"
                onClick={() => onResult(r.value)}
                disabled={readOnly}
                className={`rounded border px-2 py-1 text-xs font-semibold transition disabled:opacity-50 ${
                  active
                    ? activeCls
                    : "border-line text-ink-muted hover:bg-surface"
                }`}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </div>
      {item.result === "fail" && (
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => onNote(note)}
          disabled={readOnly}
          placeholder="지적사항(보수 필요 내용 등)"
          className="mt-1.5 block w-full rounded-md border border-stamp/40 bg-stamp-soft/30 px-2.5 py-1.5 text-sm text-ink-body focus:border-stamp focus:outline-none focus:ring-1 focus:ring-stamp disabled:opacity-60"
        />
      )}
    </div>
  );
}
