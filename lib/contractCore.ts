// =====================================================================
// 계약서 공통 (순수 모듈) — 근로계약서·연봉계약서가 함께 씁니다.
//   * 2026-10 연봉계약서를 붙이면서 근로계약서(46449f0)에서 계약 종류와
//     무관한 부분을 여기로 뺐습니다: 상태·종류 정의, 날짜 표기, 서명 이미지
//     검증, 화면·PDF 공용 블록 타입.
//   * 종류별 서식(문장 조립)은 각 모듈에 있습니다.
//       근로계약서 → lib/employmentContracts.ts
//       연봉계약서 → lib/salaryContracts.ts
//   * 흐름(보내기·서명·센터장 서명·PDF 확정·교부)은 lib/contractServer.ts 한 곳.
// =====================================================================

// --- 종류 --------------------------------------------------------------
export type ContractKind = "employment" | "salary";

export const CONTRACT_KINDS: Record<
  ContractKind,
  {
    label: string; // "근로계약서"
    table: string; // DB 테이블
    clausesKey: string; // settings 키(현행 조항). 고정본은 `${key}:${id}`
    pdfDir: string; // hr-documents 안 폴더
  }
> = {
  employment: {
    label: "근로계약서",
    table: "employment_contracts",
    clausesKey: "employment_contract_clauses",
    pdfDir: "contracts", // 46449f0 부터 쓰던 경로 그대로
  },
  salary: {
    label: "연봉계약서",
    table: "salary_contracts",
    clausesKey: "salary_contract_clauses",
    pdfDir: "salary-contracts",
  },
};

export function isContractKind(v: unknown): v is ContractKind {
  return v === "employment" || v === "salary";
}

export function clauseSnapshotKey(kind: ContractKind, contractId: string): string {
  return `${CONTRACT_KINDS[kind].clausesKey}:${contractId}`;
}

// hr-documents(비공개) 안 최종 PDF 경로 — contract_pdf_url 에 이 경로를 넣습니다
//   (공개 URL 아님. 열람은 서버가 권한 확인 후 바이트로 내려줍니다).
export function contractPdfPath(kind: ContractKind, driverId: string, contractId: string): string {
  return `${CONTRACT_KINDS[kind].pdfDir}/${driverId}/${contractId}.pdf`;
}

