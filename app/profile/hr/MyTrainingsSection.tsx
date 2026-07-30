"use client";

import { useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  uploadMyCertificate,
  getMyCertificateUrl,
  deleteMyCertificate,
  type MyTrainings,
  type MyTrainingItem,
} from "@/app/profile/hr/trainingActions";
import { ddayLabel, isDueSoon, CERT_ACCEPT } from "@/lib/trainings";
import { fmtKstDate } from "@/lib/datetime";
import {
  cardCls,
  btnPrimary,
  badgeWarning,
  badgeNeutral,
  noticeError,
  noticeSuccess,
} from "@/lib/ui";

// 완료 교육은 기본 5행만 보여주고 나머지는 "전체 보기"로 펼칩니다.
const DONE_PREVIEW = 5;

export default function MyTrainingsSection({
  initial,
}: {
  initial: MyTrainings;
}) {
  const [items, setItems] = useState<MyTrainingItem[]>(initial.items);
  const [busy, startBusy] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [showAllDone, setShowAllDone] = useState(false);

  function patchItem(trainingId: string, patch: Partial<MyTrainingItem>) {
    setItems((list) =>
      list.map((i) => (i.training_id === trainingId ? { ...i, ...patch } : i))
    );
  }

  function pickFile(trainingId: string) {
    setTargetId(trainingId);
    fileRef.current?.click();
  }

  // 클라이언트 1차 검증(서버에서도 재검증) — PDF·JPG·PNG, 16MB 이하.
  function certFileError(file: File): string | null {
    const ok = ["application/pdf", "image/jpeg", "image/png"];
    if (!ok.includes(file.type))
      return "PDF·JPG·PNG 파일만 올릴 수 있습니다.";
    if (file.size > 16 * 1024 * 1024)
      return "파일 용량은 16MB 이하여야 합니다.";
    return null;
  }

  function doUpload(trainingId: string, file: File) {
    const err = certFileError(file);
    if (err) {
      setMsg({ kind: "err", text: err });
      return;
    }
    startBusy(async () => {
      const fd = new FormData();
      fd.set("training_id", trainingId);
      fd.set("file", file);
      const res = await uploadMyCertificate(fd);
      if (!res.ok) {
        setMsg({ kind: "err", text: res.message });
        return;
      }
      patchItem(trainingId, {
        completed: true,
        completed_at: new Date().toISOString(),
        has_cert: true,
      });
      setMsg({ kind: "ok", text: "수료증을 제출했습니다. 이수 처리되었습니다." });
    });
  }

  function viewCert(trainingId: string) {
    startBusy(async () => {
      const url = await getMyCertificateUrl(trainingId);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      else setMsg({ kind: "err", text: "수료증을 찾을 수 없습니다." });
    });
  }

  function onDelete(trainingId: string) {
    if (!confirm("제출한 수료증을 삭제할까요? (이수 취소됩니다)")) return;
    startBusy(async () => {
      const res = await deleteMyCertificate(trainingId);
      if (!res.ok) {
        setMsg({ kind: "err", text: res.message });
        return;
      }
      patchItem(trainingId, {
        completed: false,
        completed_at: null,
        has_cert: false,
      });
      setMsg({ kind: "ok", text: "이수를 취소했습니다." });
    });
  }

  const pending = items.filter((i) => !i.completed);
  const done = items.filter((i) => i.completed);
  const notMet = pending.length;
  const visibleDone = showAllDone ? done : done.slice(0, DONE_PREVIEW);

  return (
    <section id="my-trainings" className={cardCls}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold tracking-wide text-navy">
          내 의무교육 ({initial.year}년)
        </h3>
        <span className="text-xs text-ink-muted">
          {items.length === 0 ? (
            "등록된 교육 없음"
          ) : notMet === 0 ? (
            <span className="font-semibold text-success">
              올해 교육 모두 완료 ✓
            </span>
          ) : (
            <>
              {items.length - notMet}/{items.length} 완료 · 미이수{" "}
              <b className="text-stamp">{notMet}건</b>
            </>
          )}
        </span>
      </div>

      {msg && (
        <p className={`mb-3 ${msg.kind === "ok" ? noticeSuccess : noticeError}`}>
          {msg.text}
        </p>
      )}

      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-hint">
          올해 등록된 의무교육이 없습니다.
        </p>
      ) : (
        <>
          {/* 미이수 — 눈에 띄게 카드 형태 그대로 맨 위에. */}
          {pending.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-bold text-stamp">
                미이수 {pending.length}건
              </p>
              <ul className="space-y-2">
                {pending.map((it) => {
                  const soon = isDueSoon(it.dday);
                  const dragging = dragOverId === it.training_id;
                  return (
                    <li
                      key={it.training_id}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (dragOverId !== it.training_id)
                          setDragOverId(it.training_id);
                      }}
                      onDragEnter={(e) => {
                        e.preventDefault();
                        setDragOverId(it.training_id);
                      }}
                      onDragLeave={(e) => {
                        // 카드 바깥으로 나갈 때만 해제(자식 이동은 무시).
                        if (
                          !e.currentTarget.contains(
                            e.relatedTarget as Node | null
                          )
                        ) {
                          setDragOverId((cur) =>
                            cur === it.training_id ? null : cur
                          );
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOverId(null);
                        const f = e.dataTransfer.files?.[0];
                        if (f) doUpload(it.training_id, f);
                      }}
                      className={`relative rounded-lg border p-3 transition ${
                        dragging
                          ? "border-2 border-navy bg-navy-soft/40 ring-2 ring-navy/30"
                          : soon
                            ? "border-stamp/50 bg-stamp-soft/40"
                            : "border-line bg-card"
                      }`}
                    >
                      {dragging && (
                        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-navy-soft/70 text-sm font-bold text-navy">
                          여기에 놓으면 수료증 업로드
                        </div>
                      )}
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-ink">
                              {it.name}
                            </span>
                            <span className={soon ? badgeWarning : badgeNeutral}>
                              {ddayLabel(it.dday)}
                            </span>
                            <span className={badgeWarning}>미이수</span>
                          </div>
                          {it.note && (
                            <p className="mt-0.5 text-xs text-ink-hint">
                              {it.note}
                            </p>
                          )}
                          {it.site_url && (
                            <a
                              href={it.site_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-1 inline-block text-xs font-semibold text-brand-blue hover:underline"
                            >
                              교육 사이트 →
                            </a>
                          )}
                        </div>

                        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            className={`${btnPrimary} h-8 px-3 text-xs`}
                            disabled={busy}
                            onClick={() => pickFile(it.training_id)}
                          >
                            수료증 올리기
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* 완료 — 한 줄 행으로 압축(교육명 · 완료일 · 수료증), 나머지는 ⋯ 메뉴. */}
          {done.length > 0 && (
            <div className={pending.length > 0 ? "mt-4" : ""}>
              <p className="mb-2 text-xs font-bold text-navy">
                완료 {done.length}건
              </p>
              <ul className="divide-y divide-line/60 overflow-hidden rounded-lg border border-line">
                {visibleDone.map((it) => (
                  <li
                    key={it.training_id}
                    className="flex items-center gap-2 bg-card px-3 py-2"
                  >
                    <span
                      className="min-w-0 flex-1 truncate text-sm font-medium text-ink"
                      title={it.name}
                    >
                      {it.name}
                    </span>
                    {/* 모바일에서 교육명이 잘리지 않도록 배지 대신 짧은 완료일만
                        — "완료"는 위 그룹 제목이 이미 알려줍니다. */}
                    <span className="shrink-0 font-mono text-[11px] font-semibold text-success">
                      ✓ {fmtKstDate(it.completed_at)}
                    </span>
                    {it.has_cert ? (
                      <button
                        type="button"
                        className="shrink-0 text-xs font-semibold text-brand-blue hover:underline disabled:opacity-50"
                        disabled={busy}
                        onClick={() => viewCert(it.training_id)}
                      >
                        수료증
                      </button>
                    ) : (
                      <span className="shrink-0 text-xs text-ink-hint">
                        수료증 없음
                      </span>
                    )}
                    <RowMenu
                      busy={busy}
                      onReupload={() => pickFile(it.training_id)}
                      onCancel={() => onDelete(it.training_id)}
                    />
                  </li>
                ))}
              </ul>
              {done.length > DONE_PREVIEW && (
                <button
                  type="button"
                  className="mt-2 text-xs font-semibold text-navy hover:underline"
                  onClick={() => setShowAllDone((v) => !v)}
                >
                  {showAllDone
                    ? "접기"
                    : `전체 보기 (${done.length - DONE_PREVIEW}건 더)`}
                </button>
              )}
            </div>
          )}
        </>
      )}

      <p className="mt-3 text-[11px] text-ink-hint">
        수료증(PDF·JPG·PNG, 16MB 이하)을 올리면 즉시 이수 처리됩니다. 버튼으로
        선택하거나, 파일을 <b>미이수 교육 카드 위로 끌어다 놓아</b>도 됩니다.
        잘못 올렸다면 완료 목록의 <b>⋯</b> 에서 재업로드하거나 취소할 수 있습니다.
      </p>

      <input
        ref={fileRef}
        type="file"
        accept={CERT_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f && targetId) doUpload(targetId, f);
        }}
      />
    </section>
  );
}

