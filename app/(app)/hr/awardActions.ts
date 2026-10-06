"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getMyDriver } from "@/lib/contractServer";
import { hasHrScope } from "@/app/(app)/hr/actions";
import { resolveDisciplineAdmin, uploadAttachment, removeAttachment, signAttachment, toAward } from "@/lib/hrDisciplineServer";
import { AWARD_KINDS, isYmd, toAwardSource, type AwardRow, type AwardSource } from "@/lib/hrDiscipline";

// =====================================================================
// 인사기록카드 '수상·포상' 탭 — hr_awards 하나로 일원화(2026-10).
//   예전 '수상' 탭(employee_profiles.awards)을 대체합니다. 그 컬럼은 더 읽지도 쓰지도 않습니다.
//
//   열람·수정 규칙(award_source 로 나눔 — 서버 쿼리 단계에서 거름):
//     external(외부 수상, 입사 전 포함) — 본인 경력.
//       본인·인사 담당(records 영역)·관장·부장이 전부 보고 고칩니다(기존 '수상' 탭과 같은 수준).
//     internal(센터 포상, 운영규정 30조) — 인사고과 반영 대상.
//       관장·부장만 전부 보고 고칩니다. 본인에게는 포상명·포상일만(등록은 본인도 가능).
//       인사 담당(비M0)은 남의 센터 포상을 받지 않습니다.
//   본인 카드가 잠겨 있으면(is_locked) 본인은 고칠 수 없습니다 — 다른 인사기록 항목과 같음.
// =====================================================================

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  const t = typeof v === "string" ? v.trim() : "";
  return t.length ? t : null;
};

export type CardAward = AwardRow & { limited: boolean }; // limited = 포상명·포상일만 받은 행

type Viewer = {
  isM0: boolean;
  isHr: boolean; // records 영역(인사 담당) — M0 포함
  isSelf: boolean;
  name: string;
};

async function viewerFor(driverId: string): Promise<Viewer | null> {
  const [me, m0, hr] = await Promise.all([getMyDriver(), resolveDisciplineAdmin(), hasHrScope("records")]);
  const isSelf = !!me && me.id === driverId;
  const isM0 = !!m0;
  if (!isSelf && !isM0 && !hr) return null;
  return { isM0, isHr: hr || isM0, isSelf, name: m0?.name ?? me?.name ?? "" };
}

export type CardAwardPerms = {
  canAddInternal: boolean;
  canEditExternal: boolean;
  canEditInternal: boolean;
  locked: boolean; // 본인 카드 잠금(본인에게만 의미)
};

