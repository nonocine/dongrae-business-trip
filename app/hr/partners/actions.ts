"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  resolvePartnerAccess,
  requirePartnerAccess,
  requirePartnerManager,
} from "@/lib/partnerAccess";
import { loadPartnerForWrite } from "@/lib/directoryGuards";
import {
  toBusinessPartner,
  toPartnerContact,
  toPartnerTransactionLog,
  normalizePartnerCategory,
  sortContacts,
  sortTransactionLogs,
  type PartnerContact,
  type PartnerTransactionLog,
  type PartnerWithContacts,
} from "@/lib/businessPartners";

// =====================================================================
// 거래처 관리 서버 액션 — /hr/partners
//   * 접근(관장 결정): 기본 공개 + 예외 비공개. lib/partnerAccess.
//     - 열람·등록·수정: 로그인한 정식 직원이면 누구나(협업 자산).
//     - is_private=true 인 거래처: 관리자(M0·hr)만 열람·수정·삭제.
//     - 공개↔비공개 전환: 관리자만(requirePartnerManager).
//   * ⚠️ 비공개 항목은 **서버에서** 걸러 클라이언트로 보내지 않습니다. 목록 필터·
//     상세 직접접근(URL 로 id 찍기)·담당자 조회 모두 is_private 를 확인합니다.
//     비공개 거래처가 가려지면 그 소속 담당자도 함께 가려집니다.
//   * business_partners·partner_contacts 는 RLS on(정책 0개) → service_role
//     경유만 가능. 모든 액션이 진입 시 권한을 재검증합니다.
//   * 거래이력(partner_transaction_logs): 등록은 거래처를 볼 수 있는 직원 누구나,
//     수정·삭제는 **등록자 본인 또는 M0**(관장·부장). 사업실적 삭제와 같은 논리이며
//     created_by(등록자 이름)로 비교합니다. 비공개 거래처의 이력은 거래처 가드를
//     그대로 태워 함께 가려집니다.
//   * 담당자·거래이력은 partner_id FK on delete cascade — 거래처를 지우면 함께 지워집니다.
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

// 거래이력을 수정·삭제할 수 있는지 — M0(관장·부장) 또는 등록자 본인.
//   사업실적(deleteBusinessResult)의 "관리자 ∥ 작성자" 판정과 같은 논리입니다.
//   created_by 가 비어 있는 행(옛 데이터)은 M0 만 손댈 수 있습니다.
function canEditLog(
  createdBy: string,
  ctx: { isM0: boolean; name: string },
): boolean {
  if (ctx.isM0) return true;
  const owner = createdBy.trim();
  return owner !== "" && owner === ctx.name.trim();
}

// 페이지용 — 접근 가능 여부만(로그인 직원이면 true).
export async function canAccessPartners(): Promise<boolean> {
  return (await resolvePartnerAccess()) !== null;
}

// 비공개 항목을 다룰 수 있는지(M0·hr) — 화면이 배지·토글 노출을 정할 때 씁니다.
//   ⚠️ 표시용일 뿐이며, 실제 차단은 각 액션의 서버 재검증이 담당합니다.
export async function isPartnerManager(): Promise<boolean> {
  const ctx = await resolvePartnerAccess();
  return ctx?.isManager === true;
}


// =====================================================================
// 목록 / 상세
//   거래처와 담당자를 각각 한 번씩 읽어 메모리에서 묶습니다(건수가 작고,
//   목록에서 담당자 수·담당자명 검색이 모두 필요하므로 N+1 을 피합니다).
// =====================================================================
export async function listPartners(): Promise<PartnerWithContacts[]> {
  const ctx = await requirePartnerAccess();

  // 비공개 거래처는 관리자가 아니면 쿼리 단계에서 제외합니다.
  let q = supabaseAdmin
    .from("business_partners")
    .select("*")
    .order("name", { ascending: true });
  if (!ctx.isManager) q = q.eq("is_private", false);

  const { data: partnerRows, error } = await q;
  if (error) throw new Error(error.message);

  const partners = (partnerRows ?? []).map((raw) =>
    toBusinessPartner(raw as Record<string, unknown>),
  );
  if (partners.length === 0) return [];

  // 담당자는 "보이는 거래처"의 것만 읽습니다 → 비공개 거래처의 담당자는
  // 애초에 조회되지 않습니다(거래처가 안 보이면 담당자도 안 보임).
  const { data: contactRows, error: cErr } = await supabaseAdmin
    .from("partner_contacts")
    .select("*")
    .in(
      "partner_id",
      partners.map((p) => p.id),
    );
  if (cErr) throw new Error(cErr.message);

  const byPartner = new Map<string, PartnerContact[]>();
  for (const raw of contactRows ?? []) {
    const c = toPartnerContact(raw as Record<string, unknown>);
    const list = byPartner.get(c.partner_id);
    if (list) list.push(c);
    else byPartner.set(c.partner_id, [c]);
  }

  // 거래이력도 "보이는 거래처"의 것만 — 담당자와 같은 방식입니다.
  const { data: logRows, error: lErr } = await supabaseAdmin
    .from("partner_transaction_logs")
    .select("*")
    .in(
      "partner_id",
      partners.map((p) => p.id),
    );
  if (lErr) throw new Error(lErr.message);

  const logsByPartner = new Map<string, PartnerTransactionLog[]>();
  for (const raw of logRows ?? []) {
    const row = raw as Record<string, unknown>;
    const log = toPartnerTransactionLog(
      row,
      canEditLog(String(row.created_by ?? ""), ctx),
    );
    const list = logsByPartner.get(log.partner_id);
    if (list) list.push(log);
    else logsByPartner.set(log.partner_id, [log]);
  }

  return partners.map((p) => ({
    ...p,
    contacts: sortContacts(byPartner.get(p.id) ?? []),
    logs: sortTransactionLogs(logsByPartner.get(p.id) ?? []),
  }));
}

