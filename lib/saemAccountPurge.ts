// =====================================================================
// 동래샘들 계정 '완전 삭제' — 사전 점검 + 삭제 (관장 요청 2026-10)
//
//   왜: [제거]는 역할만 지우고 계정(saem_instructors)을 남겨, 같은 전화번호로
//   재가입이 막혔습니다(박동원 건). 완전 삭제는 계정 행을 지워 전화번호를 풉니다.
//
//   세 동작은 서로 다릅니다.
//     · 중지      = 역할만 잠시 끔(되돌릴 수 있음)          — lib/saemRoles
//     · 제거      = 역할 삭제(계정은 남음)                   — removeClubTeacher
//     · 완전 삭제 = 계정까지 삭제(전화번호가 풀려 재가입 가능) — 이 모듈
//
//   DB 외래키가 이미 안전장치입니다(규칙은 바꾸지 않습니다).
//     saem_member_roles · saem_instructor_documents → CASCADE(함께 삭제)
//     saem_programs                                 → SET NULL(담당자만 비워짐)
//     saem_settlement_items · saem_lecture_certificates → NO ACTION(삭제 거부)
//   그래서 정산·강의확인증이 있으면 화면에서 먼저 막고, 혹시 사이에 생겨도
//   DB 가 거부합니다 — 그 사유는 그대로 사용자에게 돌려줍니다.
//
//   ★ 직원 계정은 지우지 않습니다. saem_instructors 에는 drivers 를 가리키는
//     컬럼이 없어, 전화번호(숫자만) 가 인사기록카드(employee_profiles.phone)와
//     같거나 이름이 drivers.name 과 같으면 직원으로 봅니다(재직·퇴사 모두).
//     2026-10 기준 11명이 걸립니다(전화 일치 10 + 이름만 일치 1 = 관장).
//     동명이인 외부 강사가 있으면 함께 막히는데, 지우는 쪽보다 안전한 오판입니다.
//
//   ★ 파일: 계정의 Storage 파일은 모두 hr-documents/instructors/{id}/ 아래에
//     있습니다(서류·이력서 PDF·이력서 사진). 서명은 DB 컬럼(signature_data)이라
//     행과 함께 사라집니다. 행 삭제가 성공한 뒤에만 폴더를 비웁니다 — 먼저 지웠다가
//     DB 가 거부하면 파일만 날아가기 때문입니다.
//
//   서버 전용. 권한 확인은 호출하는 액션이 합니다(M0 전용).
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { HR_DOCUMENTS_BUCKET } from "@/lib/supabase";
import { sendSlack } from "@/lib/slack";

const INSTR = "saem_instructors";

export type PurgeProgram = { name: string; type: string; status: string };

export type PurgeInspection = {
  id: string;
  name: string;
  phone: string | null;
  staff: { name: string; by: "phone" | "name" } | null; // 직원 계정이면 삭제 불가
  settlements: number; // saem_settlement_items
  lectureCerts: number; // saem_lecture_certificates
  programs: PurgeProgram[]; // 담당 프로그램(삭제 시 담당자 비워짐)
  sessions: number; // 담당 프로그램의 활동 회차
  submittedSessions: number; // 그중 강사가 제출(서명)한 회차
  docs: number; // 첨부서류(함께 삭제)
  files: number; // Storage 파일(함께 삭제)
  roles: string[];
  blocked: string | null; // 삭제 불가 사유(없으면 null)
};

const digits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

async function storagePaths(id: string): Promise<string[]> {
  const prefix = `instructors/${id}`;
  const { data, error } = await supabaseAdmin.storage
    .from(HR_DOCUMENTS_BUCKET)
    .list(prefix, { limit: 1000 });
  if (error) throw new Error(`파일 목록 조회 실패: ${error.message}`);
  return (data ?? []).filter((o) => o.name).map((o) => `${prefix}/${o.name}`);
}

