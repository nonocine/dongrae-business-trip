"use client";

// 사업실적 [프로그램 관리] 탭 (?tab=registry, 관장·부장·master·business_admin 직무 — lib/businessProgramAccess).
//   1) 프로그램 목록 — 분야별 묶음, 이름·담당자·다른 이름·사용 여부·올해 실적 건수,
//      대관 연결(읽기 전용 요약). 새 등록 / 수정 / 사용 중지(삭제 없음).
//   2) 미등록 이름 정리 — program_id 없이 직접 입력된 실적 이름을 묶어(공백·따옴표
//      무시) 기존 프로그램에 연결하거나 새 프로그램으로 등록합니다. 연결은
//      program_id 만 채우고 실적 숫자·당시 이름은 그대로 둡니다.
//   목록은 탭을 열 때 서버에서 한 번 읽고, 저장할 때마다 다시 읽습니다.
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  badgeNeutral,
  badgeSuccess,
  badgeWarning,
  btnPrimary,
  btnSecondary,
  cardCls,
  inputCls,
  labelCls,
  noticeError,
  noticeSuccess,
  noticeWarning,
} from "@/lib/ui";
import {
  createProgram,
  getProgramAdminData,
  linkNamesToProgram,
  markNotProgram,
  registerNamesAsProgram,
  setProgramActive,
  unmarkNotProgram,
  updateProgram,
  type ProgramInput,
} from "./programAdminActions";
import type {
  AdminProgram,
  ProgramAdminData,
  UnregisteredGroup,
} from "@/lib/businessProgramAdmin";
import type { RentalLink } from "@/lib/businessRentalSync";

const rowBtn =
  "rounded border border-line px-2 py-1 text-xs text-ink-muted hover:bg-surface disabled:opacity-50";

type Msg = { ok: boolean; text: string } | null;

function splitAliases(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((a) => a.trim())
    .filter(Boolean);
}

function rentalLinkLabel(l: RentalLink): string {
  const target = l.rental_program_name?.trim() && l.rental_program_name !== "*"
    ? `'${l.rental_program_name}'${l.match_mode === "contains" ? " 포함" : ""}`
    : `공간 ${l.rental_space_name ?? ""}`;
  const space =
    l.rental_program_name?.trim() && l.rental_space_name
      ? ` · ${l.rental_space_name}`
      : "";
  return `${target}${space} · ${l.count_mode === "session" ? "회차" : "일자"} 기준 · ${String(l.start_month).slice(0, 7)}부터${l.is_active ? "" : " · 꺼짐"}`;
}

// 새 등록·수정 공용 입력 칸.
function ProgramFields({
  data,
  value,
  onChange,
}: {
  data: ProgramAdminData;
  value: ProgramInput & { aliasText: string };
  onChange: (v: ProgramInput & { aliasText: string }) => void;
}) {
  const drivers = data.drivers.filter(
    (d) => d.is_active || d.id === value.manager_driver_id,
  );
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <label className={labelCls}>
        분야
        <select
          className={inputCls}
          value={value.category_id}
          onChange={(e) => onChange({ ...value, category_id: e.target.value })}
        >
          <option value="">분야 선택</option>
          {data.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.is_active ? "" : " (사용 안 함)"}
            </option>
          ))}
        </select>
      </label>
      <label className={labelCls}>
        프로그램 이름
        <input
          className={inputCls}
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          placeholder="예: 특성화체험활동 On-나-Go"
        />
      </label>
      <label className={labelCls}>
        담당자
        <select
          className={inputCls}
          value={value.manager_driver_id ?? ""}
          disabled={!data.extended}
          onChange={(e) =>
            onChange({ ...value, manager_driver_id: e.target.value || null })
          }
        >
          <option value="">(없음)</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.is_active ? "" : " (퇴직)"}
            </option>
          ))}
        </select>
      </label>
      <label className={labelCls}>
        다른 이름 (쉼표·줄바꿈으로 구분)
        <textarea
          className={inputCls}
          rows={2}
          disabled={!data.extended}
          value={value.aliasText}
          onChange={(e) => onChange({ ...value, aliasText: e.target.value })}
          placeholder="홈페이지 대관명, 예전 이름 등"
        />
      </label>
      <label className={`${labelCls} md:col-span-2`}>
        메모
        <input
          className={inputCls}
          disabled={!data.extended}
          value={value.note}
          onChange={(e) => onChange({ ...value, note: e.target.value })}
        />
      </label>
    </div>
  );
}

