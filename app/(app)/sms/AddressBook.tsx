"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  parseContactLines,
  type SmsBundle,
  type SmsGroup,
  type SmsVisibility,
} from "@/lib/sms/text";
import {
  badgeNavy,
  badgeNeutral,
  btnDanger,
  btnPrimary,
  btnSecondary,
  inputCls,
  labelCls,
  noticeError,
  noticeWarning,
} from "@/lib/ui";
import { modalBackdrop, modalPanel, stepBox } from "./ui";

export type BusinessProgramOption = { id: string; name: string };

type Mode =
  | { kind: "fromCart"; bundles: SmsBundle[]; count: number }
  | { kind: "new" }
  | { kind: "edit"; group: SmsGroup };

async function call(url: string, method: string, body?: unknown): Promise<string | null> {
  try {
    const r = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!r.ok || j.ok === false) return j.error ?? `실패했습니다(${r.status}).`;
    return null;
  } catch {
    return "서버에 닿지 않았습니다.";
  }
}

// 주소록 저장·새로 만들기·수정 — 이름·분류·공개 범위·연결 사업.
//   담긴 명단 저장: DB 출처 사람은 참조로, 직접 입력만 번호로(서버가 정리).
export function GroupDialog({
  mode,
  programs,
  onClose,
  onSaved,
}: {
  mode: Mode;
  programs: BusinessProgramOption[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const g = mode.kind === "edit" ? mode.group : null;
  const [name, setName] = useState(g?.name ?? "");
  const [category, setCategory] = useState(g?.category ?? "");
  const [visibility, setVisibility] = useState<SmsVisibility>(g?.visibility ?? "private");
  const [programId, setProgramId] = useState(g?.business_program_id ?? "");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lines = useMemo(() => parseContactLines(text), [text]);
  const valid = lines.filter((l) => l.valid).length;
  const invalid = lines.length - valid;

  async function save() {
    setBusy(true);
    setError(null);
    const meta = { name, category, visibility, business_program_id: programId || null };
    const err =
      mode.kind === "edit"
        ? await call(`/api/sms/groups/${mode.group.id}`, "PATCH", { meta, ...(text.trim() ? { text } : {}) })
        : await call(
            "/api/sms/groups",
            "POST",
            mode.kind === "fromCart" ? { meta, bundles: mode.bundles } : { meta, text },
          );
    setBusy(false);
    if (err) return setError(err);
    onSaved(mode.kind === "edit" ? "주소록을 고쳤습니다." : `주소록 "${name}"을 저장했습니다.`);
  }

  const title =
    mode.kind === "edit" ? "주소록 고치기" : mode.kind === "fromCart" ? "담긴 명단을 주소록에 저장" : "새 주소록 만들기";

  return (
    <div className={modalBackdrop} role="dialog" aria-modal="true">
      <div className={`${modalPanel} max-w-lg`}>
        <h3 className="text-lg font-bold text-ink">{title}</h3>
        {mode.kind === "fromCart" && (
          <p className="mt-1 text-xs text-ink-muted">
            담긴 {mode.count}명을 저장합니다. 강사·직원 등은 번호를 복사하지 않고 연결만 저장해, 번호가 바뀌어도
            최신 번호로 보냅니다.
          </p>
        )}
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className={labelCls}>이름</span>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 동아리 대표 학부모" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={labelCls}>분류 (선택)</span>
              <input className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="예: 학부모, 협력기관" />
            </label>
            <label className="block">
              <span className={labelCls}>연결 사업 (선택)</span>
              <select className={inputCls} value={programId} onChange={(e) => setProgramId(e.target.value)}>
                <option value="">없음</option>
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="flex items-center gap-4 text-sm text-ink-body">
            <span className="text-xs font-medium text-ink-muted">공개 범위</span>
            <label className="flex items-center gap-1">
              <input type="radio" checked={visibility === "private"} onChange={() => setVisibility("private")} />
              나만
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" checked={visibility === "shared"} onChange={() => setVisibility("shared")} />
              전 직원 공유
            </label>
          </fieldset>
          {mode.kind !== "fromCart" && (
            <label className="block">
              <span className={labelCls}>
                {mode.kind === "edit"
                  ? "사람 명단 바꾸기 (선택 — 붙여넣으면 지금 명단을 이것으로 바꿉니다)"
                  : "사람 — 한 줄에 “이름, 번호” (엑셀 두 열 붙여넣기 가능)"}
              </span>
              <textarea className={`${inputCls} h-32 font-mono`} value={text} onChange={(e) => setText(e.target.value)} />
              {lines.length > 0 && (
                <span className="mt-1 block text-xs text-ink-muted">
                  번호 {valid}개{invalid > 0 && <span className="ml-1 text-stamp">· 잘못된 번호 {invalid}개 제외</span>}
                </span>
              )}
            </label>
          )}
          {error && <p className={noticeError}>{error}</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>
            취소
          </button>
          <button
            type="button"
            className={btnPrimary}
            disabled={busy || !name.trim() || (mode.kind === "new" && valid === 0)}
            onClick={save}
          >
            {busy ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

type GroupsResponse = { ok?: boolean; groups?: SmsGroup[]; missing?: boolean; error?: string };

async function fetchGroups(): Promise<GroupsResponse> {
  try {
    const r = await fetch("/api/sms/groups", { cache: "no-store" });
    const j = (await r.json()) as GroupsResponse;
    return r.ok ? j : { ok: false, error: j.error };
  } catch {
    return { ok: false };
  }
}

// 주소록 관리 — 내 것·공유 목록, 고치기·지우기(만든 사람과 관장·부장).
//   inline: '주소록·서식' 탭(?tab=library)에 창 없이 바로 펼칩니다(화면 탭 정리 2단계).
export function GroupManager({
  programs,
  onClose,
  onChanged,
  inline = false,
}: {
  programs: BusinessProgramOption[];
  onClose?: () => void;
  onChanged: (message: string) => void;
  inline?: boolean;
}) {
  const [groups, setGroups] = useState<SmsGroup[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SmsGroup | null>(null);
  const [creating, setCreating] = useState(false);

  const apply = useCallback((j: GroupsResponse) => {
    if (j.ok === false) return setError(j.error ?? "주소록을 불러오지 못했습니다.");
    setGroups(j.groups ?? []);
    setMissing(j.missing === true);
  }, []);
  const load = useCallback(() => {
    fetchGroups().then(apply);
  }, [apply]);
  useEffect(() => {
    let alive = true;
    fetchGroups().then((j) => {
      if (alive) apply(j);
    });
    return () => {
      alive = false;
    };
  }, [apply]);

  async function remove(g: SmsGroup) {
    if (!window.confirm(`주소록 "${g.name}"을 지울까요? 되돌릴 수 없습니다.`)) return;
    const err = await call(`/api/sms/groups/${g.id}`, "DELETE");
    if (err) return setError(err);
    onChanged(`주소록 "${g.name}"을 지웠습니다.`);
    load();
  }

  return (
    <div className={inline ? "" : modalBackdrop} role={inline ? undefined : "dialog"} aria-modal={inline ? undefined : true}>
      <div className={inline ? stepBox : `${modalPanel} max-w-2xl`}>
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-bold text-ink">{inline ? "주소록" : "주소록 관리"}</h3>
          <button type="button" className={`${btnPrimary} ml-auto`} disabled={missing} onClick={() => setCreating(true)}>
            새 주소록
          </button>
          {onClose && (
            <button type="button" className={btnSecondary} onClick={onClose}>
              닫기
            </button>
          )}
        </div>
        {missing && <p className={`${noticeWarning} mt-3`}>주소록 DB 표가 아직 없습니다. 마이그레이션 적용 후 쓸 수 있습니다.</p>}
        {error && <p className={`${noticeError} mt-3`}>{error}</p>}
        <ul className="mt-4 divide-y divide-rule">
          {groups?.length === 0 && !missing && <li className="py-4 text-center text-sm text-ink-muted">주소록이 없습니다.</li>}
          {groups?.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center gap-2 py-2.5">
              <span className="font-medium text-ink">{g.name}</span>
              <span className={g.visibility === "shared" ? badgeNavy : badgeNeutral}>
                {g.visibility === "shared" ? "공유" : "나만"}
              </span>
              <span className="text-xs text-ink-muted">
                {[g.category, g.business_program_name, `${g.member_count}명`, g.owner_name && `만든 사람 ${g.owner_name}`]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              {g.can_edit && (
                <span className="ml-auto flex gap-1">
                  <button type="button" className={btnSecondary} onClick={() => setEditing(g)}>
                    고치기
                  </button>
                  <button type="button" className={btnDanger} onClick={() => remove(g)}>
                    지우기
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
      {(editing || creating) && (
        <GroupDialog
          mode={editing ? { kind: "edit", group: editing } : { kind: "new" }}
          programs={programs}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={(m) => {
            setEditing(null);
            setCreating(false);
            onChanged(m);
            load();
          }}
        />
      )}
    </div>
  );
}
