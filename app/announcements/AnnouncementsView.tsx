"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  uploadAnnouncementAttachment,
  deleteAnnouncementAttachment,
  signAnnouncementAttachment,
  type Announcement,
  type AnnouncementAttachment,
} from "./actions";
import {
  cardCls,
  inputCls,
  btnPrimary,
  btnSecondary,
  btnDanger,
  noticeError,
} from "@/lib/ui";

// "2026-06-30T..." → "2026.06.30"
function fmtDate(iso: string): string {
  return iso ? iso.slice(0, 10).replaceAll("-", ".") : "";
}

type EditState =
  | { kind: "new" }
  | { kind: "edit"; a: Announcement }
  | null;

export default function AnnouncementsView({
  announcements,
  isM0,
}: {
  announcements: Announcement[];
  isM0: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditState>(null);

  return (
    <div className="space-y-4">
      {isM0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setEditing({ kind: "new" })}
            className={btnPrimary}
          >
            + 새 공지 작성
          </button>
        </div>
      )}

      {announcements.length === 0 ? (
        <section className={cardCls}>
          <p className="py-10 text-center text-sm text-ink-muted">
            등록된 공지사항이 없습니다.
          </p>
        </section>
      ) : (
        <ul className="space-y-2.5">
          {announcements.map((a) => (
            <AnnouncementItem
              key={a.id}
              a={a}
              isM0={isM0}
              open={expanded === a.id}
              onToggle={() =>
                setExpanded((prev) => (prev === a.id ? null : a.id))
              }
              onEdit={() => setEditing({ kind: "edit", a })}
            />
          ))}
        </ul>
      )}

      {editing && (
        <AnnouncementEditor
          state={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// 목록 항목 — 클릭하면 본문/첨부 펼침. M0 면 수정/삭제.
// ---------------------------------------------------------------------
function AnnouncementItem({
  a,
  isM0,
  open,
  onToggle,
  onEdit,
}: {
  a: Announcement;
  isM0: boolean;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function openAttachment(path: string) {
    signAnnouncementAttachment(path).then((url) => {
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      else setError("첨부를 열 수 없습니다.");
    });
  }

  function handleDelete() {
    if (!confirm(`"${a.title}" 공지를 삭제할까요? 복구할 수 없습니다.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteAnnouncement(a.id);
      if (res.ok) router.refresh();
      else setError(res.message);
    });
  }

  return (
    <li className={cardCls}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-1.5">
            {a.is_pinned && (
              <span
                title="고정 공지"
                className="rounded-full bg-stamp-soft px-1.5 py-0.5 text-[10px] font-bold text-stamp"
              >
                📌 고정
              </span>
            )}
            <span className="text-sm font-bold text-ink">{a.title}</span>
            {a.attachments.length > 0 && (
              <span className="text-[11px] text-ink-hint">
                📎 {a.attachments.length}
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-[11px] text-ink-muted">
            {a.author_name || "관리자"} · {fmtDate(a.created_at)}
          </span>
        </span>
        <span aria-hidden className="shrink-0 text-ink-hint">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div className="mt-3 border-t border-line/70 pt-3">
          <p className="whitespace-pre-wrap break-words text-sm text-ink-body">
            {a.content}
          </p>

          {a.attachments.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {a.attachments.map((att) => (
                <li key={att.path}>
                  <button
                    type="button"
                    onClick={() => openAttachment(att.path)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-brand-blue bg-card px-2.5 py-1 text-xs font-semibold text-brand-blue hover:bg-brand-blue-soft"
                  >
                    📎 {att.name} ↗
                  </button>
                </li>
              ))}
            </ul>
          )}

          {error && <p className={`mt-2 ${noticeError}`}>{error}</p>}

          {isM0 && (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={onEdit}
                disabled={pending}
                className={btnSecondary}
              >
                수정
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={pending}
                className={btnDanger}
              >
                {pending ? "삭제 중…" : "삭제"}
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------
// 작성/수정 모달 — M0 전용. 텍스트 저장 후 새 첨부 업로드.
// ---------------------------------------------------------------------
function AnnouncementEditor({
  state,
  onClose,
}: {
  state: { kind: "new" } | { kind: "edit"; a: Announcement };
  onClose: () => void;
}) {
  const router = useRouter();
  const isEdit = state.kind === "edit";
  const existing = isEdit ? state.a : null;

  const [title, setTitle] = useState(existing?.title ?? "");
  const [content, setContent] = useState(existing?.content ?? "");
  const [isPinned, setIsPinned] = useState(existing?.is_pinned ?? false);
  const [attachments, setAttachments] = useState<AnnouncementAttachment[]>(
    existing?.attachments ?? []
  );
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleDeleteExisting(path: string) {
    if (!isEdit || !existing) return;
    if (!confirm("첨부 파일을 삭제할까요?")) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteAnnouncementAttachment(existing.id, path);
      if (res.ok) setAttachments((prev) => prev.filter((a) => a.path !== path));
      else setError(res.message);
    });
  }

  function handleSave() {
    const t = title.trim();
    const c = content.trim();
    if (!t) {
      setError("제목을 입력해주세요.");
      return;
    }
    if (!c) {
      setError("내용을 입력해주세요.");
      return;
    }
    setError(null);
    startTransition(async () => {
      let id = existing?.id ?? "";
      if (isEdit) {
        const res = await updateAnnouncement(id, {
          title: t,
          content: c,
          isPinned,
        });
        if (!res.ok) {
          setError(res.message);
          return;
        }
      } else {
        const res = await createAnnouncement({
          title: t,
          content: c,
          isPinned,
        });
        if (!res.ok) {
          setError(res.message);
          return;
        }
        id = res.id;
      }

      // 새 첨부 업로드 — 하나라도 실패하면 메시지 표시(저장 자체는 완료).
      for (const f of newFiles) {
        const fd = new FormData();
        fd.set("announcement_id", id);
        fd.set("file", f);
        const up = await uploadAnnouncementAttachment(fd);
        if (!up.ok) {
          setError(`첨부 업로드 실패: ${up.message}`);
          router.refresh();
          return;
        }
      }

      onClose();
      router.refresh();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      onClick={() => !pending && onClose()}
    >
      <div
        className="my-8 w-full max-w-lg rounded-xl border border-line bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-ink">
          {isEdit ? "공지 수정" : "새 공지 작성"}
        </h3>

        <div className="mt-3 space-y-3">
          <div>
            <label className="block text-xs font-bold text-navy">제목</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="공지 제목"
              className={`${inputCls} mt-1`}
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-navy">내용</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={7}
              placeholder="공지 내용을 입력하세요."
              className={`${inputCls} mt-1 resize-y`}
            />
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-1.5 text-sm text-ink-body">
              <input
                type="checkbox"
                checked={isPinned}
                onChange={(e) => setIsPinned(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-line text-navy focus:ring-navy"
              />
              상단 고정
            </label>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-navy">공개 범위</span>
              <select
                disabled
                value="all"
                className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink-muted"
              >
                <option value="all">전체 직원</option>
              </select>
            </div>
          </div>

          {/* 첨부 — 기존(수정 시) + 새로 추가 */}
          <div>
            <label className="block text-xs font-bold text-navy">첨부파일</label>
            <p className="mt-0.5 text-[11px] text-ink-hint">
              PDF · JPG · PNG · WEBP, 파일당 16MB 이하.
            </p>
            {attachments.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {attachments.map((att) => (
                  <li
                    key={att.path}
                    className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs"
                  >
                    <span className="truncate text-ink-body">📎 {att.name}</span>
                    <button
                      type="button"
                      onClick={() => handleDeleteExisting(att.path)}
                      disabled={pending}
                      className="shrink-0 text-stamp hover:underline disabled:opacity-60"
                    >
                      삭제
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {newFiles.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {newFiles.map((f, i) => (
                  <li
                    key={`${f.name}-${i}`}
                    className="flex items-center justify-between gap-2 rounded-md border border-dashed border-brand-blue/50 bg-brand-blue-soft/30 px-2.5 py-1.5 text-xs"
                  >
                    <span className="truncate text-ink-body">
                      📎 {f.name}{" "}
                      <span className="text-ink-hint">(저장 시 업로드)</span>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setNewFiles((prev) => prev.filter((_, idx) => idx !== i))
                      }
                      disabled={pending}
                      className="shrink-0 text-stamp hover:underline disabled:opacity-60"
                    >
                      제거
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <label
              className={`mt-1.5 inline-block cursor-pointer rounded-lg border border-navy bg-card px-3 py-1.5 text-xs font-semibold text-navy hover:bg-navy-soft ${
                pending ? "pointer-events-none opacity-60" : ""
              }`}
            >
              파일 추가
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                multiple
                className="sr-only"
                disabled={pending}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  if (files.length > 0)
                    setNewFiles((prev) => [...prev, ...files]);
                }}
              />
            </label>
          </div>

          {error && <p className={noticeError}>{error}</p>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className={btnSecondary}
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={pending}
            className={btnPrimary}
          >
            {pending ? "저장 중…" : isEdit ? "저장" : "등록"}
          </button>
        </div>
      </div>
    </div>
  );
}
