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

// 동래샘들 계약서 화면 주소 — 강사 본인 로그인 뒤에만 열리므로 비밀값을 넣지 않습니다.
export function instructorContractLink(saemBase: string, contractId: string): string {
  return `${saemBase.replace(/\/+$/, "")}/contracts/${contractId}`;
}
// 직원 [링크 복사] 문구.
export function instructorContractLinkMessage(link: string): string {
  return `동래샘들에 로그인한 뒤 계약서를 확인하고 서명해 주세요. ${link}`;
}

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
// 원칙: 돈 받는 사람은 반드시 계약서. 표시 문구만 바꿨고 DB 값은 그대로입니다.
export const INSTRUCTOR_MODE_LABEL: Record<InstructorMode, string> = {
  hire: "유급(계약서 필요)",
  staff: "직원 직접 운영",
  volunteer: "무급(동아리·자원봉사)",
  external: "외부기관",
};
export function normalizeInstructorMode(v: unknown): InstructorMode {
  return v === "staff" || v === "volunteer" || v === "external" ? v : "hire";
}
// 새 강좌 기본값 — 동아리(program_type='club')는 무급, 그 밖은 유급.
export function defaultInstructorMode(programType: string | null | undefined): InstructorMode {
  return programType === "club" ? "volunteer" : "hire";
}

// 유급 강좌의 계약서 전제 확인 — 강좌명 2자 이상 + 강사료 금액(방식에 맞는 칸).
//   강좌 입력 화면은 경고만, 계약서 발송은 이것이 비어 있지 않으면 막습니다.
export function programInfoIssues(p: {
  mode: InstructorMode;
  name: string | null | undefined;
  payType: ContractPayType;
  hourlyRate: number | null | undefined;
  sessionFee: number | null | undefined;
  shareRate: number | null | undefined;
}): string[] {
  if (p.mode !== "hire") return [];
  const out: string[] = [];
  if ((p.name ?? "").trim().length < 2) out.push("강좌명이 2자 미만입니다");
  const amount = p.payType === "per_session" ? p.sessionFee : p.payType === "revenue_share" ? p.shareRate : p.hourlyRate;
  if (amount == null || !Number.isFinite(Number(amount)) || Number(amount) <= 0)
    out.push(
      p.payType === "per_session"
        ? "회당 강사료가 비어 있습니다"
        : p.payType === "revenue_share"
          ? "강사 분배 비율이 비어 있습니다"
          : "시급이 비어 있습니다"
    );
  return out;
}
export const PROGRAM_INFO_BLOCK_MESSAGE = "강좌 정보를 먼저 확인해 주세요";

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
  "schedule_clause",
  "session_clause",
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
  schedule_clause: "근무시간 조항",
  session_clause: "수업시간 조항",
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

// --- 계약서 1건 = 강좌 여러 개(묶음) -------------------------------------------
// 원칙: 같은 강사·같은 학기·같은 강사료 방식과 금액이면 1건으로 묶고, 다르면 따로.
export function payKey(p: {
  payType: ContractPayType;
  hourlyRate: number | null;
  sessionFee: number | null;
  shareRate: number | null;
}): string {
  const amount = p.payType === "per_session" ? p.sessionFee : p.payType === "revenue_share" ? p.shareRate : p.hourlyRate;
  return `${p.payType}:${amount == null ? "" : Number(amount)}`;
}

// 칸 채우기에 쓰는 강좌 한 개의 값.
export type BundleProgram = {
  name: string;
  weekdays: number[];
  timeStart: string | null;
  timeEnd: string | null;
  sessionMinutes: number | null;
};

