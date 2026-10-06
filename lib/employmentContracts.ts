// =====================================================================
// 근로계약서 — 타입·조항 기본 문구·날짜 계산·서명 검증 (순수 모듈)
//   * 노미현 부장 요청 / 관장 설계 확정 (2026-10). 연봉계약서는 다음 건.
//   * 서식 = 2026년 실제 근로계약서(1~9조). 사람마다 달라지는 값(2·3조)만
//     employment_contracts 컬럼에 담고, 나머지 조항 본문은 settings 테이블의
//     CONTRACT_CLAUSES_KEY 에 JSON 으로 둡니다 → 규정이 바뀌어도 코드 수정 없이
//     /hr/contracts 의 [조항 문구] 에서 고칩니다.
//   * 보낸 계약서는 보낸 시점의 문구로 고정합니다(clauseSnapshotKey). 직원이
//     읽고 서명하는 사이에 문구가 바뀌면 "무엇에 서명했는가" 가 흐려집니다.
//     최종본은 양쪽 서명 후 만든 PDF(contract_pdf_url) 입니다.
//   * 화면(ContractView)과 PDF(employmentContractPdf)가 같은 블록 배열
//     (buildContractBlocks)을 그립니다 — 둘이 따로 문장을 조립하면 어긋납니다.
// =====================================================================

export type ContractStatus = "draft" | "sent" | "signed" | "void";
export type ContractType = "fixed_term" | "permanent";

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  draft: "작성 중",
  sent: "서명 대기",
  signed: "직원 서명 완료",
  void: "무효",
};

export const CONTRACT_TYPE_LABEL: Record<ContractType, string> = {
  fixed_term: "기간제",
  permanent: "기간의 정함 없음",
};

// 서식 머리 — 계약당사자 표의 사용자 칸.
export const CONTRACT_ORG = {
  name: "동래구청소년센터",
  representative: "허일수",
  employerTitle: "동래구청소년센터장",
} as const;

// 3조 근로조건 기본값(서식 값). 화면에서 사람마다 고칠 수 있습니다.
export const CONTRACT_DEFAULTS = {
  department: "",
  position: "",
  duty_content: `"사용자"의 정당한 지시에 의한 업무 수행 (청소년지도사 윤리헌장 따름)`,
  work_hours: "09:00~18:00",
  work_days: "화~토",
  weekly_hours: 40,
  workplace: "동래구청소년센터 및 사직동 청소년자유공간 온나",
  break_time: "12:00~13:00",
  payment_day: "매월 25일",
} as const;

// 시용기간 기본 3개월 — 취업규칙 7조(현행 표기는 "수습기간") 기준.
//   계약서 화면·PDF 표현은 "시용"(관장 지시 2026-10: 내용이 해약권 유보부 근로계약).
//   DB 컬럼명은 probation_* 그대로.
export const PROBATION_MONTHS = 3;

// settings 키. 조항 본문(현행)과, 보낸 계약서별 고정본.
export const CONTRACT_CLAUSES_KEY = "employment_contract_clauses";
export function clauseSnapshotKey(contractId: string): string {
  return `${CONTRACT_CLAUSES_KEY}:${contractId}`;
}

// hr-documents(비공개) 안 최종 PDF 경로. contract_pdf_url 에는 이 경로를 넣습니다
//   (공개 URL 아님 — 열람은 서버가 권한 확인 후 바이트로 내려줍니다).
export function contractPdfPath(driverId: string, contractId: string): string {
  return `contracts/${driverId}/${contractId}.pdf`;
}

// ---------------------------------------------------------------------
// 조항 문구
// ---------------------------------------------------------------------
export type ContractArticle = { title: string; items: string[] };

