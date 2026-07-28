// =====================================================================
// 증명서(재직·경력) 공용 타입·상수·순수 헬퍼 — /hr/certificates, /profile/hr
//   * DB: certificate_issues (RLS 0개 → service_role 경유).
//   * 증명문구는 종류별로 원천 고정(수기 발급 시 뒤섞이던 실수 차단).
//   * PDF 재발급을 위해 발급 시점 값을 snapshot(jsonb)에 통째로 보존.
// =====================================================================

export type CertType = "employment" | "career";

export const CERT_TYPES: Record<CertType, string> = {
  employment: "재직증명서",
  career: "경력증명서",
};

// ★증명문구 — 종류별 정확히(수기 실수 원천 차단). 절대 뒤섞지 말 것.
export const CERT_STATEMENT: Record<CertType, string> = {
  employment: "위와 같이 재직 중임을 증명합니다.",
  career: "위와 같이 경력을 증명합니다.",
};

// 기관 상수 — 추후 변경 대비 lib 단일 출처.
export const CERT_ORG = {
  name: "동래구청소년센터",
  phone: "051-988-0924",
  address: "부산광역시 동래구 문화로 90, (명륜동, 동래구청소년센터)",
  representative: "관장 허일수",
  certifierTitle: "동래구청소년센터장",
} as const;

// 관인 이미지 비공개 경로(hr-documents 버킷). 공개 URL 금지 — service_role 로만 열람.
export const CERT_SEAL_PATH = "org/center_seal.png";

// 발급 시점 스냅샷 — 이 값만으로 동일 PDF 재생성 가능해야 함.
export type CertSnapshot = {
  certType: CertType;
  issueLabel: string; // 제2026년-10호
  name: string;
  birthDate: string | null;
  address: string | null;
  department: string | null; // 근무부서
  duty: string | null; // 직위 및 담당업무
  periodFrom: string | null; // YYYY-MM-DD
  periodTo: string | null; // null = 현재(재직)
  periodText: string; // "3년 2개월"
  purpose: string; // 용도
  issuedOn: string; // YYYY-MM-DD
  statement: string; // 증명문구(종류별)
  org: typeof CERT_ORG;
};

export type CertificateIssue = {
  id: string;
  issue_year: number;
  issue_seq: number;
  cert_type: CertType;
  driver_id: string | null;
  employee_name: string;
  purpose: string;
  issued_on: string | null;
  issued_by: string;
  snapshot: CertSnapshot | null;
  created_at: string | null;
};

// --- 승인 신청(certificate_requests) ----------------------------------
export type CertRequestStatus = "pending" | "approved" | "rejected";
export const CERT_REQUEST_STATUS_LABEL: Record<CertRequestStatus, string> = {
  pending: "승인 대기",
  approved: "승인됨",
  rejected: "반려",
};

export type CertRequest = {
  id: string;
  driver_id: string | null;
  employee_name: string;
  cert_type: CertType;
  purpose: string;
  duty: string | null;
  status: CertRequestStatus;
  reject_reason: string | null;
  requested_at: string | null;
  decided_at: string | null;
  decided_by: string | null;
  issue_id: string | null;
};

export function toCertRequest(raw: Record<string, unknown>): CertRequest {
  const st = raw.status;
  const status: CertRequestStatus =
    st === "approved" ? "approved" : st === "rejected" ? "rejected" : "pending";
  return {
    id: String(raw.id ?? ""),
    driver_id: (raw.driver_id as string | null) ?? null,
    employee_name: String(raw.employee_name ?? ""),
    cert_type: raw.cert_type === "career" ? "career" : "employment",
    purpose: String(raw.purpose ?? ""),
    duty: (raw.duty as string | null) ?? null,
    status,
    reject_reason: (raw.reject_reason as string | null) ?? null,
    requested_at: (raw.requested_at as string | null) ?? null,
    decided_at: (raw.decided_at as string | null) ?? null,
    decided_by: (raw.decided_by as string | null) ?? null,
    issue_id: (raw.issue_id as string | null) ?? null,
  };
}

// --- 발급번호 표기 ----------------------------------------------------
const pad2 = (n: number) => String(n).padStart(2, "0");
export function formatIssueLabel(year: number, seq: number): string {
  return `제${year}년-${pad2(seq)}호`;
}

// 발급일 표기 "YYYY. MM. DD." (실물 양식과 동일).
export function formatIssuedDate(ymd: string): string {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  return `${m[1]}. ${m[2]}. ${m[3]}.`;
}

// --- 재직/경력 기간 계산 ----------------------------------------------
// from~to(없으면 todayYmd) → "3년 2개월" / "N년" / "N개월"(1년 미만).
//   * to 가 null 이면 오늘 기준으로 계산(표기상 '까지'는 caller 가 "현재"로).
export function calcServicePeriod(
  from: string,
  to: string | null,
  todayYmd: string
): string {
  const a = parseYmd(from);
  const b = parseYmd(to ?? todayYmd);
  if (!a || !b) return "";
  let months = (b.y - a.y) * 12 + (b.m - a.m);
  if (b.d < a.d) months -= 1; // 일자 미달이면 한 달 덜 참
  if (months < 0) months = 0;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years === 0) return `${rem}개월`;
  if (rem === 0) return `${years}년`;
  return `${years}년 ${rem}개월`;
}

function parseYmd(ymd: string): { y: number; m: number; d: number } | null {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

// 기간 '까지' 셀 표기 — null 이면 "현재".
export function periodToLabel(to: string | null): string {
  return to ?? "현재";
}

// --- 정규화(DB row → 타입) --------------------------------------------
export function toCertificateIssue(
  raw: Record<string, unknown>
): CertificateIssue {
  const t = raw.cert_type === "career" ? "career" : "employment";
  return {
    id: String(raw.id ?? ""),
    issue_year: Number(raw.issue_year ?? 0),
    issue_seq: Number(raw.issue_seq ?? 0),
    cert_type: t,
    driver_id: (raw.driver_id as string | null) ?? null,
    employee_name: String(raw.employee_name ?? ""),
    purpose: String(raw.purpose ?? ""),
    issued_on: (raw.issued_on as string | null) ?? null,
    issued_by: String(raw.issued_by ?? ""),
    snapshot: (raw.snapshot as CertSnapshot | null) ?? null,
    created_at: (raw.created_at as string | null) ?? null,
  };
}
