"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ORG_FILE_ACCEPT,
  ORG_FILE_EXT,
  ORG_FILE_KINDS,
  ORG_FILE_KIND_LABEL,
  ORG_FILE_MAX_BYTES,
  guessOrgFileKind,
  yearOf,
  type OrgFileKind,
  type OrgRecordFile,
  type OrgRecordKind,
} from "@/lib/orgRecords";
import {
  deleteOrgRecordFile,
  getOrgRecordFileUrls,
  setOrgRecordFileKind,
  uploadOrgRecordFile,
} from "@/app/(app)/hr/org-records/actions";
import { btnSecondary, labelCls, linkCls, noticeError, panelToneCls, sectionTitleCls } from "@/lib/ui";

// 기관 대장 탭들이 함께 쓰는 조각 — 연도 필터·출력 패널·첨부(목록 칸·상세 영역).

export const selCls =
  "mt-1 block rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";


// 연도 목록(내림차순) — 기록이 있는 연도만.
export function useYears(dates: string[]): number[] {
  return useMemo(() => {
    const s = new Set<number>();
    for (const d of dates) {
      const y = yearOf(d);
      if (y != null) s.add(y);
    }
    return [...s].sort((a, b) => b - a);
  }, [dates]);
}

export function YearFilter({
  years,
  value,
  onChange,
}: {
  years: number[];
  value: number | null;
  onChange: (y: number | null) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink-muted">
      연도
      <select
        className={selCls.replace("mt-1 ", "")}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">전체</option>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}년
          </option>
        ))}
      </select>
    </label>
  );
}