export type ContractClauses = {
  // 1조 리드문. {근로자} 자리에 성명이 들어갑니다.
  lead: string;
  // 2조 시용 문장 뒷부분("사용기간을 두며 …").
  probationNote: string;
  // 3조 ④·⑦ 괄호 안 단서, ⑥ 임금의 구성.
  workplaceNote: string;
  wageComposition: string;
  paymentNote: string;
  // 3조 ⑧ 기타사항(줄마다 한 항목).
  etc: string[];
  // 4조부터 끝까지. 번호는 순서대로 자동으로 붙습니다(4, 5, 6 …).
  articles: ContractArticle[];
  // 마지막 조의 끝 항목 — 교부 확인. 뒤에 (인) 과 근로자 서명이 붙습니다.
  deliveryConfirm: string;
};

// ★ 4~9조 전문은 지시문에 요약으로만 와서, 요약 + 2025년 청소년지도사 기간제
//   근로계약서 문구를 바탕으로 채운 초안입니다. 원문과 다른 곳은
//   /hr/contracts [조항 문구] 에서 바로잡으면 됩니다(코드 수정 불필요).
export const DEFAULT_CONTRACT_CLAUSES: ContractClauses = {
  lead: `동래구청소년센터장(이하 "사용자")과 근로자 {근로자}(이하 "근로자")는 다음과 같이 근로계약을 체결하고 상호 성실히 이행할 것을 서약한다.`,
  probationNote:
    "사용기간을 두며 업무 적격성을 평가하여 계속근로가 부적당한 경우 채용을 취소할 수 있다.",
  workplaceNote: "단, 업무상 필요한 경우 종사 업무 및 근로 장소를 변경할 수 있다.",
  wageComposition: "별도 연봉계약서 참조",
  paymentNote:
    "매월 1일부터 말일까지 마감하여 지급하며, 임금 지급일이 공휴일인 경우 전일 지급한다.",
  etc: [
    `"근로자"는 "사용자"의 사정에 따라 발생하는 연장·휴일근로 명령에 동의한다.`,
    `"근로자"는 "사용자"의 사전 승낙을 얻어 외출할 수 있으며, 승낙 없이 무단 외출하는 경우 "사용자"는 징계할 수 있다.`,
    `"근로자"의 의사에 의하여 연장·야간·휴일 근로가 필요한 경우 "사용자"의 서면 허가를 얻어야 한다.`,
    `"근로자"는 법정교육 및 업무 관련 교육을 반드시 이수하여야 하며, 이를 이행하지 않는 경우 징계할 수 있다.`,
    `"근로자"의 개인적인 사정으로 지각·조퇴·결근 등이 발생하는 경우 해당 시간에 대한 임금을 공제할 수 있다.`,
    "제수당은 당해 예산 범위 내에서 지급할 수 있으며, 종류 및 지급 내용은 조정할 수 있다.",
  ],
  articles: [
    {
      title: "퇴직금",
      items: [
        "퇴직급여는 확정기여형(DC형) 퇴직연금제도에 따른다.",
        "퇴직금은 계속근로기간 1년에 대하여 30일분의 평균임금으로 한다.",
      ],
    },
    {
      title: "휴일 및 휴가",
      items: [
        "주휴일은 일요일로 한다.",
        "조례에서 정한 휴관일과 근로자의 날은 유급휴일로 한다.",
        "업무상 필요에 따라 일요일 또는 공휴일에 근로한 경우 대체휴무를 부여한다.",
      ],
    },
    {
      title: "연차유급휴가의 부여 및 대체",
      items: [
        `1년간 80% 이상 출근한 "근로자"에게 15일의 유급휴가를 부여한다.`,
        `3년 이상 계속 근로한 "근로자"에게는 최초 1년을 초과하는 계속근로연수 매 2년에 대하여 1일을 가산한 유급휴가를 부여한다.`,
        `계속근로기간이 1년 미만인 "근로자"에게는 1개월 개근 시 1일의 유급휴가를 부여한다.`,
        `"사용자"는 근로기준법에 따른 연차유급휴가 사용촉진제도를 시행할 수 있다.`,
      ],
    },
    {
      title: "근로관계의 종료",
      items: [
        `"근로자"가 계약기간 중 퇴직하고자 할 때에는 적어도 30일 전까지 서면으로 통보하고 업무 인수인계를 성실히 하여야 한다.`,
        `"사용자"는 취업규칙에서 정한 해고 사유에 해당하는 경우 관계 법령이 정한 절차에 따라 "근로자"를 해고할 수 있다.`,
      ],
    },
    {
      title: "금품청산기일 연장에 대한 동의",
      items: [`"근로자"는 퇴사 후 다음 임금지급기일에 임금을 지급 받을 수 있음에 사전 동의한다.`],
    },
    {
      title: "준수사항",
      items: [
        `"근로자"는 "사용자"의 정당한 지시사항을 성실히 준수하여야 한다.`,
        `"근로자"가 고의 또는 중대한 과실로 "사용자"에게 손해를 끼친 경우 이를 배상하여야 한다.`,
        "본 계약서에 명시되지 않은 내용은 근로기준법 등 노동관계법령, 취업규칙 및 여성가족부 청소년사업 안내에 따른다.",
        `"근로자"는 업무상 알게 된 개인정보와 비밀을 누설하지 아니하며, 업무 수행 중 작성한 제작·연구·기획물의 저작권은 "사용자"에게 귀속된다.`,
        `본 계약과 관련한 분쟁의 재판관할은 "사용자"의 소재지를 관할하는 법원으로 한다.`,
        `본 계약서는 2부를 작성하여 "사용자"와 "근로자"가 각 1부씩 보관한다.`,
      ],
    },
  ],
  deliveryConfirm: `"근로자"는 본 계약서와 동일한 계약서 1부를 교부 받았음을 확인한다.`,
};