async function findStaff(
  name: string,
  phone: string | null
): Promise<PurgeInspection["staff"]> {
  const p = digits(phone);
  if (p.length >= 9) {
    const { data: profs } = await supabaseAdmin
      .from("employee_profiles")
      .select("driver_id, phone")
      .not("phone", "is", null);
    const hit = (profs ?? []).find((r) => digits((r as { phone: string }).phone) === p);
    if (hit) {
      const { data: d } = await supabaseAdmin
        .from("drivers")
        .select("name")
        .eq("id", (hit as { driver_id: string }).driver_id)
        .maybeSingle();
      return { name: String((d as { name?: string } | null)?.name ?? name), by: "phone" };
    }
  }
  if (name.trim()) {
    const { data: d } = await supabaseAdmin
      .from("drivers")
      .select("name")
      .eq("name", name.trim())
      .maybeSingle();
    if (d) return { name: name.trim(), by: "name" };
  }
  return null;
}

export async function inspectSaemAccount(id: string): Promise<PurgeInspection | null> {
  if (!id) return null;
  const { data: ins, error } = await supabaseAdmin
    .from(INSTR)
    .select("id, name, phone")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!ins) return null;
  const name = String((ins as { name: string }).name ?? "");
  const phone = ((ins as { phone: string | null }).phone ?? null) as string | null;

  const count = async (table: string) => {
    const { count: n, error: e } = await supabaseAdmin
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("instructor_id", id);
    if (e) throw new Error(`${table} 집계 실패: ${e.message}`);
    return n ?? 0;
  };

  const [staff, settlements, lectureCerts, docs, progRes, roleRes, files] = await Promise.all([
    findStaff(name, phone),
    count("saem_settlement_items"),
    count("saem_lecture_certificates"),
    count("saem_instructor_documents"),
    supabaseAdmin.from("saem_programs").select("id, name, program_type, status").eq("instructor_id", id),
    supabaseAdmin.from("saem_member_roles").select("role").eq("instructor_id", id),
    storagePaths(id),
  ]);
  if (progRes.error) throw new Error(progRes.error.message);
  const progRows = (progRes.data ?? []) as {
    id: string;
    name: string;
    program_type: string | null;
    status: string | null;
  }[];

  let sessions = 0;
  let submittedSessions = 0;
  if (progRows.length) {
    const ids = progRows.map((p) => p.id);
    const [all, sub] = await Promise.all([
      supabaseAdmin.from("saem_sessions").select("id", { count: "exact", head: true }).in("program_id", ids),
      supabaseAdmin
        .from("saem_sessions")
        .select("id", { count: "exact", head: true })
        .in("program_id", ids)
        .not("instructor_submitted_at", "is", null),
    ]);
    sessions = all.count ?? 0;
    submittedSessions = sub.count ?? 0;
  }

  let blocked: string | null = null;
  if (staff) {
    blocked = `직원 계정입니다(${staff.by === "phone" ? "전화번호가 인사기록카드와 일치" : "이름이 직원과 일치"} — ${staff.name}). 직원 계정은 완전 삭제할 수 없습니다. 역할 중지·제거를 사용하세요.`;
  } else if (settlements > 0 && lectureCerts > 0) {
    blocked = `정산 내역(${settlements}건)과 강의확인증(${lectureCerts}건)이 있어 삭제할 수 없습니다. 역할 제거를 사용하세요.`;
  } else if (settlements > 0) {
    blocked = `정산 내역이 있어 삭제할 수 없습니다(${settlements}건). 역할 제거를 사용하세요.`;
  } else if (lectureCerts > 0) {
    blocked = `강의확인증이 있어 삭제할 수 없습니다(${lectureCerts}건). 역할 제거를 사용하세요.`;
  }

  return {
    id,
    name,
    phone,
    staff,
    settlements,
    lectureCerts,
    programs: progRows.map((p) => ({
      name: p.name,
      type: p.program_type ?? "",
      status: p.status ?? "",
    })),
    sessions,
    submittedSessions,
    docs,
    files: files.length,
    roles: ((roleRes.data ?? []) as { role: string }[]).map((r) => r.role),
    blocked,
  };
}

export type PurgeResult =
  | {
      ok: true;
      name: string;
      programsCleared: number;
      filesRemoved: number;
      fileWarning: string | null;
    }
  | { ok: false; message: string; inspection?: PurgeInspection };

