"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getSession } from "@/app/actions";
import { requireCertificateAccess } from "@/lib/certificateAccess";
import {
  CERT_TYPES,
  CERT_STATEMENT,
  CERT_ORG,
  calcServicePeriod,
  formatIssueLabel,
  toCertificateIssue,
  type CertType,
  type CertSnapshot,
  type CertificateIssue,
} from "@/lib/certificates";
import { buildCertificatePdf } from "@/lib/certificatePdf";
import { kstTodayYmd } from "@/lib/trainings";

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
    supabaseAdmin.from("drivers").select("name").eq("id", driverId).maybeSingle(),
    supabaseAdmin
      .from("employee_profiles")
      .select(
        "birth_date, address, join_date, employment_status, resignation_date, appointments"
      )
      .eq("driver_id", driverId)
      .maybeSingle(),
  ]);
  if (!driver) return null;
  const p = (prof ?? {}) as Record<string, unknown>;
  const appt = pickAppointment(p.appointments);
  return {
    name: String((driver as { name: string }).name),
    birth_date: (p.birth_date as string | null) ?? null,
    address: (p.address as string | null) ?? null,
    join_date: (p.join_date as string | null) ?? null,
    employment_status: p.employment_status === "resigned" ? "resigned" : "active",
    resignation_date: (p.resignation_date as string | null) ?? null,
    department: appt.department,
    duty: appt.title,
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

// --- 본인 재직증명서 셀프 발급 ----------------------------------------
export async function issueMyCertificate(input: {
  purpose: string;
  duty: string;
}): Promise<IssueResult> {
  try {
    const me = await getSession();
    if (!me || me.kind !== "employee" || !me.name.trim())
      return { ok: false, message: "로그인이 필요합니다." };

    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("id")
      .eq("name", me.name.trim())
      .maybeSingle();
    const driverId = (driver as { id?: string } | null)?.id ?? null;
    if (!driverId) return { ok: false, message: "직원 정보를 찾을 수 없습니다." };

    const prof = await loadProfile(driverId);
    if (!prof) return { ok: false, message: "인사기록을 찾을 수 없습니다." };
    // 재직증명서는 재직자만(방어적 — 퇴직자는 로그인 불가).
    if (prof.employment_status === "resigned")
      return { ok: false, message: "재직 중인 직원만 재직증명서를 발급할 수 있습니다." };

    const purpose = cleanStr(input.purpose) ?? "서류제출용";
    const duty = cleanStr(input.duty) ?? prof.duty;
    const issuedOn = kstTodayYmd();
    const year = Number(issuedOn.slice(0, 4));

    const { seq, snapshot } = await insertWithNumber({
      certType: "employment",
      year,
      driverId,
      name: prof.name,
      purpose,
      issuedOn,
      issuedBy: "본인",
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

    const pdf = await buildCertificatePdf(snapshot);
    revalidatePath("/profile/hr");
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

    const pdf = await buildCertificatePdf(snapshot);
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
    if (!rec.snapshot)
      return { ok: false, message: "재발급에 필요한 정보(snapshot)가 없습니다." };

    // 권한: 관리자(M0/hr) 또는 본인 것.
    const access = await resolveOwnershipOrAdmin(rec.driver_id, me.name.trim());
    if (!access) return { ok: false, message: "재발급 권한이 없습니다." };

    const pdf = await buildCertificatePdf(rec.snapshot);
    return {
      ok: true,
      filename: pdfFilename(rec.snapshot),
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