const s = (v: unknown, fb: string): string =>
  typeof v === "string" && v.trim() ? v.trim() : fb;
const lines = (v: unknown, fb: string[]): string[] => {
  if (!Array.isArray(v)) return fb;
  const out = v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
  return out.length > 0 ? out : fb;
};

// settings 값(JSON 문자열) → 조항. 깨졌거나 빈 칸은 기본 문구로 메웁니다.
export function parseClauses(raw: string | null | undefined): ContractClauses {
  const d = DEFAULT_CONTRACT_CLAUSES;
  if (!raw) return d;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return d;
  }
  if (!o || typeof o !== "object") return d;
  const arts = Array.isArray(o.articles)
    ? (o.articles as unknown[])
        .map((a) => {
          const r = (a ?? {}) as Record<string, unknown>;
          const title = typeof r.title === "string" ? r.title.trim() : "";
          const items = lines(r.items, []);
          return title ? { title, items } : null;
        })
        .filter((a): a is ContractArticle => a !== null)
    : [];
  return {
    lead: s(o.lead, d.lead),
    probationNote: s(o.probationNote, d.probationNote),
    workplaceNote: s(o.workplaceNote, d.workplaceNote),
    wageComposition: s(o.wageComposition, d.wageComposition),
    paymentNote: s(o.paymentNote, d.paymentNote),
    etc: lines(o.etc, d.etc),
    articles: arts.length > 0 ? arts : d.articles,
    deliveryConfirm: s(o.deliveryConfirm, d.deliveryConfirm),
  };
}

// ---------------------------------------------------------------------
// 계약 행
// ---------------------------------------------------------------------
export type EmploymentContract = {
  id: string;
  driver_id: string;
  employee_name: string; // drivers.name (조인)
  contract_type: ContractType;
  contract_start: string;
  contract_end: string | null;
  probation_start: string | null;
  probation_end: string | null;
  department: string | null;
  position: string | null;
  duty_content: string | null;
  work_hours: string | null;
  work_days: string | null;
  weekly_hours: number | null;
  workplace: string | null;
  break_time: string | null;
  payment_day: string | null;
  status: ContractStatus;
  sent_at: string | null;
  employee_signed_at: string | null;
  employer_signed_at: string | null;
  delivered_at: string | null;
  has_pdf: boolean;
  created_by: string | null;
  created_at: string;
};