// 외래키 거부(23503)를 사람이 읽는 말로. 원문도 함께 남깁니다.
function explainDbError(e: { code?: string; message: string; details?: string | null }): string {
  if (e.code === "23503") {
    const where = `${e.message} ${e.details ?? ""}`;
    const what = where.includes("settlement")
      ? "정산 내역"
      : where.includes("lecture_certificate")
        ? "강의확인증"
        : "연결된 기록";
    return `${what}이 연결되어 있어 데이터베이스가 삭제를 거부했습니다. 역할 제거를 사용하세요. (DB: ${e.message})`;
  }
  return `삭제 실패: ${e.message}`;
}

export async function purgeSaemAccount(input: {
  id: string;
  confirmName: string;
  acceptProgramUnassign: boolean;
  actor: string;
}): Promise<PurgeResult> {
  const before = await inspectSaemAccount(input.id);
  if (!before) return { ok: false, message: "계정을 찾을 수 없습니다. (이미 삭제되었을 수 있습니다)" };
  // 서버에서 다시 판정합니다 — 화면 판정만 믿지 않습니다.
  if (before.blocked) return { ok: false, message: before.blocked, inspection: before };
  if (input.confirmName.trim() !== before.name.trim()) {
    return { ok: false, message: "이름이 일치하지 않습니다.", inspection: before };
  }
  if (before.programs.length > 0 && !input.acceptProgramUnassign) {
    return {
      ok: false,
      message: "담당 프로그램이 있습니다. 담당자가 비워지는 것을 확인해주세요.",
      inspection: before,
    };
  }

  // 파일 목록은 지우기 직전에 다시 읽습니다(점검 이후 올라온 파일까지).
  const paths = await storagePaths(input.id);

  const { error, count } = await supabaseAdmin
    .from(INSTR)
    .delete({ count: "exact" })
    .eq("id", input.id);
  if (error) {
    return {
      ok: false,
      message: explainDbError(error as { code?: string; message: string; details?: string | null }),
      inspection: before,
    };
  }
  if (!count) return { ok: false, message: "삭제된 행이 없습니다. 새로고침 후 다시 확인해주세요." };

  // 행이 지워진 뒤에만 파일 정리. 실패해도 계정 삭제는 이미 끝났으므로 경고로 돌려줍니다.
  let filesRemoved = 0;
  let fileWarning: string | null = null;
  if (paths.length) {
    const { data, error: rmErr } = await supabaseAdmin.storage.from(HR_DOCUMENTS_BUCKET).remove(paths);
    filesRemoved = data?.length ?? 0;
    if (rmErr || filesRemoved < paths.length) {
      fileWarning = `파일 ${paths.length - filesRemoved}개를 지우지 못했습니다(hr-documents/instructors/${input.id}/). ${rmErr?.message ?? ""}`.trim();
      console.warn(`[saem-purge] ${fileWarning}`);
    }
  }

  // 삭제 기록 — 감사 로그 테이블이 없어 관리자 채널 + 서버 로그로 남깁니다(새 테이블 금지 지시).
  //   개인정보(전화번호 전체)는 넣지 않고 뒤 4자리만.
  const tail = digits(before.phone).slice(-4);
  const line =
    `🗑️ 동래샘들 계정 완전 삭제 — ${before.name}${tail ? `(…${tail})` : ""} · 삭제자 ${input.actor} · ` +
    `${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}\n` +
    `역할 ${before.roles.join(",") || "없음"} · 담당 프로그램 ${before.programs.length}개 담당자 비움 · ` +
    `회차 ${before.sessions}건 · 첨부서류 ${before.docs}개 · 파일 ${filesRemoved}/${paths.length}개 삭제` +
    (fileWarning ? `\n⚠️ ${fileWarning}` : "");
  console.info(`[saem-purge] ${line.replace(/\n/g, " | ")}`);
  try {
    await sendSlack("SLACK_WEBHOOK_ADMIN", line);
  } catch {
    /* 알림 격리 — 삭제 결과에 영향 없음 */
  }

  return {
    ok: true,
    name: before.name,
    programsCleared: before.programs.length,
    filesRemoved,
    fileWarning,
  };
}
