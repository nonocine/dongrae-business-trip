"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getSession } from "@/app/actions";
import {
  requireCertificateAccess,
  resolveCertificateAccess,
} from "@/lib/certificateAccess";
import {
  CERT_TYPES,
  CERT_STATEMENT,
  CERT_ORG,
  CERT_SEAL_PATH,
  calcServicePeriod,
  formatIssueLabel,
  toCertificateIssue,
  toCertRequest,
  type CertType,
  type CertSnapshot,
  type CertificateIssue,
  type CertRequest,
} from "@/lib/certificates";
import { buildCertificatePdf } from "@/lib/certificatePdf";
import { downloadHrImage } from "@/lib/recruitmentApplicantDocData";
import { kstTodayYmd } from "@/lib/trainings";

// 관인 바이트 로드(비공개 hr-documents, service_role). 없으면 null(발급은 계속).
async function loadSeal(): Promise<Uint8Array | null> {
  return downloadHrImage(CERT_SEAL_PATH);
}

// =====================================================================
// 증명서 발급 서버 액션 — /hr/certificates, /profile/hr
//   * 전부 service_role. certificate_issues RLS 0개 → 진입 시 권한 재검증.
//   * 채번: (해당 연도 max(issue_seq)+1). unique 충돌 시 재시도.
//   * 발급 시점 값을 snapshot 에 보존 → 재발급은 snapshot 그대로.
// =====================================================================

const TABLE = "certificate_issues";

type ProfileLite = {
  name: string;
  birth_date: string | null;
  address: string | null;
  join_date: string | null;
  employment_status: "active" | "resigned";
  resignation_date: string | null;
  department: string | null;
  duty: string | null;
};

// 최신 발령(effective_date 최대)에서 근무부서·직위 도출.
function pickAppointment(appointments: unknown): {
  department: string | null;
  title: string | null;
} {
  if (!Array.isArray(appointments) || appointments.length === 0)
    return { department: null, title: null };
  const sorted = [...appointments].sort((a, b) =>
    String((a as { effective_date?: string }).effective_date ?? "").localeCompare(
      String((b as { effective_date?: string }).effective_date ?? "")
    )
  );
  const last = sorted[sorted.length - 1] as {
    department?: string;
    title?: string;
  };
  return {
    department: last.department?.trim() || null,
    title: last.title?.trim() || null,
  };
}

async function loadProfile(driverId: string): Promise<ProfileLite | null> {
  const [{ data: driver }, { data: prof }] = await Promise.all([
    supabaseAdmin
      .from("drivers")
      .select("name, rank")
      .eq("id", driverId)
      .maybeSingle(),
    supabaseAdmin
      .from("employee_profiles")
      .select(
        "birth_date, address, join_date, employment_status, resignation_date, appointments"
      )
      .eq("driver_id", driverId)
      .maybeSingle(),
  ]);
  if (!driver) return null;
  const rank = ((driver as { rank?: string | null }).rank ?? "")?.trim() || null;
  const p = (prof ?? {}) as Record<string, unknown>;
  const appt = pickAppointment(p.appointments);
  return {
    name: String((driver as { name: string }).name),
    birth_date: (p.birth_date as string | null) ?? null,
    address: (p.address as string | null) ?? null,
    join_date: (p.join_date as string | null) ?? null,
    employment_status: p.employment_status === "resigned" ? "resigned" : "active",
    resignation_date: (p.resignation_date as string | null) ?? null,
    // 발령 부서 없으면 직책(rank)으로 폴백 — 관장·부장 등은 근무부서 칸에 직책 표기.
    department: appt.department ?? rank,
    duty: appt.title ?? rank,
  };
}

function cleanStr(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s.length > 0 ? s : null;
}

function buildSnapshot(input: {
  certType: CertType;
  year: number;
  seq: number;
  prof: ProfileLite;
  duty: string | null;
  from: string | null;
  to: string | null;
  purpose: string;
  issuedOn: string;
}): CertSnapshot {
  const { certType, year, seq, prof, duty, from, to, purpose, issuedOn } = input;
  const periodText = from ? calcServicePeriod(from, to, issuedOn) : "";
  return {
    certType,
    issueLabel: formatIssueLabel(year, seq),
    name: prof.name,
    birthDate: prof.birth_date,
    address: prof.address,
    department: prof.department,
    duty,
    periodFrom: from,
    periodTo: to,
    periodText,
    purpose,
    issuedOn,
    statement: CERT_STATEMENT[certType],
    org: CERT_ORG,
  };
}

