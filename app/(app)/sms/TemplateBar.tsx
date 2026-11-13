"use client";

import { useCallback, useEffect, useState } from "react";
import {
  SMS_TEMPLATE_CATEGORIES,
  type SmsTemplate,
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

const CHIP_COUNT = 6;

type TemplatesResponse = { templates?: SmsTemplate[]; missing?: boolean };

// 문구함은 보조 기능 — 못 불러와도 발송은 됩니다(조용히 빈 목록).
async function fetchTemplates(): Promise<TemplatesResponse | null> {
  try {
    const r = await fetch("/api/sms/templates", { cache: "no-store" });
    return (await r.json()) as TemplatesResponse;
  } catch {
    return null;
  }
}

// 문구함 — 본문 위 자주 쓰는 문구 칩(즐겨찾기·많이 쓴 순 6개) + [문구함 전체] + [문구 저장].
export default function TemplateBar({
  body,
  onUse,
}: {
  body: string;
  onUse: (text: string) => void;
}) {
  const [templates, setTemplates] = useState<SmsTemplate[]>([]);
  const [missing, setMissing] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<SmsTemplate | "new" | null>(null);

  const apply = useCallback((j: TemplatesResponse | null) => {
    if (!j) return;
    setTemplates(j.templates ?? []);
    setMissing(j.missing === true);
  }, []);
  const load = useCallback(() => {
    fetchTemplates().then(apply);
  }, [apply]);
  useEffect(() => {
    let alive = true;
    fetchTemplates().then((j) => {
      if (alive) apply(j);
    });
    return () => {
      alive = false;
    };
  }, [apply]);

  function use(t: SmsTemplate) {
    if (body.trim() && !window.confirm("지금 본문을 이 문구로 바꿀까요?")) return;
    onUse(t.body);
    void call(`/api/sms/templates/${t.id}/use`, "POST").then(load);
  }

  return (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-ink-muted">자주 쓰는 문구</span>
        {templates.slice(0, CHIP_COUNT).map((t) => (
          <button
            key={t.id}
            type="button"
            className="rounded-full border border-[#cbd5e1] bg-[#f8fafc] px-3 py-1 text-xs text-ink-body hover:border-brand-blue hover:bg-brand-blue-soft"
            title={t.body}
            onClick={() => use(t)}
          >
            {t.is_favorite && "★ "}
            {t.title}
          </button>
        ))}
        {!missing && templates.length === 0 && <span className="text-xs text-ink-hint">저장한 문구가 없습니다.</span>}
        {missing && <span className="text-xs text-ink-hint">문구함 DB 표 적용 전입니다.</span>}
        <span className="ml-auto flex gap-1">
          <button type="button" className={btnSecondary} disabled={missing} onClick={() => setShowAll(true)}>
            문구함 전체
          </button>
          <button
            type="button"
            className={btnSecondary}
            disabled={missing || !body.trim()}
            onClick={() => setEditing("new")}
          >
            문구 저장
          </button>
        </span>
      </div>

      {showAll && (
        <TemplateList
          templates={templates}
          onClose={() => setShowAll(false)}
          onUse={(t) => {
            setShowAll(false);
            use(t);
          }}
          onEdit={(t) => setEditing(t)}
          onChanged={load}
        />
      )}
      {editing && (
        <TemplateForm
          initial={editing === "new" ? null : editing}
          body={editing === "new" ? body : editing.body}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

// 문구함(서식) 관리 — '주소록·서식' 탭(?tab=library)에 창 없이 펼칩니다.
//   [쓰기]를 누르면 본문에 넣고 '보내기' 탭으로 돌아갑니다(onUse).
export function TemplateLibrary({ onUse }: { onUse: (text: string) => void }) {
  const [templates, setTemplates] = useState<SmsTemplate[]>([]);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState<SmsTemplate | "new" | null>(null);
  const apply = useCallback((j: TemplatesResponse | null) => {
    if (!j) return;
    setTemplates(j.templates ?? []);
    setMissing(j.missing === true);
  }, []);
  const load = useCallback(() => {
    fetchTemplates().then(apply);
  }, [apply]);
  useEffect(() => {
    let alive = true;
    fetchTemplates().then((j) => {
      if (alive) apply(j);
    });
    return () => {
      alive = false;
    };
  }, [apply]);

  return (
    <>
      {missing ? (
        <p className={noticeWarning}>문구함 DB 표 적용 전입니다.</p>
      ) : (
        <TemplateList
          inline
          templates={templates}
          onNew={() => setEditing("new")}
          onUse={(t) => {
            onUse(t.body);
            void call(`/api/sms/templates/${t.id}/use`, "POST").then(load);
          }}
          onEdit={(t) => setEditing(t)}
          onChanged={load}
        />
      )}
      {editing && (
        <TemplateForm
          initial={editing === "new" ? null : editing}
          body={editing === "new" ? "" : editing.body}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </>
  );
}

function TemplateList({
  templates,
  onClose,
  onUse,
  onEdit,
  onChanged,
  onNew,
  inline = false,
}: {
  templates: SmsTemplate[];
  onClose?: () => void;
  onUse: (t: SmsTemplate) => void;
  onEdit: (t: SmsTemplate) => void;
  onChanged: () => void;
  onNew?: () => void;
  inline?: boolean;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const list = templates.filter(
    (t) =>
      (cat === "all" || t.category === cat) &&
      (!q.trim() || `${t.title} ${t.body}`.toLowerCase().includes(q.trim().toLowerCase())),
  );

  async function remove(t: SmsTemplate) {
    if (!window.confirm(`문구 "${t.title}"을 지울까요?`)) return;
    const err = await call(`/api/sms/templates/${t.id}`, "DELETE");
    if (err) return setError(err);
    onChanged();
  }
  async function favorite(t: SmsTemplate) {
    const err = await call(`/api/sms/templates/${t.id}`, "PATCH", { is_favorite: !t.is_favorite });
    if (err) return setError(err);
    onChanged();
  }

  return (
    <div className={inline ? "" : modalBackdrop} role={inline ? undefined : "dialog"} aria-modal={inline ? undefined : true}>
      <div className={inline ? stepBox : `${modalPanel} max-w-2xl`}>
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-bold text-ink">문구함(서식)</h3>
          {onNew && (
            <button type="button" className={`${btnPrimary} ml-auto`} onClick={onNew}>
              새 문구
            </button>
          )}
          {onClose && (
            <button type="button" className={`${btnSecondary} ${onNew ? "" : "ml-auto"}`} onClick={onClose}>
              닫기
            </button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <input className={`${inputCls} max-w-xs`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="검색" />
          <select className={`${inputCls} max-w-[9rem]`} value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="all">전체 분류</option>
            {SMS_TEMPLATE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        {error && <p className={`${noticeError} mt-3`}>{error}</p>}
        <ul className="mt-3 divide-y divide-rule">
          {list.length === 0 && <li className="py-4 text-center text-sm text-ink-muted">문구가 없습니다.</li>}
          {list.map((t) => (
            <li key={t.id} className="py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={t.is_favorite ? "text-warning" : "text-ink-hint"}
                  title={t.can_edit ? "즐겨찾기" : "만든 사람과 관장·부장만 바꿀 수 있습니다"}
                  disabled={!t.can_edit}
                  onClick={() => favorite(t)}
                >
                  {t.is_favorite ? "★" : "☆"}
                </button>
                <span className="font-medium text-ink">{t.title}</span>
                <span className={badgeNeutral}>{t.category}</span>
                <span className={t.visibility === "shared" ? badgeNavy : badgeNeutral}>
                  {t.visibility === "shared" ? "공유" : "나만"}
                </span>
                <span className="text-xs text-ink-muted">
                  {t.use_count}회 사용{t.owner_name ? ` · ${t.owner_name}` : ""}
                </span>
                <span className="ml-auto flex gap-1">
                  <button type="button" className={btnPrimary} onClick={() => onUse(t)}>
                    쓰기
                  </button>
                  {t.can_edit && (
                    <>
                      <button type="button" className={btnSecondary} onClick={() => onEdit(t)}>
                        고치기
                      </button>
                      <button type="button" className={btnDanger} onClick={() => remove(t)}>
                        지우기
                      </button>
                    </>
                  )}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-ink-body">{t.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function TemplateForm({
  initial,
  body,
  onClose,
  onSaved,
}: {
  initial: SmsTemplate | null;
  body: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [text, setText] = useState(body);
  const [category, setCategory] = useState(initial?.category ?? "안내");
  const [visibility, setVisibility] = useState<SmsVisibility>(initial?.visibility ?? "private");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    const payload = { title, body: text, category, visibility, ...(initial ? { is_favorite: initial.is_favorite } : {}) };
    const err = initial
      ? await call(`/api/sms/templates/${initial.id}`, "PATCH", payload)
      : await call("/api/sms/templates", "POST", payload);
    setBusy(false);
    if (err) return setError(err);
    onSaved();
  }

  return (
    <div className={modalBackdrop} role="dialog" aria-modal="true">
      <div className={`${modalPanel} max-w-lg`}>
        <h3 className="text-lg font-bold text-ink">{initial ? "문구 고치기" : "문구 저장"}</h3>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className={labelCls}>제목</span>
            <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 수업 휴강 안내" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={labelCls}>분류</span>
              <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
                {SMS_TEMPLATE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="flex items-end gap-3 pb-2 text-sm text-ink-body">
              <label className="flex items-center gap-1">
                <input type="radio" checked={visibility === "private"} onChange={() => setVisibility("private")} />
                나만
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" checked={visibility === "shared"} onChange={() => setVisibility("shared")} />
                전 직원 공유
              </label>
            </fieldset>
          </div>
          <label className="block">
            <span className={labelCls}>문구 (머리말·광고 표기는 발송 때 자동으로 붙습니다)</span>
            <textarea className={`${inputCls} h-32`} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          {!initial && <p className={noticeWarning}>개인 이름·번호가 든 문구는 공유하지 마세요.</p>}
          {error && <p className={noticeError}>{error}</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>
            취소
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !title.trim() || !text.trim()} onClick={save}>
            {busy ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
