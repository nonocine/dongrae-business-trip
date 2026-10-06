"use server";

import { revalidatePath } from "next/cache";
import { requireSaemAccess } from "@/lib/saemAccess";
import {
  inspectSaemAccount,
  purgeSaemAccount,
  type PurgeInspection,
  type PurgeResult,
} from "@/lib/saemAccountPurge";

// =====================================================================
// 동래샘들 계정 완전 삭제 액션 — 강사관리(/hr/saems/instructors/[id]) ·
//   동아리관리(/hr/clubs) 공용. 되돌릴 수 없는 동작이라 사전 점검까지 M0 전용
//   (현행 쓰기 권한 resolveSaemAccess 를 따르되 onlyM0 로 좁힘).
//   판정·삭제 로직은 lib/saemAccountPurge 한 곳에만 있습니다.
// =====================================================================

export async function inspectAccountForPurge(
  id: string
): Promise<{ ok: true; inspection: PurgeInspection } | { ok: false; message: string }> {
  try {
    await requireSaemAccess({ onlyM0: true });
    const inspection = await inspectSaemAccount(id);
    if (!inspection) return { ok: false, message: "계정을 찾을 수 없습니다." };
    return { ok: true, inspection };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "점검 중 오류가 발생했습니다." };
  }
}

export async function purgeAccount(input: {
  id: string;
  confirmName: string;
  acceptProgramUnassign: boolean;
}): Promise<PurgeResult> {
  try {
    const me = await requireSaemAccess({ onlyM0: true });
    const res = await purgeSaemAccount({ ...input, actor: me.name });
    if (res.ok) {
      revalidatePath("/hr/saems/instructors");
      revalidatePath("/hr/clubs");
      revalidatePath("/hr/saems/programs");
    }
    return res;
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "삭제 중 오류가 발생했습니다." };
  }
}
