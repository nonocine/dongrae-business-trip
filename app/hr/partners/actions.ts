"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  resolvePartnerAccess,
  requirePartnerAccess,
} from "@/lib/partnerAccess";
import {
  toBusinessPartner,
  toPartnerContact,
  normalizePartnerCategory,
  sortContacts,
  type PartnerContact,
  type PartnerWithContacts,
} from "@/lib/businessPartners";

// =====================================================================
// 거래처 관리 서버 액션 — /hr/partners
//   * 접근: M0(관장·부장·master) 또는 hr(인사) 직무. lib/partnerAccess.
//   * business_partners·partner_contacts 는 RLS on(정책 0개) → service_role
//     경유만 가능. 모든 액션이 진입 시 권한을 재검증합니다.
//   * 담당자는 partner_id FK on delete cascade — 거래처를 지우면 함께 지워집니다.
//     거래 종료는 삭제 대신 is_active=false(소프트 비활성)를 권장합니다.
//   * 명함첩 연결(card_id, business_cards.partner_id)은 2단계 — 여기서는
//     card_id 를 읽기만 하고 세팅하지 않습니다.
//   * ⚠️ 개인정보: 거래처·담당자 값(이름·연락처)을 console 로 출력하지 않습니다.
// =====================================================================

type ActionResult = { ok: true } | { ok: false; message: string };

function actionError(
  e: unknown,
  fallback: string,
): { ok: false; message: string } {
  return { ok: false, message: e instanceof Error ? e.message : fallback };
}

const trim = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

// 페이지용 — 접근 가능 여부만.
export async function canAccessPartners(): Promise<boolean> {
  return (await resolvePartnerAccess()) !== null;
}

// =====================================================================
// 목록 / 상세
//   거래처와 담당자를 각각 한 번씩 읽어 메모리에서 묶습니다(건수가 작고,
//   목록에서 담당자 수·담당자명 검색이 모두 필요하므로 N+1 을 피합니다).
// =====================================================================
export async function listPartners(): Promise<PartnerWithContacts[]> {
  await requirePartnerAccess();

  const [partnersRes, contactsRes] = await Promise.all([
    supabaseAdmin
      .from("business_partners")
      .select("*")
      .order("name", { ascending: true }),
    supabaseAdmin.from("partner_contacts").select("*"),
  ]);
  if (partnersRes.error) throw new Error(partnersRes.error.message);
  if (contactsRes.error) throw new Error(contactsRes.error.message);

  const byPartner = new Map<string, PartnerContact[]>();
  for (const raw of contactsRes.data ?? []) {
    const c = toPartnerContact(raw as Record<string, unknown>);
    const list = byPartner.get(c.partner_id);
    if (list) list.push(c);
    else byPartner.set(c.partner_id, [c]);
  }

  return (partnersRes.data ?? []).map((raw) => {
    const p = toBusinessPartner(raw as Record<string, unknown>);
    return { ...p, contacts: sortContacts(byPartner.get(p.id) ?? []) };
  });
}

export async function getPartner(
  id: string,
): Promise<PartnerWithContacts | null> {
  await requirePartnerAccess();
  if (!id) return null;

  const { data, error } = await supabaseAdmin
    .from("business_partners")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const { data: contacts, error: cErr } = await supabaseAdmin
    .from("partner_contacts")
    .select("*")
    .eq("partner_id", id);
  if (cErr) throw new Error(cErr.message);

  return {
    ...toBusinessPartner(data as Record<string, unknown>),
    contacts: sortContacts(
      (contacts ?? []).map((r) => toPartnerContact(r as Record<string, unknown>)),
    ),
  };
}

// =====================================================================
// 거래처 등록 / 수정
//   명함이 없어도(학교·프로그램 의뢰처) 거래처명만으로 등록됩니다.
// =====================================================================
export type SavePartnerInput = {
  id?: string | null;
  name?: string | null;
  category?: string | null;
  phone?: string | null;
  fax?: string | null;
  address?: string | null;
  website?: string | null;
  memo?: string | null;
  isActive?: boolean;
};

export async function savePartner(
  input: SavePartnerInput,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  try {
    const ctx = await requirePartnerAccess();

    const name = trim(input.name, 200);
    if (!name) return { ok: false, message: "거래처명을 입력해주세요." };

    const row: Record<string, unknown> = {
      name,
      category: normalizePartnerCategory(input.category),
      phone: trim(input.phone, 100),
      fax: trim(input.fax, 100),
      address: trim(input.address, 500),
      website: trim(input.website, 300),
      memo: trim(input.memo, 4000),
      is_active: input.isActive !== false,
      updated_at: new Date().toISOString(),
    };

    const id = trim(input.id, 100);
    if (id) {
      const { data: prev } = await supabaseAdmin
        .from("business_partners")
        .select("id")
        .eq("id", id)
        .maybeSingle();
      if (!prev) return { ok: false, message: "거래처를 찾을 수 없습니다." };

      const { error } = await supabaseAdmin
        .from("business_partners")
        .update(row)
        .eq("id", id);
      if (error) throw new Error(error.message);
      revalidatePath("/hr/partners");
      return { ok: true, id };
    }

    const { data, error } = await supabaseAdmin
      .from("business_partners")
      .insert({ ...row, registered_by: ctx.name })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    revalidatePath("/hr/partners");
    return { ok: true, id: String((data as { id: string }).id) };
  } catch (e) {
    return actionError(e, "거래처를 저장하지 못했습니다.");
  }
}

