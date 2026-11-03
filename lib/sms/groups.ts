// =====================================================================
// 문자 주소록(그룹) — sms_contact_groups / sms_contact_group_members. 서버 전용.
//   * 공개 범위: private(나만) / shared(전 직원). 공유 그룹은 모든 직원의 ⑦주소록에 보입니다.
//   * 사람 저장: DB 출처 사람은 {source, ref_id} 참조만(번호 복사 안 함 → 늘 최신 번호).
//     직접 입력(manual)만 phone 을 저장합니다.
//   * 수정·삭제: 만든 사람과 M0.
//   * 표가 아직 없으면(마이그레이션 미적용) 목록은 빈 배열 + missing=true.
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { canEditOwned, smsTableMissing, type SmsUser } from "@/lib/sms/access";
import {
  SMS_TABLE_MISSING,
  isValidSmsPhone,
  normalizeSmsPhone,
  type SmsGroup,
  type SmsVisibility,
} from "@/lib/sms/text";
import type { SmsPersonRef } from "@/lib/sms/sources/types";

export const GROUP_TABLE = "sms_contact_groups";
export const GROUP_MEMBER_TABLE = "sms_contact_group_members";
export const GROUP_MAX_MEMBERS = 3000;

type GroupRow = {
  id: string;
  name: string;
  category: string | null;
  visibility: SmsVisibility;
  business_program_id: string | null;
  owner_id: string | null;
};

export type GroupMemberRow = {
  id: string;
  group_id: string;
  source: string;
  ref_id: string | null;
  name: string;
  phone: string | null;
};

export type GroupMemberInput = SmsPersonRef & { name: string };

function canSee(user: SmsUser, g: GroupRow): boolean {
  return g.visibility === "shared" || canEditOwned(user, g.owner_id);
}

