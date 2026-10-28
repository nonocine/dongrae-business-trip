"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteMyReply,
  editMyReply,
  hideTalkMessage,
  replyTalk,
  setTalkClosed,
  unhideTalkMessage,
} from "@/app/(app)/bangka/talk/actions";
import { fmtKstShort } from "@/lib/bangkaContent";
import { TALK_MAX_BODY, TALK_STATUS_LABEL, type TalkMessageRow, type TalkStatus, type TalkThreadDetail } from "@/lib/bangkaTalk";
import {
  badgeNeutral,
  badgeSuccess,
  badgeWarning,
  btnDanger,
  btnPrimary,
  btnSecondary,
  inputCls,
  labelCls,
  linkCls,
  noticeError,
  noticeSuccess,
  panelToneCls,
} from "@/lib/ui";

// =====================================================================
// 방카톡 대화(직원) — 말 전체(가린 글은 원문 + 사유, 회색) · 답글(시간 제한 없음, 이름 = 로그인 직원)
//   · [가리기] 사유 필수 — 보호자 화면엔 "선생님이 가린 글입니다(사유)" · [가림 풀기]
//   · 내 답글만 [고치기] [지우기](결정 4) · [대화 닫기]/[다시 열기]
//   휴대폰에서도 누르는 곳은 44px(min-h-11) — PC(sm 이상)는 공용 버튼 높이.
// =====================================================================

const STATUS_BADGE: Record<TalkStatus, string> = { open: badgeWarning, answered: badgeSuccess, closed: badgeNeutral };
const tap = "min-h-11 sm:min-h-0";

