"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { kstTodayYmd } from "@/lib/trainings";
import { sendSlackDMDetailed, siteBaseUrl, slackLink } from "@/lib/slack";
import {
  AWARD_KINDS,
  COMMITTEE_AGENDAS,
  activePromotionBlock,
  appealDueOn,
  buildTimeline,
  isDisciplineKind,
  isYmd,
  promotionBlockUntil,
  validateDiscipline,
  warningAlert,
  type AwardRow,
  type CommitteeRow,
  type DisciplineRow,
  type IncidentRow,
  type TimelineItem,
} from "@/lib/hrDiscipline";
import {
  requireDisciplineAdmin,
  toAward,
  toCommittee,
  toDiscipline,
  toIncident,
  namesById,
  uploadAttachment,
  removeAttachment,
  signAttachment,
  readPendingRequests,
  writePendingRequests,
  type HrTable,
  type PendingRequest,
} from "@/lib/hrDisciplineServer";

// =====================================================================
// 상벌·경위서·인사위원회 관리 액션 — 관장·부장(M0)만.
//   모든 액션 첫 줄이 requireDisciplineAdmin(hr 직무 불가). RLS 정책 0 이라 방어선.
//   자동 계산(승진제한 만료일·재심 기한)은 서버가 lib/hrDiscipline 로 다시 합니다 —
//   화면이 보낸 값은 저장하지 않습니다.
// =====================================================================

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const fail = (e: unknown): { ok: false; message: string } => ({
  ok: false,
  message: e instanceof Error ? e.message : "처리 중 오류가 발생했습니다.",
});
const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  const t = typeof v === "string" ? v.trim() : "";
  return t.length ? t : null;
};

function refresh() {
  revalidatePath("/hr/discipline");
}

// --- 조회 ---------------------------------------------------------------------

export type DisciplineEmployee = { driverId: string; name: string; resigned: boolean };

export type EmployeeRecord = {
  awards: AwardRow[];
  disciplines: DisciplineRow[];
  timeline: TimelineItem[];
  promotionBlockUntil: string | null; // 오늘 기준 유효한 것만(지나면 null)
  warnings: { count: number; reached: boolean };
};

export async function listDisciplineEmployees(): Promise<DisciplineEmployee[]> {
  await requireDisciplineAdmin();
  const [{ data: drivers }, { data: profs }] = await Promise.all([
    supabaseAdmin.from("drivers").select("id, name").order("name"),
    supabaseAdmin.from("employee_profiles").select("driver_id, employment_status"),
  ]);
  const resigned = new Set(
    (profs ?? []).filter((p) => (p as { employment_status?: string }).employment_status === "resigned").map((p) => String((p as { driver_id: string }).driver_id))
  );
  return (drivers ?? []).map((d) => ({
    driverId: String((d as { id: string }).id),
    name: String((d as { name: string }).name),
    resigned: resigned.has(String((d as { id: string }).id)),
  }));
}

export async function getEmployeeRecord(driverId: string): Promise<Result<{ record: EmployeeRecord }>> {
  try {
    await requireDisciplineAdmin();
    if (!driverId) return { ok: false, message: "직원을 선택해주세요." };
    const [{ data: a, error: aErr }, { data: d, error: dErr }] = await Promise.all([
      supabaseAdmin.from("hr_awards").select("*").eq("driver_id", driverId),
      supabaseAdmin.from("hr_disciplines").select("*").eq("driver_id", driverId),
    ]);
    if (aErr) throw new Error(aErr.message);
    if (dErr) throw new Error(dErr.message);
    const awards = (a ?? []).map((r) => toAward(r as Record<string, unknown>));
    const disciplines = (d ?? []).map((r) => toDiscipline(r as Record<string, unknown>));
    return {
      ok: true,
      record: {
        awards,
        disciplines,
        timeline: buildTimeline(awards, disciplines),
        promotionBlockUntil: activePromotionBlock(disciplines, kstTodayYmd()),
        warnings: warningAlert(disciplines),
      },
    };
  } catch (e) {
    return fail(e);
  }
}

export type DisciplineBoard = {
  incidents: IncidentRow[];
  committees: CommitteeRow[];
  pendingRequests: (PendingRequest & { driverId: string; name: string })[];
  // 경고 3회 이상·승진제한 중인 사람(현황 요약)
  alerts: { driverId: string; name: string; warnings: number; blockUntil: string | null }[];
};

