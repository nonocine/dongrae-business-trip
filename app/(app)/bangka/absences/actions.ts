"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { canApproveAbsence, requireBangkaAccess } from "@/lib/bangkaAccess";
import { bkFileKind, extOf } from "@/lib/bangkaContent";
import { finalizeImage, newObjectName, signedUrls, signUpload, statObject } from "@/lib/bangkaMedia";
import {
  ABSENCE_FILE_MAX,
  awaitingEvidence,
  isAbsenceReason,
  type AbsenceRow,
  type AbsenceStatus,
  type AbsenceView,
} from "@/lib/bangkaAbsence";
import { kstTodayYmd } from "@/lib/trainings";

// =====================================================================
// 공결 처리(직원) — /bangka/absences
//   · 담임 확인: 방과후아카데미 담당자 누구나(신청 → 담임 확인)
//   · 팀장 결재 / 반려: 관장·부장·팀장만(canApproveAbsence). 결재는 앱 기록만(양식엔 결재란 없음).
//   · 전화 공결: 받은 직원이 적음 — channel=phone, 확인자=선생님(받은 직원), 증빙 대기(evidence_pending)로 시작.
//     보호자가 앱에서 증빙을 올리거나 직원이 [증빙 추가]로 대신 올리면 submitted("증빙 제출됨").
//   · 증빙 0개면 담임 확인·결재 불가(여기서 먼저 막고, DB 트리거로도 막음 — docs/설계_전화공결증빙.md).
//   bk_absences / bk_absence_files 는 service_role 전용 — 모든 액션이 진입 시 권한을 다시 봅니다.
// =====================================================================

const BASE = "/bangka/absences";
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const fail = (e: unknown, fb: string) => ({ ok: false as const, message: e instanceof Error ? e.message : fb });

const COLS =
  "id, student_id, start_date, end_date, reason_type, reason, confirmer_type, confirmer_other, confirmer_name, guardian_id, signature_path, channel, received_by, status, teacher_checked_by, teacher_checked_at, approved_by, approved_at, reject_reason, confirmed_on, evidence_requested_at, evidence_submitted_at, evidence_submitted_by, created_at";

// evidence = 증빙 대기(전화 공결 + 증빙 요청된 옛 결재 건 중 서류 없는 것). 월 구분 없이 전부.
export type AbsenceFilter = { view: "pending" | "evidence" | "all" | "phone"; ym: string | null };

// 증빙을 기다리는 건의 후보 — 증빙 대기 또는 증빙 요청된 결재 건(서류 유무는 받아서 거름).
const EVIDENCE_OR = "status.eq.evidence_pending,and(status.eq.approved,evidence_requested_at.not.is.null)";

