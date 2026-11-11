// =====================================================================
// 강사 채용 계약서 — 공용 상수·타입·자동 채움(화면·서버 공용, DB 접근 없음)
//   * DB: instructor_contract_templates / instructor_contracts / instructor_contract_logs
//   * 흐름: draft(작성 중) → sent(서명 요청) → instructor_signed(강사 서명, 동래샘들)
//           → completed(관장 직인 날인·PDF) / void(무효)
//     종이 계약은 업로드 즉시 completed(signing_method='paper').
//   * 본문은 양식 body 의 {{칸}} 을 fields 값으로 채운 것. 발송 순간 body_snapshot 에
//     확정하므로, 이후 양식이 바뀌어도 보낸 계약서는 바뀌지 않습니다.
//   ⚠️ 주민등록번호 전체는 어디에도 쓰지 않습니다 — 앞 7자리(rrn_mask) + '******' 뿐.
// =====================================================================

import { CONTRACT_ORG } from "@/lib/contractCore";
import { WEEKDAY_LABELS, normalizeWeekdays } from "@/lib/saemSchedule";

// --- 갑(기관) 정보 — 이 한 곳에서만 고칩니다 ----------------------------
export const INSTRUCTOR_CONTRACT_EMPLOYER = {
  orgName: "책임운영기관 동래구청소년센터",
  bizNo: "128-82-94632",
  address: "부산광역시 동래구 문화로 90(명륜동, 동래구청소년센터)",
  title: "동래구청소년센터장",
  // 대표 성명은 근로계약서와 같은 값을 씁니다(대표자가 바뀌면 contractCore 한 곳만 수정).
  representative: CONTRACT_ORG.representative,
} as const;

// 문자 발신번호(센터 대표번호) — 방카 접수 문자와 같은 번호.
export const INSTRUCTOR_CONTRACT_SMS_SENDER = "0519880924";
// 문자 이력(sms_send_logs.program) 분류.
export const INSTRUCTOR_CONTRACT_SMS_PROGRAM = "instructor_contract";
// 저장 위치 — hr-documents 버킷.
export const INSTRUCTOR_CONTRACT_DIR = "instructor-contracts";

export function instructorContractPdfPath(instructorId: string, contractNo: string): string {
  return `${INSTRUCTOR_CONTRACT_DIR}/${instructorId}/${contractNo}.pdf`;
}

// --- 상태 ---------------------------------------------------------------
export type InstructorContractStatus = "draft" | "sent" | "instructor_signed" | "completed" | "void";
export const INSTRUCTOR_CONTRACT_STATUS_LABEL: Record<InstructorContractStatus, string> = {
  draft: "작성 중",
  sent: "서명 대기",
  instructor_signed: "직인 대기",
  completed: "체결 완료",
  void: "무효",
};
export function toContractStatus(v: unknown): InstructorContractStatus {
  return v === "sent" || v === "instructor_signed" || v === "completed" || v === "void" ? v : "draft";
}

export type SigningMethod = "electronic" | "paper";
export const SIGNING_METHOD_LABEL: Record<SigningMethod, string> = {
  electronic: "전자서명",
  paper: "종이",
};

// --- 강좌 쪽 값 -----------------------------------------------------------
export type InstructorMode = "hire" | "staff" | "volunteer" | "external";
export const INSTRUCTOR_MODE_LABEL: Record<InstructorMode, string> = {
  hire: "채용함",
  staff: "직원 직접 운영",
  volunteer: "자원봉사",
  external: "외부기관",
};
export function normalizeInstructorMode(v: unknown): InstructorMode {
  return v === "staff" || v === "volunteer" || v === "external" ? v : "hire";
}

export type TaxType = "business_3_3" | "other_8_8" | "none";
export const TAX_TYPE_LABEL: Record<TaxType, string> = {
  business_3_3: "사업소득 3.3%",
  other_8_8: "기타소득 8.8%",
  none: "해당없음",
};
export function normalizeTaxType(v: unknown): TaxType {
  return v === "other_8_8" || v === "none" ? v : "business_3_3";
}
export function taxClause(t: TaxType): string {
  if (t === "business_3_3")
    return "4. 강사료는 사업소득-학원강사로 분류/지급되며, 매월 지급액의 3.3%(지방소득세 포함)를 원천징수한다.";
  if (t === "other_8_8")
    return "4. 강사료는 기타소득으로 분류/지급되며, 매월 지급액의 8.8%(지방소득세 포함)를 원천징수한다.";
  return "";
}

