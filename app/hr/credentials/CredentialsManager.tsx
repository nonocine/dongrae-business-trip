"use client";

// =====================================================================
// 공용 비밀번호 관리 화면 — 목록(카테고리 탭 + 검색) · 열람 · 등록/수정/삭제.
//   * 목록에는 비밀번호가 애초에 내려오지 않습니다 — 항상 ●●●●●●● 로 그리고,
//     [👁 보기] 를 누를 때 revealCredential 로 그 한 건만 받아옵니다.
//   * 받아온 평문은 이 컴포넌트 state 에만 두고, 다시 누르면 지웁니다.
//     1분이 지나면 자동으로 가려집니다(화면 켜둔 채 자리를 비우는 경우 대비).
//   * 권한(2026-08-21 개정): 등록은 로그인 직원 누구나(등록자는 자동으로 그 항목의
//     열람자가 됩니다). 수정은 M0 또는 등록자 본인(행의 canEdit). 삭제·열람자
//     지정은 M0 만(canManage). 이 값들은 모두 표시용이고, 실제 차단은 서버 액션이
//     다시 확인합니다.
//   * 반응형: 폰은 카드형(쌓임), sm 이상에서 표처럼 한 줄 배치.
// =====================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CREDENTIAL_CATEGORIES,
  CREDENTIAL_CATEGORY_BADGE,
  CREDENTIAL_MASK,
  type CredentialCategory,
  type CredentialRow,
  type CredentialStaff,
} from "@/lib/credentials";
import {
  createCredential,
  deleteCredential,
  listCredentialStaff,
  listCredentials,
  revealCredential,
  updateCredential,
} from "@/app/hr/credentials/actions";
import {
  badgeNeutral,
  btnDanger,
  btnPrimary,
  btnSecondary,
  cardCls,
  inputCls,
  labelCls,
  noticeError,
  noticeSuccess,
  noticeWarning,
} from "@/lib/ui";

// 열어 둔 비밀번호를 자동으로 가리는 시간(ms).
const AUTO_HIDE_MS = 60_000;

type Filter = "all" | CredentialCategory;
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "전체" },
  ...CREDENTIAL_CATEGORIES.map((c) => ({ key: c as Filter, label: c })),
];

type FormState = {
  id: string | null; // null = 신규
  name: string;
  category: CredentialCategory;
  account: string;
  password: string;
  url: string;
  memo: string;
  viewerIds: string[];
};

function emptyForm(): FormState {
  return {
    id: null,
    name: "",
    category: "기타",
    account: "",
    password: "",
    url: "",
    memo: "",
    viewerIds: [],
  };
}

