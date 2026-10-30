// =====================================================================
// 프로그램 관리 "선택 출력"(일괄 출력) 시험 개방 게이트 — 2026-10
//   기존 출력 권한(requireSaemAccess = M0 또는 saem 직무) 위에 한 겹 더 얹는다.
//   * 직급(drivers.rank)이 '관장'이면 항상 허용.
//   * 로그인(구글) 이메일이 BULK_PRINT_EMAILS(쉼표 구분, 대소문자·앞뒤 공백 무시)에
//     있으면 허용. 직원 비번 로그인은 이메일이 없어 직급으로만 판정된다.
//   * BULK_PRINT_EMAILS="*" → 정식 개방(기존 권한 그대로 모두 허용).
//   * 환경변수가 없으면 관장만.
//   화면(programs/page.tsx → ProgramsManager)과 서버(print-data·pdf-font)가 같은 함수를 쓴다.
//   * 서버 전용 모듈 — 페이지·라우트가 import.
// =====================================================================

import { getSession, getGoogleSession } from "@/app/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export function bulkPrintAllowed(
  who: { rank: string | null; email: string | null | undefined },
  envValue: string | undefined = process.env.BULK_PRINT_EMAILS
): boolean {
  const list = (envValue ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (list.includes("*")) return true;
  if (who.rank === "관장") return true;
  const email = who.email?.trim().toLowerCase();
  return !!email && list.includes(email);
}

export async function canBulkPrint(): Promise<boolean> {
  const me = await getSession();
  if (!me || me.kind !== "employee" || !me.name.trim()) return false;
  const g = await getGoogleSession();
  const { data: driver } = await supabaseAdmin
    .from("drivers")
    .select("rank")
    .eq("name", me.name.trim())
    .maybeSingle();
  const rank = (driver as { rank?: string | null } | null)?.rank ?? null;
  return bulkPrintAllowed({ rank, email: g?.email });
}
