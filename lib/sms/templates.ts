// =====================================================================
// 문구함(sms_templates) — 서버 전용.
//   * 공개 범위: private(나만) / shared(전 직원).
//   * 정렬: 즐겨찾기 먼저, 그다음 많이 쓴 순(use_count).
//   * 수정·삭제·즐겨찾기: 만든 사람과 M0. 사용 횟수(use)는 볼 수 있는 사람 누구나.
//   * 표가 아직 없으면 목록은 빈 배열 + missing=true.
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { canEditOwned, smsTableMissing, type SmsUser } from "@/lib/sms/access";
import {
  LMS_MAX_BYTES,
  SMS_TABLE_MISSING,
  SMS_TEMPLATE_CATEGORIES,
  eucKrBytes,
  type SmsTemplate,
  type SmsVisibility,
} from "@/lib/sms/text";

export const TEMPLATE_TABLE = "sms_templates";

type Row = {
  id: string;
  title: string;
  body: string;
  category: string | null;
  visibility: SmsVisibility;
  owner_id: string | null;
  use_count: number | null;
  is_favorite: boolean | null;
};
const COLS = "id, title, body, category, visibility, owner_id, use_count, is_favorite";

const visible = (user: SmsUser, r: Row) =>
  r.visibility === "shared" || (!!user.driverId && r.owner_id === user.driverId);

export async function listTemplates(
  user: SmsUser,
): Promise<{ templates: SmsTemplate[]; missing: boolean }> {
  const { data, error } = await supabaseAdmin
    .from(TEMPLATE_TABLE)
    .select(COLS)
    .order("is_favorite", { ascending: false })
    .order("use_count", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);
  if (smsTableMissing(error)) return { templates: [], missing: true };
  if (error) throw new Error(`문구함 조회 실패: ${error.message}`);
  const rows = ((data ?? []) as Row[]).filter((r) => visible(user, r));
  const ownerIds = [...new Set(rows.map((r) => r.owner_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (ownerIds.length) {
    const { data: d } = await supabaseAdmin.from("drivers").select("id, name").in("id", ownerIds);
    for (const o of (d ?? []) as { id: string; name: string }[]) names.set(o.id, o.name);
  }
  return {
    missing: false,
    templates: rows.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      category: r.category ?? "기타",
      visibility: r.visibility,
      owner_name: r.owner_id ? names.get(r.owner_id) ?? null : null,
      use_count: r.use_count ?? 0,
      is_favorite: r.is_favorite === true,
      can_edit: canEditOwned(user, r.owner_id),
    })),
  };
}

export type TemplateInput = {
  title: string;
  body: string;
  category: string;
  visibility: SmsVisibility;
  is_favorite?: boolean;
};

export function cleanTemplate(raw: Partial<TemplateInput>): TemplateInput | string {
  const title = (raw.title ?? "").trim().slice(0, 60);
  const body = (raw.body ?? "").trim();
  if (!title) return "제목을 입력하세요.";
  if (!body) return "문구를 입력하세요.";
  if (eucKrBytes(body) > LMS_MAX_BYTES) return `문구가 ${LMS_MAX_BYTES.toLocaleString()}바이트를 넘습니다.`;
  const category = (SMS_TEMPLATE_CATEGORIES as readonly string[]).includes(raw.category ?? "")
    ? (raw.category as string)
    : "기타";
  return {
    title,
    body,
    category,
    visibility: raw.visibility === "shared" ? "shared" : "private",
    ...(typeof raw.is_favorite === "boolean" ? { is_favorite: raw.is_favorite } : {}),
  };
}

export async function createTemplate(user: SmsUser, input: TemplateInput): Promise<string> {
  if (!user.driverId) throw new Error("직원 정보(drivers)를 찾지 못해 문구를 저장할 수 없습니다.");
  const { data, error } = await supabaseAdmin
    .from(TEMPLATE_TABLE)
    .insert({ ...input, owner_id: user.driverId })
    .select("id")
    .single();
  if (smsTableMissing(error)) throw new Error(SMS_TABLE_MISSING);
  if (error) throw new Error(`문구 저장 실패: ${error.message}`);
  return (data as { id: string }).id;
}

async function loadRow(user: SmsUser, id: string): Promise<Row> {
  const { data, error } = await supabaseAdmin.from(TEMPLATE_TABLE).select(COLS).eq("id", id).maybeSingle();
  if (smsTableMissing(error)) throw new Error(SMS_TABLE_MISSING);
  if (error) throw new Error(error.message);
  const r = data as Row | null;
  if (!r || !visible(user, r)) throw new Error("문구를 찾을 수 없습니다.");
  return r;
}

export async function updateTemplate(user: SmsUser, id: string, patch: Partial<TemplateInput>): Promise<void> {
  const r = await loadRow(user, id);
  if (!canEditOwned(user, r.owner_id)) throw new Error("만든 사람과 관장·부장만 고칠 수 있습니다.");
  const { error } = await supabaseAdmin
    .from(TEMPLATE_TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`문구 수정 실패: ${error.message}`);
}

export async function deleteTemplate(user: SmsUser, id: string): Promise<void> {
  const r = await loadRow(user, id);
  if (!canEditOwned(user, r.owner_id)) throw new Error("만든 사람과 관장·부장만 지울 수 있습니다.");
  const { error } = await supabaseAdmin.from(TEMPLATE_TABLE).delete().eq("id", id);
  if (error) throw new Error(`문구 삭제 실패: ${error.message}`);
}

// 문구를 본문에 넣을 때 — 사용 횟수 +1(동시 사용으로 1~2회 어긋나도 정렬용이라 괜찮음).
export async function markTemplateUsed(user: SmsUser, id: string): Promise<void> {
  const r = await loadRow(user, id);
  await supabaseAdmin
    .from(TEMPLATE_TABLE)
    .update({ use_count: (r.use_count ?? 0) + 1 })
    .eq("id", id);
}
