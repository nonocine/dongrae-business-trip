// =====================================================================
// 공용 메일함 접근 게이트 — /mail  (상조회 열람 패턴과 동일한 구조)
//   * 센터 대표 메일(onnainna@naver.com)은 기관 공용 자산이고 담당 배정이
//     전 직원 대상이므로, 열람·담당지정·상태변경은 로그인한 직원 전원에게 엽니다.
//   * isAdmin 은 구글 관장·master 여부(SEC-3b 이전: 공유비번 세션).
//     열람 자체는 전 직원 공통이라 게이트가 아니라 표시·권한 구분용입니다.
//   * mail_messages 는 RLS 정책 0개 → service_role 경유. 이 게이트가 유일한
//     방어선이므로 조회·변경 액션마다 진입 시 재검증합니다.
//   * 서버 전용 모듈("use server" 아님) — 서버 액션·페이지가 import.
// =====================================================================

import { getSession, isManagerAdmin } from "@/app/actions";

export type MailAccess = {
  name: string;
  isAdmin: boolean;
};

export async function resolveMailAccess(): Promise<MailAccess | null> {
  const me = await getSession();
  if (!me) return null;
  if (!me.name.trim()) return null;
  return { name: me.name.trim(), isAdmin: await isManagerAdmin() };
}

export async function requireMailAccess(): Promise<MailAccess> {
  const ctx = await resolveMailAccess();
  if (!ctx) throw new Error("로그인이 필요합니다.");
  return ctx;
}