// 계약서용 강사료 방식(saem_programs.pay_type 과 같은 값).
export type ContractPayType = "hourly" | "per_session" | "revenue_share";
export function normalizeContractPayType(v: unknown): ContractPayType {
  return v === "per_session" || v === "revenue_share" ? v : "hourly";
}
const won = (n: number | null | undefined) =>
  n == null || !Number.isFinite(Number(n)) ? "    " : Math.round(Number(n)).toLocaleString("ko-KR");
export function payClause(
  t: ContractPayType,
  p: { hourly_rate: number | null; session_fee: number | null }
): string {
  if (t === "hourly")
    return `강사료는 시간당 ${won(p.hourly_rate)}원으로 하며, 강사근무일지에 기재된 실제 강의시간을 기준으로 산정하여 지급한다.`;
  if (t === "per_session") return `강사료는 익월 5일에 지급하며, 1회기당 ${won(p.session_fee)}원을 지급한다.`;
  return ""; // 수익배분 — 직원이 문장을 직접 씁니다.
}

// --- 칸 ------------------------------------------------------------------
// 양식 body 의 {{칸}}. contract_date 는 본문이 아니라 서명란(체결일)에 들어갑니다.
export const BODY_FIELD_KEYS = [
  "program_name",
  "round_label",
  "instructor_name",
  "start_date",
  "end_date",
  "schedule",
  "session_minutes",
  "pay_clause",
  "tax_clause",
  "field_label",
] as const;
export type BodyFieldKey = (typeof BODY_FIELD_KEYS)[number];

export const FIELD_LABEL: Record<BodyFieldKey | "contract_date", string> = {
  program_name: "강좌명",
  round_label: "차시 꼬리(예: ' 1차시')",
  instructor_name: "강사 성명",
  start_date: "계약 시작일",
  end_date: "계약 종료일",
  schedule: "근무시간",
  session_minutes: "1회 수업시간(분)",
  pay_clause: "강사료 조항",
  tax_clause: "원천징수 조항",
  field_label: "분야(예: 뉴스포츠)",
  contract_date: "체결일",
};

// fields jsonb — 칸 값 + 자동 채움에 쓴 선택값(다시 열었을 때 그대로 보이게).
export type ContractFields = Record<BodyFieldKey, string> & {
  contract_date: string; // YYYY-MM-DD
  pay_type: ContractPayType;
  tax_type: TaxType;
};

export function emptyFields(): ContractFields {
  const f = Object.fromEntries(BODY_FIELD_KEYS.map((k) => [k, ""])) as Record<BodyFieldKey, string>;
  return { ...f, contract_date: "", pay_type: "hourly", tax_type: "business_3_3" };
}

export function toFields(raw: unknown): ContractFields {
  const base = emptyFields();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  for (const k of BODY_FIELD_KEYS) base[k] = typeof r[k] === "string" ? (r[k] as string) : r[k] == null ? "" : String(r[k]);
  base.contract_date = typeof r.contract_date === "string" ? r.contract_date : "";
  base.pay_type = normalizeContractPayType(r.pay_type);
  base.tax_type = normalizeTaxType(r.tax_type);
  return base;
}

// 비어 있어도 되는 칸 — round_label(꼬리 없음), tax_clause(해당없음일 때).
export function missingFields(f: ContractFields, body: string): (BodyFieldKey | "contract_date")[] {
  const used = new Set(usedKeys(body));
  const out: (BodyFieldKey | "contract_date")[] = [];
  for (const k of BODY_FIELD_KEYS) {
    if (!used.has(k)) continue;
    if (k === "round_label") continue;
    if (k === "tax_clause" && f.tax_type === "none") continue;
    if (!f[k].trim()) out.push(k);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.contract_date)) out.push("contract_date");
  return out;
}

const TOKEN = /\{\{\s*([a-z_]+)\s*\}\}/g;
export function usedKeys(body: string): string[] {
  return [...body.matchAll(TOKEN)].map((m) => m[1]);
}

// 본문 채우기 — 모르는 칸은 그대로 둡니다(양식 오타가 눈에 띄도록).
export function fillBody(body: string, f: ContractFields): string {
  return body.replace(TOKEN, (all, key: string) =>
    (BODY_FIELD_KEYS as readonly string[]).includes(key) ? f[key as BodyFieldKey] : all
  );
}

