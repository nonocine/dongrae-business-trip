// =====================================================================
// 문자 발송 접근 게이트 — /sms 화면과 /api/sms/* 라우트가 같은 함수를 씁니다.
//   통과 조건(둘 다):
//   1) 팀장 이상 — 기존 권한 체계: M0(관장·부장·master·auth_level M0) 또는
//      유효 권한등급 M1(auth_level 우선, 없으면 직급 팀장).
//   2) SMS_SEND_EMAILS(쉼표 구분, 대소문자·공백 무시)에 로그인 이메일이 있음.
//      "*" 이면 1)만 보면 됩니다. 없으면 아무도 못 보냅니다.
//      BULK_PRINT_EMAILS 와 같은 방식 — 직원 비번 로그인은 이메일이 없어 "*" 일 때만.
//   * 서버 전용 모듈.
// =====================================================================

import { getSession, getGoogleSession } from "@/app/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { effectiveAuthLevel, isM0Grant } from "@/lib/authLevels";

export function smsSendAllowed(
  who: {
    rank: string | null;
    email: string | null | undefined;
    authLevel: string | null;
  },
  envValue: string | undefined = process.env.SMS_SEND_EMAILS,
): boolean {
  const leader =
    isM0Grant({ rank: who.rank, email: who.email, authLevel: who.authLevel }) ||
    effectiveAuthLevel(who.rank, who.authLevel) === "M1";
  if (!leader) return false;
  const list = (envValue ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (list.includes("*")) return true;
  const email = who.email?.trim().toLowerCase();
  return !!email && list.includes(email);
}

export type SmsAccess = { name: string; driverId: string | null };

export async function resolveSmsAccess(): Promise<SmsAccess | null> {
  const me = await getSession();
  if (!me || me.kind !== "employee" || !me.name.trim()) return null;
  const g = await getGoogleSession();
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
  if (!smsSendAllowed({ rank: d?.rank ?? null, email: g?.email, authLevel }))
    return null;
  return { name: me.name.trim(), driverId };
}