export async function getDisciplineBoard(): Promise<DisciplineBoard> {
  await requireDisciplineAdmin();
  const [{ data: inc }, { data: com }, { data: dis }, pending] = await Promise.all([
    supabaseAdmin.from("hr_incident_reports").select("*").order("submitted_at", { ascending: false }).limit(500),
    supabaseAdmin.from("hr_committees").select("*").order("held_on", { ascending: false }).limit(500),
    supabaseAdmin.from("hr_disciplines").select("driver_id, kind, promotion_block_until").limit(2000),
    readPendingRequests(),
  ]);
  const disRows = (dis ?? []) as { driver_id: string; kind: string; promotion_block_until: string | null }[];
  const names = await namesById([
    ...(inc ?? []).map((r) => String((r as { driver_id: string }).driver_id)),
    ...(com ?? []).map((r) => String((r as { target_driver_id: string | null }).target_driver_id ?? "")),
    ...Object.keys(pending),
    ...disRows.map((r) => r.driver_id),
  ]);
  const today = kstTodayYmd();
  const byDriver = new Map<string, { kind: string; promotion_block_until: string | null }[]>();
  for (const r of disRows) byDriver.set(r.driver_id, [...(byDriver.get(r.driver_id) ?? []), r]);
  const alerts = [...byDriver.entries()]
    .map(([driverId, rows]) => ({
      driverId,
      name: names.get(driverId) ?? "(알 수 없음)",
      warnings: rows.filter((r) => r.kind === "warning").length,
      blockUntil: activePromotionBlock(rows, today),
    }))
    .filter((x) => x.warnings >= 3 || x.blockUntil)
    .sort((x, y) => x.name.localeCompare(y.name, "ko"));
  return {
    incidents: (inc ?? []).map((r) =>
      toIncident(r as Record<string, unknown>, names.get(String((r as { driver_id: string }).driver_id)) ?? "(알 수 없음)")
    ),
    committees: (com ?? []).map((r) => {
      const t = (r as { target_driver_id: string | null }).target_driver_id;
      return toCommittee(r as Record<string, unknown>, t ? names.get(t) ?? null : null);
    }),
    pendingRequests: Object.entries(pending).map(([driverId, p]) => ({ ...p, driverId, name: names.get(driverId) ?? "(알 수 없음)" })),
    alerts,
  };
}

const TABLES: HrTable[] = ["hr_awards", "hr_disciplines", "hr_incident_reports", "hr_committees"];

export async function getAttachmentUrl(table: HrTable, id: string): Promise<Result<{ url: string }>> {
  try {
    await requireDisciplineAdmin();
    if (!TABLES.includes(table)) return { ok: false, message: "잘못된 요청입니다." };
    const { data } = await supabaseAdmin.from(table).select("attachment_path").eq("id", id).maybeSingle();
    const url = await signAttachment((data as { attachment_path?: string | null } | null)?.attachment_path ?? null);
    return url ? { ok: true, url } : { ok: false, message: "첨부가 없습니다." };
  } catch (e) {
    return fail(e);
  }
}