export async function listGroups(
  user: SmsUser,
): Promise<{ groups: SmsGroup[]; missing: boolean }> {
  const { data, error } = await supabaseAdmin
    .from(GROUP_TABLE)
    .select("id, name, category, visibility, business_program_id, owner_id")
    .order("name");
  if (smsTableMissing(error)) return { groups: [], missing: true };
  if (error) throw new Error(`주소록 조회 실패: ${error.message}`);
  // M0 도 남의 '나만' 그룹은 목록에 보이지 않게 — 공개 범위의 뜻을 지킵니다.
  const rows = ((data ?? []) as GroupRow[]).filter(
    (g) => g.visibility === "shared" || (!!user.driverId && g.owner_id === user.driverId),
  );
  const ids = rows.map((g) => g.id);
  const counts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: mem } = await supabaseAdmin
      .from(GROUP_MEMBER_TABLE)
      .select("group_id")
      .in("group_id", ids);
    for (const m of (mem ?? []) as { group_id: string }[])
      counts.set(m.group_id, (counts.get(m.group_id) ?? 0) + 1);
  }
  const ownerIds = [...new Set(rows.map((g) => g.owner_id).filter(Boolean))] as string[];
  const programIds = [...new Set(rows.map((g) => g.business_program_id).filter(Boolean))] as string[];
  const [owners, programs] = await Promise.all([
    ownerIds.length
      ? supabaseAdmin.from("drivers").select("id, name").in("id", ownerIds)
      : Promise.resolve({ data: [] }),
    programIds.length
      ? supabaseAdmin.from("business_programs").select("id, name").in("id", programIds)
      : Promise.resolve({ data: [] }),
  ]);
  const ownerName = new Map(((owners.data ?? []) as { id: string; name: string }[]).map((o) => [o.id, o.name]));
  const programName = new Map(((programs.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  return {
    missing: false,
    groups: rows.map((g) => ({
      id: g.id,
      name: g.name,
      category: g.category,
      visibility: g.visibility,
      business_program_id: g.business_program_id,
      business_program_name: g.business_program_id ? programName.get(g.business_program_id) ?? null : null,
      owner_name: g.owner_id ? ownerName.get(g.owner_id) ?? null : null,
      member_count: counts.get(g.id) ?? 0,
      can_edit: canEditOwned(user, g.owner_id),
    })),
  };
}

// 볼 수 있는 그룹들의 사람 — 발송·미리보기용(서버 전용).
export async function loadGroupMembers(
  user: SmsUser,
  groupIds: string[],
): Promise<{ groups: GroupRow[]; members: GroupMemberRow[] }> {
  if (groupIds.length === 0) return { groups: [], members: [] };
  const { data, error } = await supabaseAdmin
    .from(GROUP_TABLE)
    .select("id, name, category, visibility, business_program_id, owner_id")
    .in("id", groupIds.slice(0, 200));
  if (smsTableMissing(error)) throw new Error(SMS_TABLE_MISSING);
  if (error) throw new Error(`주소록 조회 실패: ${error.message}`);
  const groups = ((data ?? []) as GroupRow[]).filter((g) => canSee(user, g));
  if (groups.length === 0) return { groups, members: [] };
  const { data: mem, error: me } = await supabaseAdmin
    .from(GROUP_MEMBER_TABLE)
    .select("id, group_id, source, ref_id, name, phone")
    .in(
      "group_id",
      groups.map((g) => g.id),
    )
    .order("created_at");
  if (me) throw new Error(`주소록 사람 조회 실패: ${me.message}`);
  return { groups, members: (mem ?? []) as GroupMemberRow[] };
}

export type GroupMetaInput = {
  name: string;
  category: string | null;
  visibility: SmsVisibility;
  business_program_id: string | null;
};

export function cleanGroupMeta(raw: Partial<GroupMetaInput>): GroupMetaInput | string {
  const name = (raw.name ?? "").trim().slice(0, 60);
  if (!name) return "주소록 이름을 입력하세요.";
  return {
    name,
    category: (raw.category ?? "").trim().slice(0, 30) || null,
    visibility: raw.visibility === "shared" ? "shared" : "private",
    business_program_id:
      typeof raw.business_program_id === "string" && /^[0-9a-f-]{36}$/i.test(raw.business_program_id)
        ? raw.business_program_id
        : null,
  };
}

// 저장할 사람 정리 — 같은 참조·같은 번호는 한 번만. manual 만 phone, 나머지는 ref_id 만.
export function cleanMembers(members: GroupMemberInput[]): GroupMemberInput[] {
  const seen = new Set<string>();
  const out: GroupMemberInput[] = [];
  for (const m of members) {
    if (m.source === "manual") {
      const d = normalizeSmsPhone(m.phone ?? "");
      if (!isValidSmsPhone(d)) continue;
      const k = `manual:${d}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ source: "manual", ref_id: null, phone: d, name: (m.name ?? "").slice(0, 60) });
    } else {
      if (!m.ref_id) continue;
      const k = `${m.source}:${m.ref_id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ source: m.source, ref_id: m.ref_id, phone: null, name: (m.name ?? "").slice(0, 60) });
    }
  }
  return out.slice(0, GROUP_MAX_MEMBERS);
}

export async function createGroup(
  user: SmsUser,
  meta: GroupMetaInput,
  members: GroupMemberInput[],
): Promise<string> {
  if (!user.driverId) throw new Error("직원 정보(drivers)를 찾지 못해 주소록을 만들 수 없습니다.");
  const { data, error } = await supabaseAdmin
    .from(GROUP_TABLE)
    .insert({ ...meta, owner_id: user.driverId })
    .select("id")
    .single();
  if (smsTableMissing(error)) throw new Error(SMS_TABLE_MISSING);
  if (error) throw new Error(`주소록 저장 실패: ${error.message}`);
  const id = (data as { id: string }).id;
  await insertMembers(id, members);
  return id;
}

async function insertMembers(groupId: string, members: GroupMemberInput[]) {
  const rows = cleanMembers(members).map((m) => ({ group_id: groupId, ...m }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabaseAdmin.from(GROUP_MEMBER_TABLE).insert(rows.slice(i, i + 500));
    if (error) throw new Error(`주소록 사람 저장 실패: ${error.message}`);
  }
}

async function loadEditable(user: SmsUser, id: string): Promise<GroupRow> {
  const { data, error } = await supabaseAdmin
    .from(GROUP_TABLE)
    .select("id, name, category, visibility, business_program_id, owner_id")
    .eq("id", id)
    .maybeSingle();
  if (smsTableMissing(error)) throw new Error(SMS_TABLE_MISSING);
  if (error) throw new Error(error.message);
  const g = data as GroupRow | null;
  if (!g || !canSee(user, g)) throw new Error("주소록을 찾을 수 없습니다.");
  if (!canEditOwned(user, g.owner_id)) throw new Error("만든 사람과 관장·부장만 고칠 수 있습니다.");
  return g;
}

// 이름·분류·공개 범위·연결 사업 수정. members 를 주면 사람 명단을 통째로 바꿉니다.
export async function updateGroup(
  user: SmsUser,
  id: string,
  meta: GroupMetaInput,
  members?: GroupMemberInput[],
): Promise<void> {
  await loadEditable(user, id);
  const { error } = await supabaseAdmin
    .from(GROUP_TABLE)
    .update({ ...meta, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`주소록 수정 실패: ${error.message}`);
  if (members) {
    const { error: de } = await supabaseAdmin.from(GROUP_MEMBER_TABLE).delete().eq("group_id", id);
    if (de) throw new Error(`주소록 사람 정리 실패: ${de.message}`);
    await insertMembers(id, members);
  }
}

export async function deleteGroup(user: SmsUser, id: string): Promise<void> {
  await loadEditable(user, id);
  const { error } = await supabaseAdmin.from(GROUP_TABLE).delete().eq("id", id);
  if (error) throw new Error(`주소록 삭제 실패: ${error.message}`);
}
