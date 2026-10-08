"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  removeHrDocuments,
  STAMP_IMAGE_MIME,
  uploadStampImage,
} from "@/lib/supabase";
import { downloadHrImage } from "@/lib/recruitmentApplicantDocData";
import { bytesToDataUrl } from "@/lib/contractServer";
import {
  ORG_SEAL_SETTING_KEY,
  orgSealPath,
  orgSealUploadPath,
  requireSealAccess,
} from "@/lib/orgSeal";

// =====================================================================
// 기관 직인 등록·교체 — /hr/seal (M0 전용, 액션마다 재검증)
//   * 개인 도장 이미지 업로드(profile/hr/actions uploadMyStampImage)와 같은 방식:
//     png/jpg · 8MB 이하 · 고정 경로 upsert · 확장자가 바뀌면 옛 파일 정리.
//   * 경로는 settings.organization_seal_path 에 둡니다.
//   * 미리보기는 data URL 로만 내려보냅니다(서명 URL·공개 URL 없음).
//   * 삭제는 두지 않습니다 — 지우면 증명서가 직인 없이 나갑니다. 교체만.
// =====================================================================

export async function getOrgSealPreview(): Promise<string | null> {
  await requireSealAccess();
  return bytesToDataUrl(await downloadHrImage(await orgSealPath()));
}

export async function uploadOrgSeal(
  formData: FormData
): Promise<{ ok: true; sealUrl: string | null } | { ok: false; message: string }> {
  try {
    await requireSealAccess();

    const file = formData.get("seal_file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, message: "업로드할 직인 이미지를 선택해주세요." };
    }
    if (file.size > 8 * 1024 * 1024) {
      return { ok: false, message: "직인 이미지 용량은 8MB 이하여야 합니다." };
    }
    const ext = STAMP_IMAGE_MIME[file.type];
    if (!ext) {
      return {
        ok: false,
        message: "직인 이미지는 PNG·JPG 만 가능합니다. (배경이 투명한 PNG 권장)",
      };
    }

    const oldPath = await orgSealPath();
    const path = orgSealUploadPath(ext);
    const bytes = new Uint8Array(await file.arrayBuffer());
    await uploadStampImage(path, bytes, file.type);

    const { error } = await supabaseAdmin
      .from("settings")
      .upsert({ key: ORG_SEAL_SETTING_KEY, value: path }, { onConflict: "key" });
    if (error) throw new Error(error.message);

    if (oldPath !== path) await removeHrDocuments([oldPath]);

    revalidatePath("/hr/seal");
    return { ok: true, sealUrl: bytesToDataUrl(bytes) };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "직인 업로드 중 오류가 발생했습니다.",
    };
  }
}