// --- 징계 ---------------------------------------------------------------------
// FormData: id?, driverId, kind, decidedOn, effectiveStart, effectiveEnd, reason, ruleBasis,
//           committeeId, notifiedOn, appealFiledOn, appealResult, incidentId, file, removeFile
export async function saveDiscipline(fd: FormData): Promise<Result<{ id: string; promotionBlockUntil: string | null; appealDueOn: string }>> {
  try {
    const me = await requireDisciplineAdmin();
    const id = s(fd, "id");
    const driverId = s(fd, "driverId");
    const kind = s(fd, "kind");
    if (!driverId) return { ok: false, message: "대상 직원을 선택해주세요." };
    if (!isDisciplineKind(kind)) return { ok: false, message: "징계 종류를 선택해주세요." };
    const reason = s(fd, "reason");
    if (!reason) return { ok: false, message: "징계 사유를 적어주세요." };
    const core = {
      kind,
      decided_on: s(fd, "decidedOn") ?? "",
      effective_start: s(fd, "effectiveStart"),
      effective_end: s(fd, "effectiveEnd"),
    };
    const invalid = validateDiscipline(core);
    if (invalid) return { ok: false, message: invalid };
    for (const k of ["notifiedOn", "appealFiledOn"]) {
      const v = s(fd, k);
      if (v && !isYmd(v)) return { ok: false, message: "날짜 형식을 확인해주세요." };
    }
    // 자동 계산 — 운영규정 32조(승진제한)·41조(재심 기한).
    const block = promotionBlockUntil(core);
    const due = appealDueOn(core.decided_on);
    const row = {
      driver_id: driverId,
      ...core,
      reason,
      rule_basis: s(fd, "ruleBasis"),
      committee_id: s(fd, "committeeId"),
      notified_on: s(fd, "notifiedOn"),
      appeal_due_on: due,
      appeal_filed_on: s(fd, "appealFiledOn"),
      appeal_result: s(fd, "appealResult"),
      promotion_block_until: block,
    };
    let savedId = id;
    if (id) {
      const { error } = await supabaseAdmin.from("hr_disciplines").update({ ...row, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw new Error(error.message);
    } else {
      const { data, error } = await supabaseAdmin
        .from("hr_disciplines")
        .insert({ ...row, created_by: me.name })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      savedId = String((data as { id: string }).id);
    }
    await replaceAttachment("hr_disciplines", savedId!, fd);
    // 경위서와 연결(선택).
    const incidentId = s(fd, "incidentId");
    if (incidentId) {
      await supabaseAdmin.from("hr_incident_reports").update({ discipline_id: savedId }).eq("id", incidentId).eq("driver_id", driverId);
    }
    refresh();
    return { ok: true, id: savedId!, promotionBlockUntil: block, appealDueOn: due };
  } catch (e) {
    return fail(e);
  }
}

async function replaceAttachment(table: HrTable, id: string, fd: FormData): Promise<void> {
  const file = fd.get("file");
  const remove = s(fd, "removeFile") === "1";
  if (!(file instanceof File && file.size > 0) && !remove) return;
  const { data } = await supabaseAdmin.from(table).select("attachment_path").eq("id", id).maybeSingle();
  const old = (data as { attachment_path?: string | null } | null)?.attachment_path ?? null;
  const path = file instanceof File && file.size > 0 ? await uploadAttachment(table, id, file) : null;
  const { error } = await supabaseAdmin.from(table).update({ attachment_path: path }).eq("id", id);
  if (error) throw new Error(error.message);
  if (old && old !== path) await removeAttachment(old);
}

async function deleteRow(table: HrTable, id: string): Promise<Result> {
  try {
    await requireDisciplineAdmin();
    const { data } = await supabaseAdmin.from(table).select("attachment_path").eq("id", id).maybeSingle();
    if (table === "hr_disciplines") {
      await supabaseAdmin.from("hr_incident_reports").update({ discipline_id: null }).eq("discipline_id", id);
    }
    if (table === "hr_committees") {
      await supabaseAdmin.from("hr_disciplines").update({ committee_id: null }).eq("committee_id", id);
    }
    const { error } = await supabaseAdmin.from(table).delete().eq("id", id);
    if (error) throw new Error(error.message);
    await removeAttachment((data as { attachment_path?: string | null } | null)?.attachment_path ?? null);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteDiscipline(id: string): Promise<Result> {
  return deleteRow("hr_disciplines", id);
}

// --- 포상(관리자 수정·삭제·대리 등록) --------------------------------------------
export async function saveAwardAdmin(fd: FormData): Promise<Result<{ id: string }>> {
  try {
    const me = await requireDisciplineAdmin();
    const id = s(fd, "id");
    const driverId = s(fd, "driverId");
    const row = awardRowFrom(fd);
    if (typeof row === "string") return { ok: false, message: row };
    let savedId = id;
    if (id) {
      const { error } = await supabaseAdmin.from("hr_awards").update({ ...row, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw new Error(error.message);
    } else {
      if (!driverId) return { ok: false, message: "대상 직원을 선택해주세요." };
      const { data, error } = await supabaseAdmin
        .from("hr_awards")
        .insert({ ...row, driver_id: driverId, created_by: me.name })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      savedId = String((data as { id: string }).id);
    }
    await replaceAttachment("hr_awards", savedId!, fd);
    refresh();
    return { ok: true, id: savedId! };
  } catch (e) {
    return fail(e);
  }
}

function awardRowFrom(fd: FormData) {
  const awarded_on = s(fd, "awardedOn");
  const title = s(fd, "title");
  if (!isYmd(awarded_on)) return "포상일을 확인해주세요.";
  if (!title) return "포상명을 적어주세요.";
  const kind = s(fd, "awardKind");
  return {
    awarded_on,
    title,
    awarding_body: s(fd, "awardingBody"),
    award_kind: kind && (AWARD_KINDS as readonly string[]).includes(kind) ? kind : null,
    merit_summary: s(fd, "meritSummary"),
  };
}

export async function deleteAward(id: string): Promise<Result> {
  return deleteRow("hr_awards", id);
}

// --- 경위서 -------------------------------------------------------------------
export async function reviewIncident(input: {
  id: string;
  reviewNote: string;
  disciplineId: string | null;
}): Promise<Result> {
  try {
    const me = await requireDisciplineAdmin();
    const { error } = await supabaseAdmin
      .from("hr_incident_reports")
      .update({
        review_note: input.reviewNote.trim() || null,
        reviewed_at: new Date().toISOString(),
        reviewed_by: me.name,
        discipline_id: input.disciplineId || null,
      })
      .eq("id", input.id);
    if (error) throw new Error(error.message);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteIncident(id: string): Promise<Result> {
  return deleteRow("hr_incident_reports", id);
}

// 경위서 제출 요청 — 대기 목록에 남기고 본인에게 슬랙 DM(부가기능, 실패해도 요청은 남음).
export async function requestIncidentReport(driverId: string, note: string): Promise<Result<{ dmFailed: string | null }>> {
  try {
    const me = await requireDisciplineAdmin();
    if (!driverId) return { ok: false, message: "직원을 선택해주세요." };
    const pending = await readPendingRequests();
    pending[driverId] = { by: me.name, at: new Date().toISOString(), note: note.trim() || null };
    await writePendingRequests(pending);
    let dmFailed: string | null = null;
    try {
      const { data } = await supabaseAdmin.from("employee_profiles").select("email").eq("driver_id", driverId).maybeSingle();
      const base = siteBaseUrl();
      const link = base ? ` ${slackLink(`${base}/profile/hr#discipline`, "경위서 제출하기")}` : "";
      // 개인정보·사유는 DM 에 넣지 않습니다(요청 사실만).
      const res = await sendSlackDMDetailed((data as { email?: string | null } | null)?.email ?? null, `📄 경위서 제출 요청이 있습니다. 마이페이지에서 제출해주세요.${link}`);
      dmFailed = res.ok ? null : res.reason ?? "사유 미상";
    } catch (e) {
      dmFailed = e instanceof Error ? e.message : "알 수 없는 오류";
    }
    refresh();
    return { ok: true, dmFailed };
  } catch (e) {
    return fail(e);
  }
}

export async function cancelIncidentRequest(driverId: string): Promise<Result> {
  try {
    await requireDisciplineAdmin();
    const pending = await readPendingRequests();
    delete pending[driverId];
    await writePendingRequests(pending);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// --- 인사위원회(기록용) ------------------------------------------------------------
export async function saveCommittee(fd: FormData): Promise<Result<{ id: string }>> {
  try {
    const me = await requireDisciplineAdmin();
    const id = s(fd, "id");
    const held_on = s(fd, "heldOn");
    const subject = s(fd, "subject");
    if (!isYmd(held_on)) return { ok: false, message: "개최일을 확인해주세요." };
    if (!subject) return { ok: false, message: "안건명을 적어주세요." };
    const agenda = s(fd, "agendaType");
    const members = (s(fd, "members") ?? "")
      .split(/[\n,]/)
      .map((m) => m.trim())
      .filter(Boolean)
      .slice(0, 30);
    const row = {
      held_on,
      subject,
      agenda_type: agenda && (COMMITTEE_AGENDAS as readonly string[]).includes(agenda) ? agenda : null,
      members,
      target_driver_id: s(fd, "targetDriverId"),
      resolution: s(fd, "resolution"),
      note: s(fd, "note"),
    };
    let savedId = id;
    if (id) {
      const { error } = await supabaseAdmin.from("hr_committees").update(row).eq("id", id);
      if (error) throw new Error(error.message);
    } else {
      const { data, error } = await supabaseAdmin.from("hr_committees").insert({ ...row, created_by: me.name }).select("id").single();
      if (error) throw new Error(error.message);
      savedId = String((data as { id: string }).id);
    }
    await replaceAttachment("hr_committees", savedId!, fd);
    refresh();
    return { ok: true, id: savedId! };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteCommittee(id: string): Promise<Result> {
  return deleteRow("hr_committees", id);
}
