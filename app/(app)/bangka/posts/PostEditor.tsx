"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createPostUpload,
  deletePost,
  deletePostFile,
  finalizePostUpload,
  savePost,
} from "@/app/(app)/bangka/posts/actions";
import { uploadToSlot } from "@/app/(app)/bangka/uploadClient";
import {
  BK_FILE_KIND_LABEL,
  BK_POST_TYPES,
  BK_POST_TYPE_LABEL,
  BK_SCOPES,
  BK_SCOPE_LABEL,
  bkFileKind,
  fmtBytes,
  isoToKstInput,
  type BkPostDetail,
  type BkPostType,
  type BkScope,
} from "@/lib/bangkaContent";
import {
  badgeNeutral,
  btnPrimary,
  btnSecondary,
  inputCls,
  labelCls,
  linkCls,
  noticeError,
  noticeSuccess,
  panelToneCls,
  sectionTitleCls,
} from "@/lib/ui";

// =====================================================================
// 공지·알림장 작성/수정.
//   · 게시일시: 비우면 저장하는 '지금'. 미래로 정하면 그때 보호자 앱에 나타납니다(예약).
//   · 첨부(사진·동영상·문서 여러 개): 새 글은 저장한 뒤 이어서 올라가고, 이미 있는 글은
//     고르는 즉시 올라갑니다. 사진은 서버에서 긴 변 1600px 로 줄입니다.
//   · 삭제는 소프트삭제 — 보호자 앱에서 바로 사라집니다.
// =====================================================================

const ACCEPT = "image/*,video/*,.pdf,.hwp,.hwpx,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip";

type Form = {
  post_type: BkPostType;
  scope: BkScope;
  title: string;
  body: string;
  is_pinned: boolean;
  published_at: string; // datetime-local(KST), 비면 지금
};