// ⚠️ employee_signature(서명 이미지)·contract_pdf_url(경로)은 목록 select 에
//   넣지 않습니다. 화면에는 "있다/없다" 만 필요합니다.
export const CONTRACT_LIST_COLUMNS =
  "id, driver_id, contract_type, contract_start, contract_end, probation_start, probation_end, department, position, duty_content, work_hours, work_days, weekly_hours, workplace, break_time, payment_day, status, sent_at, employee_signed_at, employer_signed_at, delivered_at, contract_pdf_url, created_by, created_at";

export function toContract(
  raw: Record<string, unknown>,
  employeeName: string
): EmploymentContract {
  const str = (v: unknown) => (v == null || v === "" ? null : String(v));
  const status = String(raw.status ?? "draft");
  return {
    id: String(raw.id),
    driver_id: String(raw.driver_id),
    employee_name: employeeName,
    contract_type: raw.contract_type === "permanent" ? "permanent" : "fixed_term",
    contract_start: String(raw.contract_start ?? ""),
    contract_end: str(raw.contract_end),
    probation_start: str(raw.probation_start),
    probation_end: str(raw.probation_end),
    department: str(raw.department),
    position: str(raw.position),
    duty_content: str(raw.duty_content),
    work_hours: str(raw.work_hours),
    work_days: str(raw.work_days),
    weekly_hours: raw.weekly_hours == null ? null : Number(raw.weekly_hours),
    workplace: str(raw.workplace),
    break_time: str(raw.break_time),
    payment_day: str(raw.payment_day),
    status: (["draft", "sent", "signed", "void"].includes(status)
      ? status
      : "draft") as ContractStatus,
    sent_at: str(raw.sent_at),
    employee_signed_at: str(raw.employee_signed_at),
    employer_signed_at: str(raw.employer_signed_at),
    delivered_at: str(raw.delivered_at),
    has_pdf: !!str(raw.contract_pdf_url),
    created_by: str(raw.created_by),
    created_at: String(raw.created_at ?? ""),
  };
}

// 양쪽 서명 + PDF 까지 끝난 상태.
export function isFinalized(c: Pick<EmploymentContract, "status" | "employer_signed_at" | "has_pdf">): boolean {
  return c.status === "signed" && !!c.employer_signed_at && c.has_pdf;
}

// 화면 표시용 상태(서명 완료 뒤 센터장 서명 대기/확정 구분).
export function contractStateLabel(
  c: Pick<EmploymentContract, "status" | "employer_signed_at" | "has_pdf">
): string {
  if (c.status === "signed") return isFinalized(c) ? "체결 완료" : "센터장 서명 대기";
  return CONTRACT_STATUS_LABEL[c.status];
}

// ---------------------------------------------------------------------
// 날짜
// ---------------------------------------------------------------------
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

