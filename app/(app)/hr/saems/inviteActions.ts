"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireSaemView } from "@/lib/saemAccess";
import { normalizePhone, saemAppUrl } from "@/lib/saem";
import { inviteExpiresAt, normalizeInviteDays } from "@/lib/saemInvite";

// =====================================================================
// 초대 링크 (재)발급 — 아직 가입하지 않은 동래샘들 계정 전용 (2026-10 관장 요청)
//
//   · 링크가 만료됐든, 처음부터 없었든 같은 동작입니다(새 토큰 + 새 만료일).
//   · 토큰을 덮어쓰므로 옛 링크는 즉시 무효가 됩니다 — 동래샘들은
//     invite_token 일치로만 찾습니다(dongrae-saems app/invite/[token]).
//   · 권한: 로그인 직원 누구나(관장 지시 "일반 직원도 가능"). 동아리관리
//     (lib/clubAccess)와 같은 범위입니다. 가입자에게는 거부하므로 남의 계정
//     비밀번호를 바꾸는 데 쓸 수 없고, 가입 때 전화번호 뒤 4자리도 대조합니다.
//   · 이미 가입한 계정의 비밀번호 재설정은 별개 기능입니다
//     (instructorActions.generateInvite — 강사 상세·동아리관리 [비밀번호 재설정 링크]).
// =====================================================================
export async function reissueInvite(input: {
  instructorId: string;
  days?: number;
}): Promise<
  | { ok: true; url: string; expiresAt: string; days: number; name: string }
  | { ok: false; message: string }
> {
  try {
    await requireSaemView();
    const id = String(input.instructorId ?? "").trim();
    if (!id) return { ok: false, message: "대상이 없습니다." };

    const { data: row } = await supabaseAdmin
      .from("saem_instructors")
      .select("id, name, phone, password_hash")
      .eq("id", id)
      .maybeSingle();
    if (!row) return { ok: false, message: "계정을 찾을 수 없습니다." };
    if ((row as { password_hash: string | null }).password_hash)
      return {
        ok: false,
        message:
          "이미 가입한 계정입니다. 비밀번호를 잊은 경우는 [비밀번호 재설정 링크]를 쓰세요.",
      };

    // 동래샘들 가입 화면은 전화번호 뒤 4자리로 본인 확인을 합니다.
    //   번호가 없으면 링크를 보내도 가입이 안 되므로 먼저 막습니다.
    if (normalizePhone((row as { phone: string | null }).phone ?? "").length < 4)
      return {
        ok: false,
        message:
          "전화번호가 없어 가입할 수 없습니다(가입 때 전화번호 뒤 4자리로 본인 확인). 전화번호를 먼저 입력한 뒤 발급하세요.",
      };

    const days = normalizeInviteDays(input.days);
    const token = randomUUID().replace(/-/g, "");
    const expiresAt = inviteExpiresAt(days);
    // 조회와 갱신 사이에 가입이 끝났을 수 있어 조건을 한 번 더 겁니다.
    const { data: updated, error } = await supabaseAdmin
      .from("saem_instructors")
      .update({ invite_token: token, invite_expires_at: expiresAt })
      .eq("id", id)
      .is("password_hash", null)
      .select("id");
    if (error) throw new Error(error.message);
    if (!updated || updated.length === 0)
      return { ok: false, message: "방금 가입이 완료된 계정입니다. 새로고침해 주세요." };

    revalidatePath("/hr/saems/instructors");
    revalidatePath(`/hr/saems/instructors/${id}`);
    revalidatePath("/hr/clubs");
    return {
      ok: true,
      url: `${saemAppUrl()}/invite/${token}`,
      expiresAt,
      days,
      name: String((row as { name: string }).name ?? ""),
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "초대 링크를 발급하지 못했습니다.",
    };
  }
}