export function contractPdfFilename(kind: ContractKind, name: string, year: string | number): string {
  const safe = (name || "직원").replace(/[\\/:*?"<>|\r\n\t]/g, "").trim() || "직원";
  return `${CONTRACT_KINDS[kind].label}_${safe}_${String(year).slice(0, 4)}.pdf`;
}

// --- 상태 --------------------------------------------------------------
export type ContractStatus = "draft" | "sent" | "signed" | "void";

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  draft: "작성 중",
  sent: "서명 대기",
  signed: "직원 서명 완료",
  void: "무효",
};

export function toStatus(v: unknown): ContractStatus {
  const s = String(v ?? "draft");
  return (["draft", "sent", "signed", "void"].includes(s) ? s : "draft") as ContractStatus;
}

type FinalizeFields = { status: ContractStatus; employer_signed_at: string | null; has_pdf: boolean };

// 양쪽 서명 + PDF 까지 끝난 상태.
export function isFinalized(c: FinalizeFields): boolean {
  return c.status === "signed" && !!c.employer_signed_at && c.has_pdf;
}

// 화면 표시용 상태(직원 서명 뒤 센터장 서명 대기/체결 완료 구분).
export function contractStateLabel(c: FinalizeFields): string {
  if (c.status === "signed") return isFinalized(c) ? "체결 완료" : "센터장 서명 대기";
  return CONTRACT_STATUS_LABEL[c.status];
}

// 서식 머리 — 사용자(기관) 정보.
export const CONTRACT_ORG = {
  name: "동래구청소년센터",
  representative: "허일수",
  employerTitle: "동래구청소년센터장",
} as const;

// 두 계약서 목록이 공유하는 요약 행(관리자 목록·직원 카드).
export type ContractSummary = {
  kind: ContractKind;
  id: string;
  driver_id: string;
  employee_name: string;
  period: string; // "2026. 01. 01. ~ 2026. 12. 31."
  year: string; // 파일명용
  note: string | null; // 연봉계약서: 연봉액 등 한 줄
  status: ContractStatus;
  sent_at: string | null;
  employee_signed_at: string | null;
  employer_signed_at: string | null;
  delivered_at: string | null;
  has_pdf: boolean;
  created_at: string;
};

// 두 테이블에 공통으로 있는 흐름 컬럼.
export const WORKFLOW_COLUMNS =
  "id, driver_id, status, sent_at, employee_signed_at, employer_signed_at, delivered_at, contract_pdf_url, created_by, created_at";

export function workflowFields(raw: Record<string, unknown>) {
  const str = (v: unknown) => (v == null || v === "" ? null : String(v));
  return {
    id: String(raw.id),
    driver_id: String(raw.driver_id),
    status: toStatus(raw.status),
    sent_at: str(raw.sent_at),
    employee_signed_at: str(raw.employee_signed_at),
    employer_signed_at: str(raw.employer_signed_at),
    delivered_at: str(raw.delivered_at),
    has_pdf: !!str(raw.contract_pdf_url),
    created_by: str(raw.created_by),
    created_at: String(raw.created_at ?? ""),
  };
}

// --- 날짜 --------------------------------------------------------------
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isYmd(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = v.match(YMD);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function toUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function fromUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(ymd: string, n: number): string {
  const d = toUtc(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtc(d);
}

// 월 더하기 — 말일을 넘기면 그 달 말일로 맞춥니다(1/31 + 1개월 = 2/28).
export function addMonths(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return fromUtc(target);
}

// 그 달 말일 "YYYY-MM-DD".
export function lastDayOfMonth(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// "2026. 03. 01."
export function fmtDot(ymd: string | null | undefined): string {
  if (!ymd || !isYmd(ymd)) return "";
  const [y, m, d] = ymd.split("-");
  return `${y}. ${m}. ${d}.`;
}

// 양 끝 포함 기간 → "10개월" / "3개월 15일".
export function periodLabel(from: string, to: string): string {
  if (!isYmd(from) || !isYmd(to) || to < from) return "";
  const end1 = addDays(to, 1);
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = end1.split("-").map(Number);
  let months = (ty - fy) * 12 + (tm - fm);
  let anchor = addMonths(from, months);
  if (anchor > end1) {
    months -= 1;
    anchor = addMonths(from, months);
  }
  const days = Math.round((toUtc(end1).getTime() - toUtc(anchor).getTime()) / 86400000);
  if (months <= 0) return `${days}일`;
  return days === 0 ? `${months}개월` : `${months}개월 ${days}일`;
}

// ISO 시각 → KST "YYYY-MM-DD".
export function kstYmd(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// "2026년 10월 06일" (근로계약서 서명일 표기)
export function fmtKoreanDate(ymd: string | null): string {
  if (!ymd || !isYmd(ymd)) return "        년      월      일";
  const [y, m, d] = ymd.split("-");
  return `${y}년 ${m}월 ${d}일`;
}

// --- 주민등록번호 표기 ----------------------------------------------------
// 화면은 뒤 6자리를 가립니다(전체는 PDF 에만).
export function maskRrn(rrn: string | null | undefined): string {
  const digits = (rrn ?? "").replace(/\D/g, "");
  if (digits.length !== 13) return rrn ? "형식 확인 필요" : "";
  return `${digits.slice(0, 6)}-${digits.charAt(6)}******`;
}
export function hyphenRrn(rrn: string | null | undefined): string {
  const digits = (rrn ?? "").replace(/\D/g, "");
  if (digits.length !== 13) return (rrn ?? "").trim();
  return `${digits.slice(0, 6)}-${digits.slice(6)}`;
}

// --- 문서 블록 — 화면(ContractView)·PDF(contractPdf) 공용 ----------------
export type ContractParty = {
  name: string;
  rrn: string; // 화면은 maskRrn, PDF 는 hyphenRrn 값을 넣어 호출
  address: string;
};

export type ContractBlock =
  | { kind: "title"; text: string }
  | { kind: "party"; party: ContractParty }
  | { kind: "heading"; text: string }
  | { kind: "para"; text: string }
  | { kind: "note"; text: string } // ※ 들여쓴 단서
  | { kind: "item"; no: number; text: string } // ① …
  | { kind: "sub"; text: string } // - 들여쓴 줄
  | { kind: "bullet"; text: string } // ○ 줄
  | { kind: "table"; caption?: string; headers: string[]; rows: string[][]; align: ("center" | "right")[] }
  | { kind: "confirm"; no: number; text: string } // 교부 확인 (인)
  | { kind: "sign"; date: string; employeeName: string };

// 원문자 — 화면용(나눔고딕엔 글리프가 없어 PDF 는 원을 직접 그립니다).
export function circled(n: number): string {
  return n >= 1 && n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : `(${n})`;
}

// --- 서명 이미지 검증 — 동래샘들 lib/signature.ts 와 같은 규칙 ------------
const PNG_PREFIX = "data:image/png;base64,";
export const SIGNATURE_MAX_CHARS = 200 * 1024;
const B64_BODY = /^[A-Za-z0-9+/]+={0,2}$/;

export function isPngDataUrl(v: unknown): v is string {
  if (typeof v !== "string" || !v.startsWith(PNG_PREFIX)) return false;
  const body = v.slice(PNG_PREFIX.length);
  if (body.length === 0 || body.length % 4 !== 0) return false;
  return B64_BODY.test(body);
}

export function checkSignature(
  v: unknown
): { ok: true; dataUrl: string } | { ok: false; message: string } {
  if (!isPngDataUrl(v)) return { ok: false, message: "서명 이미지를 인식하지 못했습니다." };
  if (v.length > SIGNATURE_MAX_CHARS) {
    return { ok: false, message: "서명 이미지가 너무 큽니다. 다시 그려주세요." };
  }
  return { ok: true, dataUrl: v };
}

// --- 조항 파싱 도우미 -----------------------------------------------------
export const clauseText = (v: unknown, fb: string): string =>
  typeof v === "string" && v.trim() ? v.trim() : fb;
export const clauseLines = (v: unknown, fb: string[]): string[] => {
  if (!Array.isArray(v)) return fb;
  const out = v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
  return out.length > 0 ? out : fb;
};

// 직원 카드 한 장 = 요약 + 화면용 블록(주민번호 가림).
export type MyContract = ContractSummary & { blocks: ContractBlock[] };
