"use server";

// =====================================================================
// 강의확인증 발급대장 — 담당자(동업자씨) 측 검토·수정·승인/반려. (2부-a)
//   * 흐름: 강사가 동래샘들에서 신청(status=pending, 발급번호 채번 완료)
//           → 여기서 담당자가 내용 검토·수정 후 승인/반려
//           → 승인된 건만 강사가 1회 출력(printed_at 기록 — 2부-b).
//   * 발급번호(cert_year·cert_no)는 신청 때 정해진다. 여기서 부여·변경하지 않는다.
//   * 수정은 pending 일 때만. 승인·반려된 건은 잠근다(되돌리기는 아직 없음).
//   * ⚠️ 주민번호는 신청 데이터에 없다(컬럼 자체가 없음). 읽지도 쓰지도 않는다.
//   * saem_lecture_certificates 는 RLS 0개 → service_role 경유.
//     requireSaemAccess 가 유일한 방어선이다.
// =====================================================================

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireSaemAccess } from "@/lib/saemAccess";
import { normalizeCertStatus, type CertStatus } from "@/lib/saem";
import { fmtKstDate } from "@/lib/datetime";

const CERT = "saem_lecture_certificates";
const INSTR = "saem_instructors";

export type LectureCertRow = {
  id: string;
  certYear: number | null;
  certNo: number | null;
  applicantName: string;
  instructorName: string; // 강사 명부상 이름(신청서의 성명과 다를 수 있다)
  address: string;
  lectureContent: string;
  lecturePeriod: string;
  status: CertStatus;
  rejectReason: string;
  reviewedBy: string;
  // 화면에 그대로 찍는 KST 날짜 문자열. 클라이언트에서 Date 를 쓰면 하이드레이션이
  //   어긋나므로(서버=UTC, 브라우저=로컬) 서버에서 미리 만들어 보낸다.
  requestedOn: string; // 요청일자(created_at)
  reviewedOn: string; // 검토일자(reviewed_at) — 없으면 ""
  printedOn: string; // 출력일자(printed_at) — 없으면 ""
};

type Result = { ok: true } | { ok: false; message: string };

// timestamptz → KST "YYYY.MM.DD". 값이 없으면 "" (화면에서 "-" 로 대체).
//   lib/datetime 의 결정적 포맷터를 쓴다 — toLocaleString 은 서버·브라우저 ICU 차이로
//   하이드레이션이 어긋난다(e2e/README 참고).
function kstDate(ts: string | null): string {
  if (!ts) return "";
  const s = fmtKstDate(ts);
  return s === "-" ? "" : s;
}

function toRow(r: Record<string, unknown>, instrName: string): LectureCertRow {
  const s = (v: unknown) => (v == null ? "" : String(v));
  const n = (v: unknown) => (v == null ? null : Number(v));
  return {
    id: s(r.id),
    certYear: n(r.cert_year),
    certNo: n(r.cert_no),
    applicantName: s(r.applicant_name),
    instructorName: instrName,
    address: s(r.address),
    lectureContent: s(r.lecture_content),
    lecturePeriod: s(r.lecture_period),
    status: normalizeCertStatus(r.status),
    rejectReason: s(r.reject_reason),
    reviewedBy: s(r.reviewed_by),
    requestedOn: kstDate(s(r.created_at) || null),
    reviewedOn: kstDate(s(r.reviewed_at) || null),
    printedOn: kstDate(s(r.printed_at) || null),
  };
}

// 발급대장 전체. 신청중을 먼저, 그 안에서 최신순 —
//   담당자가 열었을 때 처리할 것이 맨 위에 오는 게 이 화면의 목적이다.
const STATUS_ORDER: Record<CertStatus, number> = {
  pending: 0,
  rejected: 1,
  approved: 2,
};

export async function listLectureCertificates(): Promise<LectureCertRow[]> {
  await requireSaemAccess();
  const { data } = await supabaseAdmin
    .from(CERT)
    .select(
      "id, instructor_id, cert_year, cert_no, applicant_name, address, lecture_content, lecture_period, status, reject_reason, reviewed_by, reviewed_at, printed_at, created_at"
    )
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return [];

  // 강사 이름은 명부에서 따로 읽는다(신청서의 성명이 바뀌어도 누구 건지 알 수 있게).
  const ids = [
    ...new Set(rows.map((r) => String(r.instructor_id ?? "")).filter(Boolean)),
  ];
  const nameById = new Map<string, string>();
  if (ids.length) {
    const { data: instrs } = await supabaseAdmin
      .from(INSTR)
      .select("id, name")
      .in("id", ids);
    for (const i of instrs ?? []) {
      const r = i as { id: string; name: string | null };
      nameById.set(String(r.id), String(r.name ?? ""));
    }
  }

  // 상태로만 재정렬한다 — 쿼리가 이미 created_at 내림차순이고 Array#sort 는 안정
  //   정렬이므로, 각 상태 묶음 안에서는 최신순이 그대로 유지된다.
  return rows
    .map((r) => toRow(r, nameById.get(String(r.instructor_id ?? "")) ?? ""))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
}