export async function getPartner(
  id: string,
): Promise<PartnerWithContacts | null> {
  const ctx = await requirePartnerAccess();
  if (!id) return null;

  const { data, error } = await supabaseAdmin
    .from("business_partners")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  // URL 로 id 를 직접 찍어 들어오는 경로 차단 — 비공개면 없는 것으로 취급합니다.
  if ((data as { is_private?: unknown }).is_private === true && !ctx.isManager) {
    return null;
  }

  const { data: contacts, error: cErr } = await supabaseAdmin
    .from("partner_contacts")
    .select("*")
    .eq("partner_id", id);
  if (cErr) throw new Error(cErr.message);

  const { data: logs, error: lErr } = await supabaseAdmin
    .from("partner_transaction_logs")
    .select("*")
    .eq("partner_id", id);
  if (lErr) throw new Error(lErr.message);

  return {
    ...toBusinessPartner(data as Record<string, unknown>),
    contacts: sortContacts(
      (contacts ?? []).map((r) => toPartnerContact(r as Record<string, unknown>)),
    ),
    logs: sortTransactionLogs(
      (logs ?? []).map((r) => {
        const row = r as Record<string, unknown>;
        return toPartnerTransactionLog(
          row,
          canEditLog(String(row.created_by ?? ""), ctx),
        );
      }),
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
  // 관리자만 반영됩니다. 일반 직원이 보내와도 무시합니다.
  isPrivate?: boolean;
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
    // 비공개 지정은 관리자만. 일반 직원이 폼을 우회해 보내도 여기서 떨굽니다.
    //   (관리자가 아니면 아예 컬럼을 건드리지 않아 기존 값이 유지됩니다.)
    if (ctx.isManager && input.isPrivate !== undefined) {
      row.is_private = input.isPrivate === true;
    }

    const id = trim(input.id, 100);
    if (id) {
      // 비공개 거래처의 수정은 관리자만 — 비관리자에겐 "없는 것"으로 응답합니다.
      const guard = await loadPartnerForWrite(id, ctx.isManager);
      if (!guard.ok) return guard;

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
    const ctx = await requirePartnerAccess();
    if (!id) return { ok: false, message: "대상이 없습니다." };

    const guard = await loadPartnerForWrite(id, ctx.isManager);
    if (!guard.ok) return guard;

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

// 공개 ↔ 비공개 전환 — 관리자(M0·hr) 전용.
//   requirePartnerManager 가 UI 를 우회한 직접 호출까지 막습니다.
export async function setPartnerPrivate(
  id: string,
  isPrivate: boolean,
): Promise<ActionResult> {
  try {
    await requirePartnerManager();
    if (!id) return { ok: false, message: "대상이 없습니다." };

    const { data: prev } = await supabaseAdmin
      .from("business_partners")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (!prev) return { ok: false, message: "거래처를 찾을 수 없습니다." };

    const { error } = await supabaseAdmin
      .from("business_partners")
      .update({ is_private: isPrivate, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/hr/partners");
    return { ok: true };
  } catch (e) {
    return actionError(e, "공개 설정을 바꾸지 못했습니다.");
  }
}

// 거래처 삭제 — 담당자는 FK on delete cascade 로 함께 지워집니다.
export async function deletePartner(id: string): Promise<ActionResult> {
  try {
    const ctx = await requirePartnerAccess();
    if (!id) return { ok: false, message: "대상이 없습니다." };

    // 비공개 거래처는 관리자만 삭제할 수 있습니다.
    const guard = await loadPartnerForWrite(id, ctx.isManager);
    if (!guard.ok) return guard;

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

    // 비공개 거래처의 담당자는 관리자만 건드릴 수 있습니다.
    const guard = await loadPartnerForWrite(partnerId, ctx.isManager);
    if (!guard.ok) return guard;

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
    const ctx = await requirePartnerAccess();
    if (!id) return { ok: false, message: "대상이 없습니다." };

    const { data: prev } = await supabaseAdmin
      .from("partner_contacts")
      .select("id, partner_id")
      .eq("id", id)
      .maybeSingle();
    if (!prev) return { ok: false, message: "담당자를 찾을 수 없습니다." };

    // 소속 거래처가 비공개면 관리자만 삭제할 수 있습니다.
    const guard = await loadPartnerForWrite(
      String((prev as { partner_id?: unknown }).partner_id ?? ""),
      ctx.isManager,
    );
    if (!guard.ok) return { ok: false, message: "담당자를 찾을 수 없습니다." };

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

// =====================================================================
// 거래이력 등록 / 수정 / 삭제
//   한 거래처에 여러 건("2026-03 간판 제작", "2026-07 인테리어 공사").
//   담당자가 바뀌어도, 담당 직원이 바뀌어도 "이 업체와 무엇을 했는지"가 남아
//   인수인계 때 바로 읽힙니다.
//   * 등록: 거래처를 볼 수 있는 직원이면 누구나(관장 결정 2026-08-25).
//   * 수정·삭제: 등록자 본인 또는 M0. UI 버튼을 숨기는 것과 별개로 여기서
//     다시 막습니다.
// =====================================================================
export type SavePartnerLogInput = {
  id?: string | null;
  partnerId: string;
  // "YYYY-MM-DD". 화면에서 date 입력으로 받습니다.
  occurredOn?: string | null;
  content?: string | null;
};

export async function savePartnerLog(
  input: SavePartnerLogInput,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  try {
    const ctx = await requirePartnerAccess();

    const partnerId = trim(input.partnerId, 100);
    if (!partnerId)
      return { ok: false, message: "거래처가 지정되지 않았습니다." };

    // 비공개 거래처의 이력은 관리자만 건드릴 수 있습니다(담당자와 동일).
    const guard = await loadPartnerForWrite(partnerId, ctx.isManager);
    if (!guard.ok) return guard;

    const occurredOn = trim(input.occurredOn, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) {
      return { ok: false, message: "거래 일자를 입력해주세요." };
    }
    const content = trim(input.content, 2000);
    if (!content) return { ok: false, message: "거래 내용을 입력해주세요." };

    const row = { occurred_on: occurredOn, content };

    const id = trim(input.id, 100);
    if (id) {
      // 수정 대상이 이 거래처의 이력인지 + 손댈 수 있는 사람인지 확인합니다.
      const { data: prev } = await supabaseAdmin
        .from("partner_transaction_logs")
        .select("id, created_by")
        .eq("id", id)
        .eq("partner_id", partnerId)
        .maybeSingle();
      if (!prev) return { ok: false, message: "거래이력을 찾을 수 없습니다." };
      if (
        !canEditLog(String((prev as { created_by?: unknown }).created_by ?? ""), ctx)
      ) {
        return {
          ok: false,
          message: "본인이 등록한 거래이력만 수정할 수 있습니다.",
        };
      }

      const { error } = await supabaseAdmin
        .from("partner_transaction_logs")
        .update(row)
        .eq("id", id);
      if (error) throw new Error(error.message);
      revalidatePath("/hr/partners");
      return { ok: true, id };
    }

    const { data, error } = await supabaseAdmin
      .from("partner_transaction_logs")
      .insert({ ...row, partner_id: partnerId, created_by: ctx.name })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    revalidatePath("/hr/partners");
    return { ok: true, id: String((data as { id: string }).id) };
  } catch (e) {
    return actionError(e, "거래이력을 저장하지 못했습니다.");
  }
}

export async function deletePartnerLog(id: string): Promise<ActionResult> {
  try {
    const ctx = await requirePartnerAccess();
    if (!id) return { ok: false, message: "대상이 없습니다." };

    const { data: prev } = await supabaseAdmin
      .from("partner_transaction_logs")
      .select("id, partner_id, created_by")
      .eq("id", id)
      .maybeSingle();
    if (!prev) return { ok: false, message: "거래이력을 찾을 수 없습니다." };

    const row = prev as { partner_id?: unknown; created_by?: unknown };

    // 소속 거래처가 비공개면 관리자만 — "없는 것"으로 응답합니다.
    const guard = await loadPartnerForWrite(
      String(row.partner_id ?? ""),
      ctx.isManager,
    );
    if (!guard.ok) return { ok: false, message: "거래이력을 찾을 수 없습니다." };

    if (!canEditLog(String(row.created_by ?? ""), ctx)) {
      return {
        ok: false,
        message: "본인이 등록한 거래이력만 삭제할 수 있습니다.",
      };
    }

    const { error } = await supabaseAdmin
      .from("partner_transaction_logs")
      .delete()
      .eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/hr/partners");
    return { ok: true };
  } catch (e) {
    return actionError(e, "거래이력을 삭제하지 못했습니다.");
  }
}
