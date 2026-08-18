"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  supabase,
  signHrDocument,
  removeHrDocuments,
  HR_DOCUMENTS_BUCKET,
} from "@/lib/supabase";
import {
  resolveCardAccess,
  requireCardAccess,
  requireCardManager,
} from "@/lib/businessCardAccess";
import { scanCardImage, isCardOcrConfigured } from "@/lib/businessCardOcr";
import {
  toBusinessCard,
  OCR_FIELD_KEYS,
  CARD_IMAGE_EXT,
  CARD_MAX_BYTES,
  EMPTY_FIELDS,
  type BusinessCard,
  type CardFields,
} from "@/lib/businessCards";

// =====================================================================
// 명함첩 서버 액션 — /hr/cards
//   * 접근(관장 결정): 기본 공개 + 예외 비공개. lib/businessCardAccess.
//     - 열람·등록·수정: 로그인한 정식 직원이면 누구나(협업 자산).
//     - is_private=true 인 명함: 관리자(M0·hr)만 열람·수정·삭제(원본 이미지 포함).
//     - 공개↔비공개 전환: 관리자만(requireCardManager).
//   * ⚠️ 비공개 명함은 **서버에서** 걸러 클라이언트로 보내지 않습니다. 목록 필터·
//     상세 직접접근·서명 URL 발급 모두 is_private 를 확인합니다.
//   * business_cards 는 RLS on(정책 0개) → service_role 경유만 가능.
//   * 명함 이미지는 비공개 버킷(hr-documents)의 business-cards/ 아래에 두고
//     열람은 1시간 서명 URL 로만 내줍니다.
//   * ⚠️ 개인정보: 명함 값(이름·연락처)을 console 로 출력하지 않습니다.
// =====================================================================

type ActionResult = { ok: true } | { ok: false; message: string };

function actionError(e: unknown, fallback: string): { ok: false; message: string } {
  return { ok: false, message: e instanceof Error ? e.message : fallback };
}

// 페이지용 — 접근 가능 여부만(로그인 직원이면 true).
export async function canAccessCards(): Promise<boolean> {
  return (await resolveCardAccess()) !== null;
}

// 비공개 명함을 다룰 수 있는지(M0·hr) — 화면이 배지·토글 노출을 정할 때 씁니다.
//   ⚠️ 표시용일 뿐이며, 실제 차단은 각 액션의 서버 재검증이 담당합니다.
export async function isCardManager(): Promise<boolean> {
  const ctx = await resolveCardAccess();
  return ctx?.isManager === true;
}

// 대상 명함을 이 사용자가 다룰 수 있는지 확인합니다.
//   비공개인데 관리자가 아니면 "찾을 수 없음"으로 취급해 존재 자체를 감춥니다.
async function loadCardForWrite(
  id: string,
  isManager: boolean,
): Promise<
  { ok: true; imagePath: string | null } | { ok: false; message: string }
> {
  const { data } = await supabaseAdmin
    .from("business_cards")
    .select("id, image_path, is_private")
    .eq("id", id)
    .maybeSingle();
  if (!data) return { ok: false, message: "명함을 찾을 수 없습니다." };
  const row = data as { image_path?: unknown; is_private?: unknown };
  if (row.is_private === true && !isManager) {
    return { ok: false, message: "명함을 찾을 수 없습니다." };
  }
  return { ok: true, imagePath: (row.image_path as string | null) ?? null };
}

// AI 판독 사용 가능 여부(키 미설정이면 화면에서 안내 후 수기 입력).
export async function isCardScanAvailable(): Promise<boolean> {
  await requireCardAccess();
  return isCardOcrConfigured();
}

// =====================================================================
// 목록 / 상세
// =====================================================================
export async function listBusinessCards(): Promise<BusinessCard[]> {
  const ctx = await requireCardAccess();
  // 비공개 명함은 관리자가 아니면 쿼리 단계에서 제외합니다.
  let q = supabaseAdmin
    .from("business_cards")
    .select("*")
    .order("created_at", { ascending: false });
  if (!ctx.isManager) q = q.eq("is_private", false);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => toBusinessCard(r as Record<string, unknown>));
}

