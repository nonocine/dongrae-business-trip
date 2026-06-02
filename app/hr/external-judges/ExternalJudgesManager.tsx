"use client";

import { useMemo, useState, useTransition } from "react";
import {
  cardCls,
  inputCls,
  labelCls,
  btnPrimary,
  btnSecondary,
  badgeSuccess,
  badgeNeutral,
  noticeError,
  noticeSuccess,
  noticeWarning,
} from "@/lib/ui";
import {
  createExternalJudge,
  updateExternalJudge,
  toggleExternalJudgeActive,
  deleteExternalJudge,
} from "@/app/hr/recruitment/[slug]/actions";
import type { ExternalJudge } from "@/lib/supabase";

const DEFAULT_ROLE_OPTIONS = ["외부위원", "심사위원장", "자문위원"] as const;

type EditingState =
  | { kind: "new" }
  | { kind: "edit"; judge: ExternalJudge }
  | { kind: "none" };

// 01012345678 → 010-1234-5678 (디스플레이용)
function formatPhone(phone: string): string {
  if (!/^010\d{8}$/.test(phone)) return phone;
  return `${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}`;
}

function formatDate(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export default function ExternalJudgesManager({
  initialJudges,
}: {
  initialJudges: ExternalJudge[];
}) {
  const [editing, setEditing] = useState<EditingState>({ kind: "none" });
  const [search, setSearch] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    const numericQuery = s.replace(/\D/g, "");
    return initialJudges
      .filter((j) => (includeInactive ? true : j.is_active))
      .filter((j) => {
        if (!s) return true;
        if (j.name.toLowerCase().includes(s)) return true;
        if (j.affiliation.toLowerCase().includes(s)) return true;
        if (numericQuery && j.phone.includes(numericQuery)) return true;
        return false;
      });
  }, [initialJudges, search, includeInactive]);

  return (
    <div className="space-y-5">
      <section className={cardCls}>
        {/* 헤더 + 새 위원 등록 */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">
            외부위원 목록{" "}
            <span className="ml-1 text-xs font-medium text-ink-hint">
              {filtered.length} / {initialJudges.length}명
            </span>
          </h3>
          {editing.kind !== "new" && (
            <button
              type="button"
              onClick={() => setEditing({ kind: "new" })}
              className={btnPrimary}
            >
              ＋ 새 위원 등록
            </button>
          )}
        </div>

        {/* 필터 */}
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름·소속·전화번호로 검색"
            className={inputCls}
          />
          <label className="inline-flex h-[38px] cursor-pointer items-center gap-2 self-start rounded-lg border border-line bg-surface px-3 text-sm">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
              className="h-4 w-4 rounded border-line text-brand-blue focus:ring-brand-blue"
            />
            <span className="text-ink-body">비활성 포함</span>
          </label>
        </div>

        {/* 목록 */}
        {filtered.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-line bg-surface p-6 text-center text-sm text-ink-muted">
            {initialJudges.length === 0
              ? "등록된 외부위원이 없습니다. 새 위원을 등록해보세요."
              : "조건에 맞는 위원이 없습니다."}
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {filtered.map((j) => (
              <JudgeRow
                key={j.id}
                judge={j}
                onEdit={() => setEditing({ kind: "edit", judge: j })}
                isEditing={
                  editing.kind === "edit" && editing.judge.id === j.id
                }
              />
            ))}
          </ul>
        )}
      </section>

      {editing.kind !== "none" && (
        <JudgeForm
          key={editing.kind === "edit" ? editing.judge.id : "new"}
          initial={editing.kind === "edit" ? editing.judge : null}
          onCancel={() => setEditing({ kind: "none" })}
          onSaved={() => setEditing({ kind: "none" })}
        />
      )}
    </div>
  );
}