// 거래 종료 / 재개 — 이력을 남기려 삭제 대신 소프트 비활성으로 처리합니다.
export async function setPartnerActive(
  id: string,
  active: boolean,
): Promise<ActionResult> {
  try {
    await requirePartnerAccess();
    if (!id) return { ok: false, message: "대상이 없습니다." };

    const { error } = await supabaseAdmin
      .from("business_partners")
      .update({ is_active: active, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/hr/partners");
    return { ok: true };
  } catch (e) {
    return actionError(e, "거래처 상태를 바꾸지 못했습니다.");
  }
}

// 거래처 삭제 — 담당자는 FK on delete cascade 로 함께 지워집니다.
export async function deletePartner(id: string): Promise<ActionResult> {
  try {
    await requirePartnerAccess();
    if (!id) return { ok: false, message: "대상이 없습니다." };

    const { data: prev } = await supabaseAdmin
      .from("business_partners")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (!prev) return { ok: false, message: "거래처를 찾을 수 없습니다." };

    const { error } = await supabaseAdmin
      .from("business_partners")
      .delete()
      .eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/hr/partners");
    return { ok: true };
  } catch (e) {
    return actionError(e, "거래처를 삭제하지 못했습니다.");
  }
}

// =====================================================================
// 담당자 등록 / 수정 / 삭제
//   한 거래처에 여러 명(예: 학교 = 교감·방과후담당·행정실).
//   담당자가 바뀌어도 거래처는 남으므로 인수인계가 이어집니다.
// =====================================================================
export type SaveContactInput = {
  id?: string | null;
  partnerId: string;
  person_name?: string | null;
  title?: string | null;
  department?: string | null;
  mobile?: string | null;
  phone?: string | null;
  email?: string | null;
  memo?: string | null;
  isPrimary?: boolean;
};

export async function saveContact(
  input: SaveContactInput,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  try {
    const ctx = await requirePartnerAccess();

    const partnerId = trim(input.partnerId, 100);
    if (!partnerId) return { ok: false, message: "거래처가 지정되지 않았습니다." };

    const { data: partner } = await supabaseAdmin
      .from("business_partners")
      .select("id")
      .eq("id", partnerId)
      .maybeSingle();
    if (!partner) return { ok: false, message: "거래처를 찾을 수 없습니다." };

    const personName = trim(input.person_name, 200);
    if (!personName) return { ok: false, message: "담당자 이름을 입력해주세요." };

    const isPrimary = input.isPrimary === true;
    const row: Record<string, unknown> = {
      partner_id: partnerId,
      person_name: personName,
      title: trim(input.title, 100),
      department: trim(input.department, 200),
      mobile: trim(input.mobile, 100),
      phone: trim(input.phone, 100),
      email: trim(input.email, 200),
      memo: trim(input.memo, 2000),
      is_primary: isPrimary,
      updated_at: new Date().toISOString(),
    };

    const id = trim(input.id, 100);
    let savedId: string;

    if (id) {
      const { data: prev } = await supabaseAdmin
        .from("partner_contacts")
        .select("id")
        .eq("id", id)
        .eq("partner_id", partnerId)
        .maybeSingle();
      if (!prev) return { ok: false, message: "담당자를 찾을 수 없습니다." };

      const { error } = await supabaseAdmin
        .from("partner_contacts")
        .update(row)
        .eq("id", id);
      if (error) throw new Error(error.message);
      savedId = id;
    } else {
      const { data, error } = await supabaseAdmin
        .from("partner_contacts")
        .insert({ ...row, registered_by: ctx.name })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      savedId = String((data as { id: string }).id);
    }

    // 대표담당자는 거래처당 한 명 — 나머지는 내립니다.
    if (isPrimary) {
      const { error } = await supabaseAdmin
        .from("partner_contacts")
        .update({ is_primary: false })
        .eq("partner_id", partnerId)
        .neq("id", savedId);
      if (error) throw new Error(error.message);
    }

    revalidatePath("/hr/partners");
    return { ok: true, id: savedId };
  } catch (e) {
    return actionError(e, "담당자를 저장하지 못했습니다.");
  }
}

export async function deleteContact(id: string): Promise<ActionResult> {
  try {
    await requirePartnerAccess();
    if (!id) return { ok: false, message: "대상이 없습니다." };

    const { data: prev } = await supabaseAdmin
      .from("partner_contacts")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (!prev) return { ok: false, message: "담당자를 찾을 수 없습니다." };

    const { error } = await supabaseAdmin
      .from("partner_contacts")
      .delete()
      .eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/hr/partners");
    return { ok: true };
  } catch (e) {
    return actionError(e, "담당자를 삭제하지 못했습니다.");
  }
}
