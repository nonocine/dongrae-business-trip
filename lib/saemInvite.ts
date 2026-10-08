// =====================================================================
// 동래샘들 초대 링크 — 유효기간 설정 + 링크 상태 판정 (2026-10 관장 요청)
//
//   배경: 강사가 초대 링크를 늦게 열어 만료되자, 담당자가 되살릴 방법을 몰라
//   '계정 삭제 후 재등록'을 요청했습니다. 그래서
//     · 목록에 링크 상태(가입 완료 / 유효 N일 / 만료 / 없음)를 보이고
//     · 미가입자에게 [초대 링크 재발급]을 둡니다(inviteActions.reissueInvite).
//
//   유효기간: 원래 7일 고정이었습니다. 강사들이 바로 가입하지 못하는 일이
//   많아 기본 14일로 늘리고, 재발급 때 7/14/30일 중 고를 수 있게 했습니다.
//   기본값을 바꾸려면 INVITE_DAYS_DEFAULT 한 곳만 고치면 됩니다
//   (신규 동아리샘 등록·재발급이 모두 이 값을 씁니다).
//
//   클라이언트에서도 쓰는 순수 모듈입니다(서버 전용 import 금지).
// =====================================================================

export const INVITE_DAYS_DEFAULT = 14;
export const INVITE_DAYS_OPTIONS = [7, 14, 30] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export function inviteExpiresAt(days: number, nowMs = Date.now()): string {
  return new Date(nowMs + days * DAY_MS).toISOString();
}

// 재발급 요청의 기간 — 허용 목록 밖이면 기본값.
export function normalizeInviteDays(days: unknown): number {
  const n = Number(days);
  return (INVITE_DAYS_OPTIONS as readonly number[]).includes(n)
    ? n
    : INVITE_DAYS_DEFAULT;
}

export type InviteState =
  | { kind: "registered" }
  | { kind: "valid"; daysLeft: number; expiresAt: string }
  | { kind: "expired"; expiresAt: string }
  | { kind: "none" };

// 판정 기준
//   · 가입 여부 = password_set_at. 동래샘들 가입 처리(app/api/auth/invite)와
//     임시비번 발급이 password_hash 와 함께 항상 같이 채웁니다.
//   · 링크 유무 = invite_expires_at. 토큰과 항상 함께 쓰이고 함께 지워집니다.
//     토큰 자체는 열람 직원에게 가려지므로(maskInstructor) 만료일로 봅니다.
//   서버에서 계산해 내려보냅니다 — 클라이언트에서 Date.now() 로 다시 재면
//   서버 렌더와 하루 경계에서 어긋날 수 있습니다.
export function inviteState(
  row: { password_set_at: string | null; invite_expires_at: string | null },
  nowMs = Date.now()
): InviteState {
  if (row.password_set_at) return { kind: "registered" };
  if (!row.invite_expires_at) return { kind: "none" };
  const left = new Date(row.invite_expires_at).getTime() - nowMs;
  if (!Number.isFinite(left) || left <= 0)
    return { kind: "expired", expiresAt: row.invite_expires_at };
  return {
    kind: "valid",
    daysLeft: Math.max(1, Math.ceil(left / DAY_MS)),
    expiresAt: row.invite_expires_at,
  };
}

export function inviteStateLabel(s: InviteState): string {
  switch (s.kind) {
    case "registered":
      return "가입 완료";
    case "valid":
      return `링크 유효(${s.daysLeft}일 남음)`;
    case "expired":
      return "링크 만료";
    case "none":
      return "링크 없음";
  }
}

// "2026-10-07" 형태(KST) — 배지 툴팁·안내용.
export function inviteDateKst(iso: string): string {
  return new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}
