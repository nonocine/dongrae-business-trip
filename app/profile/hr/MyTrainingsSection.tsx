"use client";

import { useRef, useState, useTransition } from "react";
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
  btnSecondary,
  btnDanger,
  badgeSuccess,
  badgeWarning,
  badgeNeutral,
  noticeError,
  noticeSuccess,
} from "@/lib/ui";

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

  const notMet = items.filter((i) => !i.completed).length;

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
        <ul className="space-y-2">
          {items.map((it) => {
            const soon = !it.completed && isDueSoon(it.dday);
            const dragging = dragOverId === it.training_id;
            return (
              <li
                key={it.training_id}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragOverId !== it.training_id) setDragOverId(it.training_id);
                }}
                onDragEnter={(e) => {
                  e.preventDefault();
                  setDragOverId(it.training_id);
                }}
                onDragLeave={(e) => {
                  // 카드 바깥으로 나갈 때만 해제(자식 이동은 무시).
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
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
                      <span
                        className={
                          it.completed
                            ? badgeNeutral
                            : soon
                              ? badgeWarning
                              : badgeNeutral
                        }
                      >
                        {ddayLabel(it.dday)}
                      </span>
                      {it.completed ? (
                        <span className={badgeSuccess}>
                          완료 ✓ {fmtKstDate(it.completed_at)}
                        </span>
                      ) : (
                        <span className={badgeWarning}>미이수</span>
                      )}
                    </div>
                    {it.note && (
                      <p className="mt-0.5 text-xs text-ink-hint">{it.note}</p>
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
                    {it.completed && it.has_cert && (
                      <button
                        type="button"
                        className={`${btnSecondary} h-8 px-3 text-xs`}
                        disabled={busy}
                        onClick={() => viewCert(it.training_id)}
                      >
                        수료증 보기
                      </button>
                    )}
                    <button
                      type="button"
                      className={`${btnPrimary} h-8 px-3 text-xs`}
                      disabled={busy}
                      onClick={() => pickFile(it.training_id)}
                    >
                      {it.completed ? "재업로드" : "수료증 올리기"}
                    </button>
                    {it.completed && (
                      <button
                        type="button"
                        className={`${btnDanger} h-8 px-3 text-xs`}
                        disabled={busy}
                        onClick={() => onDelete(it.training_id)}
                      >
                        취소
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-3 text-[11px] text-ink-hint">
        수료증(PDF·JPG·PNG, 16MB 이하)을 올리면 즉시 이수 처리됩니다. 버튼으로
        선택하거나, 파일을 <b>교육 카드 위로 끌어다 놓아</b>도 됩니다. 잘못
        올렸다면 재업로드하거나 취소할 수 있습니다.
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