function pdfFilename(snap: CertSnapshot): string {
  return `${CERT_TYPES[snap.certType]}_${snap.name}_${snap.issueLabel}.pdf`;
}

// 채번+insert(스냅샷 포함). unique(issue_year,issue_seq) 충돌 시 재시도.
async function insertWithNumber(base: {
  certType: CertType;
  year: number;
  driverId: string | null;
  name: string;
  purpose: string;
  issuedOn: string;
  issuedBy: string;
  makeSnapshot: (seq: number) => CertSnapshot;
}): Promise<{ id: string; seq: number; snapshot: CertSnapshot }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: maxRow } = await supabaseAdmin
      .from(TABLE)
      .select("issue_seq")
      .eq("issue_year", base.year)
      .order("issue_seq", { ascending: false })
      .limit(1)
      .maybeSingle();
    const seq = Number((maxRow as { issue_seq?: number } | null)?.issue_seq ?? 0) + 1;
    const snapshot = base.makeSnapshot(seq);
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .insert({
        issue_year: base.year,
        issue_seq: seq,
        cert_type: base.certType,
        driver_id: base.driverId,
        employee_name: base.name,
        purpose: base.purpose,
        issued_on: base.issuedOn,
        issued_by: base.issuedBy,
        snapshot,
      })
      .select("id")
      .single();
    if (!error) return { id: String((data as { id: string }).id), seq, snapshot };
    // 23505 = unique_violation → 다른 요청이 같은 seq 선점, 재시도.
    if (error.code !== "23505") throw new Error(error.message);
  }
  throw new Error("발급번호 채번에 실패했습니다. 잠시 후 다시 시도해주세요.");
}

export type IssueResult =
  | {
      ok: true;
      label: string;
      year: number;
      seq: number;
      filename: string;
      pdfBase64: string;
    }
  | { ok: false; message: string };

// 재직증명서 실제 발급(내부) — 승인 시 호출. 채번·snapshot·대장 insert.
async function issueEmployment(
  driverId: string,
  prof: ProfileLite,
  purpose: string,
  duty: string | null,
  issuedBy: string
): Promise<{ id: string; snapshot: CertSnapshot }> {
  const issuedOn = kstTodayYmd();
  const year = Number(issuedOn.slice(0, 4));
  const { id, snapshot } = await insertWithNumber({
    certType: "employment",
    year,
    driverId,
    name: prof.name,
    purpose,
    issuedOn,
    issuedBy,
    makeSnapshot: (s) =>
      buildSnapshot({
        certType: "employment",
        year,
        seq: s,
        prof,
        duty,
        from: prof.join_date,
        to: null, // 재직 → 현재
        purpose,
        issuedOn,
      }),
  });
  return { id, snapshot };
}