function CategoryBadge({ category }: { category: CredentialCategory }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${CREDENTIAL_CATEGORY_BADGE[category]}`}
    >
      {category}
    </span>
  );
}

export default function CredentialsManager({
  initial,
  canManage,
  canCreate,
  keyConfigured,
}: {
  initial: CredentialRow[];
  canManage: boolean; // M0 — 삭제·열람자 지정
  canCreate: boolean; // 로그인 직원(명부 연결) — 등록
  keyConfigured: boolean;
}) {
  const [rows, setRows] = useState<CredentialRow[]>(initial);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // 열어 본 비밀번호 — { id: 평문 }. 가리면 즉시 지웁니다.
  const [shown, setShown] = useState<Record<string, string>>({});
  const [openingId, setOpeningId] = useState<string | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // 등록/수정 모달 + 삭제 확인.
  const [form, setForm] = useState<FormState | null>(null);
  const [staff, setStaff] = useState<CredentialStaff[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CredentialRow | null>(null);

  // 화면을 떠날 때 남은 타이머를 정리합니다(열린 값도 함께 사라집니다).
  useEffect(() => {
    const t = timers.current;
    return () => {
      for (const id of Object.keys(t)) clearTimeout(t[id]);
    };
  }, []);

  const hide = useCallback((id: string) => {
    const t = timers.current[id];
    if (t) {
      clearTimeout(t);
      delete timers.current[id];
    }
    setShown((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const shownRows = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "all" && r.category !== filter) return false;
      if (!kw) return true;
      return (
        r.name.toLowerCase().includes(kw) ||
        r.account.toLowerCase().includes(kw) ||
        r.url.toLowerCase().includes(kw) ||
        r.memo.toLowerCase().includes(kw)
      );
    });
  }, [rows, filter, q]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = {
      all: rows.length,
      메일: 0,
      구매: 0,
      은행: 0,
      기타: 0,
    };
    for (const r of rows) c[r.category]++;
    return c;
  }, [rows]);

  async function reload() {
    setRows(await listCredentials());
  }

  // [👁 보기] — 서버에서 그 한 건만 복호화해 받아옵니다.
  async function toggleReveal(row: CredentialRow) {
    if (row.id in shown) {
      hide(row.id);
      return;
    }
    setMsg(null);
    setOpeningId(row.id);
    const res = await revealCredential(row.id);
    setOpeningId(null);
    if (!res.ok) {
      setMsg({ ok: false, text: res.message });
      return;
    }
    setShown((prev) => ({ ...prev, [row.id]: res.password }));
    timers.current[row.id] = setTimeout(() => hide(row.id), AUTO_HIDE_MS);
  }

  async function copy(id: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMsg({ ok: true, text: "비밀번호를 복사했습니다." });
    } catch {
      setMsg({
        ok: false,
        text: "복사하지 못했습니다. 값을 직접 선택해 복사해 주세요.",
      });
    }
  }

  // 등록·수정 모달 열기 — 열람자 후보 명단은 처음 열 때 한 번만 받아옵니다.
  async function openForm(row: CredentialRow | null) {
    setMsg(null);
    setForm(
      row
        ? {
            id: row.id,
            name: row.name,
            category: row.category,
            account: row.account,
            password: "", // 수정에서는 비워 둡니다(입력할 때만 변경)
            url: row.url,
            memo: row.memo,
            viewerIds: row.viewerIds,
          }
        : emptyForm()
    );
    // 열람자 지정은 M0 만 — 그 외에는 명단을 요청하지 않습니다(서버도 거부).
    if (canManage && staff === null) {
      try {
        setStaff(await listCredentialStaff());
      } catch (e) {
        setStaff([]);
        setMsg({
          ok: false,
          text: e instanceof Error ? e.message : "직원 명단을 불러오지 못했습니다.",
        });
      }
    }
  }

  async function submitForm() {
    if (!form) return;
    setBusy(true);
    setMsg(null);
    const payload = {
      name: form.name,
      category: form.category,
      account: form.account,
      password: form.password,
      url: form.url,
      memo: form.memo,
      viewerIds: form.viewerIds,
    };
    const res = form.id
      ? await updateCredential(form.id, payload)
      : await createCredential(payload);
    if (!res.ok) {
      setBusy(false);
      setMsg({ ok: false, text: res.message });
      return;
    }
    // 저장 후 열려 있던 값은 모두 가립니다(바뀐 비번이 옛 값으로 남지 않게).
    for (const id of Object.keys(timers.current)) hide(id);
    setShown({});
    await reload();
    setBusy(false);
    setForm(null);
    setMsg({ ok: true, text: form.id ? "수정했습니다." : "등록했습니다." });
  }

  async function doDelete(row: CredentialRow) {
    setBusy(true);
    setMsg(null);
    const res = await deleteCredential(row.id);
    if (!res.ok) {
      setBusy(false);
      setMsg({ ok: false, text: res.message });
      return;
    }
    hide(row.id);
    await reload();
    setBusy(false);
    setConfirmDelete(null);
    setMsg({ ok: true, text: "삭제했습니다." });
  }

  return (
    <div className="space-y-4">
      {canCreate && !keyConfigured && (
        <p className={noticeWarning}>
          암호화 마스터키(CREDENTIAL_MASTER_KEY)가 이 환경에 설정되지 않았습니다.
          등록·열람이 되지 않습니다 — 배포 환경변수에 등록한 뒤 다시 배포해
          주세요. (키 없이 평문으로 저장하지는 않습니다)
        </p>
      )}

      <section className={cardCls}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-bold text-ink">공용 비밀번호</h2>
          <span className="text-xs text-ink-hint">
            {canManage
              ? "항목마다 열람할 수 있는 직원을 지정합니다."
              : "내가 올린 항목과, 열람 권한을 받은 항목만 보입니다."}
          </span>
          {canCreate && (
            <button
              type="button"
              className={`${btnPrimary} ml-auto`}
              onClick={() => openForm(null)}
              disabled={busy}
            >
              + 새 항목
            </button>
          )}
        </div>

        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${
                  filter === f.key
                    ? "border-navy bg-navy text-white"
                    : "border-line bg-card text-ink-body hover:bg-surface"
                }`}
              >
                {f.label}
                <span
                  className={`ml-1.5 text-xs font-normal ${
                    filter === f.key ? "text-white/80" : "text-ink-hint"
                  }`}
                >
                  {counts[f.key]}
                </span>
              </button>
            ))}
          </div>
          <input
            className={`${inputCls} sm:ml-auto sm:max-w-[240px]`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름·계정·주소·메모 검색"
            aria-label="비밀번호 항목 검색"
          />
        </div>

        {msg && (
          <p className={`mb-3 ${msg.ok ? noticeSuccess : noticeError}`}>
            {msg.text}
          </p>
        )}

        {shownRows.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-muted">
            {rows.length === 0
              ? canManage
                ? "아직 등록된 항목이 없습니다. [+ 새 항목] 으로 등록하세요."
                : "열람 가능한 항목이 없습니다."
              : "조건에 맞는 항목이 없습니다."}
          </p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            {shownRows.map((r) => {
              const plain = shown[r.id];
              return (
                <li
                  key={r.id}
                  className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5">
                      <CategoryBadge category={r.category} />
                      <span className="min-w-0 truncate text-sm font-semibold text-ink">
                        {r.name}
                      </span>
                    </p>
                    <p className="mt-0.5 truncate text-xs text-ink-muted">
                      {r.account ? `계정 ${r.account}` : "계정 미기재"}
                      {r.url ? " · " : ""}
                      {r.url && (
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-navy underline-offset-2 hover:underline"
                        >
                          바로가기
                        </a>
                      )}
                    </p>
                    {r.memo && (
                      <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-ink-hint">
                        {r.memo}
                      </p>
                    )}
                    {canManage && (
                      <p className="mt-1 text-[11px] text-ink-hint">
                        열람{" "}
                        {r.viewerNames.length > 0
                          ? r.viewerNames.join(" · ")
                          : "지정 없음(관장·부장만)"}
                        {r.updatedOn ? ` · 수정 ${r.updatedOn}` : ""}
                      </p>
                    )}
                  </div>

                  {/* 비밀번호 자리 — 열기 전에는 항상 고정 마스크 */}
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <code className="min-w-[92px] rounded-md border border-line bg-surface px-2 py-1 font-mono text-sm text-ink-body">
                      {plain ?? CREDENTIAL_MASK}
                    </code>
                    <button
                      type="button"
                      className={btnSecondary}
                      onClick={() => toggleReveal(r)}
                      disabled={openingId === r.id}
                    >
                      {plain
                        ? "🙈 가리기"
                        : openingId === r.id
                          ? "여는 중…"
                          : "👁 보기"}
                    </button>
                    {plain && (
                      <button
                        type="button"
                        className={btnSecondary}
                        onClick={() => copy(r.id, plain)}
                      >
                        복사
                      </button>
                    )}
                    {/* 수정 = M0 또는 내가 등록한 항목 / 삭제 = M0 만 */}
                    {r.canEdit && (
                      <button
                        type="button"
                        className={btnSecondary}
                        onClick={() => openForm(r)}
                        disabled={busy}
                      >
                        수정
                      </button>
                    )}
                    {canManage && (
                      <button
                        type="button"
                        className={btnDanger}
                        onClick={() => setConfirmDelete(r)}
                        disabled={busy}
                      >
                        삭제
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {Object.keys(shown).length > 0 && (
          <p className="mt-3 text-[11px] text-ink-hint">
            열어 둔 비밀번호는 1분 뒤 자동으로 가려집니다. 화면을 떠나면 즉시
            사라집니다.
          </p>
        )}
      </section>

      {form && (
        <FormModal
          form={form}
          setForm={setForm}
          staff={staff}
          canManage={canManage}
          busy={busy}
          onClose={() => setForm(null)}
          onSubmit={submitForm}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-line bg-card p-5 shadow-2xl">
            <h3 className="text-base font-bold text-ink">
              {confirmDelete.name} 항목을 삭제할까요?
            </h3>
            <p className="mt-2 text-sm text-ink-muted">
              저장된 비밀번호와 열람자 지정이 함께 지워집니다. 되돌릴 수 없습니다.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className={btnDanger}
                disabled={busy}
                onClick={() => doDelete(confirmDelete)}
              >
                삭제
              </button>
              <button
                type="button"
                className={btnSecondary}
                disabled={busy}
                onClick={() => setConfirmDelete(null)}
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// 등록·수정 모달 — 수정 시 비밀번호 칸은 비워 두면 기존 값이 유지됩니다.
// =====================================================================
function FormModal({
  form,
  setForm,
  staff,
  canManage,
  busy,
  onClose,
  onSubmit,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  staff: CredentialStaff[] | null;
  canManage: boolean; // 열람자 지정(M0)만 체크박스 목록을 봅니다
  busy: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm({ ...form, [k]: v });

  function toggleViewer(driverId: string) {
    const has = form.viewerIds.includes(driverId);
    set(
      "viewerIds",
      has
        ? form.viewerIds.filter((v) => v !== driverId)
        : [...form.viewerIds, driverId]
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-card p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">
            {form.id ? "항목 수정" : "새 항목 등록"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-ink-muted hover:underline"
          >
            닫기
          </button>
        </div>

        <div className="space-y-3">
          <label className={labelCls}>
            이름
            <input
              className={`${inputCls} mt-1`}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="예: 센터 대표메일(네이버)"
            />
          </label>
          <label className={labelCls}>
            분류
            <select
              className={`${inputCls} mt-1`}
              value={form.category}
              onChange={(e) =>
                set("category", e.target.value as CredentialCategory)
              }
            >
              {CREDENTIAL_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className={labelCls}>
            계정(아이디)
            <input
              className={`${inputCls} mt-1`}
              value={form.account}
              onChange={(e) => set("account", e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className={labelCls}>
            비밀번호
            <input
              className={`${inputCls} mt-1`}
              type="password"
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              autoComplete="new-password"
              placeholder={
                form.id ? "변경할 때만 입력 (비우면 기존 유지)" : "저장 시 암호화됩니다"
              }
            />
          </label>
          <label className={labelCls}>
            주소(URL)
            <input
              className={`${inputCls} mt-1`}
              value={form.url}
              onChange={(e) => set("url", e.target.value)}
              placeholder="https://"
            />
          </label>
          <label className={labelCls}>
            메모
            <textarea
              className={`${inputCls} mt-1 min-h-[72px]`}
              value={form.memo}
              onChange={(e) => set("memo", e.target.value)}
              placeholder="주의사항·2차 인증 방법 등 (비밀번호는 위 칸에)"
            />
          </label>

          {!canManage ? (
            // 일반 직원 등록·수정 — 열람자는 본인 하나로 자동 지정됩니다.
            //   (추가 열람자 지정은 관장·부장 권한이라 폼에 체크박스가 없습니다)
            <p className="rounded-lg border border-line bg-surface/60 px-3 py-2 text-[11px] text-ink-muted">
              이 항목은 나와 관장·부장만 볼 수 있습니다. 다른 직원도 볼 수 있게
              하려면 관장·부장에게 열람자 지정을 요청해 주세요.
            </p>
          ) : (
          <div>
            <p className={labelCls}>열람자 지정</p>
            <p className="mt-0.5 text-[11px] text-ink-hint">
              체크한 직원만 이 항목을 볼 수 있습니다. 관장·부장은 지정과 무관하게
              전 항목을 봅니다. 등록자 본인은 자동으로 포함됩니다.
            </p>
            {staff === null ? (
              <p className="mt-2 text-xs text-ink-hint">명단을 불러오는 중…</p>
            ) : staff.length === 0 ? (
              <p className="mt-2 text-xs text-ink-hint">
                재직 직원 명단을 불러오지 못했습니다.
              </p>
            ) : (
              <div className="mt-2 grid max-h-44 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-line p-2 sm:grid-cols-2">
                {staff.map((s) => (
                  <label
                    key={s.driverId}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-ink-body hover:bg-surface"
                  >
                    <input
                      type="checkbox"
                      checked={form.viewerIds.includes(s.driverId)}
                      onChange={() => toggleViewer(s.driverId)}
                    />
                    <span className="truncate">
                      {s.name}
                      {s.rank ? (
                        <span className="ml-1 text-xs text-ink-hint">
                          {s.rank}
                        </span>
                      ) : null}
                    </span>
                  </label>
                ))}
              </div>
            )}
            {form.viewerIds.length === 0 && (
              <p className="mt-1">
                <span className={badgeNeutral}>
                  지정 없음 — 등록자와 관장·부장만 열람
                </span>
              </p>
            )}
          </div>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            className={btnPrimary}
            disabled={busy}
            onClick={onSubmit}
          >
            저장
          </button>
          <button
            type="button"
            className={btnSecondary}
            disabled={busy}
            onClick={onClose}
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
