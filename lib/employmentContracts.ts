// =====================================================================
// 근로계약서 서식 — 조항 기본 문구·계약 행·문장 조립 (순수 모듈)
//   * 노미현 부장 요청 / 관장 설계 확정 (2026-10).
//   * 서식 = 2026년 실제 근로계약서(1~9조). 사람마다 달라지는 값(2·3조)만
//     employment_contracts 컬럼에 담고, 나머지 조항 본문은 settings 테이블의
//     CONTRACT_KINDS.employment.clausesKey 에 JSON 으로 둡니다 → 규정이 바뀌어도
//     코드 수정 없이 /hr/contracts 의 [조항 문구] 에서 고칩니다.
//   * 보낸 계약서는 보낸 시점의 문구로 고정합니다(clauseSnapshotKey).
//   * 상태·날짜·서명 검증·블록 타입은 lib/contractCore(연봉계약서와 공용),
//     보내기·서명·PDF 확정 흐름은 lib/contractServer 에 있습니다.
// =====================================================================

import {
  addDays,
  addMonths,
  clauseLines as lines,
  clauseText as s,
  fmtDot,
  fmtKoreanDate,
  periodLabel,
  workflowFields,
  type ContractBlock,
  type ContractParty,
  type ContractStatus,
} from "./contractCore";

export type ContractType = "fixed_term" | "permanent";

export const CONTRACT_TYPE_LABEL: Record<ContractType, string> = {
  fixed_term: "기간제",
  permanent: "기간의 정함 없음",
};

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
  const w = workflowFields(raw);
  return {
    ...w,
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
  };
}

// 취업규칙 7조 — 시작일부터 3개월(마지막 날 포함). 3/1 → 5/31.
export function defaultProbationEnd(start: string): string {
  return addDays(addMonths(start, PROBATION_MONTHS), -1);
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