// 미리보기용 — 본문을 글/칸 조각으로(칸은 색으로 표시).
export type BodySegment = { text: string; field?: string; empty?: boolean };
export function bodySegments(body: string, f: ContractFields): BodySegment[] {
  const out: BodySegment[] = [];
  let last = 0;
  for (const m of body.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: body.slice(last, at) });
    const key = m[1];
    const known = (BODY_FIELD_KEYS as readonly string[]).includes(key);
    const v = known ? f[key as BodyFieldKey] : m[0];
    out.push({ text: v, field: key, empty: known && !v.trim() });
    last = at + m[0].length;
  }
  if (last < body.length) out.push({ text: body.slice(last) });
  return out;
}

// --- 자동 채움 도우미 ------------------------------------------------------
// "2026-11-07" → "2026년 11월 7일"
export function koreanDate(ymd: string | null | undefined): string {
  const m = (ymd ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일`;
}

function minutesOf(hhmm: string | null | undefined): number | null {
  const m = (hhmm ?? "").match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
export function durationLabel(min: number): string {
  const h = Math.floor(min / 60);
  const mm = min % 60;
  return [h ? `${h}시간` : "", mm ? `${mm}분` : ""].filter(Boolean).join(" ") || "0분";
}
// 수업 시간(분) — 시작·종료 시각 차이.
export function lessonMinutes(start: string | null, end: string | null): number | null {
  const a = minutesOf(start);
  const b = minutesOf(end);
  return a != null && b != null && b > a ? b - a : null;
}
// "매주 토요일 10:00부터 11:30까지 (1시간 30분)"
export function scheduleText(weekdays: number[] | null | undefined, start: string | null, end: string | null): string {
  const w = normalizeWeekdays(weekdays);
  const s = (start ?? "").slice(0, 5);
  const e = (end ?? "").slice(0, 5);
  if (!w.length || !s || !e) return "";
  const days = w.map((d) => WEEKDAY_LABELS[d]).join("·");
  const dur = lessonMinutes(s, e);
  return `매주 ${days}요일 ${s}부터 ${e}까지${dur ? ` (${durationLabel(dur)})` : ""}`;
}

// 강좌·학기·강사 값으로 칸을 채웁니다(직원이 이후 수정).
export function autoFields(input: {
  programName: string;
  subject: string | null;
  instructorName: string;
  termStart: string | null;
  termEnd: string | null;
  weekdays: number[];
  timeStart: string | null;
  timeEnd: string | null;
  sessionMinutes: number | null;
  payType: ContractPayType;
  hourlyRate: number | null;
  sessionFee: number | null;
  taxType: TaxType;
  today: string; // YYYY-MM-DD(KST)
}): ContractFields {
  const minutes = input.sessionMinutes ?? lessonMinutes(input.timeStart, input.timeEnd);
  return {
    program_name: input.programName,
    round_label: "",
    instructor_name: input.instructorName,
    start_date: koreanDate(input.termStart),
    end_date: koreanDate(input.termEnd),
    schedule: scheduleText(input.weekdays, input.timeStart, input.timeEnd),
    session_minutes: minutes ? String(minutes) : "",
    pay_clause: payClause(input.payType, { hourly_rate: input.hourlyRate, session_fee: input.sessionFee }),
    tax_clause: taxClause(input.taxType),
    field_label: input.subject ?? "",
    contract_date: input.today,
    pay_type: input.payType,
    tax_type: input.taxType,
  };
}

// 주민번호 표기 — "000722-3" → "000722-3******". 앞 7자리 형식이 아니면 빈칸.
export function rrnMaskDisplay(mask: string | null | undefined): string {
  const d = (mask ?? "").replace(/\D/g, "");
  if (d.length < 7) return "";
  return `${d.slice(0, 6)}-${d.charAt(6)}******`;
}

// --- 목록 행 -------------------------------------------------------------
export type InstructorContractRow = {
  id: string;
  contract_no: string;
  instructor_id: string;
  instructor_name: string;
  project_id: string | null;
  project_name: string | null;
  term_id: string | null;
  term_name: string | null;
  program_id: string | null;
  program_name: string | null;
  signing_method: SigningMethod;
  status: InstructorContractStatus;
  sent_at: string | null;
  first_viewed_at: string | null;
  instructor_signed_at: string | null;
  employer_signed_at: string | null;
  has_pdf: boolean;
  has_paper: boolean;
  void_reason: string | null;
  created_at: string;
  created_by: string | null;
};