export async function listCardAwards(driverId: string): Promise<Result<{ awards: CardAward[]; perms: CardAwardPerms }>> {
  try {
    const v = await viewerFor(driverId);
    if (!v) return { ok: false, message: "볼 수 있는 권한이 없습니다." };
    const locked = v.isSelf && !v.isHr ? await isLocked(driverId) : false;
    const [full, limited] = await Promise.all([
      // 전체 칸 — M0 는 둘 다, 그 외(본인·인사 담당)는 외부 수상만.
      (v.isM0
        ? supabaseAdmin.from("hr_awards").select("*").eq("driver_id", driverId)
        : supabaseAdmin.from("hr_awards").select("*").eq("driver_id", driverId).eq("award_source", "external")),
      // 본인(비M0)의 센터 포상 — 포상명·포상일만 select.
      v.isSelf && !v.isM0
        ? supabaseAdmin.from("hr_awards").select("id, awarded_on, title").eq("driver_id", driverId).eq("award_source", "internal")
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (full.error) throw new Error(full.error.message);
    if (limited.error) throw new Error(limited.error.message);
    const awards: CardAward[] = [
      ...(full.data ?? []).map((r) => ({ ...toAward(r as Record<string, unknown>), limited: false })),
      ...((limited.data ?? []) as { id: string; awarded_on: string; title: string }[]).map((r) => ({
        id: String(r.id),
        driver_id: driverId,
        award_source: "internal" as const,
        awarded_on: String(r.awarded_on),
        title: String(r.title),
        awarding_body: null,
        award_kind: null,
        merit_summary: null,
        has_attachment: false,
        created_by: null,
        created_at: "",
        limited: true,
      })),
    ].sort((a, b) => (a.awarded_on < b.awarded_on ? -1 : a.awarded_on > b.awarded_on ? 1 : 0));
    return {
      ok: true,
      awards,
      perms: {
        canAddInternal: v.isM0 || v.isSelf,
        canEditExternal: !locked && (v.isM0 || v.isHr || v.isSelf),
        canEditInternal: v.isM0,
        locked,
      },
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "불러오지 못했습니다." };
  }
}

async function isLocked(driverId: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from("employee_profiles").select("is_locked").eq("driver_id", driverId).maybeSingle();
  return (data as { is_locked?: boolean | null } | null)?.is_locked === true;
}

async function rowSource(id: string): Promise<{ driver_id: string; source: AwardSource; path: string | null } | null> {
  const { data } = await supabaseAdmin.from("hr_awards").select("driver_id, award_source, attachment_path").eq("id", id).maybeSingle();
  if (!data) return null;
  const r = data as { driver_id: string; award_source: string; attachment_path: string | null };
  return { driver_id: String(r.driver_id), source: toAwardSource(r.award_source), path: r.attachment_path };
}

function canWrite(v: Viewer, source: AwardSource, locked: boolean, creating: boolean): boolean {
  if (v.isM0) return true;
  if (source === "external") return v.isHr || (v.isSelf && !locked);
  // 센터 포상: 본인은 새로 등록만(이후 수정·삭제는 관장·부장).
  return creating && v.isSelf && !locked;
}

// FormData: id?, driverId, source, awardedOn, title, awardingBody, awardKind, meritSummary, file, removeFile
export async function saveCardAward(fd: FormData): Promise<Result<{ id: string }>> {
  try {
    const id = s(fd, "id");
    const existing = id ? await rowSource(id) : null;
    if (id && !existing) return { ok: false, message: "기록을 찾을 수 없습니다." };
    const driverId = existing?.driver_id ?? s(fd, "driverId");
    if (!driverId) return { ok: false, message: "대상 직원이 없습니다." };
    const v = await viewerFor(driverId);
    if (!v) return { ok: false, message: "권한이 없습니다." };
    const locked = v.isSelf && !v.isHr ? await isLocked(driverId) : false;
    const source = toAwardSource(s(fd, "source"));
    // 기존 행의 출처 기준으로 수정 권한, 새 출처 기준으로 쓰기 권한을 모두 봅니다.
    if (existing && !canWrite(v, existing.source, locked, false)) return { ok: false, message: "이 기록을 고칠 권한이 없습니다." };
    if (!canWrite(v, source, locked, !existing)) {
      return { ok: false, message: locked ? "인사기록카드가 잠겨 있어 고칠 수 없습니다." : "센터 포상은 관장·부장만 고칠 수 있습니다." };
    }
    const awarded_on = s(fd, "awardedOn");
    const title = s(fd, "title");
    if (!isYmd(awarded_on)) return { ok: false, message: "날짜를 확인해주세요." };
    if (!title) return { ok: false, message: "포상명을 적어주세요." };
    const kind = s(fd, "awardKind");
    const row = {
      award_source: source,
      awarded_on,
      title,
      awarding_body: s(fd, "awardingBody"),
      // 포상 종류(운영규정 30조)는 센터 포상에만.
      award_kind: source === "internal" && kind && (AWARD_KINDS as readonly string[]).includes(kind) ? kind : null,
      merit_summary: s(fd, "meritSummary"),
    };
    let savedId = id;
    if (id) {
      const { error } = await supabaseAdmin.from("hr_awards").update({ ...row, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw new Error(error.message);
    } else {
      const { data, error } = await supabaseAdmin
        .from("hr_awards")
        .insert({ ...row, driver_id: driverId, created_by: v.name })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      savedId = String((data as { id: string }).id);
    }
    const file = fd.get("file");
    const remove = s(fd, "removeFile") === "1";
    if ((file instanceof File && file.size > 0) || remove) {
      const path = file instanceof File && file.size > 0 ? await uploadAttachment("hr_awards", savedId!, file) : null;
      await supabaseAdmin.from("hr_awards").update({ attachment_path: path }).eq("id", savedId!);
      if (existing?.path && existing.path !== path) await removeAttachment(existing.path);
    }
    revalidatePath("/profile/hr");
    revalidatePath("/hr");
    revalidatePath("/hr/discipline");
    return { ok: true, id: savedId! };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "저장 중 오류가 발생했습니다." };
  }
}

export async function deleteCardAward(id: string): Promise<Result> {
  try {
    const existing = await rowSource(id);
    if (!existing) return { ok: false, message: "기록을 찾을 수 없습니다." };
    const v = await viewerFor(existing.driver_id);
    if (!v) return { ok: false, message: "권한이 없습니다." };
    const locked = v.isSelf && !v.isHr ? await isLocked(existing.driver_id) : false;
    if (!canWrite(v, existing.source, locked, false)) return { ok: false, message: "이 기록을 지울 권한이 없습니다." };
    const { error } = await supabaseAdmin.from("hr_awards").delete().eq("id", id);
    if (error) throw new Error(error.message);
    await removeAttachment(existing.path);
    revalidatePath("/profile/hr");
    revalidatePath("/hr");
    revalidatePath("/hr/discipline");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "삭제 중 오류가 발생했습니다." };
  }
}

export async function getCardAwardAttachmentUrl(id: string): Promise<Result<{ url: string }>> {
  try {
    const existing = await rowSource(id);
    if (!existing) return { ok: false, message: "기록을 찾을 수 없습니다." };
    const v = await viewerFor(existing.driver_id);
    // 첨부 열람은 전체 열람 권한과 같습니다(센터 포상은 M0 만).
    if (!v || (existing.source === "internal" && !v.isM0)) return { ok: false, message: "권한이 없습니다." };
    const url = await signAttachment(existing.path);
    return url ? { ok: true, url } : { ok: false, message: "첨부가 없습니다." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "오류가 발생했습니다." };
  }
}
