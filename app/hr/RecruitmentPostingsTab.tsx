"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  cardCls,
  inputCls,
  labelCls,
  btnPrimary,
  btnSecondary,
  badgeSuccess,
  badgeNeutral,
  badgeWarning,
  noticeError,
  noticeSuccess,
} from "@/lib/ui";
import {
  saveRecruitmentPosting,
  deleteRecruitmentPosting,
  type RecruitmentPostingAdmin,
} from "@/app/hr/actions";

// KST(+09:00) 로 timestamptz → datetime-local 입력값(YYYY-MM-DDTHH:mm).
function isoToKstLocal(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  let hour = get("hour");
  if (hour === "24") hour = "00"; // 자정 표기 보정
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

function fmtKst(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type EditingState =
  | { kind: "new" }
  | { kind: "edit"; posting: RecruitmentPostingAdmin }
  | { kind: "none" };

export default function RecruitmentPostingsTab({
  postings,
}: {
  postings: RecruitmentPostingAdmin[];
}) {
  const [editing, setEditing] = useState<EditingState>({ kind: "none" });

  const sorted = useMemo(
    () =>
      [...postings].sort((a, b) =>
        a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0
      ),
    [postings]
  );

  return (
    <div className="space-y-5">
      <section className={cardCls}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">
            채용공고 목록{" "}
            <span className="ml-1 text-xs font-medium text-ink-hint">
              {sorted.length}건
            </span>
          </h3>
          {editing.kind !== "new" && (
            <button
              type="button"
              onClick={() => setEditing({ kind: "new" })}
              className={btnPrimary}
            >
              ＋ 새 공고
            </button>
          )}
        </div>

        {sorted.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-line bg-surface p-4 text-center text-sm text-ink-muted">
            등록된 공고가 없습니다. “새 공고” 버튼으로 첫 공고를 작성하세요.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {sorted.map((p) => (
              <PostingRow
                key={p.id}
                posting={p}
                editingId={
                  editing.kind === "edit" ? editing.posting.id : null
                }
                onEdit={() => setEditing({ kind: "edit", posting: p })}
              />
            ))}
          </ul>
        )}
      </section>

      {editing.kind !== "none" && (
        <PostingForm
          key={editing.kind === "edit" ? editing.posting.id : "new"}
          initial={editing.kind === "edit" ? editing.posting : null}
          onCancel={() => setEditing({ kind: "none" })}
          onSaved={() => setEditing({ kind: "none" })}
        />
      )}
    </div>
  );
}

// =====================================================================
// 공고 한 줄 — 제목·상태·기간·작업 버튼
// =====================================================================
function PostingRow({
  posting,
  editingId,
  onEdit,
}: {
  posting: RecruitmentPostingAdmin;
  editingId: string | null;
  onEdit: () => void;
}) {
  const [deleting, deleteTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const closed =
    new Date(posting.application_end).getTime() < Date.now() &&
    posting.status === "published";

  const statusBadge =
    posting.status === "published"
      ? closed
        ? badgeNeutral
        : badgeSuccess
      : posting.status === "closed"
        ? badgeNeutral
        : badgeWarning;

  const statusLabel =
    posting.status === "published"
      ? closed
        ? "마감"
        : "공개"
      : posting.status === "closed"
        ? "종료"
        : "비공개";

  const isEditing = editingId === posting.id;

  function handleDelete() {
    if (
      !confirm(
        `"${posting.title}" 공고를 삭제하시겠습니까?\n지원서가 한 건이라도 접수되어 있으면 삭제되지 않고 비공개로 전환하셔야 합니다.`
      )
    )
      return;
    setErr(null);
    deleteTransition(async () => {
      const res = await deleteRecruitmentPosting(posting.id);
      if (!res.ok) setErr(res.message);
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
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={statusBadge}>{statusLabel}</span>
            <span className="font-mono text-[11px] text-ink-muted">
              {posting.slug}
            </span>
          </div>
          <p className="mt-1 text-sm font-semibold text-ink">{posting.title}</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {posting.field} · 모집 {posting.recruit_count}명
          </p>
          <p className="mt-1 text-[11px] text-ink-hint">
            {fmtKst(posting.application_start)} ~ {fmtKst(posting.application_end)}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <Link
            href={`/recruitment/${posting.slug}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-line bg-card px-2.5 py-1 text-xs font-medium text-ink-body hover:bg-surface"
          >
            공고 보기 ↗
          </Link>
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md border border-brand-blue bg-card px-2.5 py-1 text-xs font-semibold text-brand-blue hover:bg-brand-blue-soft"
          >
            편집
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="rounded-md border border-stamp bg-card px-2.5 py-1 text-xs font-medium text-stamp hover:bg-stamp-soft disabled:opacity-60"
          >
            {deleting ? "삭제 중…" : "삭제"}
          </button>
        </div>
      </div>
      {err && <p className={`mt-2 ${noticeError}`}>{err}</p>}
    </li>
  );
}

// =====================================================================
// 공고 작성/편집 폼
// =====================================================================
function PostingForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial: RecruitmentPostingAdmin | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [field, setField] = useState(initial?.field ?? "");
  const [recruitCount, setRecruitCount] = useState(
    String(initial?.recruit_count ?? 1)
  );
  const [startLocal, setStartLocal] = useState(
    initial ? isoToKstLocal(initial.application_start) : ""
  );
  const [endLocal, setEndLocal] = useState(
    initial ? isoToKstLocal(initial.application_end) : ""
  );
  const [qualifications, setQualifications] = useState(
    initial?.qualifications ?? ""
  );
  const [preferred, setPreferred] = useState(initial?.preferred ?? "");
  const [salaryInfo, setSalaryInfo] = useState(initial?.salary_info ?? "");
  const [processInfo, setProcessInfo] = useState(initial?.process_info ?? "");
  const [notice, setNotice] = useState(initial?.notice ?? "");
  const [published, setPublished] = useState(initial?.status === "published");

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function handleSave() {
    setError(null);
    setOk(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        if (initial?.id) fd.set("id", initial.id);
        fd.set("slug", slug);
        fd.set("title", title);
        fd.set("field", field);
        fd.set("recruit_count", recruitCount);
        fd.set("application_start", startLocal);
        fd.set("application_end", endLocal);
        fd.set("qualifications", qualifications);
        fd.set("preferred", preferred);
        fd.set("salary_info", salaryInfo);
        fd.set("process_info", processInfo);
        fd.set("notice", notice);
        fd.set("status", published ? "published" : "draft");

        const res = await saveRecruitmentPosting(fd);
        if (res.ok) {
          setOk(
            initial ? "수정되었습니다." : `공고가 등록되었습니다. (/${res.slug})`
          );
          // 약간 텀을 두고 폼을 닫아 결과 메시지를 보여줌.
          setTimeout(onSaved, 600);
        } else {
          setError(res.message);
        }
      } catch (e) {
        setError(
          e instanceof Error
            ? `저장 실패: ${e.message}`
            : "공고 저장 중 알 수 없는 오류가 발생했습니다."
        );
      }
    });
  }

  return (
    <section className={cardCls}>
      <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
        <h3 className="text-sm font-semibold text-ink">
          {initial ? "공고 편집" : "새 공고 작성"}
        </h3>
        <button type="button" onClick={onCancel} className={btnSecondary}>
          취소
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
        <div className="sm:col-span-2">
          <label className={labelCls}>공고 URL (slug) *</label>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="2026-1"
            className={`${inputCls} font-mono`}
          />
          <p className="mt-1 text-[11px] text-ink-hint">
            영문/숫자/하이픈만 가능. 지원 페이지 URL이 됩니다 — /recruitment/
            <span className="font-semibold">{slug || "예시"}</span>
          </p>
        </div>

        <div className="sm:col-span-2">
          <label className={labelCls}>제목 *</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="동래구청소년센터 직원 채용 (2026년 1차)"
            className={inputCls}
          />
        </div>

        <div>
          <label className={labelCls}>채용분야 *</label>
          <input
            type="text"
            value={field}
            onChange={(e) => setField(e.target.value)}
            placeholder="청소년사업담당"
            className={inputCls}
          />
        </div>

        <div>
          <label className={labelCls}>모집인원 *</label>
          <input
            type="number"
            min={1}
            value={recruitCount}
            onChange={(e) => setRecruitCount(e.target.value)}
            className={inputCls}
          />
        </div>

        <div>
          <label className={labelCls}>접수 시작 *</label>
          <input
            type="datetime-local"
            value={startLocal}
            onChange={(e) => setStartLocal(e.target.value)}
            className={inputCls}
          />
          <p className="mt-1 text-[11px] text-ink-hint">한국 시간(KST)</p>
        </div>

        <div>
          <label className={labelCls}>접수 마감 *</label>
          <input
            type="datetime-local"
            value={endLocal}
            onChange={(e) => setEndLocal(e.target.value)}
            className={inputCls}
          />
          <p className="mt-1 text-[11px] text-ink-hint">한국 시간(KST)</p>
        </div>

        <div className="sm:col-span-2">
          <label className={labelCls}>자격요건</label>
          <textarea
            value={qualifications}
            onChange={(e) => setQualifications(e.target.value)}
            rows={4}
            placeholder="- 학력: 전문대학 졸업 이상&#10;- 청소년지도사 2급 이상 자격 소지자"
            className={`${inputCls} resize-y`}
          />
        </div>

        <div className="sm:col-span-2">
          <label className={labelCls}>우대사항</label>
          <textarea
            value={preferred}
            onChange={(e) => setPreferred(e.target.value)}
            rows={3}
            className={`${inputCls} resize-y`}
          />
        </div>

        <div className="sm:col-span-2">
          <label className={labelCls}>임금조건</label>
          <textarea
            value={salaryInfo}
            onChange={(e) => setSalaryInfo(e.target.value)}
            rows={3}
            className={`${inputCls} resize-y`}
          />
        </div>

        <div className="sm:col-span-2">
          <label className={labelCls}>채용절차</label>
          <textarea
            value={processInfo}
            onChange={(e) => setProcessInfo(e.target.value)}
            rows={3}
            className={`${inputCls} resize-y`}
          />
        </div>

        <div className="sm:col-span-2">
          <label className={labelCls}>유의사항</label>
          <textarea
            value={notice}
            onChange={(e) => setNotice(e.target.value)}
            rows={3}
            className={`${inputCls} resize-y`}
          />
        </div>

        <div className="sm:col-span-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
            <input
              type="checkbox"
              checked={published}
              onChange={(e) => setPublished(e.target.checked)}
              className="h-4 w-4 rounded border-line text-brand-blue focus:ring-brand-blue"
            />
            <span className="text-sm font-semibold text-ink">
              공개(published)로 게시
            </span>
            <span className="text-xs text-ink-muted">
              {published
                ? "외부 지원자가 공고를 열람·지원할 수 있습니다."
                : "비공개(draft) — 외부에서 보이지 않습니다."}
            </span>
          </label>
        </div>
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
          {pending ? "저장 중…" : initial ? "수정 저장" : "공고 등록"}
        </button>
      </div>
    </section>
  );
}