export async function listAbsences(f: AbsenceFilter): Promise<AbsenceView[]> {
  await requireBangkaAccess();
  let q = supabaseAdmin
    .from("bk_absences")
    .select(`${COLS}, bk_students(name, school, grade, school_class, class_code), bk_absence_files(id, name, mime, size, path)`)
    .order("start_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(300);
  if (f.view === "pending") q = q.in("status", ["submitted", "teacher_checked"]);
  if (f.view === "evidence") q = q.or(EVIDENCE_OR);
  if (f.view === "phone") q = q.eq("channel", "phone");
  if (f.ym && /^\d{4}-\d{2}$/.test(f.ym)) {
    const [y, m] = f.ym.split("-").map(Number);
    const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
    q = q.lt("start_date", next).gte("end_date", `${f.ym}-01`);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  type Raw = AbsenceRow & {
    bk_students: AbsenceView["student"];
    bk_absence_files: { id: string; name: string | null; mime: string | null; size: number | null; path: string }[];
  };
  let rows = (data ?? []) as unknown as Raw[];
  if (f.view === "evidence") rows = rows.filter((r) => awaitingEvidence(r, r.bk_absence_files.length));
  const urls = await signedUrls([
    ...rows.flatMap((r) => r.bk_absence_files.map((x) => x.path)),
    ...rows.map((r) => r.signature_path).filter((p): p is string => !!p),
  ]);
  return rows.map(({ bk_students, bk_absence_files, ...r }) => ({
    ...r,
    student: bk_students,
    files: bk_absence_files.map(({ path, ...x }) => ({ ...x, url: urls.get(path) ?? null })),
    signatureUrl: r.signature_path ? urls.get(r.signature_path) ?? null : null,
  }));
}

// 처리할 공결 수 — 상단 '공결' 탭 배지. '처리할 공결' 목록(view=pending)과 같은 조건.
export async function countPendingAbsences(): Promise<number> {
  await requireBangkaAccess();
  const { count, error } = await supabaseAdmin
    .from("bk_absences")
    .select("id", { count: "exact", head: true })
    .in("status", ["submitted", "teacher_checked"]);
  if (error) return 0;
  return count ?? 0;
}

type StudentPick = { id: string; name: string; school: string | null; grade: string | null; school_class: string | null; class_code: string };
export async function listActiveStudents(): Promise<StudentPick[]> {
  await requireBangkaAccess();
  const { data, error } = await supabaseAdmin
    .from("bk_students")
    .select("id, name, school, grade, school_class, class_code")
    .eq("status", "active")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as StudentPick[];
}

// 증빙을 기다리는 건 수 — '증빙 대기' 묶음 숫자. 보호자 응답을 기다리는 것이라 처리할 공결 배지와 따로.
export async function countAwaitingEvidence(): Promise<number> {
  await requireBangkaAccess();
  const { data, error } = await supabaseAdmin
    .from("bk_absences")
    .select("status, evidence_requested_at, bk_absence_files(id)")
    .or(EVIDENCE_OR);
  if (error) return 0;
  type Raw = { status: AbsenceStatus; evidence_requested_at: string | null; bk_absence_files: { id: string }[] };
  return ((data ?? []) as unknown as Raw[]).filter((r) => awaitingEvidence(r, r.bk_absence_files.length)).length;
}

// 증빙이 하나라도 있는지 — 담임 확인·결재 전에 확인(DB 트리거와 같은 규칙, 문구를 친절하게).
async function hasEvidence(id: string): Promise<boolean> {
  const { count } = await supabaseAdmin.from("bk_absence_files").select("id", { count: "exact", head: true }).eq("absence_id", id);
  return (count ?? 0) > 0;
}
const NO_EVIDENCE = "증빙 서류가 없어 처리할 수 없습니다. 보호자가 앱에서 올리거나 [증빙 추가]로 올려 주세요.";

// 상태 바꾸기 — 현재 상태가 from 중 하나일 때만(동시 처리 방지).
async function transition(id: string, from: AbsenceStatus[], patch: Record<string, unknown>): Promise<void> {
  if (!UUID.test(id)) throw new Error("잘못된 요청입니다.");
  const { data, error } = await supabaseAdmin
    .from("bk_absences")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", from)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("이미 처리되었거나 상태가 바뀌었습니다. 새로고침 해 주세요.");
}

export async function teacherCheckAbsence(id: string): Promise<Result> {
  try {
    const me = await requireBangkaAccess();
    if (UUID.test(id) && !(await hasEvidence(id))) return { ok: false, message: NO_EVIDENCE };
    await transition(id, ["submitted"], { status: "teacher_checked", teacher_checked_by: me.name, teacher_checked_at: new Date().toISOString() });
    revalidatePath(BASE);
    return { ok: true };
  } catch (e) {
    return fail(e, "담임 확인을 저장하지 못했습니다.");
  }
}

export async function approveAbsence(id: string): Promise<Result> {
  try {
    const me = await requireBangkaAccess();
    if (!canApproveAbsence(me)) return { ok: false, message: "팀장 결재는 관장·부장 또는 방과후아카데미 팀장만 할 수 있습니다." };
    if (UUID.test(id) && !(await hasEvidence(id))) return { ok: false, message: NO_EVIDENCE };
    await transition(id, ["teacher_checked"], { status: "approved", approved_by: me.name, approved_at: new Date().toISOString(), reject_reason: null });
    revalidatePath(BASE);
    return { ok: true };
  } catch (e) {
    return fail(e, "결재를 저장하지 못했습니다.");
  }
}

// 반려 — 증빙 대기·신청 단계는 담당자 누구나, 담임 확인 뒤에는 결재권자만.
export async function rejectAbsence(id: string, reason: string): Promise<Result> {
  try {
    const me = await requireBangkaAccess();
    const why = (reason ?? "").trim().slice(0, 500);
    if (!why) return { ok: false, message: "반려 사유를 적어 주세요." };
    const from: AbsenceStatus[] = canApproveAbsence(me)
      ? ["evidence_pending", "submitted", "teacher_checked"]
      : ["evidence_pending", "submitted"];
    await transition(id, from, { status: "rejected", reject_reason: why, approved_by: me.name, approved_at: new Date().toISOString() });
    revalidatePath(BASE);
    return { ok: true };
  } catch (e) {
    return fail(e, "반려를 저장하지 못했습니다.");
  }
}

export async function createPhoneAbsence(input: {
  studentId: string;
  startDate: string;
  endDate: string;
  reasonType: string;
  reason: string;
}): Promise<Result<{ id: string }>> {
  try {
    const me = await requireBangkaAccess();
    if (!UUID.test(input.studentId)) return { ok: false, message: "학생을 고르세요." };
    if (!YMD.test(input.startDate) || !YMD.test(input.endDate)) return { ok: false, message: "기간을 고르세요." };
    if (input.endDate < input.startDate) return { ok: false, message: "끝나는 날이 시작일보다 앞입니다." };
    if (!isAbsenceReason(input.reasonType)) return { ok: false, message: "사유 구분을 고르세요." };
    const reason = (input.reason ?? "").trim().slice(0, 1000);
    if (input.reasonType === "other" && !reason) return { ok: false, message: "기타 사유를 적어 주세요." };
    const { data: st } = await supabaseAdmin.from("bk_students").select("id").eq("id", input.studentId).maybeSingle();
    if (!st) return { ok: false, message: "학생을 찾지 못했습니다." };
    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("bk_absences")
      .insert({
        student_id: input.studentId,
        start_date: input.startDate,
        end_date: input.endDate,
        reason_type: input.reasonType,
        reason: reason || null,
        confirmer_type: "teacher",
        confirmer_name: me.name,
        channel: "phone",
        received_by: me.name,
        // 서류를 받아야 담임 확인 → 결재로 갈 수 있음(관장 결정 2026-10-28). 보호자 앱에 "증빙 서류를 올려 주세요".
        status: "evidence_pending",
        evidence_requested_at: now,
        confirmed_on: kstTodayYmd(),
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "저장하지 못했습니다.");
    revalidatePath(BASE);
    return { ok: true, id: (data as { id: string }).id };
  } catch (e) {
    return fail(e, "전화 공결을 저장하지 못했습니다.");
  }
}

// 증빙 올리기(직원) — 사진은 tmp 로 올려 줄여서 absences/{id}/, PDF 는 바로 absences/{id}/.
export async function createAbsenceFileUpload(input: {
  absenceId: string;
  name: string;
  mime: string;
  size: number;
}): Promise<Result<{ path: string; token: string }>> {
  try {
    await requireBangkaAccess();
    if (!UUID.test(input.absenceId)) return { ok: false, message: "잘못된 요청입니다." };
    const kind = bkFileKind(input.name, input.mime);
    const isPdf = input.mime === "application/pdf" || extOf(input.name) === "pdf";
    if (kind !== "image" && !isPdf) return { ok: false, message: "사진 또는 PDF 만 올릴 수 있습니다." };
    if (input.size > ABSENCE_FILE_MAX) return { ok: false, message: "15MB 이하 파일만 올릴 수 있습니다." };
    const path = kind === "image" ? `tmp/${newObjectName(input.name, "jpg")}` : `absences/${input.absenceId}/${newObjectName(input.name, "pdf")}`;
    return { ok: true, ...(await signUpload(path)) };
  } catch (e) {
    return fail(e, "업로드를 준비하지 못했습니다.");
  }
}

export async function finalizeAbsenceFile(input: { absenceId: string; path: string; name: string; mime: string }): Promise<Result> {
  try {
    const me = await requireBangkaAccess();
    if (!UUID.test(input.absenceId)) return { ok: false, message: "잘못된 요청입니다." };
    let row: { path: string; mime: string; size: number };
    if (input.path.startsWith("tmp/")) {
      const img = await finalizeImage(input.path, `absences/${input.absenceId}`, input.mime);
      row = { path: img.path, mime: img.mime, size: img.bytes.length };
    } else {
      if (!new RegExp(`^absences/${input.absenceId}/[0-9a-f-]{36}\\.pdf$`).test(input.path)) return { ok: false, message: "업로드 경로가 올바르지 않습니다." };
      const st = await statObject(input.path);
      if (!st) return { ok: false, message: "올라간 파일을 찾지 못했습니다. 다시 올려 주세요." };
      row = { path: input.path, mime: "application/pdf", size: st.size };
    }
    const { error } = await supabaseAdmin
      .from("bk_absence_files")
      .insert({ absence_id: input.absenceId, name: input.name.slice(0, 200), uploaded_by: me.name, ...row });
    if (error) throw new Error(error.message);
    // 직원이 종이 서류를 대신 올린 경우 — 증빙 대기였으면 다음 단계(증빙 제출됨)로. 다른 상태는 그대로.
    await supabaseAdmin
      .from("bk_absences")
      .update({ status: "submitted", evidence_submitted_at: new Date().toISOString(), evidence_submitted_by: me.name, updated_at: new Date().toISOString() })
      .eq("id", input.absenceId)
      .eq("status", "evidence_pending");
    revalidatePath(BASE);
    return { ok: true };
  } catch (e) {
    return fail(e, "증빙을 저장하지 못했습니다.");
  }
}
