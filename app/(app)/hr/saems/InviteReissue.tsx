"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reissueInvite } from "@/app/(app)/hr/saems/inviteActions";
import {
  INVITE_DAYS_DEFAULT,
  INVITE_DAYS_OPTIONS,
  inviteDateKst,
  inviteStateLabel,
  type InviteState,
} from "@/lib/saemInvite";
import {
  badgeDanger,
  badgeNeutral,
  badgeSuccess,
  badgeWarning,
  blockCls,
  btnPrimary,
  btnSecondary,
  inputCls,
  labelCls,
  noticeError,
  noticeSuccess,
  panelToneCls,
} from "@/lib/ui";

// =====================================================================
// 초대 링크 상태 배지 + [초대 링크 재발급] — 강사관리(목록·상세)·동아리관리 공용.
//   미가입자에게만 버튼이 나옵니다(가입 완료면 null). 링크가 만료된 경우와
//   처음부터 없던 경우 모두 같은 버튼입니다(없으면 문구만 '발급').
// =====================================================================

const BADGE: Record<InviteState["kind"], string> = {
  registered: badgeSuccess,
  valid: badgeNeutral,
  expired: badgeDanger,
  none: badgeWarning,
};

export function InviteStatusBadge({ state }: { state: InviteState }) {
  const title =
    state.kind === "valid"
      ? `만료일 ${inviteDateKst(state.expiresAt)}`
      : state.kind === "expired"
        ? `${inviteDateKst(state.expiresAt)} 만료 — [초대 링크 재발급]으로 새 링크를 보내세요`
        : state.kind === "none"
          ? "초대 링크가 발급된 적이 없습니다"
          : undefined;
  return (
    <span className={BADGE[state.kind]} title={title}>
      {inviteStateLabel(state)}
    </span>
  );
}

export function InviteReissueButton({
  instructorId,
  name,
  state,
  className,
}: {
  instructorId: string;
  name: string;
  state: InviteState;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (state.kind === "registered") return null;
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation(); // 목록 행 클릭(상세 이동)과 분리
          setOpen(true);
        }}
        className={className ?? (state.kind === "valid" ? btnSecondary : btnPrimary)}
      >
        {state.kind === "none" ? "초대 링크 발급" : "초대 링크 재발급"}
      </button>
      {open && (
        <InviteReissueDialog
          instructorId={instructorId}
          name={name}
          state={state}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function InviteReissueDialog({
  instructorId,
  name,
  state,
  onClose,
}: {
  instructorId: string;
  name: string;
  state: InviteState;
  onClose: () => void;
}) {
  const router = useRouter();
  const [days, setDays] = useState<number>(INVITE_DAYS_DEFAULT);
  const [issued, setIssued] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState<"" | "url" | "msg">("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function issue() {
    setErr(null);
    setCopied("");
    start(async () => {
      const res = await reissueInvite({ instructorId, days });
      if (!res.ok) {
        setErr(res.message);
        return;
      }
      setIssued({ url: res.url, expiresAt: res.expiresAt });
    });
  }

  function close() {
    if (issued) router.refresh(); // 목록 배지 갱신
    onClose();
  }

  // 카톡에 그대로 붙여 넣을 안내문.
  const message = issued
    ? `[동래구청소년센터] ${name}님, 동래샘들 가입 링크입니다.\n${issued.url}\n링크를 열어 전화번호 뒤 4자리를 확인하고 비밀번호를 정하시면 됩니다. (${inviteDateKst(issued.expiresAt)}까지 유효)`
    : "";

  async function copy(text: string, which: "url" | "msg") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
    } catch {
      setCopied("");
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${name} 초대 링크 재발급`}
      onClick={(e) => e.stopPropagation()}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
    >
      <div className={`${panelToneCls("yellow")} max-h-[92vh] w-full max-w-md overflow-y-auto shadow-lg`}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">
            {state.kind === "none" ? "초대 링크 발급" : "초대 링크 재발급"} — {name}
          </h3>
          <button type="button" onClick={close} disabled={pending} className="text-sm text-ink-muted hover:underline">
            닫기
          </button>
        </div>

        <div className={blockCls}>
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink-body">
            현재 상태 <InviteStatusBadge state={state} />
          </p>
          <p className="mt-1 text-xs text-ink-hint">
            {state.kind === "none"
              ? "아직 링크를 만든 적이 없습니다. 새로 만들어 보내세요."
              : "새 링크를 만들면 예전에 보낸 링크는 더 이상 열리지 않습니다. 꼭 새 링크를 다시 보내세요."}
          </p>
        </div>

        {!issued ? (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="min-w-[8rem] flex-1">
              <span className={labelCls}>유효기간</span>
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className={`mt-1 ${inputCls}`}
              >
                {INVITE_DAYS_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}일{d === INVITE_DAYS_DEFAULT ? " (기본)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={issue} disabled={pending} className={btnPrimary}>
              {pending ? "만드는 중…" : "새 링크 만들기"}
            </button>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            <p className={noticeSuccess}>
              새 링크를 만들었습니다 — {inviteDateKst(issued.expiresAt)}까지 유효합니다.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                readOnly
                value={issued.url}
                onFocus={(e) => e.currentTarget.select()}
                className={`${inputCls} min-w-[200px] flex-1 font-mono text-xs`}
                data-testid="invite-url"
              />
              <button type="button" onClick={() => copy(issued.url, "url")} className={btnPrimary}>
                {copied === "url" ? "복사됨 ✓" : "링크 복사"}
              </button>
            </div>
            <div className={blockCls}>
              <p className="whitespace-pre-wrap text-xs text-ink-body">{message}</p>
              <button type="button" onClick={() => copy(message, "msg")} className={`mt-2 ${btnSecondary}`}>
                {copied === "msg" ? "복사됨 ✓" : "카톡 안내문 복사"}
              </button>
            </div>
          </div>
        )}

        {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}
      </div>
    </div>
  );
}
