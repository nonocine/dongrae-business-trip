"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FacilityLocation } from "@/lib/facility";
import {
  createLocation,
  renameLocation,
  toggleLocation,
} from "@/app/hr/facility/actions";
import {
  cardCls,
  btnPrimary,
  badgeSuccess,
  badgeNeutral,
  noticeError,
} from "@/lib/ui";

const inCls =
  "block w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const thCls = "px-2 py-2 text-left text-xs font-semibold text-navy whitespace-nowrap";
const tdCls = "px-2 py-2 align-middle text-sm text-ink-body";
const rowBtn =
  "rounded border border-line px-2 py-1 text-xs text-ink-muted hover:bg-surface disabled:opacity-50";

export default function LocationManager({
  locations,
  counts,
}: {
  locations: FacilityLocation[];
  counts: Record<string, number>;
}) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function add() {
    const nm = newName.trim();
    if (!nm) return;
    setMsg(null);
    setBusyId("new");
    start(async () => {
      const res = await createLocation(nm);
      setBusyId(null);
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      setNewName("");
      setMsg({ ok: true, text: `'${nm}' 장소를 추가했습니다.` });
      router.refresh();
    });
  }

  function startRename(loc: FacilityLocation) {
    setMsg(null);
    setEditId(loc.id);
    setEditName(loc.name);
  }

  function submitRename(loc: FacilityLocation) {
    const nm = editName.trim();
    if (!nm || nm === loc.name) {
      setEditId(null);
      return;
    }
    // 같은 이름의 다른 장소가 있으면 병합(서버와 동일 판정 — 활성/비활성 무관).
    const willMerge = locations.some((l) => l.id !== loc.id && l.name === nm);
    const n = counts[loc.name] ?? 0;
    const confirmMsg = willMerge
      ? `'${loc.name}'을(를) 기존 장소 '${nm}'(으)로 통합합니다.\n이 장소를 쓰는 비품 ${n}건이 '${nm}'(으)로 이동합니다. 계속할까요?`
      : `'${loc.name}'을(를) '${nm}'(으)로 변경합니다.\n이 장소를 쓰는 비품 ${n}건도 함께 바뀝니다. 계속할까요?`;
    if (!confirm(confirmMsg)) return;

    setMsg(null);
    setBusyId(loc.id);
    start(async () => {
      const res = await renameLocation(loc.id, nm);
      setBusyId(null);
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      setEditId(null);
      setMsg({
        ok: true,
        text: res.merged
          ? `비품 ${res.moved}건을 '${res.newName}'(으)로 통합했습니다.`
          : `'${res.newName}'(으)로 변경했습니다.${
              res.moved > 0 ? ` (비품 ${res.moved}건 반영)` : ""
            }`,
      });
      router.refresh();
    });
  }

  function toggle(loc: FacilityLocation) {
    const next = !loc.is_active;
    if (
      !next &&
      !confirm(
        `'${loc.name}'을(를) 비활성화할까요?\n등록·수정 드롭다운에서 숨겨집니다. (기존 비품 표기는 유지)`
      )
    )
      return;
    setMsg(null);
    setBusyId(loc.id);
    start(async () => {
      const res = await toggleLocation(loc.id, next);
      setBusyId(null);
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      setMsg({
        ok: true,
        text: `'${loc.name}'을(를) ${next ? "활성화" : "비활성화"}했습니다.`,
      });
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {/* 추가 */}
      <section className={cardCls}>
        <label className="block text-[11px] font-semibold text-navy">
          장소 추가
        </label>
        <div className="mt-1 flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
            placeholder="예: 싱글벙글사무실"
            className={inCls}
          />
          <button
            type="button"
            onClick={add}
            disabled={pending || !newName.trim()}
            className={btnPrimary}
          >
            {busyId === "new" && pending ? "추가 중…" : "추가"}
          </button>
        </div>
      </section>

      {msg && (
        <p
          className={
            msg.ok
              ? "rounded-lg bg-success-soft px-3 py-2 text-xs text-success"
              : noticeError
          }
        >
          {msg.text}
        </p>
      )}

      {/* 목록 */}
      <section className={cardCls}>
        {locations.length === 0 ? (
          <div className="py-10 text-center text-sm text-ink-hint">
            등록된 장소가 없습니다.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th className={thCls}>장소명</th>
                  <th className={`${thCls} text-right`}>사용중 비품</th>
                  <th className={thCls}>상태</th>
                  <th className={`${thCls} text-right`}>관리</th>
                </tr>
              </thead>
              <tbody>
                {locations.map((loc) => {
                  const editing = editId === loc.id;
                  const busy = pending && busyId === loc.id;
                  return (
                    <tr key={loc.id} className="border-b border-line/60">
                      <td className={`${tdCls} font-medium text-ink`}>
                        {editing ? (
                          <input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") submitRename(loc);
                              if (e.key === "Escape") setEditId(null);
                            }}
                            autoFocus
                            className={`${inCls} max-w-[240px]`}
                          />
                        ) : (
                          <span className={loc.is_active ? "" : "text-ink-hint"}>
                            {loc.name}
                          </span>
                        )}
                      </td>
                      <td className={`${tdCls} text-right font-mono`}>
                        {counts[loc.name] ?? 0}
                      </td>
                      <td className={tdCls}>
                        <span className={loc.is_active ? badgeSuccess : badgeNeutral}>
                          {loc.is_active ? "활성" : "비활성"}
                        </span>
                      </td>
                      <td className={`${tdCls} text-right`}>
                        <div className="flex justify-end gap-1">
                          {editing ? (
                            <>
                              <button
                                type="button"
                                onClick={() => submitRename(loc)}
                                disabled={busy}
                                className={rowBtn}
                              >
                                저장
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditId(null)}
                                disabled={busy}
                                className={rowBtn}
                              >
                                취소
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => startRename(loc)}
                                disabled={busy}
                                className={rowBtn}
                              >
                                이름변경
                              </button>
                              <button
                                type="button"
                                onClick={() => toggle(loc)}
                                disabled={busy}
                                className={rowBtn}
                              >
                                {loc.is_active ? "비활성화" : "활성화"}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[11px] text-ink-hint">
          ‘사무실, 북카페, 로비’ 같은 복합 표기 장소는 여기서 개별 장소로 정리하거나
          비활성 처리하세요. 이름 변경으로 기존 장소와 합치면 자동 통합됩니다.
        </p>
      </section>
    </div>
  );
}