export default function PostEditor({ post }: { post: BkPostDetail | null }) {
  const router = useRouter();
  const [f, setF] = useState<Form>(() =>
    post
      ? {
          post_type: post.post_type,
          scope: post.scope,
          title: post.title,
          body: post.body ?? "",
          is_pinned: post.is_pinned,
          published_at: isoToKstInput(post.published_at),
        }
      : { post_type: "class_note", scope: "all", title: "", body: "", is_pinned: false, published_at: "" }
  );
  const [queued, setQueued] = useState<File[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  // 한 장씩 올립니다(폰 회선에서 동시에 여러 개 올리면 자주 끊깁니다). 실패한 것만 모아 알림.
  async function uploadAll(postId: string, files: File[]): Promise<string[]> {
    const errors: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setProgress(`첨부 올리는 중 ${i + 1}/${files.length} — ${file.name}`);
      try {
        const slot = await createPostUpload({ postId, name: file.name, mime: file.type, size: file.size });
        if (!slot.ok) throw new Error(slot.message);
        await uploadToSlot(slot, file);
        const fin = await finalizePostUpload({ postId, path: slot.path, name: file.name, mime: file.type, kind: slot.kind });
        if (!fin.ok) throw new Error(fin.message);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : `${file.name}: 올리지 못했습니다.`);
      }
    }
    setProgress(null);
    return errors;
  }

  function save() {
    setErr(null);
    setOk(null);
    start(async () => {
      const res = await savePost({ id: post?.id, ...f });
      if (!res.ok) {
        setErr(res.message);
        return;
      }
      const errors = queued.length ? await uploadAll(res.id, queued) : [];
      setQueued([]);
      if (errors.length) setErr(errors.join("\n"));
      if (!post) {
        router.replace(`/bangka/posts/${res.id}`);
        return;
      }
      setOk("저장했습니다.");
      router.refresh();
    });
  }

  function addFiles(files: File[]) {
    setErr(null);
    const bad = files.filter((x) => !bkFileKind(x.name, x.type));
    if (bad.length) setErr(`올릴 수 없는 형식: ${bad.map((x) => x.name).join(", ")} (사진·동영상·문서만)`);
    const good = files.filter((x) => bkFileKind(x.name, x.type));
    if (!good.length) return;
    if (!post) {
      setQueued((q) => [...q, ...good]);
      return;
    }
    start(async () => {
      const errors = await uploadAll(post.id, good);
      if (errors.length) setErr(errors.join("\n"));
      router.refresh();
    });
  }

  function removeFile(fileId: string, name: string | null) {
    if (!post || !confirm(`첨부 "${name ?? "파일"}"을(를) 지울까요?`)) return;
    start(async () => {
      const res = await deletePostFile({ postId: post.id, fileId });
      if (!res.ok) setErr(res.message);
      router.refresh();
    });
  }

  function remove() {
    if (!post || !confirm("이 글을 삭제할까요? 보호자 앱에서 바로 사라집니다.")) return;
    start(async () => {
      const res = await deletePost(post.id);
      if (!res.ok) setErr(res.message);
      else router.push("/bangka/posts");
    });
  }

  return (
    <div className="space-y-4">
      <Link href="/bangka/posts" className={`text-sm ${linkCls}`}>
        ← 목록
      </Link>

      <section className={`${panelToneCls("yellow")} space-y-3`}>
        <h3 className={sectionTitleCls("yellow")}>{post ? "글 수정" : "새 글"}</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <label>
            <span className={labelCls}>종류</span>
            <select value={f.post_type} onChange={(e) => set("post_type", e.target.value as BkPostType)} className={inputCls}>
              {BK_POST_TYPES.map((t) => (
                <option key={t} value={t}>
                  {BK_POST_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={labelCls}>대상</span>
            <select value={f.scope} onChange={(e) => set("scope", e.target.value as BkScope)} className={inputCls}>
              {BK_SCOPES.map((s) => (
                <option key={s} value={s}>
                  {BK_SCOPE_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={labelCls}>게시일시(비우면 지금)</span>
            <input
              type="datetime-local"
              value={f.published_at}
              onChange={(e) => set("published_at", e.target.value)}
              className={inputCls}
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-body">
          <input type="checkbox" checked={f.is_pinned} onChange={(e) => set("is_pinned", e.target.checked)} className="h-4 w-4" />
          📌 맨 위에 고정
        </label>
        <label className="block">
          <span className={labelCls}>제목 *</span>
          <input value={f.title} onChange={(e) => set("title", e.target.value)} className={inputCls} />
        </label>
        <label className="block">
          <span className={labelCls}>내용</span>
          <textarea value={f.body} onChange={(e) => set("body", e.target.value)} rows={10} className={`${inputCls} h-auto`} />
        </label>
      </section>

      <section className={`${panelToneCls("green")} space-y-3`}>
        <h3 className={sectionTitleCls("green")}>첨부(사진·동영상·문서)</h3>
        <p className="text-xs text-ink-hint">
          여러 개를 한꺼번에 고를 수 있습니다. 사진은 긴 변 1600px 로 줄여 저장합니다(동영상 100MB, 문서 30MB 까지).
          {!post && " 새 글은 [저장]을 누르면 이어서 올라갑니다."}
        </p>
        {post && post.files.length > 0 && (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {post.files.map((x) => (
              <li key={x.id} className="flex items-center gap-2 rounded-lg border border-line bg-card p-2">
                {x.kind === "image" && x.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- 비공개 버킷 서명 URL(1시간) 미리보기
                  <img src={x.url} alt={x.name ?? ""} className="h-14 w-14 shrink-0 rounded object-cover" />
                ) : (
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-surface text-2xl">
                    {x.kind === "video" ? "🎬" : "📄"}
                  </span>
                )}
                <div className="min-w-0 flex-1 text-xs">
                  <p className="truncate font-medium text-ink">
                    {x.url ? (
                      <a href={x.url} target="_blank" rel="noopener noreferrer" className={linkCls}>
                        {x.name ?? "파일"}
                      </a>
                    ) : (
                      (x.name ?? "파일")
                    )}
                  </p>
                  <p className="text-ink-muted">
                    {BK_FILE_KIND_LABEL[x.kind]} · {fmtBytes(x.size)}
                    {x.width && x.height ? ` · ${x.width}×${x.height}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => removeFile(x.id, x.name)}
                  className={`${btnSecondary} h-8 px-2 text-xs`}
                >
                  삭제
                </button>
              </li>
            ))}
          </ul>
        )}
        {queued.length > 0 && (
          <ul className="space-y-1 text-xs">
            {queued.map((x, i) => (
              <li key={`${x.name}-${i}`} className="flex items-center gap-2">
                <span className={badgeNeutral}>{BK_FILE_KIND_LABEL[bkFileKind(x.name, x.type) ?? "doc"]}</span>
                <span className="truncate text-ink-body">{x.name}</span>
                <span className="text-ink-muted">{fmtBytes(x.size)}</span>
                <button
                  type="button"
                  onClick={() => setQueued((q) => q.filter((_, j) => j !== i))}
                  className="text-ink-muted hover:underline"
                >
                  빼기
                </button>
              </li>
            ))}
          </ul>
        )}
        <label className={`inline-flex cursor-pointer ${btnSecondary} ${pending ? "pointer-events-none opacity-60" : ""}`}>
          파일 고르기
          <input
            type="file"
            multiple
            accept={ACCEPT}
            className="sr-only"
            disabled={pending}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length) addFiles(files);
            }}
          />
        </label>
        {progress && <p className="text-xs text-navy">{progress}</p>}
      </section>

      {err && <p className={`${noticeError} whitespace-pre-line`}>{err}</p>}
      {ok && <p className={noticeSuccess}>{ok}</p>}

      <div className="flex flex-wrap justify-between gap-2">
        <div>
          {post && (
            <button type="button" onClick={remove} disabled={pending} className={btnSecondary}>
              글 삭제
            </button>
          )}
        </div>
        <button type="button" onClick={save} disabled={pending || !f.title.trim()} className={btnPrimary}>
          {pending ? (progress ? "올리는 중…" : "저장 중…") : "저장"}
        </button>
      </div>
    </div>
  );
}
