// =====================================================================
// 기관 대장(업무협약·수상) — 화면·출력(PDF/Word)·MCP 가 함께 쓰는 단일 출처.
//   * 노미현 부장 요청: 한글 표로 수기 관리하던 "업무협약 체결 현황"·"수상 현황"
//     을 동업자씨에서 저장·출력합니다.
//   * 순수 모듈(서버·클라이언트 공용). DB 접근은 lib/orgRecordsServer.ts.
//   * 탭은 ORG_RECORD_TABS 배열 하나로 정합니다. 공모사업 선정·기관 방문·
//     대외 협력 탭이 붙으면 여기 한 줄 + 탭 컴포넌트 하나를 더하면 됩니다.
// =====================================================================

export const ORG_RECORD_TABS = [
  { key: "agreements", label: "업무협약", icon: "🤝" },
  { key: "awards", label: "수상", icon: "🏆" },
] as const;
export type OrgRecordTab = (typeof ORG_RECORD_TABS)[number]["key"];

export function normalizeOrgRecordTab(v: string | null | undefined): OrgRecordTab {
  return ORG_RECORD_TABS.some((t) => t.key === v) ? (v as OrgRecordTab) : ORG_RECORD_TABS[0].key;
}

// --- 업무협약 ------------------------------------------------------------
export const AGREEMENT_STATUSES = ["active", "expired", "terminated"] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];
export const AGREEMENT_STATUS_LABEL: Record<AgreementStatus, string> = {
  active: "유효",
  expired: "만료",
  terminated: "해지",
};

export type OrgAgreement = {
  id: string;
  partner_name: string;
  business_partner_id: string | null;
  agreed_on: string; // YYYY-MM-DD
  content: string;
  period_start: string | null;
  period_end: string | null;
  status: AgreementStatus;
  manager_driver_id: string | null;
  manager_name: string | null; // 화면 표시용(drivers.name)
  has_file: boolean;
  memo: string;
  created_by: string | null;
  can_delete: boolean;
};

// 목록에 붙일 상태 표시 — 저장된 status 와 별개로 기간 종료일을 봅니다.
//   period_end 가 지났으면 "만료", 30일 이내면 "만료 임박".
//   해지된 협약은 기간과 무관하게 "해지".
export type AgreementBadge = { label: string; tone: "ok" | "warn" | "danger" | "muted" };
export function agreementBadge(
  a: Pick<OrgAgreement, "status" | "period_end">,
  todayYmd: string,
): AgreementBadge {
  if (a.status === "terminated") return { label: "해지", tone: "muted" };
  if (a.period_end) {
    if (a.period_end < todayYmd) return { label: "만료", tone: "danger" };
    if (a.period_end <= addDaysYmd(todayYmd, 30)) return { label: "만료 임박", tone: "warn" };
  }
  if (a.status === "expired") return { label: "만료", tone: "danger" };
  return { label: "유효", tone: "ok" };
}

// --- 수상 ----------------------------------------------------------------
export const RECIPIENT_TYPES = ["organization", "staff", "youth", "other"] as const;
export type RecipientType = (typeof RECIPIENT_TYPES)[number];
export const RECIPIENT_TYPE_LABEL: Record<RecipientType, string> = {
  organization: "기관",
  staff: "직원",
  youth: "청소년",
  other: "기타",
};
export function normalizeRecipientType(v: unknown): RecipientType | null {
  return RECIPIENT_TYPES.includes(v as RecipientType) ? (v as RecipientType) : null;
}

export type OrgAward = {
  id: string;
  award_name: string;
  recipient_name: string | null;
  recipient_type: RecipientType | null;
  recipient_driver_id: string | null;
  awarded_by: string;
  awarded_on: string; // YYYY-MM-DD
  related_program: string;
  has_file: boolean;
  memo: string;
  created_by: string | null;
  can_delete: boolean;
};

