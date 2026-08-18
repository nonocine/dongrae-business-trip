// =====================================================================
// 주소록(명함첩·거래처) 대상 행 가드 — 공개/비공개 규칙의 단일 출처.
//   * 정책은 lib/directoryAccess 참고: 기본 공개, is_private=true 만 관리자 전용.
//   * 여기 두 함수는 "이 사용자가 이 행을 다룰 수 있는가"를 판정합니다.
//     비공개인데 관리자가 아니면 **"찾을 수 없음"** 으로 응답합니다 —
//     "권한 없음" 이라고 하면 그 자체로 비공개 항목의 존재를 알려주기 때문입니다.
//   * 명함↔거래처 연결(2단계)처럼 두 테이블을 함께 건드리는 액션이 생기면서
//     각 actions.ts 에 있던 같은 코드를 이 모듈로 모았습니다.
//   * 서버 전용 모듈("use server" 아님) — 서버 액션이 import 합니다.
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type GuardFail = { ok: false; message: string };

export type CardGuard =
  | {
      ok: true;
      imagePath: string | null;
      // 이미 편입된 거래처. null 이면 아직 미편입입니다.
      partnerId: string | null;
    }
  | GuardFail;

export type PartnerGuard = { ok: true; isPrivate: boolean } | GuardFail;

// 대상 명함을 이 사용자가 다룰 수 있는지.
export async function loadCardForWrite(
  id: string,
  isManager: boolean,
): Promise<CardGuard> {
  if (!id) return { ok: false, message: "명함을 찾을 수 없습니다." };
  const { data } = await supabaseAdmin
    .from("business_cards")
    .select("id, image_path, is_private, partner_id")
    .eq("id", id)
    .maybeSingle();
  if (!data) return { ok: false, message: "명함을 찾을 수 없습니다." };
  const row = data as {
    image_path?: unknown;
    is_private?: unknown;
    partner_id?: unknown;
  };
  if (row.is_private === true && !isManager) {
    return { ok: false, message: "명함을 찾을 수 없습니다." };
  }
  return {
    ok: true,
    imagePath: (row.image_path as string | null) ?? null,
    partnerId: (row.partner_id as string | null) ?? null,
  };
}

// 대상 거래처를 이 사용자가 다룰 수 있는지.
export async function loadPartnerForWrite(
  id: string,
  isManager: boolean,
): Promise<PartnerGuard> {
  if (!id) return { ok: false, message: "거래처를 찾을 수 없습니다." };
  const { data } = await supabaseAdmin
    .from("business_partners")
    .select("id, is_private")
    .eq("id", id)
    .maybeSingle();
  if (!data) return { ok: false, message: "거래처를 찾을 수 없습니다." };
  const isPrivate = (data as { is_private?: unknown }).is_private === true;
  if (isPrivate && !isManager) {
    return { ok: false, message: "거래처를 찾을 수 없습니다." };
  }
  return { ok: true, isPrivate };
}
