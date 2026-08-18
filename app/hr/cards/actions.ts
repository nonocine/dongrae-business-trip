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
import { loadCardForWrite, loadPartnerForWrite } from "@/lib/directoryGuards";
import { normalizePartnerCategory } from "@/lib/businessPartners";
import { scanCardImage, isCardOcrConfigured } from "@/lib/businessCardOcr";
import {
  toBusinessCard,
  OCR_FIELD_KEYS,
  CARD_IMAGE_EXT,
  CARD_MAX_BYTES,
  EMPTY_FIELDS,
  type BusinessCard,
  type CardWithLink,
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

// AI 판독 사용 가능 여부(키 미설정이면 화면에서 안내 후 수기 입력).
export async function isCardScanAvailable(): Promise<boolean> {
  await requireCardAccess();
  return isCardOcrConfigured();
}

// =====================================================================
// 목록 / 상세
// =====================================================================
export async function listBusinessCards(): Promise<CardWithLink[]> {
  const ctx = await requireCardAccess();
  // 비공개 명함은 관리자가 아니면 쿼리 단계에서 제외합니다.
  let q = supabaseAdmin
    .from("business_cards")
    .select("*")
    .order("created_at", { ascending: false });
  if (!ctx.isManager) q = q.eq("is_private", false);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const cards = (data ?? []).map((r) =>
    toBusinessCard(r as Record<string, unknown>),
  );
  return withPartnerNames(cards, ctx.isManager);
}

// 연결된 거래처 이름을 붙입니다.
//   ⚠️ 이름 조회에도 공개/비공개 규칙을 그대로 적용합니다. 공개 명함이 나중에
//   비공개로 바뀐 거래처에 편입돼 있을 수 있는데, 그때 이름을 그대로 실어 보내면
//   비공개 거래처의 상호가 일반 직원에게 새어 나갑니다 → 이름만 null 로 둡니다.
async function withPartnerNames(
  cards: BusinessCard[],
  isManager: boolean,
): Promise<CardWithLink[]> {
  const ids = [...new Set(cards.map((c) => c.partner_id).filter(Boolean))];
  if (ids.length === 0) {
    return cards.map((c) => ({ ...c, partner_name: null }));
  }

  let q = supabaseAdmin
    .from("business_partners")
    .select("id, name, is_private")
    .in("id", ids as string[]);
  if (!isManager) q = q.eq("is_private", false);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const nameById = new Map<string, string>();
  for (const raw of data ?? []) {
    const row = raw as { id?: unknown; name?: unknown };
    nameById.set(String(row.id ?? ""), String(row.name ?? ""));
  }
  return cards.map((c) => ({
    ...c,
    partner_name: c.partner_id ? (nameById.get(c.partner_id) ?? null) : null,
  }));
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
// 2단계 — 명함을 거래처로 편입
//   * 연결 = business_cards.partner_id 세팅 + partner_contacts 행 생성(card_id).
//   * ⚠️ 이것은 명함 정보를 거래처로 **복사(연결 시점 스냅샷)** 하는 동작입니다.
//     이후 거래처·담당자를 고쳐도 명함 원본(business_cards)은 그대로이고,
//     명함을 고쳐도 거래처에 자동 반영되지 않습니다. 명함첩은 "받은 그대로"의
//     원본 보관소로 남습니다.
//   * Supabase REST 에는 다중 문장 트랜잭션이 없어, 실패 시 앞 단계를 되돌리는
//     보상 삭제로 일관성을 맞춥니다. 명함의 partner_id 는 담당자 생성이 성공한
//     **뒤에** 세팅해, 중간에 끊겨도 "연결됐다는데 담당자가 없는" 상태를 피합니다.
//   * 권한: 로그인 직원이면 가능하되 비공개 명함·비공개 거래처는 관리자만
//     (loadCardForWrite·loadPartnerForWrite 가 "찾을 수 없음"으로 응답).
//   * 거래처가 나중에 삭제되면 business_cards.partner_id 는 FK 의 on delete set
//     null 로 자동으로 풀립니다(명함은 그대로 남고 다시 연결 가능). 담당자는
//     거래처와 함께 cascade 삭제됩니다.
// =====================================================================

// 명함에서 담당자 정보만 뽑아 partner_contacts 행 모양으로 만듭니다.
function contactRowFromCard(
  card: BusinessCard,
  partnerId: string,
  isPrimary: boolean,
  registeredBy: string,
): Record<string, unknown> {
  return {
    partner_id: partnerId,
    person_name: card.person_name,
    title: card.title,
    department: card.department,
    mobile: card.mobile,
    phone: card.phone,
    email: card.email,
    memo: "",
    card_id: card.id, // 어느 명함에서 왔는지 — 역방향 "명함 보기"에 씁니다.
    is_primary: isPrimary,
    registered_by: registeredBy,
  };
}

// 편입 대상 명함을 읽고 연결 가능한 상태인지 확인합니다.
async function loadCardForLink(
  cardId: string,
  isManager: boolean,
): Promise<{ ok: true; card: BusinessCard } | { ok: false; message: string }> {
  const guard = await loadCardForWrite(cardId, isManager);
  if (!guard.ok) return guard;
  if (guard.partnerId) {
    return { ok: false, message: "이미 거래처로 등록된 명함입니다." };
  }
  const { data, error } = await supabaseAdmin
    .from("business_cards")
    .select("*")
    .eq("id", cardId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { ok: false, message: "명함을 찾을 수 없습니다." };
  return { ok: true, card: toBusinessCard(data as Record<string, unknown>) };
}

// 담당자 생성 후 명함에 partner_id 를 세팅합니다. 실패하면 담당자를 되돌립니다.
async function attachContactAndLink(
  card: BusinessCard,
  partnerId: string,
  isPrimary: boolean,
  registeredBy: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data: contact, error: cErr } = await supabaseAdmin
    .from("partner_contacts")
    .insert(contactRowFromCard(card, partnerId, isPrimary, registeredBy))
    .select("id")
    .single();
  if (cErr) return { ok: false, message: cErr.message };
  const contactId = String((contact as { id: string }).id);

  const { error: uErr } = await supabaseAdmin
    .from("business_cards")
    .update({ partner_id: partnerId, updated_at: new Date().toISOString() })
    .eq("id", card.id);
  if (uErr) {
    // 보상: 방금 만든 담당자를 거둬들여 "명함은 미연결인데 담당자만 남는" 상태를 막습니다.
    await supabaseAdmin.from("partner_contacts").delete().eq("id", contactId);
    return { ok: false, message: uErr.message };
  }
  return { ok: true };
}

// A) 명함 → 새 거래처 + 첫 담당자.
export type LinkToNewPartnerInput = {
  cardId: string;
  name?: string | null;
  category?: string | null;
  phone?: string | null;
  fax?: string | null;
  address?: string | null;
  website?: string | null;
  memo?: string | null;
};

export async function linkCardToNewPartner(
  input: LinkToNewPartnerInput,
): Promise<{ ok: true; partnerId: string } | { ok: false; message: string }> {
  try {
    const ctx = await requireCardAccess();

    const cardId = String(input.cardId ?? "").trim();
    const loaded = await loadCardForLink(cardId, ctx.isManager);
    if (!loaded.ok) return loaded;
    const card = loaded.card;

    const name = String(input.name ?? "").trim().slice(0, 200);
    if (!name) return { ok: false, message: "거래처명을 입력해주세요." };

    // 1) 거래처 생성. 새 거래처는 항상 공개로 시작합니다(비공개 전환은 별도 액션).
    const { data: partner, error: pErr } = await supabaseAdmin
      .from("business_partners")
      .insert({
        name,
        category: normalizePartnerCategory(input.category),
        phone: String(input.phone ?? "").trim().slice(0, 100),
        fax: String(input.fax ?? "").trim().slice(0, 100),
        address: String(input.address ?? "").trim().slice(0, 500),
        website: String(input.website ?? "").trim().slice(0, 300),
        memo: String(input.memo ?? "").trim().slice(0, 4000),
        is_active: true,
        registered_by: ctx.name,
      })
      .select("id")
      .single();
    if (pErr) throw new Error(pErr.message);
    const partnerId = String((partner as { id: string }).id);

    // 2) 첫 담당자 + 3) 명함 연결. 실패하면 거래처까지 되돌립니다.
    const attached = await attachContactAndLink(card, partnerId, true, ctx.name);
    if (!attached.ok) {
      await supabaseAdmin
        .from("business_partners")
        .delete()
        .eq("id", partnerId);
      return { ok: false, message: attached.message };
    }

    revalidatePath("/hr/cards");
    revalidatePath("/hr/partners");
    return { ok: true, partnerId };
  } catch (e) {
    return actionError(e, "거래처로 등록하지 못했습니다.");
  }
}

// B) 명함 → 기존 거래처의 담당자로 추가.
export async function linkCardToExistingPartner(
  cardId: string,
  partnerId: string,
): Promise<{ ok: true; partnerId: string } | { ok: false; message: string }> {
  try {
    const ctx = await requireCardAccess();

    const loaded = await loadCardForLink(
      String(cardId ?? "").trim(),
      ctx.isManager,
    );
    if (!loaded.ok) return loaded;
    const card = loaded.card;

    // 비공개 거래처에는 관리자만 붙일 수 있습니다.
    const target = String(partnerId ?? "").trim();
    const pGuard = await loadPartnerForWrite(target, ctx.isManager);
    if (!pGuard.ok) return pGuard;

    // 담당자가 아직 없는 거래처면 이 명함이 대표담당자가 됩니다.
    const { count, error: cntErr } = await supabaseAdmin
      .from("partner_contacts")
      .select("id", { count: "exact", head: true })
      .eq("partner_id", target);
    if (cntErr) throw new Error(cntErr.message);

    const attached = await attachContactAndLink(
      card,
      target,
      (count ?? 0) === 0,
      ctx.name,
    );
    if (!attached.ok) return { ok: false, message: attached.message };

    revalidatePath("/hr/cards");
    revalidatePath("/hr/partners");
    return { ok: true, partnerId: target };
  } catch (e) {
    return actionError(e, "거래처에 담당자로 추가하지 못했습니다.");
  }
}

// 연결 UI(B)용 거래처 후보 — 비공개 거래처는 관리자에게만 나갑니다.
export type PartnerOption = {
  id: string;
  name: string;
  category: string;
  is_active: boolean;
  is_private: boolean;
  contact_count: number;
};

export async function listPartnerOptions(): Promise<PartnerOption[]> {
  const ctx = await requireCardAccess();

  let q = supabaseAdmin
    .from("business_partners")
    .select("id, name, category, is_active, is_private")
    .order("name", { ascending: true });
  if (!ctx.isManager) q = q.eq("is_private", false);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map((raw) => {
    const r = raw as Record<string, unknown>;
    return {
      id: String(r.id ?? ""),
      name: String(r.name ?? ""),
      category: normalizePartnerCategory(r.category),
      is_active: r.is_active !== false,
      is_private: r.is_private === true,
      contact_count: 0,
    };
  });
  if (rows.length === 0) return [];

  // 담당자 수 — "이미 몇 명 있는 거래처인지" 보고 고르게 합니다(중복 생성 예방).
  const { data: contacts, error: cErr } = await supabaseAdmin
    .from("partner_contacts")
    .select("partner_id")
    .in(
      "partner_id",
      rows.map((r) => r.id),
    );
  if (cErr) throw new Error(cErr.message);
  for (const raw of contacts ?? []) {
    const pid = String((raw as { partner_id?: unknown }).partner_id ?? "");
    const row = rows.find((r) => r.id === pid);
    if (row) row.contact_count += 1;
  }
  return rows;
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