export default function TalkThreadView({ thread }: { thread: TalkThreadDetail }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [reply, setReply] = useState("");

  const run = (fn: () => Promise<{ ok: true } | { ok: false; message: string }>, okText: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.message });
      if (r.ok) {
        after?.();
        router.refresh();
      }
    });

  const closed = thread.status === "closed";

  return (
    <div className="space-y-4">
      <Link href="/bangka/talk" className={`${linkCls} inline-flex min-h-11 items-center text-sm sm:min-h-0`}>
        ← 방카톡 목록
      </Link>

      <div className={`${panelToneCls("blue")} space-y-2`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={STATUS_BADGE[thread.status]}>{TALK_STATUS_LABEL[thread.status]}</span>
          <b className="text-ink">{thread.guardianName} 보호자</b>
          {thread.studentName && <span className="text-sm text-ink">({thread.studentName})</span>}
          {thread.classLabel && <span className="text-sm text-ink-muted">{thread.classLabel}</span>}
        </div>
        <p className="break-words text-sm font-medium text-ink">{thread.topicTitle}</p>
        {thread.topicType === "post" && thread.postId && (
          <Link href={`/bangka/posts/${thread.postId}`} className={`${linkCls} inline-flex min-h-11 items-center text-sm sm:min-h-0`}>
            연결된 글 보기 →
          </Link>
        )}
        {closed && (
          <p className="text-xs text-ink-muted">
            {thread.closedBy ?? "직원"}이(가) 닫음{thread.closedAt ? ` · ${fmtKstShort(thread.closedAt)}` : ""} — 보호자는 이 대화에 더 쓸 수 없습니다.
          </p>
        )}
      </div>

      <ol className="space-y-3">
        {thread.messages.map((m) => (
          <MessageItem key={m.id} threadId={thread.id} m={m} pending={pending} run={run} />
        ))}
      </ol>

      {msg && <p className={msg.ok ? noticeSuccess : noticeError}>{msg.text}</p>}

      <div className={`${panelToneCls("green")} space-y-2`}>
        <label className="block">
          <span className={labelCls}>답글 (보호자 앱에 내 이름으로 보입니다 · {reply.length}/{TALK_MAX_BODY})</span>
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            maxLength={TALK_MAX_BODY}
            rows={4}
            className={`${inputCls} text-base sm:text-sm`}
            placeholder={closed ? "닫힌 대화에도 마지막 안내를 남길 수 있습니다." : "답글을 적어 주세요."}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pending || !reply.trim()}
            onClick={() => run(() => replyTalk(thread.id, reply), "답글을 보냈습니다.", () => setReply(""))}
            className={`${btnPrimary} ${tap}`}
          >
            답글 보내기
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!closed && !confirm("이 대화를 닫을까요? 보호자는 이 대화에 더 쓸 수 없습니다(새 문의는 가능).")) return;
              run(() => setTalkClosed(thread.id, !closed), closed ? "대화를 다시 열었습니다." : "대화를 닫았습니다.");
            }}
            className={`ml-auto ${closed ? btnSecondary : btnDanger} ${tap}`}
          >
            {closed ? "대화 다시 열기" : "대화 닫기"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageItem({
  threadId,
  m,
  pending,
  run,
}: {
  threadId: string;
  m: TalkMessageRow;
  pending: boolean;
  run: (fn: () => Promise<{ ok: true } | { ok: false; message: string }>, okText: string, after?: () => void) => void;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "hide">("view");
  const [draft, setDraft] = useState(m.body);
  const [why, setWhy] = useState("");
  const staff = m.authorType === "staff";
  const muted = m.deleted || !!m.hiddenAt;

  return (
    <li className={`flex flex-col gap-1 ${staff ? "items-end" : "items-start"}`}>
      <span className="text-xs text-ink-muted">
        {m.authorName}
        {staff ? " 선생님" : ""} · {fmtKstShort(m.createdAt)}
        {m.edited && !m.deleted ? " · 수정됨" : ""}
      </span>
      {mode === "edit" ? (
        <div className="w-full max-w-xl space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={TALK_MAX_BODY}
            rows={4}
            aria-label="고칠 답글"
            className={`${inputCls} text-base sm:text-sm`}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setMode("view")} className={`${btnSecondary} ${tap}`}>
              그만두기
            </button>
            <button
              type="button"
              disabled={pending || !draft.trim()}
              onClick={() => run(() => editMyReply(threadId, m.id, draft), "답글을 고쳤습니다.", () => setMode("view"))}
              className={`${btnPrimary} ${tap}`}
            >
              고친 내용 저장
            </button>
          </div>
        </div>
      ) : (
        <div
          className={`max-w-[85%] whitespace-pre-wrap break-words rounded-xl border px-3 py-2 text-sm ${
            muted ? "border-rule bg-surface text-ink-muted" : staff ? "border-navy/30 bg-navy-soft text-ink" : "border-rule bg-card text-ink"
          }`}
        >
          {m.deleted ? (staff ? "(지운 답글)" : "(보호자가 지운 글)") : m.body}
          {m.hiddenAt && (
            <p className="mt-1 text-xs font-semibold text-stamp">
              가린 글 — {m.hiddenReason} ({m.hiddenBy ?? "직원"}) · 보호자에게는 내용 대신 안내만 보입니다.
            </p>
          )}
        </div>
      )}
      {mode === "hide" && (
        <div className="flex w-full max-w-xl flex-wrap items-end gap-2">
          <label className="min-w-[12rem] flex-1">
            <span className={labelCls}>가리는 이유(보호자에게도 보입니다)</span>
            <input value={why} onChange={(e) => setWhy(e.target.value)} maxLength={200} className={`${inputCls} text-base sm:text-sm`} placeholder="예: 개인정보 포함" />
          </label>
          <button type="button" onClick={() => setMode("view")} className={`${btnSecondary} ${tap}`}>
            그만두기
          </button>
          <button
            type="button"
            disabled={pending || !why.trim()}
            onClick={() => run(() => hideTalkMessage(threadId, m.id, why), "글을 가렸습니다.", () => setMode("view"))}
            className={`${btnDanger} ${tap}`}
          >
            가리기
          </button>
        </div>
      )}
      {mode === "view" && !m.deleted && (
        <div className="flex flex-wrap gap-2">
          {m.hiddenAt ? (
            <button type="button" disabled={pending} onClick={() => run(() => unhideTalkMessage(threadId, m.id), "가림을 풀었습니다.")} className={`${btnSecondary} ${tap}`}>
              가림 풀기
            </button>
          ) : (
            !m.mine && (
              <button type="button" onClick={() => setMode("hide")} className={`${btnSecondary} ${tap}`}>
                가리기
              </button>
            )
          )}
          {m.mine && (
            <>
              <button
                type="button"
                onClick={() => {
                  setDraft(m.body);
                  setMode("edit");
                }}
                className={`${btnSecondary} ${tap}`}
              >
                고치기
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (confirm("이 답글을 지울까요? 보호자에게는 '삭제된 답글입니다'로 보입니다.")) run(() => deleteMyReply(threadId, m.id), "답글을 지웠습니다.");
                }}
                className={`${btnSecondary} ${tap}`}
              >
                지우기
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
}