type FormState = ProgramInput & { aliasText: string };
const emptyForm = (categoryId = ""): FormState => ({
  category_id: categoryId,
  name: "",
  manager_driver_id: null,
  aliases: [],
  note: "",
  aliasText: "",
});
const toInput = (f: FormState): ProgramInput => ({
  category_id: f.category_id,
  name: f.name,
  manager_driver_id: f.manager_driver_id,
  aliases: splitAliases(f.aliasText),
  note: f.note,
});

export default function ProgramAdminTab() {
  const router = useRouter();
  const [data, setData] = useState<ProgramAdminData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(true);
  // 열린 입력 — 새 등록("new") 또는 수정 중인 프로그램 id.
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());

  const reload = useCallback(async () => {
    const res = await getProgramAdminData();
    if (res.ok) {
      setData(res.data);
      setLoadError("");
    } else setLoadError(res.message);
  }, []);

  useEffect(() => {
    let alive = true;
    getProgramAdminData()
      .then((res) => {
        if (!alive) return;
        if (res.ok) setData(res.data);
        else setLoadError(res.message);
      })
      .catch(() => alive && setLoadError("프로그램 목록을 불러오지 못했습니다."));
    return () => {
      alive = false;
    };
  }, []);

  function run(
    task: () => Promise<{ ok: true } | { ok: false; message: string }>,
    okText: string | ((res: Record<string, unknown>) => string),
    after?: () => void,
  ) {
    setMsg(null);
    start(async () => {
      try {
        const res = await task();
        if (!res.ok) {
          setMsg({ ok: false, text: res.message });
          return;
        }
        after?.();
        setMsg({
          ok: true,
          text:
            typeof okText === "function"
              ? okText(res as unknown as Record<string, unknown>)
              : okText,
        });
        await reload();
        router.refresh();
      } catch {
        setMsg({ ok: false, text: "처리하지 못했습니다. 다시 시도해주세요." });
      }
    });
  }

  const driverName = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of data?.drivers ?? []) m.set(d.id, d.name);
    return m;
  }, [data?.drivers]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.programs.filter((p) => {
      if (!showInactive && !p.is_active) return false;
      if (!q) return true;
      const hay = [
        p.name,
        ...p.aliases,
        p.note,
        p.manager_driver_id ? (driverName.get(p.manager_driver_id) ?? "") : "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [data, query, showInactive, driverName]);

  if (loadError)
    return (
      <section className={cardCls}>
        <p className={noticeError}>{loadError}</p>
      </section>
    );
  if (!data)
    return (
      <section className={cardCls}>
        <p className="py-6 text-center text-sm text-ink-hint">불러오는 중…</p>
      </section>
    );
  if (!data.configured)
    return (
      <section className={cardCls}>
        <p className="text-sm text-ink-muted">
          사업 등록 테이블(business_programs)이 아직 적용되지 않았습니다.
        </p>
      </section>
    );

  const openNew = () => {
    setEditId("new");
    setForm(emptyForm(data.categories.find((c) => c.is_active)?.id ?? ""));
  };
  const openEdit = (p: AdminProgram) => {
    setEditId(p.id);
    setForm({
      category_id: p.category_id,
      name: p.name,
      manager_driver_id: p.manager_driver_id,
      aliases: p.aliases,
      note: p.note,
      aliasText: p.aliases.join(", "),
    });
  };
  const editingProgram = data.programs.find((p) => p.id === editId) ?? null;
  const renaming =
    editingProgram && form.name.trim() && form.name.trim() !== editingProgram.name;

  const formBox = (
    <div className="mt-3 rounded-lg border border-navy/30 bg-surface p-3">
      <p className="mb-2 text-sm font-bold text-ink">
        {editId === "new" ? "새 프로그램 등록" : `'${editingProgram?.name}' 수정`}
      </p>
      <ProgramFields data={data} value={form} onChange={setForm} />
      {renaming && (
        <p className="mt-2 text-xs text-ink-muted">
          이름을 바꾸면 예전 이름 &lsquo;{editingProgram?.name}&rsquo;은 다른 이름에
          자동으로 남고, 이미 입력된 실적의 이름은 그대로입니다.
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className={btnPrimary}
          disabled={pending || !form.category_id || !form.name.trim()}
          onClick={() =>
            editId === "new"
              ? run(
                  () => createProgram(toInput(form)),
                  `'${form.name.trim()}' 프로그램을 등록했습니다.`,
                  () => setEditId(null),
                )
              : run(
                  () => updateProgram(editId!, toInput(form)),
                  "저장했습니다.",
                  () => setEditId(null),
                )
          }
        >
          저장
        </button>
        <button type="button" className={btnSecondary} onClick={() => setEditId(null)}>
          취소
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <section className={cardCls}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-bold text-ink">프로그램 관리</h2>
            <p className="mt-1 text-xs text-ink-muted">
              분야 {data.categories.length}개 · 프로그램 {data.programs.length}개 ·
              실적 건수는 {data.year}년 기준 · 지우지 않고 &lsquo;사용 중지&rsquo;로
              입력 목록에서만 숨깁니다(과거 실적 이름은 그대로).
            </p>
          </div>
          <button
            type="button"
            className={btnPrimary}
            disabled={pending}
            onClick={openNew}
          >
            + 새 프로그램 등록
          </button>
        </div>

        {!data.extended && (
          <p className={`mt-3 ${noticeWarning}`}>
            담당자·다른 이름·메모 칸이 아직 DB에 없습니다. 이름·분야·사용 여부만
            바꿀 수 있습니다(business_program_admin.sql 적용 후 사용).
          </p>
        )}
        {msg && (
          <p className={`mt-3 ${msg.ok ? noticeSuccess : noticeError}`}>{msg.text}</p>
        )}
        {editId === "new" && formBox}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            className={`${inputCls} max-w-xs`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름·다른 이름·담당자 검색"
            aria-label="프로그램 검색"
          />
          <label className="flex items-center gap-1 text-xs text-ink-muted">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            사용 중지 포함
          </label>
        </div>

        <div className="mt-3 space-y-3">
          {data.categories.map((c) => {
            const list = filtered.filter((p) => p.category_id === c.id);
            if (list.length === 0 && query.trim()) return null;
            return (
              <div key={c.id} className="rounded-lg border border-line p-3">
                <div className="flex items-center gap-2">
                  <b className={`text-sm ${c.is_active ? "text-ink" : "text-ink-hint"}`}>
                    {c.name}
                  </b>
                  {!c.is_active && <span className={badgeNeutral}>분야 사용 안 함</span>}
                  <span className="text-xs text-ink-hint">{list.length}개</span>
                </div>
                <ul className="mt-2 divide-y divide-line/60 border-t border-line/60">
                  {list.map((p) => {
                    const links = data.rentalLinks.filter((l) => l.program_id === p.id);
                    return (
                      <li key={p.id} className="py-2 text-sm">
                        <div className="flex flex-wrap items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={
                                  p.is_active ? "font-semibold text-ink-body" : "text-ink-hint line-through"
                                }
                              >
                                {p.name}
                              </span>
                              <span className={p.is_active ? badgeSuccess : badgeNeutral}>
                                {p.is_active ? "사용" : "사용 중지"}
                              </span>
                              <span className="text-xs tabular-nums text-ink-muted">
                                {data.year}년 실적 {data.yearCounts[p.id] ?? 0}건
                              </span>
                            </div>
                            <p className="mt-0.5 text-xs text-ink-muted">
                              담당{" "}
                              {p.manager_driver_id
                                ? (driverName.get(p.manager_driver_id) ?? "(알 수 없음)")
                                : "-"}
                              {p.aliases.length > 0 && ` · 다른 이름: ${p.aliases.join(", ")}`}
                              {p.note && ` · ${p.note}`}
                            </p>
                            {links.length > 0 && (
                              <p className="mt-0.5 text-xs text-ink-hint">
                                대관 연결: {links.map(rentalLinkLabel).join(" / ")}
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <button
                              type="button"
                              className={rowBtn}
                              disabled={pending}
                              onClick={() => openEdit(p)}
                            >
                              수정
                            </button>
                            <button
                              type="button"
                              className={rowBtn}
                              disabled={pending}
                              onClick={() => {
                                if (
                                  p.is_active &&
                                  !confirm(
                                    `'${p.name}'을(를) 사용 중지할까요?\n실적 입력 목록에서 숨겨집니다. (과거 실적은 그대로)`,
                                  )
                                )
                                  return;
                                run(
                                  () => setProgramActive(p.id, !p.is_active),
                                  `'${p.name}'을(를) ${p.is_active ? "사용 중지" : "다시 사용"}했습니다.`,
                                );
                              }}
                            >
                              {p.is_active ? "사용 중지" : "다시 사용"}
                            </button>
                          </div>
                        </div>
                        {editId === p.id && formBox}
                      </li>
                    );
                  })}
                  {list.length === 0 && (
                    <li className="py-2 text-center text-xs text-ink-hint">
                      등록된 프로그램이 없습니다.
                    </li>
                  )}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      <UnregisteredNames data={data} pending={pending} run={run} />
    </div>
  );
}

// ---------------------------------------------------------------------
// 미등록 이름 정리
// ---------------------------------------------------------------------
function UnregisteredNames({
  data,
  pending,
  run,
}: {
  data: ProgramAdminData;
  pending: boolean;
  run: (
    task: () => Promise<{ ok: true } | { ok: false; message: string }>,
    okText: string | ((res: Record<string, unknown>) => string),
    after?: () => void,
  ) => void;
}) {
  const [open, setOpen] = useState<{ key: string; mode: "link" | "new" } | null>(
    null,
  );
  const [target, setTarget] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm());
  const [showExcluded, setShowExcluded] = useState(false);
  const total = data.groups.reduce((s, g) => s + g.count, 0);
  const programName = (id: string | null) =>
    data.programs.find((p) => p.id === id)?.name ?? "";
  const categoryName = (id: string) =>
    data.categories.find((c) => c.id === id)?.name ?? "";

  function openLink(g: UnregisteredGroup) {
    setOpen({ key: g.key, mode: "link" });
    setTarget(g.suggestedProgramId ?? "");
  }
  function openNew(g: UnregisteredGroup) {
    setOpen({ key: g.key, mode: "new" });
    setForm({
      ...emptyForm(data.categories.find((c) => c.is_active)?.id ?? ""),
      name: g.variants[0].name.trim(),
    });
  }
  const names = (g: UnregisteredGroup) => g.variants.map((v) => v.name);

  return (
    <section className={cardCls}>
      <h2 className="font-bold text-ink">미등록 이름 정리</h2>
      <p className="mt-1 text-xs leading-5 text-ink-muted">
        프로그램을 고르지 않고 직접 입력한 실적 {total}건을 이름별로 묶었습니다(공백·따옴표
        모양만 다르면 한 묶음). 연결하면 그 이름의 실적 전부에 프로그램이 지정되고, 실적
        숫자와 당시 이름은 바뀌지 않습니다.
      </p>
      <div className="mt-3 space-y-2">
        {data.groups.length === 0 && (
          <p className="py-4 text-center text-sm text-ink-hint">
            정리할 직접 입력 이름이 없습니다.
          </p>
        )}
        {data.groups.map((g) => (
          <div key={g.key} className="rounded-lg border border-line p-3 text-sm">
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink-body">{g.variants[0].name}</p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  <b className="tabular-nums text-ink">{g.count}건</b> · {g.range}
                  {g.variants.length > 1 &&
                    ` · 표기 ${g.variants.length}가지: ${g.variants
                      .map((v) => `“${v.name}” ${v.count}`)
                      .join(", ")}`}
                </p>
                {g.suggestedProgramId && (
                  <p className="mt-0.5 text-xs">
                    <span className={badgeWarning}>추천</span>{" "}
                    등록된 &lsquo;{programName(g.suggestedProgramId)}&rsquo;과(와) 같은
                    이름입니다
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap gap-1">
                <button type="button" className={rowBtn} disabled={pending} onClick={() => openLink(g)}>
                  기존 프로그램에 연결
                </button>
                <button type="button" className={rowBtn} disabled={pending} onClick={() => openNew(g)}>
                  새 프로그램으로 등록
                </button>
                <button
                  type="button"
                  className={rowBtn}
                  disabled={pending || !data.exclusionsConfigured}
                  title={
                    data.exclusionsConfigured
                      ? "프로그램이 아닌 항목(회의·회원가입수 등)을 이 목록에서 숨깁니다"
                      : "business_program_admin.sql 적용 후 사용"
                  }
                  onClick={() =>
                    run(
                      () => markNotProgram(g.variants[0].name),
                      `'${g.variants[0].name}'을(를) 프로그램 아님으로 표시했습니다.`,
                    )
                  }
                >
                  프로그램 아님
                </button>
              </div>
            </div>

            {open?.key === g.key && open.mode === "link" && (
              <div className="mt-3 flex flex-col gap-2 rounded-lg bg-surface p-3 sm:flex-row sm:items-end">
                <label className={`${labelCls} flex-1`}>
                  연결할 프로그램
                  <select
                    className={inputCls}
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  >
                    <option value="">선택하세요</option>
                    {data.categories.map((c) => (
                      <optgroup key={c.id} label={c.name}>
                        {data.programs
                          .filter((p) => p.category_id === c.id)
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                              {p.is_active ? "" : " (사용 중지)"}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={btnPrimary}
                    disabled={pending || !target}
                    onClick={() => {
                      if (
                        !confirm(
                          `${g.count}건 연결됩니다.\n'${g.variants[0].name}' → '${programName(target)}'\n실적 숫자와 당시 이름은 바뀌지 않습니다.`,
                        )
                      )
                        return;
                      run(
                        () => linkNamesToProgram(names(g), target),
                        (res) => `${res.linked}건을 '${programName(target)}'에 연결했습니다.`,
                        () => setOpen(null),
                      );
                    }}
                  >
                    연결
                  </button>
                  <button type="button" className={btnSecondary} onClick={() => setOpen(null)}>
                    취소
                  </button>
                </div>
              </div>
            )}

            {open?.key === g.key && open.mode === "new" && (
              <div className="mt-3 rounded-lg bg-surface p-3">
                <ProgramFields data={data} value={form} onChange={setForm} />
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    className={btnPrimary}
                    disabled={pending || !form.category_id || !form.name.trim()}
                    onClick={() => {
                      if (
                        !confirm(
                          `'${form.name.trim()}'을(를) ${categoryName(form.category_id)} 분야에 등록하고 ${g.count}건 연결됩니다.\n실적 숫자와 당시 이름은 바뀌지 않습니다.`,
                        )
                      )
                        return;
                      run(
                        () => registerNamesAsProgram(names(g), toInput(form)),
                        (res) =>
                          `'${form.name.trim()}'을(를) 등록하고 ${res.linked}건을 연결했습니다.`,
                        () => setOpen(null),
                      );
                    }}
                  >
                    등록 후 연결
                  </button>
                  <button type="button" className={btnSecondary} onClick={() => setOpen(null)}>
                    취소
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {data.excluded.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <button
            type="button"
            className="text-xs font-semibold text-ink-muted hover:underline"
            onClick={() => setShowExcluded((v) => !v)}
          >
            프로그램 아님으로 숨긴 이름 {data.excluded.length}개 {showExcluded ? "접기" : "보기"}
          </button>
          {showExcluded && (
            <ul className="mt-2 space-y-1">
              {data.excluded.map((x) => (
                <li key={x.key} className="flex items-center gap-2 text-sm text-ink-muted">
                  <span>{x.name}</span>
                  <span className="text-xs tabular-nums">{x.count}건</span>
                  <button
                    type="button"
                    className={`ml-auto ${rowBtn}`}
                    disabled={pending}
                    onClick={() =>
                      run(() => unmarkNotProgram(x.key), `'${x.name}'을(를) 다시 목록에 표시합니다.`)
                    }
                  >
                    되돌리기
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