export async function getBusinessCard(
  id: string,
): Promise<BusinessCard | null> {
  const ctx = await requireCardAccess();
  if (!id) return null;
  const { data, error } = await supabaseAdmin
    .from("business_cards")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  // id 를 직접 찍어 들어오는 경로 차단 — 비공개면 없는 것으로 취급합니다.
  if ((data as { is_private?: unknown }).is_private === true && !ctx.isManager) {
    return null;
  }
  return toBusinessCard(data as Record<string, unknown>);
}

// 원본 이미지 1시간 임시 열람 URL — 저장된 경로가 없으면 null.
//   ⚠️ 비공개 명함의 이미지는 일반 직원에게 서명 URL 자체를 내주지 않습니다.
export async function getCardImageUrl(id: string): Promise<string | null> {
  const ctx = await requireCardAccess();
  if (!id) return null;
  const guard = await loadCardForWrite(id, ctx.isManager);
  if (!guard.ok) return null;
  return signHrDocument(guard.imagePath);
}

// =====================================================================
// AI 판독 — data:image/...;base64,.... 을 받아 항목을 추출합니다.
//   * 저장은 하지 않습니다(폼을 채워줄 뿐). 사용자가 확인·수정 후 저장합니다.
//   * 실패해도 throw 하지 않습니다 — 수기 입력으로 계속 진행할 수 있어야 합니다.
// =====================================================================
type DecodedImage = { base64: string; mediaType: string; ext: string };

function decodeDataUrl(dataUrl: string): DecodedImage | null {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl ?? "");
  if (!match) return null;
  const mediaType = match[1].toLowerCase();
  const ext = CARD_IMAGE_EXT[mediaType];
  if (!ext) return null;
  const base64 = match[2];
  // base64 4문자 = 3바이트.
  const bytes = Math.floor((base64.length * 3) / 4);
  if (bytes > CARD_MAX_BYTES) return null;
  return { base64, mediaType, ext };
}

export async function scanBusinessCard(
  imageDataUrl: string,
): Promise<
  { ok: true; fields: CardFields; raw: unknown } | { ok: false; message: string }
> {
  try {
    await requireCardAccess();
    const decoded = decodeDataUrl(imageDataUrl);
    if (!decoded) {
      return {
        ok: false,
        message: "이미지 형식이 올바르지 않거나 용량이 너무 큽니다.",
      };
    }
    const result = await scanCardImage({
      base64: decoded.base64,
      mediaType: decoded.mediaType,
    });
    if (!result) {
      return {
        ok: false,
        message:
          "명함을 읽지 못했습니다. 아래 칸에 직접 입력해 저장할 수 있습니다.",
      };
    }
    return { ok: true, fields: result.fields, raw: result.raw };
  } catch (e) {
    return actionError(e, "명함을 읽지 못했습니다.");
  }
}

// =====================================================================
// 저장 (등록 / 수정)
// =====================================================================
export type SaveCardInput = Partial<CardFields> & {
  id?: string | null;
  memo?: string | null;
  // 새로 찍은/고른 이미지가 있을 때만. 없으면 기존 이미지를 유지합니다.
  imageDataUrl?: string | null;
  // scanBusinessCard 결과를 그대로 넘기면 ocr_raw 에 감사 기록으로 남깁니다.
  ocrRaw?: unknown;
  // 관리자만 반영됩니다. 일반 직원이 보내와도 무시합니다.
  isPrivate?: boolean;
};

// 이미지 업로드 — business-cards/{uuid}.{ext}. 실패 시 throw.
async function uploadCardImage(decoded: DecodedImage): Promise<string> {
  const path = `business-cards/${randomUUID()}.${decoded.ext}`;
  const bytes = Buffer.from(decoded.base64, "base64");
  const { error } = await supabase.storage
    .from(HR_DOCUMENTS_BUCKET)
    .upload(path, bytes, { contentType: decoded.mediaType, upsert: false });
  if (error) throw new Error(`이미지 업로드 실패: ${error.message}`);
  return path;
}