// 세션 직원의 driver_id 조회.
async function myDriverId(name: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("drivers")
    .select("id")
    .eq("name", name.trim())
    .maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

// --- 경력증명서 발급(관리자) — 퇴사자 포함 ----------------------------
export async function issueCareerCertificate(
  driverId: string,
  input: { purpose: string; duty: string; from?: string | null; to?: string | null }
): Promise<IssueResult> {
  try {
    const access = await requireCertificateAccess();
    if (!driverId) return { ok: false, message: "직원을 선택하세요." };

    const prof = await loadProfile(driverId);
    if (!prof) return { ok: false, message: "인사기록을 찾을 수 없습니다." };

    const purpose = cleanStr(input.purpose) ?? "서류제출용";
    const duty = cleanStr(input.duty) ?? prof.duty;
    const from = cleanStr(input.from) ?? prof.join_date;
    // to 미지정: 퇴사자는 퇴사일, 재직자는 현재(null).
    const to =
      input.to === undefined
        ? prof.resignation_date
        : cleanStr(input.to);
    const issuedOn = kstTodayYmd();
    const year = Number(issuedOn.slice(0, 4));

    const { seq, snapshot } = await insertWithNumber({
      certType: "career",
      year,
      driverId,
      name: prof.name,
      purpose,
      issuedOn,
      issuedBy: access.name,
      makeSnapshot: (s) =>
        buildSnapshot({
          certType: "career",
          year,
          seq: s,
          prof,
          duty,
          from,
          to,
          purpose,
          issuedOn,
        }),
    });

    const pdf = await buildCertificatePdf(snapshot, await loadSeal());
    revalidatePath("/hr/certificates");
    return {
      ok: true,
      label: snapshot.issueLabel,
      year,
      seq,
      filename: pdfFilename(snapshot),
      pdfBase64: Buffer.from(pdf).toString("base64"),
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "발급 중 오류가 발생했습니다.",
    };
  }
}

// 경력증명서 발급 대상 직원 목록(관리자) — 퇴사자 포함, 퇴사자 우선 정렬.
export type CertEmployee = {
  driverId: string;
  name: string;
  rank: string | null;
  status: "active" | "resigned";
  joinDate: string | null;
  resignationDate: string | null;
  defaultDuty: string | null;
};

export async function listCertificateEmployees(): Promise<CertEmployee[]> {
  await requireCertificateAccess();
  const [{ data: drivers }, { data: profs }] = await Promise.all([
    supabaseAdmin.from("drivers").select("id, name, rank"),
    supabaseAdmin
      .from("employee_profiles")
      .select("driver_id, join_date, employment_status, resignation_date, appointments"),
  ]);
  const pByD = new Map<string, Record<string, unknown>>();
  for (const p of profs ?? [])
    pByD.set(String((p as Record<string, unknown>).driver_id), p as Record<string, unknown>);

  const list: CertEmployee[] = [];
  for (const d of drivers ?? []) {
    const dd = d as Record<string, unknown>;
    const id = String(dd.id);
    const p = pByD.get(id);
    const appt = pickAppointment(p?.appointments);
    list.push({
      driverId: id,
      name: String(dd.name ?? ""),
      rank: (dd.rank as string | null) ?? null,
      status: p?.employment_status === "resigned" ? "resigned" : "active",
      joinDate: (p?.join_date as string | null) ?? null,
      resignationDate: (p?.resignation_date as string | null) ?? null,
      defaultDuty: appt.title,
    });
  }
  // 퇴사자 우선 → 이름.
  list.sort((a, b) => {
    if (a.status !== b.status) return a.status === "resigned" ? -1 : 1;
    return a.name.localeCompare(b.name, "ko");
  });
  return list;
}

// --- 발급대장 목록(관리자) -------------------------------------------
export async function listCertificates(
  year?: number
): Promise<CertificateIssue[]> {
  await requireCertificateAccess();
  let query = supabaseAdmin.from(TABLE).select("*");
  if (year) query = query.eq("issue_year", year);
  const { data, error } = await query
    .order("issue_year", { ascending: false })
    .order("issue_seq", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => toCertificateIssue(r as Record<string, unknown>));
}

// 본인 발급 이력(마이페이지) — 본인 driver_id 건만.
export async function listMyCertificates(): Promise<CertificateIssue[]> {
  const me = await getSession();
  if (!me || me.kind !== "employee" || !me.name.trim()) return [];
  const { data: driver } = await supabaseAdmin
    .from("drivers")
    .select("id")
    .eq("name", me.name.trim())
    .maybeSingle();
  const driverId = (driver as { id?: string } | null)?.id ?? null;
  if (!driverId) return [];
  const { data } = await supabaseAdmin
    .from(TABLE)
    .select("*")
    .eq("driver_id", driverId)
    .order("issue_seq", { ascending: false });
  return (data ?? []).map((r) => toCertificateIssue(r as Record<string, unknown>));
}

// 마이페이지 셀프 발급 프리필 — 발급 가능 여부 + 직위/담당업무 기본값.
//   * 기본값: 최근 발급 snapshot.duty 우선, 없으면 프로필(최신 발령) 직위.
export async function getMyCertificatePrefill(): Promise<{
  canIssue: boolean;
  defaultDuty: string;
  name: string;
} | null> {
  const me = await getSession();
  if (!me || me.kind !== "employee" || !me.name.trim()) return null;
  const { data: driver } = await supabaseAdmin
    .from("drivers")
    .select("id")
    .eq("name", me.name.trim())
    .maybeSingle();
  const driverId = (driver as { id?: string } | null)?.id ?? null;
  if (!driverId) return null;
  const prof = await loadProfile(driverId);
  if (!prof) return null;

  const { data: last } = await supabaseAdmin
    .from(TABLE)
    .select("snapshot")
    .eq("driver_id", driverId)
    .order("issue_seq", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastDuty =
    ((last as { snapshot?: CertSnapshot } | null)?.snapshot?.duty) ?? null;

  return {
    canIssue: prof.employment_status === "active",
    defaultDuty: lastDuty ?? prof.duty ?? "",
    name: prof.name,
  };
}

// =====================================================================
// 재직증명서 승인제 — 직원 신청(certificate_requests) → M0 승인 시 발급.
//   * 경력증명서(관리자 직접 발급)는 승인 절차 없음(현행 유지).
// =====================================================================
const REQ_TABLE = "certificate_requests";

// 본인 재직증명서 신청(pending). 재직자만, 중복 pending 차단.
export async function requestMyCertificate(input: {
  purpose: string;
  duty: string;
}): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  try {
    const me = await getSession();
    if (!me || me.kind !== "employee" || !me.name.trim())
      return { ok: false, message: "로그인이 필요합니다." };
    const driverId = await myDriverId(me.name);
    if (!driverId) return { ok: false, message: "직원 정보를 찾을 수 없습니다." };
    const prof = await loadProfile(driverId);
    if (!prof) return { ok: false, message: "인사기록을 찾을 수 없습니다." };
    if (prof.employment_status === "resigned")
      return { ok: false, message: "재직 중인 직원만 신청할 수 있습니다." };

    // 중복 pending 차단.
    const { data: dup } = await supabaseAdmin
      .from(REQ_TABLE)
      .select("id")
      .eq("driver_id", driverId)
      .eq("cert_type", "employment")
      .eq("status", "pending")
      .maybeSingle();
    if (dup)
      return {
        ok: false,
        message: "이미 승인 대기 중인 신청이 있습니다. 승인 후 다시 신청하세요.",
      };

    const purpose = cleanStr(input.purpose) ?? "서류제출용";
    const duty = cleanStr(input.duty) ?? prof.duty;
    const { error } = await supabaseAdmin.from(REQ_TABLE).insert({
      driver_id: driverId,
      employee_name: prof.name,
      cert_type: "employment",
      purpose,
      duty,
      status: "pending",
      requested_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    revalidatePath("/profile/hr");
    revalidatePath("/hr/certificates");
    return { ok: true, message: "재직증명서 발급을 신청했습니다. 승인 후 발급됩니다." };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "신청 중 오류가 발생했습니다.",
    };
  }
}

// 본인 신청 현황(마이페이지).
export async function listMyRequests(): Promise<CertRequest[]> {
  const me = await getSession();
  if (!me || me.kind !== "employee" || !me.name.trim()) return [];
  const driverId = await myDriverId(me.name);
  if (!driverId) return [];
  const { data } = await supabaseAdmin
    .from(REQ_TABLE)
    .select("*")
    .eq("driver_id", driverId)
    .order("requested_at", { ascending: false });
  return (data ?? []).map((r) => toCertRequest(r as Record<string, unknown>));
}

// 승인 대기 목록(관리자 — M0/hr 열람).
export async function listPendingRequests(): Promise<CertRequest[]> {
  await requireCertificateAccess();
  const { data, error } = await supabaseAdmin
    .from(REQ_TABLE)
    .select("*")
    .eq("status", "pending")
    .order("requested_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => toCertRequest(r as Record<string, unknown>));
}

// 대시보드 배지용 — 대기 건수(접근 불가 시 0).
export async function getPendingCertRequestCount(): Promise<number> {
  const access = await resolveCertificateAccess();
  if (!access) return 0;
  const { count } = await supabaseAdmin
    .from(REQ_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return count ?? 0;
}

// 승인 — M0만. 승인 시점에 채번·발급·대장 기록 후 issue_id 연결.
export async function approveRequest(
  id: string
): Promise<{ ok: true; label: string } | { ok: false; message: string }> {
  try {
    const access = await requireCertificateAccess();
    if (!access.isM0)
      return { ok: false, message: "승인은 관장·부장만 할 수 있습니다." };
    if (!id) return { ok: false, message: "대상이 없습니다." };

    const { data: reqRow, error: reqErr } = await supabaseAdmin
      .from(REQ_TABLE)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (reqErr) throw new Error(reqErr.message);
    if (!reqRow) return { ok: false, message: "신청을 찾을 수 없습니다." };
    const req = toCertRequest(reqRow as Record<string, unknown>);
    if (req.status !== "pending")
      return { ok: false, message: "이미 처리된 신청입니다." };
    if (!req.driver_id) return { ok: false, message: "신청자 정보가 없습니다." };

    const prof = await loadProfile(req.driver_id);
    if (!prof) return { ok: false, message: "신청자 인사기록을 찾을 수 없습니다." };

    const { id: issueId, snapshot } = await issueEmployment(
      req.driver_id,
      prof,
      req.purpose,
      req.duty,
      access.name
    );

    const { error: upErr } = await supabaseAdmin
      .from(REQ_TABLE)
      .update({
        status: "approved",
        decided_at: new Date().toISOString(),
        decided_by: access.name,
        issue_id: issueId,
      })
      .eq("id", id)
      .eq("status", "pending"); // 동시 승인 방지
    if (upErr) throw new Error(upErr.message);

    revalidatePath("/hr/certificates");
    revalidatePath("/profile/hr");
    return { ok: true, label: snapshot.issueLabel };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "승인 중 오류가 발생했습니다.",
    };
  }
}

// 반려 — M0만. 사유 기록.
export async function rejectRequest(
  id: string,
  reason: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const access = await requireCertificateAccess();
    if (!access.isM0)
      return { ok: false, message: "반려는 관장·부장만 할 수 있습니다." };
    if (!id) return { ok: false, message: "대상이 없습니다." };
    const r = cleanStr(reason);
    if (!r) return { ok: false, message: "반려 사유를 입력하세요." };

    const { error } = await supabaseAdmin
      .from(REQ_TABLE)
      .update({
        status: "rejected",
        reject_reason: r,
        decided_at: new Date().toISOString(),
        decided_by: access.name,
      })
      .eq("id", id)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    revalidatePath("/hr/certificates");
    revalidatePath("/profile/hr");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "반려 중 오류가 발생했습니다.",
    };
  }
}

// 저장 스냅샷 → PDF용 CertSnapshot 정규화.
//   * 신형(내 발급): 그대로 사용(org.name 에 전화번호 없음 → 기관명 전화 미표기).
//   * 구형(수기 이관 9건): {근무기간·근무부서·직위및담당업무} Korean 키 → 매핑.
//     기관 정보·증명문구는 현재 상수(CERT_ORG/CERT_STATEMENT)로 채워 재발급 가능케.
function pdfSnapshotFromRecord(rec: CertificateIssue): CertSnapshot | null {
  const s = rec.snapshot as Record<string, unknown> | null;
  if (!s) return null;
  // 신형 판별 — certType 키 존재.
  if (typeof (s as { certType?: unknown }).certType === "string") {
    return s as unknown as CertSnapshot;
  }
  // 구형(수기 이관) 매핑.
  const rawPeriod = String((s["근무기간"] as string) ?? "");
  const [f, t] = rawPeriod.split("~").map((x) => x.trim());
  return {
    certType: rec.cert_type,
    issueLabel: formatIssueLabel(rec.issue_year, rec.issue_seq),
    name: rec.employee_name,
    birthDate: null,
    address: null,
    department: (s["근무부서"] as string | null) ?? null,
    duty: (s["직위및담당업무"] as string | null) ?? null,
    periodFrom: f || null,
    periodTo: !t || t === "현재" ? null : t,
    periodText: "", // 구형엔 년·개월 없음 → 기간 칸 비움
    purpose: rec.purpose,
    issuedOn: rec.issued_on ?? "",
    statement: CERT_STATEMENT[rec.cert_type],
    org: CERT_ORG,
  };
}

// --- 재발급(snapshot 그대로) — 대장에 새 행 만들지 않음 ----------------
export type ReissueResult =
  | { ok: true; filename: string; pdfBase64: string }
  | { ok: false; message: string };

export async function reissuePdf(id: string): Promise<ReissueResult> {
  try {
    if (!id) return { ok: false, message: "대상이 없습니다." };
    const me = await getSession();
    if (!me || me.kind !== "employee")
      return { ok: false, message: "로그인이 필요합니다." };

    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { ok: false, message: "발급 기록을 찾을 수 없습니다." };
    const rec = toCertificateIssue(data as Record<string, unknown>);
    const snapshot = pdfSnapshotFromRecord(rec);
    if (!snapshot)
      return { ok: false, message: "재발급에 필요한 정보(snapshot)가 없습니다." };

    // 권한: 관리자(M0/hr) 또는 본인 것.
    const access = await resolveOwnershipOrAdmin(rec.driver_id, me.name.trim());
    if (!access) return { ok: false, message: "재발급 권한이 없습니다." };

    const pdf = await buildCertificatePdf(snapshot, await loadSeal());
    return {
      ok: true,
      filename: pdfFilename(snapshot),
      pdfBase64: Buffer.from(pdf).toString("base64"),
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "재발급 중 오류가 발생했습니다.",
    };
  }
}

// 본인 소유이거나 관리자면 true. (재발급 권한)
async function resolveOwnershipOrAdmin(
  ownerDriverId: string | null,
  myName: string
): Promise<boolean> {
  const { resolveCertificateAccess } = await import("@/lib/certificateAccess");
  const admin = await resolveCertificateAccess();
  if (admin) return true;
  if (!ownerDriverId) return false;
  const { data: driver } = await supabaseAdmin
    .from("drivers")
    .select("id")
    .eq("name", myName)
    .maybeSingle();
  const myId = (driver as { id?: string } | null)?.id ?? null;
  return !!myId && myId === ownerDriverId;
}