// 이름이 같은 강좌 구분 — "강좌명 (화 16:00~17:00)".
export function programTimeTag(p: Pick<BundleProgram, "weekdays" | "timeStart" | "timeEnd">): string {
  const w = normalizeWeekdays(p.weekdays)
    .map((d) => WEEKDAY_LABELS[d])
    .join("·");
  const s = (p.timeStart ?? "").slice(0, 5);
  const e = (p.timeEnd ?? "").slice(0, 5);
  return [w, s && e ? `${s}~${e}` : s].filter(Boolean).join(" ");
}
export function distinctProgramNames<T extends BundleProgram & { id: string }>(list: T[]): Map<string, string> {
  const count = new Map<string, number>();
  for (const p of list) count.set(p.name, (count.get(p.name) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const p of list) {
    const tag = (count.get(p.name) ?? 0) > 1 ? programTimeTag(p) : "";
    out.set(p.id, tag ? `${p.name} (${tag})` : p.name);
  }
  return out;
}

const programMinutes = (p: BundleProgram) => p.sessionMinutes ?? lessonMinutes(p.timeStart, p.timeEnd);

// 묶음 칸 — program_name·schedule_clause·session_clause(+ 예전 양식용 schedule·session_minutes).
export function bundleFields(list: BundleProgram[]): Pick<
  ContractFields,
  "program_name" | "schedule" | "session_minutes" | "schedule_clause" | "session_clause"
> {
  const names = [...new Set(list.map((p) => p.name.trim()).filter(Boolean))];
  const scheds = list.map((p) => scheduleText(p.weekdays, p.timeStart, p.timeEnd));
  const mins = list.map(programMinutes);
  const sameMin = mins.length > 0 && mins.every((m) => m != null && m === mins[0]);
  let scheduleClause = "";
  if (list.length === 1) {
    scheduleClause = scheds[0] ? `근무시간 : ${scheds[0]}로 한다.` : "";
  } else if (list.length > 1) {
    scheduleClause = [
      "근무시간은 아래와 같이 한다.",
      ...list.map((p, i) => `   - ${p.name}: ${scheds[i] || "(시간 미정)"}`),
    ].join("\n");
  }
  let sessionClause = "";
  if (sameMin) sessionClause = `강의 1회당 수업시간은 ${mins[0]}분으로 한다.`;
  else if (list.length > 1) sessionClause = "강의 1회당 수업시간은 강좌별 근무시간에 따른다.";
  return {
    program_name: names.join(", "),
    // 예전 양식({{schedule}}·{{session_minutes}}) 호환 — 강좌가 여럿이면 강좌명을 붙여 이어 씁니다.
    schedule: list.length === 1 ? scheds[0] : list.map((p, i) => `${p.name} ${scheds[i]}`.trim()).join(", "),
    session_minutes: sameMin ? String(mins[0]) : "",
    schedule_clause: scheduleClause,
    session_clause: sessionClause,
  };
}

// 강좌(여럿)·학기·강사 값으로 칸을 채웁니다(직원이 이후 수정). 강사료·분야·학기는 첫 강좌 기준.
export function autoFields(input: {
  programs: (BundleProgram & { subject: string | null })[];
  instructorName: string;
  termStart: string | null;
  termEnd: string | null;
  payType: ContractPayType;
  hourlyRate: number | null;
  sessionFee: number | null;
  taxType: TaxType;
  today: string; // YYYY-MM-DD(KST)
}): ContractFields {
  const subjects = [...new Set(input.programs.map((p) => (p.subject ?? "").trim()).filter(Boolean))];
  return {
    ...bundleFields(input.programs),
    round_label: "",
    instructor_name: input.instructorName,
    start_date: koreanDate(input.termStart),
    end_date: koreanDate(input.termEnd),
    pay_clause: payClause(input.payType, { hourly_rate: input.hourlyRate, session_fee: input.sessionFee }),
    tax_clause: taxClause(input.taxType),
    field_label: subjects.join(", "),
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
  program_id: string | null; // 대표 강좌
  program_name: string | null;
  // 이 계약에 든 강좌 전체(연결표 instructor_contract_programs 기준, 대표 강좌 먼저).
  programs: { id: string; name: string }[];
  period: string; // 계약기간 "2026년 11월 7일 ~ 2026년 12월 26일" (없으면 "")
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