// =====================================================================
// 위원 한 줄
// =====================================================================
function JudgeRow({
  judge,
  isEditing,
  onEdit,
}: {
  judge: ExternalJudge;
  isEditing: boolean;
  onEdit: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function handleToggle() {
    const target = judge.is_active ? "비활성화" : "활성화";
    if (!confirm(`${judge.name} 위원을 ${target}하시겠습니까?`)) return;
    setErr(null);
    startTransition(async () => {
      try {
        await toggleExternalJudgeActive(judge.id);
      } catch (e) {
        setErr(e instanceof Error ? e.message : `${target} 실패`);
      }
    });
  }

  function handleDelete() {
    if (
      !confirm(
        `${judge.name} 위원을 풀에서 삭제하시겠습니까?\n채용 이력이 있으면 삭제되지 않습니다 (대신 비활성화하세요).`
      )
    )
      return;
    setErr(null);
    startTransition(async () => {
      try {
        await deleteExternalJudge(judge.id);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "삭제 실패");
      }
    });
  }

  return (
    <li
      className={`rounded-lg border bg-card p-3 shadow-sm transition ${
        isEditing
          ? "border-brand-blue ring-1 ring-brand-blue-soft"
          : "border-line"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold text-ink">{judge.name}</span>
            <span className="text-xs text-ink-hint">·</span>
            <span className="text-xs text-ink-body">{judge.affiliation}</span>
            <span
              className={judge.is_active ? badgeSuccess : badgeNeutral}
            >
              {judge.is_active ? "활성" : "비활성"}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
            <span className="font-mono">{formatPhone(judge.phone)}</span>
            <span className="text-ink-hint">·</span>
            <span>{judge.default_role}</span>
            <span className="text-ink-hint">·</span>
            <span>등록 {formatDate(judge.created_at)}</span>
          </div>
          {judge.notes && (
            <p className="mt-1.5 whitespace-pre-line rounded-md bg-surface px-2 py-1 text-[11px] text-ink-muted">
              메모: {judge.notes}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onEdit}
            disabled={pending}
            className="rounded-md border border-brand-blue bg-card px-2.5 py-1 text-xs font-semibold text-brand-blue hover:bg-brand-blue-soft disabled:opacity-60"
          >
            수정
          </button>
          <button
            type="button"
            onClick={handleToggle}
            disabled={pending}
            className="rounded-md border border-line bg-card px-2.5 py-1 text-xs font-medium text-ink-body hover:bg-surface disabled:opacity-60"
          >
            {judge.is_active ? "비활성화" : "활성화"}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className="rounded-md border border-stamp bg-card px-2.5 py-1 text-xs font-medium text-stamp hover:bg-stamp-soft disabled:opacity-60"
          >
            삭제
          </button>
        </div>
      </div>
      {err && <p className={`mt-2 ${noticeError}`}>{err}</p>}
    </li>
  );
}

// =====================================================================
// 등록/수정 폼 — 하단에 펼쳐지는 인라인 패널 (기존 PostingForm 패턴)
// =====================================================================
function JudgeForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial: ExternalJudge | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const editMode = initial != null;
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [affiliation, setAffiliation] = useState(initial?.affiliation ?? "");
  const [defaultRole, setDefaultRole] = useState(
    initial?.default_role ?? "외부위원"
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  // 수정 모드: 이미 동의된 상태이므로 체크박스 자체를 숨김. 신규: false 로 시작.
  const [privacyAgreed, setPrivacyAgreed] = useState(false);

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function handlePhoneChange(v: string) {
    // 입력 즉시 숫자만 남기고 11자리로 자른다 (하이픈/공백 자동 제거).
    setPhone(v.replace(/\D/g, "").slice(0, 11));
  }

  function handleSave() {
    setError(null);
    setOk(null);

    // 클라이언트 1차 검증 — 서버에서도 재검증되지만 즉시 피드백을 위해.
    const trimmedName = name.trim();
    const trimmedAffiliation = affiliation.trim();
    if (!trimmedName) {
      setError("이름을 입력해주세요.");
      return;
    }
    if (!trimmedAffiliation) {
      setError("소속을 입력해주세요.");
      return;
    }
    if (!/^010\d{8}$/.test(phone)) {
      setError("휴대전화는 010 으로 시작하는 11자리 숫자여야 합니다.");
      return;
    }
    if (!editMode && !privacyAgreed) {
      setError("개인정보 수집 동의가 필요합니다.");
      return;
    }

    startTransition(async () => {
      try {
        if (editMode && initial) {
          await updateExternalJudge(initial.id, {
            name: trimmedName,
            phone,
            affiliation: trimmedAffiliation,
            default_role: defaultRole,
            notes: notes.trim(),
          });
          setOk("수정되었습니다.");
        } else {
          await createExternalJudge({
            name: trimmedName,
            phone,
            affiliation: trimmedAffiliation,
            default_role: defaultRole,
            notes: notes.trim(),
            privacy_agreed: privacyAgreed,
          });
          setOk("새 외부위원이 등록되었습니다.");
        }
        setTimeout(onSaved, 600);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "저장 중 오류가 발생했습니다."
        );
      }
    });
  }

  return (
    <section className={cardCls}>
      <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
        <h3 className="text-sm font-semibold text-ink">
          {editMode ? "외부위원 수정" : "새 외부위원 등록"}
        </h3>
        <button type="button" onClick={onCancel} className={btnSecondary}>
          취소
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
        <div>
          <label className={labelCls}>이름 *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="홍길동"
            className={inputCls}
          />
        </div>

        <div>
          <label className={labelCls}>휴대전화 *</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => handlePhoneChange(e.target.value)}
            placeholder="01012345678"
            maxLength={11}
            inputMode="numeric"
            className={`${inputCls} font-mono`}
          />
          <p className="mt-1 text-[11px] text-ink-hint">
            하이픈 없이 11자리 숫자 (입력 시 자동 정리).
            {phone && /^010\d{8}$/.test(phone) && (
              <span className="ml-1 text-success">
                → {formatPhone(phone)}
              </span>
            )}
          </p>
        </div>

        <div className="sm:col-span-2">
          <label className={labelCls}>소속 *</label>
          <input
            type="text"
            value={affiliation}
            onChange={(e) => setAffiliation(e.target.value)}
            placeholder="동의대학교 청소년교육과"
            className={inputCls}
          />
        </div>

        <div>
          <label className={labelCls}>기본 역할</label>
          <select
            value={defaultRole}
            onChange={(e) => setDefaultRole(e.target.value)}
            className={inputCls}
          >
            {DEFAULT_ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-ink-hint">
            공고에 배정될 때 기본값으로 사용됩니다.
          </p>
        </div>

        <div className="sm:col-span-2">
          <label className={labelCls}>메모</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="선택 — 위원 관련 메모"
            className={`${inputCls} resize-y`}
          />
        </div>

        {editMode ? (
          <div className="sm:col-span-2">
            <p className={noticeWarning}>
              ⚠ 전화번호를 변경하면 위원이 다음 로그인부터 새 번호로 인증해야
              합니다.
            </p>
          </div>
        ) : (
          <div className="space-y-2 sm:col-span-2">
            <label className="inline-flex w-full cursor-pointer items-start gap-2 rounded-lg border border-line bg-surface px-3 py-2">
              <input
                type="checkbox"
                checked={privacyAgreed}
                onChange={(e) => setPrivacyAgreed(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-line text-brand-blue focus:ring-brand-blue"
              />
              <span className="text-sm text-ink">
                <strong className="font-semibold">
                  개인정보 수집·이용 동의
                </strong>
                <span className="ml-1 text-xs text-stamp">*</span>
                <span className="ml-2 text-xs text-ink-muted">
                  (위원 본인에게 동의를 받은 후 체크해주세요)
                </span>
              </span>
            </label>
            <details className="rounded-lg border border-dashed border-line bg-surface p-3">
              <summary className="cursor-pointer text-xs font-semibold text-ink-muted hover:text-ink">
                안내문 보기
              </summary>
              <div className="mt-2 text-xs leading-relaxed text-ink-body">
                본 시스템은 외부 심사위원의 채용 심사 참여를 위해 다음
                개인정보를 수집·이용합니다.
                <ul className="ml-4 mt-2 list-disc space-y-1">
                  <li>수집 항목: 성명, 휴대전화번호, 소속</li>
                  <li>이용 목적: 심사위원 인증, 심사 결과 관리</li>
                  <li>보유 기간: 5년 (채용 관련 서류 보존 의무)</li>
                  <li>동의 거부 시: 외부위원 등록 불가</li>
                </ul>
              </div>
            </details>
          </div>
        )}
      </div>

      {error && <p className={`mt-3 ${noticeError}`}>{error}</p>}
      {ok && <p className={`mt-3 ${noticeSuccess}`}>{ok}</p>}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
        <button type="button" onClick={onCancel} className={btnSecondary}>
          취소
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className={btnPrimary}
        >
          {pending ? "저장 중…" : editMode ? "수정 저장" : "등록"}
        </button>
      </div>
    </section>
  );
}
