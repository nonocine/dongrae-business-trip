// =====================================================================
// 문자 발송 접근 게이트 — /sms 화면과 /api/sms/* 라우트가 같은 함수를 씁니다.
//   전 직원 공통 기능(2026-11 변경 — 팀장 이상 조건 삭제).
//   통과 조건: 로그인한 직원 + SMS_SEND_EMAILS(쉼표 구분, 대소문자·공백 무시)에
//     로그인 이메일이 있음. "*" 이면 로그인 직원 전원. 없으면 아무도 못 보냅니다.
//     BULK_PRINT_EMAILS 와 같은 방식 — 직원 비번 로그인은 이메일이 없어 "*" 일 때만.
//   발송 이력의 본문 전체는 보낸 본인·관장·부장(M0)만 — canSeeFullBody.
//   * 서버 전용 모듈.
// =====================================================================

import { getSession, getGoogleSession } from "@/app/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isM0Grant } from "@/lib/authLevels";

export function smsSendAllowed(
  who: { email: string | null | undefined },
  envValue: string | undefined = process.env.SMS_SEND_EMAILS,
): boolean {
  const list = (envValue ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (list.includes("*")) return true;
  const email = who.email?.trim().toLowerCase();
  return !!email && list.includes(email);
}

export type SmsAccess = {
  name: string;
  driverId: string | null;
  // 관장·부장(M0) — 이력의 다른 직원 본문 전체 열람.
  isM0: boolean;
};

export async function resolveSmsAccess(): Promise<SmsAccess | null> {
  const me = await getSession();
  if (!me || me.kind !== "employee" || !me.name.trim()) return null;
  const g = await getGoogleSession();
  if (!smsSendAllowed({ email: g?.email })) return null;

  const { data: driver } = await supabaseAdmin
    .from("drivers")
    .select("id, rank")
    .eq("name", me.name.trim())
    .maybeSingle();
  const d = driver as { id?: string; rank?: string | null } | null;
  const driverId = typeof d?.id === "string" ? d.id : null;
  let authLevel: string | null = null;
  if (driverId) {
    const { data: prof } = await supabaseAdmin
      .from("employee_profiles")
      .select("auth_level")
      .eq("driver_id", driverId)
      .maybeSingle();
    authLevel = (prof as { auth_level?: string | null } | null)?.auth_level ?? null;
  }
  return {
    name: me.name.trim(),
    driverId,
    isM0: isM0Grant({ rank: d?.rank ?? null, email: g?.email, authLevel }),
  };
}

// 이력 본문 전체를 볼 수 있는가 — 보낸 본인 또는 관장·부장(M0).
export function canSeeFullBody(
  viewer: Pick<SmsAccess, "driverId" | "isM0">,
  sentBy: string | null,
): boolean {
  return viewer.isM0 || (!!viewer.driverId && viewer.driverId === sentBy);
}

// 다른 직원에게 보이는 본문 — 앞 20자.
export const SMS_BODY_PREVIEW_CHARS = 20;
export function previewBody(text: string): string {
  const chars = [...(text ?? "")];
  return chars.length > SMS_BODY_PREVIEW_CHARS
    ? `${chars.slice(0, SMS_BODY_PREVIEW_CHARS).join("")}…`
    : chars.join("");
}
