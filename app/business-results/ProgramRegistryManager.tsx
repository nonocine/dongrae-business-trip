"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createBusinessCategory,
  createBusinessProgram,
  updateBusinessCategory,
  updateBusinessProgram,
  type BusinessCategory,
  type BusinessProgram,
  type ProgramRegistry,
} from "./actions";
import {
  badgeNeutral,
  badgeSuccess,
  btnPrimary,
  cardCls,
  noticeError,
  noticeSuccess,
} from "@/lib/ui";

// /hr/facility 의 장소 마스터 관리와 같은 패턴 — 삭제 없이 비활성 토글로 숨깁니다.
const inCls =
  "block w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm placeholder:text-ink-hint focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const rowBtn =
  "rounded border border-line px-2 py-1 text-xs text-ink-muted hover:bg-surface disabled:opacity-50";

type Editing = { kind: "category" | "program"; id: string; name: string };

export default function ProgramRegistryManager({
  registry,
}: {
  registry: ProgramRegistry;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [newProgram, setNewProgram] = useState("");
  const [targetCategory, setTargetCategory] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function run(
    task: () => Promise<{ ok: boolean; message?: string }>,
    okText: string,
  ) {
    setMsg(null);
    start(async () => {
      const res = await task();
      if (!res.ok) {
        setMsg({ ok: false, text: res.message ?? "처리하지 못했습니다." });
        return;
      }
      setEditing(null);
      setMsg({ ok: true, text: okText });
      router.refresh();
    });
  }

  if (!registry.configured)
    return (
      <section className={cardCls}>
        <h3 className="font-bold text-ink">사업 등록 관리</h3>
        <p className="mt-2 text-sm leading-6 text-ink-muted">
          레지스트리 테이블을 아직 적용하지 않았습니다. 적용 전까지는 분야·사업명을
          직접 입력해 저장할 수 있습니다.
        </p>
      </section>
    );

  const programsOf = (categoryId: string) =>
    registry.programs.filter((p) => p.category_id === categoryId);

  function saveName(item: BusinessCategory | BusinessProgram, kind: Editing["kind"]) {
    if (!editing) return;
    const nm = editing.name.trim();
    if (!nm || nm === item.name) {
      setEditing(null);
      return;
    }
    run(
      () =>
        kind === "category"
          ? updateBusinessCategory(item.id, { name: nm })
          : updateBusinessProgram(item.id, { name: nm }),
      `'${nm}'(으)로 변경했습니다.`,
    );
  }

  function toggle(
    item: BusinessCategory | BusinessProgram,
    kind: Editing["kind"],
  ) {
    const next = !item.is_active;
    if (
      !next &&
      !confirm(
        `'${item.name}'을(를) 비활성화할까요?\n입력 드롭다운에서 숨겨집니다. (과거 실적 표기는 유지)`,
      )
    )
      return;
    run(
      () =>
        kind === "category"
          ? updateBusinessCategory(item.id, { is_active: next })
          : updateBusinessProgram(item.id, { is_active: next }),
      `'${item.name}'을(를) ${next ? "활성화" : "비활성화"}했습니다.`,
    );
  }

  function move(
    item: BusinessCategory | BusinessProgram,
    kind: Editing["kind"],
    delta: number,
  ) {
    run(
      () =>
        kind === "category"
          ? updateBusinessCategory(item.id, {
              sort_order: Math.max(0, item.sort_order + delta),
            })
          : updateBusinessProgram(item.id, {
              sort_order: Math.max(0, item.sort_order + delta),
            }),
      "표시순서를 변경했습니다.",
    );
  }

  return (
    <section className={cardCls}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-ink">사업 등록 관리</h3>
          <p className="mt-1 text-xs text-ink-muted">
            분야 {registry.categories.length}개 · 사업{" "}
            {registry.programs.length}개 (관리자 전용)
          </p>
        </div>
        <button
          type="button"
          className={rowBtn}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "접기" : "펼치기"}
        </button>
      </div>

      {open && (
        <div className="mt-4 space-y-4">
          {msg && (
            <p className={msg.ok ? noticeSuccess : noticeError}>{msg.text}</p>
          )}

          {/* 분야 추가 */}
          <div className="rounded-lg border border-dashed border-line bg-surface p-3">
            <label className="block text-[11px] font-semibold text-navy">
              분야 추가
            </label>
            <div className="mt-1 flex gap-2">
              <input
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="예: 디지털 기반 활동"
                className={inCls}
              />
              <button
                type="button"
                className={btnPrimary}
                disabled={pending || !newCategory.trim()}
                onClick={() => {
                  const nm = newCategory;
                  run(
                    () => createBusinessCategory(nm),
                    `'${nm.trim()}' 분야를 추가했습니다.`,
                  );
                  setNewCategory("");
                }}
              >
                추가
              </button>
            </div>
          </div>

          {/* 사업 추가 */}
          <div className="rounded-lg border border-dashed border-line bg-surface p-3">
            <label className="block text-[11px] font-semibold text-navy">
              세부사업 추가
            </label>
            <div className="mt-1 flex flex-col gap-2 sm:flex-row">
              <select
                value={targetCategory}
                onChange={(e) => setTargetCategory(e.target.value)}
                className={`${inCls} sm:max-w-[240px]`}
              >
                <option value="">분야 선택</option>
                {registry.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                value={newProgram}
                onChange={(e) => setNewProgram(e.target.value)}
                placeholder="예: 특성화체험활동 On-나-Go"
                className={inCls}
              />
              <button
                type="button"
                className={btnPrimary}
                disabled={pending || !targetCategory || !newProgram.trim()}
                onClick={() => {
                  const nm = newProgram;
                  run(
                    () => createBusinessProgram(targetCategory, nm),
                    `'${nm.trim()}' 사업을 추가했습니다.`,
                  );
                  setNewProgram("");
                }}
              >
                추가
              </button>
            </div>
          </div>

          {/* 목록 */}
          <div className="space-y-3">
            {registry.categories.map((c) => (
              <div key={c.id} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-8 text-center text-xs text-ink-hint">
                    {c.sort_order}
                  </span>
                  {editing?.kind === "category" && editing.id === c.id ? (
                    <input
                      autoFocus
                      value={editing.name}
                      onChange={(e) =>
                        setEditing({ ...editing, name: e.target.value })
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveName(c, "category");
                        if (e.key === "Escape") setEditing(null);
                      }}
                      className={`${inCls} max-w-[280px]`}
                    />
                  ) : (
                    <b
                      className={`text-sm ${c.is_active ? "text-ink" : "text-ink-hint"}`}
                    >
                      {c.name}
                    </b>
                  )}
                  <span className={c.is_active ? badgeSuccess : badgeNeutral}>
                    {c.is_active ? "활성" : "비활성"}
                  </span>
                  <div className="ml-auto flex gap-1">
                    {editing?.kind === "category" && editing.id === c.id ? (
                      <>
                        <button
                          type="button"
                          className={rowBtn}
                          disabled={pending}
                          onClick={() => saveName(c, "category")}
                        >
                          저장
                        </button>
                        <button
                          type="button"
                          className={rowBtn}
                          onClick={() => setEditing(null)}
                        >
                          취소
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={rowBtn}
                          disabled={pending}
                          onClick={() => move(c, "category", -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className={rowBtn}
                          disabled={pending}
                          onClick={() => move(c, "category", 1)}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className={rowBtn}
                          onClick={() =>
                            setEditing({
                              kind: "category",
                              id: c.id,
                              name: c.name,
                            })
                          }
                        >
                          이름변경
                        </button>
                        <button
                          type="button"
                          className={rowBtn}
                          disabled={pending}
                          onClick={() => toggle(c, "category")}
                        >
                          {c.is_active ? "비활성화" : "활성화"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <ul className="mt-2 space-y-1 border-t border-line/60 pt-2">
                  {programsOf(c.id).map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-wrap items-center gap-2 text-sm"
                    >
                      <span className="w-8 text-center text-xs text-ink-hint">
                        {p.sort_order}
                      </span>
                      {editing?.kind === "program" && editing.id === p.id ? (
                        <input
                          autoFocus
                          value={editing.name}
                          onChange={(e) =>
                            setEditing({ ...editing, name: e.target.value })
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveName(p, "program");
                            if (e.key === "Escape") setEditing(null);
                          }}
                          className={`${inCls} max-w-[320px]`}
                        />
                      ) : (
                        <span
                          className={
                            p.is_active ? "text-ink-body" : "text-ink-hint"
                          }
                        >
                          {p.name}
                        </span>
                      )}
                      {!p.is_active && (
                        <span className={badgeNeutral}>비활성</span>
                      )}
                      <div className="ml-auto flex gap-1">
                        {editing?.kind === "program" && editing.id === p.id ? (
                          <>
                            <button
                              type="button"
                              className={rowBtn}
                              disabled={pending}
                              onClick={() => saveName(p, "program")}
                            >
                              저장
                            </button>
                            <button
                              type="button"
                              className={rowBtn}
                              onClick={() => setEditing(null)}
                            >
                              취소
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className={rowBtn}
                              disabled={pending}
                              onClick={() => move(p, "program", -1)}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className={rowBtn}
                              disabled={pending}
                              onClick={() => move(p, "program", 1)}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              className={rowBtn}
                              onClick={() =>
                                setEditing({
                                  kind: "program",
                                  id: p.id,
                                  name: p.name,
                                })
                              }
                            >
                              이름변경
                            </button>
                            <button
                              type="button"
                              className={rowBtn}
                              disabled={pending}
                              onClick={() => toggle(p, "program")}
                            >
                              {p.is_active ? "비활성화" : "활성화"}
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                  {programsOf(c.id).length === 0 && (
                    <li className="py-2 text-center text-xs text-ink-hint">
                      등록된 세부사업이 없습니다.
                    </li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
