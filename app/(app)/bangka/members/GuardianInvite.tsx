"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reissueGuardianInvite } from "@/app/(app)/bangka/members/actions";
import { bkInviteMessage } from "@/lib/bangka";
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
  noticeWarning,
  panelToneCls,
} from "@/lib/ui";

// =====================================================================
// 동래방카 가입 링크 — 상태 배지 + [초대 링크 발급/재발급] 창 + 링크·카톡 문구 복사.
//   동래샘들 InviteReissue(app/(app)/hr/saems) 와 같은 UX(7/14/30일, 기본 14일).
//   다른 점: 이미 가입(PIN 설정)한 보호자에게도 발급할 수 있고, 그러면 PIN 이
//   바로 지워집니다(PIN 분실 재설정 경로가 이것뿐) — 창에서 크게 경고합니다.
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
        ? `${inviteDateKst(state.expiresAt)} 만료 — 상세에서 링크를 다시 발급하세요`
        : state.kind === "none"
          ? "가입 링크가 발급된 적이 없습니다"
          : undefined;
  return (
    <span className={BADGE[state.kind]} title={title}>
      {inviteStateLabel(state)}
    </span>
  );
}

export function GuardianInviteButton({
  guardianId,
  name,
  state,
}: {
  guardianId: string;
  name: string;
  state: InviteState;
}) {
  const [open, setOpen] = useState(false);
  const label =
    state.kind === "registered" ? "PIN 재설정 링크" : state.kind === "none" ? "초대 링크 발급" : "초대 링크 재발급";
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={state.kind === "registered" || state.kind === "valid" ? btnSecondary : btnPrimary}
      >
        {label}
      </button>
      {open && (
        <InviteDialog guardianId={guardianId} name={name} state={state} title={label} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function InviteDialog({
  guardianId,
  name,
  state,
  title,
  onClose,
}: {
  guardianId: string;
  name: string;
  state: InviteState;
  title: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [days, setDays] = useState<number>(INVITE_DAYS_DEFAULT);
  const [issued, setIssued] = useState<{ url: string; expiresAt: string; name: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const registered = state.kind === "registered";

  function issue() {
    if (registered && !confirm(`${name}님의 지금 PIN 이 바로 지워지고 앱에서 로그아웃됩니다. 계속할까요?`)) return;
    setErr(null);
    start(async () => {
      const res = await reissueGuardianInvite({ guardianId, days });
      if (!res.ok) {
        setErr(res.message);
        return;
      }
      setIssued({ url: res.url, expiresAt: res.expiresAt, name: res.name || name });
    });
  }

  function close() {
    if (issued) router.refresh(); // 상태·배지 갱신
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${name} ${title}`}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
    >
      <div className={`${panelToneCls("yellow")} max-h-[92vh] w-full max-w-md overflow-y-auto shadow-lg`}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">
            {title} — {name}
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
        {registered && (
          <p className={`mt-2 ${noticeWarning}`}>
            이미 가입한 보호자입니다. 링크를 만들면 지금 PIN 이 바로 지워지고 앱에서 로그아웃됩니다.
            보호자가 새 링크로 PIN 을 다시 정해야 앱을 쓸 수 있습니다(PIN 을 잊었을 때만 쓰세요).
          </p>
        )}

        {!issued ? (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="min-w-[8rem] flex-1">
              <span className={labelCls}>유효기간</span>
              <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={`mt-1 ${inputCls}`}>
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
          <IssuedLink
            url={issued.url}
            message={bkInviteMessage({ guardianName: issued.name, url: issued.url, expiresAt: issued.expiresAt })}
            notice={`새 링크를 만들었습니다 — ${inviteDateKst(issued.expiresAt)}까지 유효합니다.`}
          />
        )}

        {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}
      </div>
    </div>
  );
}

// 링크 + [링크 복사] + [카톡 문구 복사] — 발급 직후와 상세의 '지금 유효한 링크' 공용.
export function IssuedLink({ url, message, notice }: { url: string; message: string; notice?: string }) {
  const [copied, setCopied] = useState<"" | "url" | "msg">("");

  async function copy(text: string, which: "url" | "msg") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
    } catch {
      setCopied("");
    }
  }

  return (
    <div className="mt-3 space-y-2">
      {notice && <p className={noticeSuccess}>{notice}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className={`${inputCls} min-w-[200px] flex-1 font-mono text-xs`}
          data-testid="bangka-invite-url"
        />
        <button type="button" onClick={() => copy(url, "url")} className={btnPrimary}>
          {copied === "url" ? "복사됨 ✓" : "링크 복사"}
        </button>
      </div>
      <div className={blockCls}>
        <p className="whitespace-pre-wrap text-xs text-ink-body">{message}</p>
        <button type="button" onClick={() => copy(message, "msg")} className={`mt-2 ${btnSecondary}`}>
          {copied === "msg" ? "복사됨 ✓" : "카톡 문구 복사"}
        </button>
      </div>
    </div>
  );
}