// 완료 행의 ⋯ 메뉴 — 비품관리(AssetManager) 패턴 재사용.
//   목록 overflow 클리핑을 피하려 portal + fixed 좌표로 렌더.
function RowMenu({
  busy,
  onReupload,
  onCancel,
}: {
  busy: boolean;
  onReupload: () => void;
  onCancel: () => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: Math.max(8, r.right - 160) });
    }
    setOpen((o) => !o);
  }

  const item =
    "block w-full px-3 py-1.5 text-left text-xs text-ink-body hover:bg-surface";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        disabled={busy}
        className="shrink-0 rounded border border-line px-1.5 py-1 text-xs text-ink-muted hover:bg-surface disabled:opacity-50"
        aria-label="더보기"
      >
        ⋯
      </button>
      {open &&
        pos &&
        createPortal(
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)}>
            <div
              className="absolute w-40 overflow-hidden rounded-lg border border-line bg-card py-1 shadow-lg"
              style={{ top: pos.top, left: pos.left }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className={item}
                onClick={() => {
                  setOpen(false);
                  onReupload();
                }}
              >
                수료증 재업로드
              </button>
              <button
                type="button"
                className={`${item} text-stamp`}
                onClick={() => {
                  setOpen(false);
                  onCancel();
                }}
              >
                이수 취소
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