// 현재 상태를 읽어 잠금 여부를 판단한다(목록이 오래됐을 수 있으므로 서버에서 다시 본다).
async function currentStatus(id: string): Promise<CertStatus | null> {
  const { data } = await supabaseAdmin
    .from(CERT)
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return normalizeCertStatus((data as { status: unknown }).status);
}

// 담당자 수정 — pending 일 때만. 발급번호·상태·강사는 건드리지 않는다.
export async function updateLectureCertificate(
  id: string,
  fields: {
    applicantName: string;
    address: string;
    lectureContent: string;
    lecturePeriod: string;
  }
): Promise<Result> {
  try {
    await requireSaemAccess();
    if (!id) return { ok: false, message: "대상이 없습니다." };

    const applicantName = (fields.applicantName ?? "").trim();
    const lectureContent = (fields.lectureContent ?? "").trim();
    if (!applicantName) return { ok: false, message: "성명을 입력하세요." };
    if (!lectureContent) return { ok: false, message: "강의내용을 입력하세요." };

    const st = await currentStatus(id);
    if (st == null) return { ok: false, message: "신청을 찾을 수 없습니다." };
    if (st !== "pending")
      return {
        ok: false,
        message: "이미 처리된 신청입니다. 신청중일 때만 수정할 수 있습니다.",
      };

    const { error } = await supabaseAdmin
      .from(CERT)
      .update({
        applicant_name: applicantName,
        address: (fields.address ?? "").trim() || null,
        lecture_content: lectureContent,
        lecture_period: (fields.lecturePeriod ?? "").trim() || null,
      })
      .eq("id", id)
      .eq("status", "pending"); // 검토하는 사이 처리됐다면 덮어쓰지 않는다
    if (error) throw new Error(error.message);

    revalidatePath("/hr/saems/certificates");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "수정 중 오류가 발생했습니다.",
    };
  }
}

export async function approveLectureCertificate(id: string): Promise<Result> {
  try {
    const access = await requireSaemAccess();
    if (!id) return { ok: false, message: "대상이 없습니다." };

    const st = await currentStatus(id);
    if (st == null) return { ok: false, message: "신청을 찾을 수 없습니다." };
    if (st !== "pending")
      return { ok: false, message: "신청중인 건만 승인할 수 있습니다." };

    const { data, error } = await supabaseAdmin
      .from(CERT)
      .update({
        status: "approved",
        reject_reason: null, // 반려 흔적이 남아 있으면 지운다
        reviewed_by: access.name,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "pending")
      .select("id");
    if (error) throw new Error(error.message);
    if ((data ?? []).length === 0)
      return { ok: false, message: "이미 처리된 신청입니다." };

    revalidatePath("/hr/saems/certificates");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "승인 중 오류가 발생했습니다.",
    };
  }
}

export async function rejectLectureCertificate(
  id: string,
  reason: string
): Promise<Result> {
  try {
    const access = await requireSaemAccess();
    if (!id) return { ok: false, message: "대상이 없습니다." };
    // 반려는 강사가 다시 신청해야 하는 결정이다 — 사유 없이 되돌려보내지 않는다.
    const why = (reason ?? "").trim();
    if (!why) return { ok: false, message: "반려 사유를 입력하세요." };

    const st = await currentStatus(id);
    if (st == null) return { ok: false, message: "신청을 찾을 수 없습니다." };
    if (st !== "pending")
      return { ok: false, message: "신청중인 건만 반려할 수 있습니다." };

    const { data, error } = await supabaseAdmin
      .from(CERT)
      .update({
        status: "rejected",
        reject_reason: why,
        reviewed_by: access.name,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "pending")
      .select("id");
    if (error) throw new Error(error.message);
    if ((data ?? []).length === 0)
      return { ok: false, message: "이미 처리된 신청입니다." };

    revalidatePath("/hr/saems/certificates");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "반려 중 오류가 발생했습니다.",
    };
  }
}
