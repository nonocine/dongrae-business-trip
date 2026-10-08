// =====================================================================
// 기관 직인("동래구청소년센터장인") — 등록 위치·로드·접근 게이트 (2026-10 관장 지시)
//   * 기관 명의(동래구청소년센터장)로 나가는 출력물에는 관장 개인 도장이 아니라
//     이 직인을 찍습니다: 재직·경력증명서, 강의확인증(센터장 줄), 근로·연봉계약서
//     (센터장 서명 기본값).
//   * 저장: hr-documents 비공개 버킷 + settings 키 organization_seal_path 에 경로.
//     개인 도장(employee_profiles.stamp_path)과 같은 방식 — uploadStampImage 로
//     고정 경로에 upsert, png/jpg 만(STAMP_IMAGE_MIME).
//     공개 URL 은 만들지 않습니다. 화면 미리보기도 서명 URL 대신 data URL 로
//     내려보냅니다(관장·부장 화면에서만).
//   * settings 키가 없으면 기존 고정 경로(org/center_seal.png)를 씁니다 — 증명서가
//     2026-07 부터 이 경로의 직인을 써 왔습니다.
//   * 등록·교체: M0(관장·부장·master) 전용 — /hr/seal.
//   * 서버 전용(supabaseAdmin 사용).
// =====================================================================

import { getSession, getGoogleSession } from "@/app/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isM0Grant } from "@/lib/authLevels";
import { readMark } from "@/lib/settingsMark";
import { downloadHrImage } from "@/lib/recruitmentApplicantDocData";

export const ORG_SEAL_SETTING_KEY = "organization_seal_path";
// settings 키가 없을 때 쓰는 기존 경로(증명서 최초 도입 때 올린 직인).
export const ORG_SEAL_DEFAULT_PATH = "org/center_seal.png";
// 새로 올릴 때의 경로(확장자만 바뀜) — 개인 도장 stamps/employee/{id}.{ext} 와 같은 규칙.
export function orgSealUploadPath(ext: "png" | "jpg"): string {
  return `org/center_seal.${ext}`;
}

export async function orgSealPath(): Promise<string> {
  const v = (await readMark(ORG_SEAL_SETTING_KEY))?.trim();
  return v || ORG_SEAL_DEFAULT_PATH;
}

// 직인 바이트. 없거나 못 읽으면 null(호출 측이 '미등록'으로 처리).
export async function loadOrgSeal(): Promise<Uint8Array | null> {
  try {
    return await downloadHrImage(await orgSealPath());
  } catch {
    return null;
  }
}

// --- 접근 게이트(M0 전용) — lib/backupAccess 와 같은 구조 ---------------
export type SealAccess = { name: string; driverId: string | null };

export async function resolveSealAccess(): Promise<SealAccess | null> {
  const me = await getSession();
  if (!me || me.kind !== "employee" || !me.name.trim()) return null;
  const g = await getGoogleSession();

  const { data: driver } = await supabaseAdmin
    .from("drivers")
    .select("id, rank")
    .eq("name", me.name.trim())
    .maybeSingle();
  const driverId =
    driver && typeof (driver as { id?: unknown }).id === "string"
      ? String((driver as { id: string }).id)
      : null;
  const rank = (driver as { rank?: string | null } | null)?.rank ?? null;

  let authLevel: string | null = null;
  if (driverId) {
    const { data: prof } = await supabaseAdmin
      .from("employee_profiles")
      .select("auth_level")
      .eq("driver_id", driverId)
      .maybeSingle();
    authLevel =
      (prof as { auth_level?: string | null } | null)?.auth_level ?? null;
  }

  if (!isM0Grant({ rank, email: g?.email, authLevel })) return null;
  return { name: me.name.trim(), driverId };
}

export async function requireSealAccess(): Promise<SealAccess> {
  const ctx = await resolveSealAccess();
  if (!ctx) throw new Error("기관 직인 관리 권한이 없습니다. (관장·부장 전용)");
  return ctx;
}