// 취업규칙 7조 — 시작일부터 3개월(마지막 날 포함). 3/1 → 5/31.
export function defaultProbationEnd(start: string): string {
  return addDays(addMonths(start, PROBATION_MONTHS), -1);
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
  const end1 = addDays(to, 1); // 마지막 날 포함
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

// 서명일 표기 "2026년 10월 06일".
export function fmtKoreanDate(ymd: string | null): string {
  if (!ymd || !isYmd(ymd)) return "        년      월      일";
  const [y, m, d] = ymd.split("-");
  return `${y}년 ${m}월 ${d}일`;
}

// 주민등록번호 화면 표기 — 뒤 6자리 가립니다(전체는 PDF 에만).
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

// ---------------------------------------------------------------------
// 문서 블록 — 화면·PDF 공용
// ---------------------------------------------------------------------
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
  | { kind: "sub"; text: string } // - 기타사항 줄
  | { kind: "confirm"; no: number; text: string } // 교부 확인 (인)
  | { kind: "sign"; date: string; employeeName: string };

// 원문자 — 화면용(나눔고딕엔 글리프가 없어 PDF 는 원을 직접 그립니다).
export function circled(n: number): string {
  return n >= 1 && n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : `(${n})`;
}

export type ContractTerms = Pick<
  EmploymentContract,
  | "contract_type"
  | "contract_start"
  | "contract_end"
  | "probation_start"
  | "probation_end"
  | "department"
  | "position"
  | "duty_content"
  | "work_hours"
  | "work_days"
  | "weekly_hours"
  | "workplace"
  | "break_time"
  | "payment_day"
>;

export function buildContractBlocks(input: {
  terms: ContractTerms;
  party: ContractParty;
  clauses: ContractClauses;
  signDate: string | null; // KST YYYY-MM-DD, 미서명이면 null
}): ContractBlock[] {
  const { terms: t, party, clauses: c } = input;
  const b: ContractBlock[] = [];
  b.push({ kind: "title", text: "근 로 계 약 서" });

  // 1. 계약당사자
  b.push({ kind: "heading", text: "1. 계약당사자" });
  b.push({ kind: "party", party });
  b.push({ kind: "para", text: c.lead.replaceAll("{근로자}", party.name || "OOO") });

  // 2. 근로계약 기간
  const start = fmtDot(t.contract_start);
  const period =
    t.contract_type === "permanent" || !t.contract_end
      ? `${start} ~ (기간의 정함이 없음)`
      : `${start} ~ ${fmtDot(t.contract_end)} (${periodLabel(t.contract_start, t.contract_end)})`;
  b.push({ kind: "heading", text: `2. 근로계약 기간 : ${period}` });
  if (t.probation_start && t.probation_end) {
    b.push({
      kind: "note",
      text: `※ 시용기간은 ${fmtDot(t.probation_start)} ~ ${fmtDot(t.probation_end)} (${periodLabel(
        t.probation_start,
        t.probation_end
      )}) ${c.probationNote}`,
    });
  }

  // 3. 근로조건
  b.push({ kind: "heading", text: "3. 근로조건" });
  const pos = [t.department, t.position].filter((v) => v && v.trim()).join(" / ");
  const hours = [
    t.work_hours?.trim(),
    t.work_days?.trim() ? `(${t.work_days.trim()})` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const weekly = t.weekly_hours ? `, 주${t.weekly_hours}시간` : "";
  const items: string[] = [
    `직 위 : ${pos || "-"}`,
    `업무내용 : ${t.duty_content?.trim() || "-"}`,
    `근무시간 : ${hours || "-"}${weekly}`,
    `근무장소 : ${t.workplace?.trim() || "-"} (${c.workplaceNote})`,
    `휴게시간 : ${t.break_time?.trim() || "-"}`,
    `임금의 구성 : ${c.wageComposition}`,
    `임금의 지급 : ${t.payment_day?.trim() || "-"} (${c.paymentNote})`,
    "기타사항",
  ];
  items.forEach((text, i) => b.push({ kind: "item", no: i + 1, text }));
  c.etc.forEach((text) => b.push({ kind: "sub", text: `- ${text}` }));

  // 4조~
  c.articles.forEach((a, ai) => {
    const no = ai + 4;
    const last = ai === c.articles.length - 1;
    if (a.items.length === 1 && !last) {
      // 항이 하나뿐인 조는 번호 없이 본문만(원문 8조 모양).
      b.push({ kind: "heading", text: `${no}. ${a.title}` });
      b.push({ kind: "para", text: a.items[0] });
      return;
    }
    b.push({ kind: "heading", text: `${no}. ${a.title}` });
    a.items.forEach((text, i) => b.push({ kind: "item", no: i + 1, text }));
    if (last) b.push({ kind: "confirm", no: a.items.length + 1, text: c.deliveryConfirm });
  });
  if (c.articles.length === 0) {
    b.push({ kind: "confirm", no: 1, text: c.deliveryConfirm });
  }

  b.push({ kind: "sign", date: fmtKoreanDate(input.signDate), employeeName: party.name });
  return b;
}

// ---------------------------------------------------------------------
// 서명 이미지 검증 — 동래샘들 lib/signature.ts 와 같은 규칙(245건 검증된 패턴).
// ---------------------------------------------------------------------
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

export function contractPdfFilename(name: string, start: string): string {
  const safe = (name || "직원").replace(/[\\/:*?"<>|\r\n\t]/g, "").trim() || "직원";
  return `근로계약서_${safe}_${start.slice(0, 4)}.pdf`;
}