export async function saveBusinessCard(
  input: SaveCardInput,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  try {
    const ctx = await requireCardAccess();

    const fields = { ...EMPTY_FIELDS };
    for (const key of OCR_FIELD_KEYS) {
      fields[key] = String(input[key] ?? "").trim().slice(0, 300);
    }
    const memo = String(input.memo ?? "").trim().slice(0, 2000);
    // 최소 조건 — 업체명이나 이름 중 하나는 있어야 목록에서 찾을 수 있습니다.
    if (!fields.company && !fields.person_name) {
      return { ok: false, message: "업체명 또는 이름을 입력해주세요." };
    }

    const id = String(input.id ?? "").trim();

    // 수정 대상 확인은 이미지 업로드보다 **먼저** — 비공개 명함을 일반 직원이
    // 수정하려 할 때 파일만 올라가고 거부되는 고아 업로드를 막습니다.
    let oldPath: string | null = null;
    if (id) {
      const guard = await loadCardForWrite(id, ctx.isManager);
      if (!guard.ok) return guard;
      oldPath = guard.imagePath;
    }

    // 새 이미지가 있으면 먼저 올립니다(업로드 실패 시 DB 를 건드리지 않음).
    let newPath: string | null = null;
    if (input.imageDataUrl) {
      const decoded = decodeDataUrl(input.imageDataUrl);
      if (!decoded) {
        return {
          ok: false,
          message: "이미지 형식이 올바르지 않거나 용량이 너무 큽니다.",
        };
      }
      newPath = await uploadCardImage(decoded);
    }

    const row: Record<string, unknown> = {
      ...fields,
      memo,
      updated_at: new Date().toISOString(),
    };
    if (newPath) row.image_path = newPath;
    if (input.ocrRaw !== undefined && input.ocrRaw !== null) {
      row.ocr_raw = input.ocrRaw;
    }
    // 비공개 지정은 관리자만. 일반 직원이 폼을 우회해 보내도 여기서 떨굽니다.
    //   (관리자가 아니면 아예 컬럼을 건드리지 않아 기존 값이 유지됩니다.)
    if (ctx.isManager && input.isPrivate !== undefined) {
      row.is_private = input.isPrivate === true;
    }

    if (id) {
      // 수정 — 이미지를 새로 올렸으면 기존 파일은 회수합니다(oldPath 는 위에서 확보).
      const { error } = await supabaseAdmin
        .from("business_cards")
        .update(row)
        .eq("id", id);
      if (error) throw new Error(error.message);
      if (newPath && oldPath && oldPath !== newPath) {
        await removeHrDocuments([oldPath]);
      }
      revalidatePath("/hr/cards");
      return { ok: true, id };
    }

    const { data, error } = await supabaseAdmin
      .from("business_cards")
      .insert({ ...row, registered_by: ctx.name })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    revalidatePath("/hr/cards");
    return { ok: true, id: String((data as { id: string }).id) };
  } catch (e) {
    return actionError(e, "명함을 저장하지 못했습니다.");
  }
}

// =====================================================================
// 삭제 — 원본 이미지(Storage)도 함께 회수합니다.
// =====================================================================
export async function deleteBusinessCard(id: string): Promise<ActionResult> {
  try {
    const ctx = await requireCardAccess();
    if (!id) return { ok: false, message: "대상이 없습니다." };

    // 비공개 명함은 관리자만 삭제할 수 있습니다.
    const guard = await loadCardForWrite(id, ctx.isManager);
    if (!guard.ok) return guard;
    const oldPath = guard.imagePath;

    const { error } = await supabaseAdmin
      .from("business_cards")
      .delete()
      .eq("id", id);
    if (error) throw new Error(error.message);
    if (oldPath) await removeHrDocuments([oldPath]);

    revalidatePath("/hr/cards");
    return { ok: true };
  } catch (e) {
    return actionError(e, "명함을 삭제하지 못했습니다.");
  }
}

// =====================================================================
// 공개 ↔ 비공개 전환 — 관리자(M0·hr) 전용.
//   requireCardManager 가 UI 를 우회한 직접 호출까지 막습니다.
// =====================================================================
export async function setCardPrivate(
  id: string,
  isPrivate: boolean,
): Promise<ActionResult> {
  try {
    await requireCardManager();
    if (!id) return { ok: false, message: "대상이 없습니다." };

    const { data: prev } = await supabaseAdmin
      .from("business_cards")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (!prev) return { ok: false, message: "명함을 찾을 수 없습니다." };

    const { error } = await supabaseAdmin
      .from("business_cards")
      .update({ is_private: isPrivate, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/hr/cards");
    return { ok: true };
  } catch (e) {
    return actionError(e, "공개 설정을 바꾸지 못했습니다.");
  }
}