// 출력 — 연도 범위 + (수상만) 청소년 이름 가리기. PDF·Word 둘 다.
export function ExportPanel({ kind, years }: { kind: OrgRecordKind; years: number[] }) {
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [mask, setMask] = useState(false);

  const href = (format: "pdf" | "docx") => {
    const p = new URLSearchParams({ kind, format });
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (kind === "awards" && mask) p.set("mask", "1");
    return `/hr/org-records/export?${p.toString()}`;
  };
  const asc = [...years].sort((a, b) => a - b);

  return (
    <section className={panelToneCls("blue")}>
      <h3 className={sectionTitleCls("blue")}>출력 (수기 양식)</h3>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className={labelCls}>
          시작 연도
          <select className={selCls} value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">처음부터</option>
            {asc.map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
        </label>
        <label className={labelCls}>
          끝 연도
          <select className={selCls} value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">끝까지</option>
            {asc.map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
        </label>
        {kind === "awards" && (
          <label className="flex items-center gap-1.5 pb-2 text-sm text-ink-body">
            <input type="checkbox" checked={mask} onChange={(e) => setMask(e.target.checked)} />
            청소년 이름 가리기 <span className="text-xs text-ink-hint">(행감 제출용)</span>
          </label>
        )}
        <div className="flex gap-2">
          <a className={btnSecondary} href={href("pdf")}>
            PDF 내려받기
          </a>
          <a className={btnSecondary} href={href("docx")}>
            Word 내려받기
          </a>
        </div>
      </div>
    </section>
  );
}

// =====================================================================
// 첨부 — 관장 피드백 "올리기 버튼이 안 보인다" 이후.
//   * 목록 "첨부" 칸: 있으면 📎개수(누르면 상세), 없으면 회색 [+ 올리기] →
//     행을 열지 않고 곧장 파일 선택 창. 종류는 파일로 추정(이미지=사진,
//     PDF=협약서·상장)하고, 상세에서 바꿀 수 있습니다.
//   * 상세 위쪽 첨부 영역: 끌어다 놓기·여러 파일, 종류 선택, 사진 썸네일,
//     PDF 는 아이콘+파일명. 새 건(아직 저장 전)은 대기열에 담았다가 저장 뒤 올립니다.
// =====================================================================

export type QueuedFile = { file: File; kind: OrgFileKind | "auto" };

// 화면 사전 검사 — 서버가 다시 검사하므로 안내용입니다.
function checkFile(f: File): string | null {
  if (!ORG_FILE_EXT[f.type]) return `'${f.name}' — PDF·JPG·PNG 만 올릴 수 있습니다.`;
  if (f.size > ORG_FILE_MAX_BYTES) return `'${f.name}' — 16MB 이하만 올릴 수 있습니다.`;
  return null;
}

// 차례로 하나씩 올립니다(Server Action 본문 한도). 실패한 파일의 사유를 모아 돌려줍니다.
export async function uploadQueued(
  kind: OrgRecordKind,
  recordId: string,
  items: QueuedFile[],
): Promise<string[]> {
  const errors: string[] = [];
  for (const it of items) {
    const bad = checkFile(it.file);
    if (bad) {
      errors.push(bad);
      continue;
    }
    const fd = new FormData();
    fd.set("kind", kind);
    fd.set("recordId", recordId);
    fd.set("fileKind", it.kind === "auto" ? guessOrgFileKind(it.file.type) : it.kind);
    fd.set("file", it.file);
    const r = await uploadOrgRecordFile(fd);
    if (!r.ok) errors.push(r.message);
  }
  return errors;
}

// 목록 "첨부" 칸.
export function AttachCell({
  kind,
  recordId,
  count,
  onOpen,
}: {
  kind: OrgRecordKind;
  recordId: string;
  count: number;
  onOpen: () => void;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  if (count > 0) {
    return (
      <button
        type="button"
        className="rounded-md px-1.5 py-0.5 text-sm font-semibold text-navy hover:bg-navy-soft"
        title="첨부 보기"
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
      >
        📎{count}
      </button>
    );
  }
  return (
    <>
      <button
        type="button"
        disabled={busy}
        className="whitespace-nowrap rounded-md border border-line bg-surface px-2 py-0.5 text-xs font-medium text-ink-muted hover:border-navy hover:text-navy disabled:opacity-60"
        onClick={(e) => {
          e.stopPropagation();
          input.current?.click();
        }}
      >
        {busy ? "올리는 중…" : "+ 올리기"}
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept={ORG_FILE_ACCEPT}
        className="hidden"
        onClick={(e) => e.stopPropagation()}
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (!files.length) return;
          setBusy(true);
          const errors = await uploadQueued(kind, recordId, files.map((file) => ({ file, kind: "auto" as const })));
          setBusy(false);
          if (errors.length) alert(errors.join("\n"));
          router.refresh();
        }}
      />
    </>
  );
}

// 상세 위쪽 첨부 영역. recordId 가 없으면(새 건) queue 에 담기만 합니다.
export function AttachmentPanel({
  kind,
  recordId,
  files,
  queue,
  setQueue,
}: {
  kind: OrgRecordKind;
  recordId: string | null;
  files: OrgRecordFile[];
  queue: QueuedFile[];
  setQueue: (q: QueuedFile[]) => void;
}) {
  const router = useRouter();
  const labels = ORG_FILE_KIND_LABEL[kind];
  const input = useRef<HTMLInputElement>(null);
  const [nextKind, setNextKind] = useState<OrgFileKind | "auto">("auto");
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});

  // 썸네일·열람 링크 — 첨부 구성이 바뀔 때만 다시 받습니다.
  const idsKey = files.map((f) => f.id).join(",");
  useEffect(() => {
    if (!recordId || !idsKey) return;
    let alive = true;
    getOrgRecordFileUrls(kind, recordId).then((r) => {
      if (alive && r.ok) setUrls(r.urls);
    });
    return () => {
      alive = false;
    };
  }, [kind, recordId, idsKey]);

  const add = async (list: File[]) => {
    setError(null);
    if (!list.length) return;
    const items = list.map((file) => ({ file, kind: nextKind }));
    if (!recordId) {
      const bad = list.map(checkFile).filter((x): x is string => !!x);
      if (bad.length) setError(bad.join(" "));
      setQueue([...queue, ...items.filter((it) => !checkFile(it.file))]);
      return;
    }
    setBusy(true);
    const errors = await uploadQueued(kind, recordId, items);
    setBusy(false);
    if (errors.length) setError(errors.join(" "));
    router.refresh();
  };

  const remove = async (f: OrgRecordFile) => {
    if (!confirm(`'${f.file_name}' 첨부를 삭제할까요?`)) return;
    setBusy(true);
    const r = await deleteOrgRecordFile(f.id);
    setBusy(false);
    if (!r.ok) setError(r.message);
    router.refresh();
  };

  const changeKind = async (f: OrgRecordFile, k: OrgFileKind) => {
    const r = await setOrgRecordFileKind(f.id, k);
    if (!r.ok) setError(r.message);
    router.refresh();
  };

  return (
    <div className="rounded-lg border border-rule bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">
          📎 첨부{" "}
          <span className="font-normal text-ink-muted">
            ({labels.document}·{labels.photo} 등 · PDF·JPG·PNG, 파일당 16MB)
          </span>
        </p>
        <label className="flex items-center gap-1.5 text-xs text-ink-muted">
          올릴 종류
          <select
            className="rounded-md border border-line bg-card px-2 py-1 text-xs"
            value={nextKind}
            onChange={(e) => setNextKind(e.target.value as OrgFileKind | "auto")}
          >
            <option value="auto">자동 (이미지=사진, PDF={labels.document})</option>
            {ORG_FILE_KINDS.map((k) => (
              <option key={k} value={k}>
                {labels[k]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div
        role="button"
        tabIndex={0}
        data-testid="org-dropzone"
        onClick={() => input.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") input.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void add([...e.dataTransfer.files]);
        }}
        className={`mt-2 cursor-pointer rounded-lg border-2 border-dashed px-3 py-4 text-center text-sm transition ${
          drag ? "border-navy bg-navy-soft text-navy" : "border-line text-ink-muted hover:border-navy hover:text-navy"
        }`}
      >
        {busy ? "처리 중…" : "여기로 파일을 끌어다 놓거나 눌러서 고르세요 (여러 개 가능)"}
        <input
          ref={input}
          type="file"
          multiple
          accept={ORG_FILE_ACCEPT}
          className="hidden"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const list = [...(e.target.files ?? [])];
            e.target.value = "";
            void add(list);
          }}
        />
      </div>

      {error && <p className={`${noticeError} mt-2`}>{error}</p>}

      {files.length > 0 && (
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {files.map((f) => {
            const url = urls[f.id];
            const isImage = f.mime_type.startsWith("image/");
            return (
              <li key={f.id} data-testid="org-file" className="flex flex-col gap-1 rounded-md border border-rule p-2">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener"
                  className="flex h-24 items-center justify-center overflow-hidden rounded bg-surface"
                  title="새 탭에서 열기"
                  onClick={(e) => {
                    if (!url) e.preventDefault();
                  }}
                >
                  {isImage && url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- 1시간 서명 URL 이라 next/image 최적화 대상이 아님
                    <img src={url} alt={f.file_name} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-3xl">{isImage ? "🖼️" : "📄"}</span>
                  )}
                </a>
                <p className="truncate text-xs text-ink-body" title={f.file_name}>
                  {f.file_name}
                </p>
                <div className="flex items-center justify-between gap-1">
                  <select
                    className="rounded border border-line bg-card px-1 py-0.5 text-[11px]"
                    value={f.kind}
                    onChange={(e) => void changeKind(f, e.target.value as OrgFileKind)}
                    aria-label="첨부 종류"
                  >
                    {ORG_FILE_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {labels[k]}
                      </option>
                    ))}
                  </select>
                  <span className="flex gap-2 text-[11px]">
                    {url && (
                      <a href={url} target="_blank" rel="noopener" className={linkCls}>
                        열기
                      </a>
                    )}
                    <button
                      type="button"
                      className="text-stamp hover:underline"
                      disabled={busy}
                      onClick={() => void remove(f)}
                    >
                      삭제
                    </button>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {queue.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-ink-body">
          {queue.map((q, i) => (
            <li key={i} className="flex items-center gap-2">
              <span>{q.file.type.startsWith("image/") ? "🖼️" : "📄"}</span>
              <span className="truncate">{q.file.name}</span>
              <span className="text-ink-hint">
                ({q.kind === "auto" ? labels[guessOrgFileKind(q.file.type)] : labels[q.kind]}) — 저장하면 올라갑니다
              </span>
              <button
                type="button"
                className="text-stamp hover:underline"
                onClick={() => setQueue(queue.filter((_, j) => j !== i))}
              >
                빼기
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