// 청소년 수상자 가리기 — 행감 제출용 출력과 MCP 가 같은 규칙을 씁니다.
export const MASKED_NAME = "***";
export function awardRecipientName(
  a: Pick<OrgAward, "recipient_name" | "recipient_type">,
  maskYouth: boolean,
): string {
  const name = (a.recipient_name ?? "").trim();
  if (!name) return "";
  return maskYouth && a.recipient_type === "youth" ? MASKED_NAME : name;
}

// --- 날짜 ----------------------------------------------------------------
// 수기 양식 표기 "YYYY.MM.DD."
export function fmtDotDate(ymd: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd ?? "");
  return m ? `${m[1]}.${m[2]}.${m[3]}.` : "";
}

export function yearOf(ymd: string | null | undefined): number | null {
  const y = Number((ymd ?? "").slice(0, 4));
  return Number.isInteger(y) && y > 1900 ? y : null;
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export function inYearRange(ymd: string, from: number | null, to: number | null): boolean {
  const y = yearOf(ymd);
  if (y == null) return false;
  if (from != null && y < from) return false;
  if (to != null && y > to) return false;
  return true;
}

// --- 출력(수기 양식 그대로) ------------------------------------------------
//   업무협약: "업 무 협 약 체 결 현 황" — 번호 | 기관명 | 협약일 | 협약내용
//   수상    : "수 상 현 황" + 부제 — 연번 | 수상명 | 수상기관 | 수상일
//   번호는 출력 순서대로 01, 02 … 두 자리. 수상명 칸은 "수상명 (수상자)".
export type OrgRecordKind = "agreements" | "awards";

export type OrgExportTable = {
  title: string;
  subtitle: string | null;
  headers: string[];
  // 열 너비 비율(합 = 1) — PDF·Word 가 같은 비율을 씁니다.
  widths: number[];
  // 가운데 정렬할 열
  center: boolean[];
  rows: string[][];
};

export const ORG_EXPORT_TITLE: Record<OrgRecordKind, string> = {
  agreements: "업 무 협 약 체 결 현 황",
  awards: "수 상 현 황",
};
export const AWARDS_SUBTITLE = "○ 기관 대상 대외 각종 포상·수상 등 실적 기록";

const seq = (i: number) => String(i + 1).padStart(2, "0");

export function buildAgreementExport(rows: OrgAgreement[]): OrgExportTable {
  const sorted = [...rows].sort(byDate((r) => r.agreed_on));
  return {
    title: ORG_EXPORT_TITLE.agreements,
    subtitle: null,
    headers: ["번호", "기관명", "협약일", "협약내용"],
    widths: [0.08, 0.3, 0.16, 0.46],
    center: [true, true, true, false],
    rows: sorted.map((r, i) => [seq(i), r.partner_name, fmtDotDate(r.agreed_on), r.content ?? ""]),
  };
}

export function buildAwardExport(rows: OrgAward[], maskYouth: boolean): OrgExportTable {
  const sorted = [...rows].sort(byDate((r) => r.awarded_on));
  return {
    title: ORG_EXPORT_TITLE.awards,
    subtitle: AWARDS_SUBTITLE,
    headers: ["연번", "수상명", "수상기관", "수상일"],
    widths: [0.08, 0.46, 0.3, 0.16],
    center: [true, false, true, true],
    rows: sorted.map((r, i) => {
      const who = awardRecipientName(r, maskYouth);
      return [seq(i), who ? `${r.award_name} (${who})` : r.award_name, r.awarded_by, fmtDotDate(r.awarded_on)];
    }),
  };
}

function byDate<T>(get: (r: T) => string) {
  return (a: T, b: T) => get(a).localeCompare(get(b));
}

export function orgExportFilename(
  kind: OrgRecordKind,
  from: number | null,
  to: number | null,
  ext: "pdf" | "docx",
): string {
  const base = kind === "agreements" ? "업무협약_체결현황" : "수상현황";
  const range =
    from == null && to == null ? "전체" : from === to ? `${from}년` : `${from ?? ""}~${to ?? ""}년`;
  return `${base}_${range}.${ext}`;
}
