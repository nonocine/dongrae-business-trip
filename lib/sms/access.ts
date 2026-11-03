// =====================================================================
// 문자 발송 접근 게이트 — /sms 화면과 /api/sms/* 라우트가 같은 함수를 씁니다.
//   전 직원 공통 기능(2026-11).
//   통과 조건: 로그인한 직원 + SMS_SEND_EMAILS(쉼표 구분, 대소문자·공백 무시)에
//     로그인 이메일이 있음. "*" 이면 로그인 직원 전원. 없으면 아무도 못 보냅니다.
//     BULK_PRINT_EMAILS 와 같은 방식 — 직원 비번 로그인은 이메일이 없어 "*" 일 때만.
//   출처별 사용 가능 여부(canUse)는 각 출처 파일이 SmsUser 로 판정합니다.
//   발송 이력의 본문 전체는 보낸 본인·관장·부장(M0)만 — canSeeFullBody.
//   * 서버 전용 모듈.
// =====================================================================

import { getSession, getGoogleSession } from "@/app/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isM0Grant } from "@/lib/authLevels";
import { listRolesForDriver } from "@/lib/employeeRolesServer";

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

export type SmsUser = {
  name: string;
  driverId: string | null;
  // 관장·부장·master·auth_level M0.
  isM0: boolean;
  // 직무(employee_roles) — bangka·saem·hr 등.
  roles: string[];
  // 관장 권한(구글 세션 + master 또는 직급 관장) — 기자 명단 기준(isManagerAdmin 과 같음).
  isPressAdmin: boolean;
};

// 이전 이름 호환.
export type SmsAccess = SmsUser;

export async function resolveSmsAccess(): Promise<SmsUser | null> {
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
  const roles = driverId ? await listRolesForDriver(driverId) : [];
  return {
    name: me.name.trim(),
    driverId,
    isM0: isM0Grant({ rank: d?.rank ?? null, email: g?.email, authLevel }),
    roles,
    isPressAdmin: !!g && (g.isMaster || g.rank === "관장"),
  };
}

// 이력 본문 전체를 볼 수 있는가 — 보낸 본인 또는 관장·부장(M0).
export function canSeeFullBody(
  viewer: Pick<SmsUser, "driverId" | "isM0">,
  sentBy: string | null,
): boolean {
  return viewer.isM0 || (!!viewer.driverId && viewer.driverId === sentBy);
}

// 문구·주소록 수정·삭제 — 만든 사람과 M0.
export function canEditOwned(
  viewer: Pick<SmsUser, "driverId" | "isM0">,
  ownerId: string | null,
): boolean {
  return viewer.isM0 || (!!viewer.driverId && viewer.driverId === ownerId);
}

// 다른 직원에게 보이는 본문 — 앞 20자.
export const SMS_BODY_PREVIEW_CHARS = 20;
export function previewBody(text: string): string {
  const chars = [...(text ?? "")];
  return chars.length > SMS_BODY_PREVIEW_CHARS
    ? `${chars.slice(0, SMS_BODY_PREVIEW_CHARS).join("")}…`
    : chars.join("");
}

// 테이블 없음(마이그레이션 미적용) 판정.
export function smsTableMissing(
  error: { code?: string; message?: string } | null,
): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /does not exist|Could not find the table/i.test(error.message ?? "")
  );
}
