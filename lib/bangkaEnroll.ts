// =====================================================================
// 신규 청소년 온라인 접수(모집) — 표시·판정 규칙(순수 모듈, 서버·브라우저 공용)
//   동래방카 lib/enroll.ts 와 같은 표(키를 바꾸면 두 곳을 함께 바꿉니다).
//   DB: supabase/migrations/bk_enroll_apply.sql · 설계: docs/설계_방카신규접수.md
//   ⚠️ 서버 전용 모듈·환경변수를 import 하지 않습니다.
// =====================================================================

export const ENROLL_BUCKET = "bk-applications";
export const ENROLL_FILE_MAX = 10 * 1024 * 1024; // 1장 10MB
export const ENROLL_FILE_MIMES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
export const ENROLL_FILES_PER_KIND = 10;
export const PHOTO_MAX_EDGE = 1600; // 청소년 사진 — 브라우저에서 줄임
export const DOC_IMAGE_MAX_EDGE = 2400; // 서류 사진 — 글자가 읽히게 조금 크게(EXIF 는 똑같이 지움)

// --- 상태 ----------------------------------------------------------------
export type AppStatus =
  | "draft"
  | "submitted"
  | "needs_fix"
  | "docs_ok"
  | "accepted"
  | "waitlisted"
  | "rejected";

export const APP_STATUS_LABEL: Record<AppStatus, string> = {
  draft: "작성중",
  submitted: "제출",
  needs_fix: "보완요청",
  docs_ok: "서류확인",
  accepted: "합격",
  waitlisted: "대기",
  rejected: "불합격",
};

// scheduled(모집 예정): 보호자 화면에 회차·기간·준비 서류만 미리 보여 주고 인증·신청은 막습니다.
export type RecruitmentStatus = "draft" | "scheduled" | "open" | "closed" | "ended";
export const RECRUITMENT_STATUS_LABEL: Record<RecruitmentStatus, string> = {
  draft: "준비",
  scheduled: "모집 예정",
  open: "접수중",
  closed: "마감",
  ended: "종료",
};

// --- 단계 ----------------------------------------------------------------
export const STEPS = [
  { n: 1, key: "youth", title: "청소년 정보" },
  { n: 2, key: "guardian", title: "보호자 정보" },
  { n: 3, key: "priority", title: "우선지원 유형" },
  { n: 4, key: "docs", title: "증빙 서류" },
  { n: 5, key: "consent", title: "동의서" },
  { n: 6, key: "extra", title: "귀가·알레르기" },
  { n: 7, key: "sign", title: "확인·서명" },
] as const;
export type SectionKey = (typeof STEPS)[number]["key"];

// 보완요청으로 다시 여는 항목 키(bk_applications.fix_items):
//   'youth' | 'photo' | 'guardian' | 'priority' | 'consent' | 'extra' | 'recommend' | 'doc:<doc_kind>'
export const FIX_ITEM_LABEL: Record<string, string> = {
  youth: "청소년 정보",
  photo: "청소년 사진",
  guardian: "보호자 정보",
  priority: "우선지원 유형",
  consent: "동의서",
  extra: "귀가·알레르기",
  recommend: "추천서(추천자 다시 지정)",
};
export function fixItemLabel(k: string): string {
  if (k.startsWith("doc:")) return `서류: ${docKindLabel(k.slice(4))}`;
  return FIX_ITEM_LABEL[k] ?? k;
}

// --- 학년 ----------------------------------------------------------------
export const GRADES = ["초1", "초2", "초3", "초4", "초5", "초6", "중1", "중2", "중3"];

// --- 우선지원 유형 ---------------------------------------------------------
export const PRIORITY_TYPES = [
  { key: "low_income", label: "저소득층(수급자·차상위)" },
  { key: "legal_single_parent", label: "법정 한부모" },
  { key: "single_parent", label: "일반 한부모" },
  { key: "multicultural", label: "다문화" },
  { key: "grandparent", label: "조손" },
  { key: "multi_child", label: "2자녀 이상" },
  { key: "disability", label: "장애가정" },
  { key: "dual_income", label: "맞벌이" },
  { key: "recommended", label: "추천(돌봄 필요)" },
] as const;
export type PriorityKey = (typeof PRIORITY_TYPES)[number]["key"];
export const PRIORITY_KEYS = PRIORITY_TYPES.map((p) => p.key) as readonly string[];
export const priorityLabel = (k: string) => PRIORITY_TYPES.find((p) => p.key === k)?.label ?? k;

// --- 서류 칸 ---------------------------------------------------------------
//   양식 표 기준(관장 확정 2026-11-03). 공통 2종(필수) + 고른 유형의 서류 칸만.
//   sensitive=true 는 직원 화면에서 [민감정보 보기] 뒤에만 열람.
//   추가 서류가 없는 유형(일반 한부모·조손·다문화·2자녀 이상·장애가족)은 직원 화면에서 '가족관계증명서로 확인' 체크.
export type DocKind = {
  key: string;
  label: string;
  hint?: string;
  forType: PriorityKey | "common";
  required: boolean; // 그 유형을 골랐을 때 꼭 올려야 하는지
  sensitive?: boolean;
};

export const DOC_KINDS: DocKind[] = [
  { key: "resident_register", label: "주민등록등본", hint: "주민등록번호 뒷자리 미기재로 발급", forType: "common", required: true },
  { key: "family_relation", label: "가족관계증명서", hint: "주민등록번호 뒷자리 미기재로 발급", forType: "common", required: true },
  { key: "low_income_cert", label: "수급자증명서 또는 차상위증명서", forType: "low_income", required: true },
  { key: "single_parent_cert", label: "한부모가족증명서", forType: "legal_single_parent", required: true },
  {
    key: "multicultural_doc",
    label: "외국인등록증 · 혼인관계증명서 · 외국인등록사실증명서 중 해당 서류",
    hint: "결혼이주자가 국적을 포기하지 않은 경우에만 올려 주세요(그 밖에는 가족관계증명서로 확인합니다)",
    forType: "multicultural",
    required: false,
  },
  {
    key: "disability_doc",
    label: "장애인등록증 또는 장애인복지카드",
    hint: "청소년 본인 또는 가정 내 가족의 것. 가족이 장애인이면 그 가족이 포함된 가족관계증명서로 확인합니다",
    forType: "disability",
    required: true,
    sensitive: true,
  },
  {
    key: "dual_income_father",
    label: "맞벌이 증명 서류 — 부",
    hint: "건강보험납부확인서, 재직증명서, 위촉계약서, 고용보험 피보험자격내역서 등",
    forType: "dual_income",
    required: true,
  },
  {
    key: "dual_income_mother",
    label: "맞벌이 증명 서류 — 모",
    hint: "건강보험납부확인서, 재직증명서, 위촉계약서, 고용보험 피보험자격내역서 등",
    forType: "dual_income",
    required: true,
  },
];

// 추가 서류 없이 가족관계증명서로 확인하는 유형 — 직원 화면 체크 칸.
//   기록은 bk_application_access_logs(action='family_check', target=유형 키, detail.checked) — 가장 최근 행이 현재 값.
export const FAMILY_CHECK_TYPES: { key: PriorityKey; label: string }[] = [
  { key: "single_parent", label: "일반 한부모" },
  { key: "grandparent", label: "조손" },
  { key: "multicultural", label: "다문화" },
  { key: "multi_child", label: "2자녀 이상(모두 만 19세 미만)" },
  { key: "disability", label: "장애가정(가족이 장애인인 경우)" },
];

export const docKindLabel = (k: string) =>
  k === "photo" ? "청소년 사진" : DOC_KINDS.find((d) => d.key === k)?.label ?? k;

export function docKindsFor(priority: readonly string[]): DocKind[] {
  return DOC_KINDS.filter((d) => d.forType === "common" || priority.includes(d.forType));
}

export function isDocKindKey(k: string): boolean {
  return DOC_KINDS.some((d) => d.key === k);
}

// --- 추천서 ----------------------------------------------------------------
//   양식: 추천 사유(경제적 형편 / 보호자 없어 방치 / 기타( )) + 특이사항(추천사유 구체적 작성).
//   DB: reasons(키), opinion = 기타( ) 내용, notes = 특이사항(추천사유 구체적 작성).
export const RECOMMEND_TOKEN_DAYS = 14;
export const RECOMMEND_REASONS = [
  { key: "economic", label: "가정의 경제적인 형편이 어렵다" },
  { key: "no_guardian", label: "방과 후 특별한 보호자가 없어 방치된다" },
  { key: "other", label: "기타" },
] as const;
export const recommendReasonLabel = (k: string) =>
  RECOMMEND_REASONS.find((r) => r.key === k)?.label ?? k;

// --- 동의서 ----------------------------------------------------------------
//   양식 PDF 원문 그대로(consent_version '2027-v1'). consent_records.consent_key 와 같은 키.
//   required=true 인데 '아니오'면 제출 불가.
export const PLEDGE_INTRO =
  "청소년의 보호자로서 동래구청소년센터에서 실시하고 있는 청소년방과후아카데미 입학을 동의하며 다음과 같은 내용을 준수하겠습니다.";
export const PLEDGE_ITEMS = [
  "청소년에게 청소년방과후아카데미의 규칙을 준수하도록 교육하겠습니다.",
  "청소년방과후아카데미에서 발송하는 가정통신문을 반드시 확인하겠습니다.",
  "청소년방과후아카데미에서 실시하는 간담회, 상담, 교육 및 기타 행사에 적극적으로 참여하겠습니다.",
  "청소년방과후아카데미 교육과 청소년에게 대해 관심을 갖겠습니다.",
  "청소년의 지속적인 문제 발생 시 방과후아카데미 운영규정에 따라 퇴소조치 될 수 있음에 동의합니다.",
];

// 보호자 동의서 6번 — 귀가 방법.
export const RETURN_METHODS = [
  { key: "shuttle", label: "귀가차량 이용" },
  { key: "guardian", label: "보호자동행귀가" },
  { key: "alone", label: "청소년 혼자귀가" },
  { key: "other", label: "기타" },
] as const;
export const returnMethodLabel = (k: string | null | undefined) =>
  RETURN_METHODS.find((r) => r.key === k)?.label ?? (k ?? "");

export type ConsentDef = {
  key: string;
  title: string;
  required: boolean; // 필수 — '아니오'면 제출 불가
  body: string; // 펼쳐보기 원문
  noReason?: string; // '아니오' 일 때 안내
};

const REFUSE =
  "동의를 거부할 권리가 있습니다. 그러나 동의를 거부할 경우 청소년방과후아카데미 참여에 제한을 받을 수 있습니다.";

export const CONSENTS: ConsentDef[] = [
  {
    key: "privacy_required",
    title: "개인정보 수집·이용 동의(필수)",
    required: true,
    body:
      "■ 수집 항목: (청소년) 성명, 성별, 생년월일, 학교, 학년, 반, 연락처, 주소, 가족정보 / (보호자) 성명, 연락처\n" +
      "■ 수집·이용 목적: 청소년방과후아카데미 운영(모집, 현황관리, 연계사업, 면담 등)\n" +
      "■ 보유·이용 기간: 5년\n" +
      `■ ${REFUSE}`,
    noReason: "필수 동의 항목이라 '아니오'를 고르면 신청서를 제출할 수 없습니다.",
  },
  {
    key: "sensitive_medical_disability",
    title: "민감정보 수집·이용 동의(필수)",
    required: true,
    body:
      "■ 수집 항목: (청소년) 의료·장애정보(식품알레르기, 장애 여부 및 증빙 포함)\n" +
      "■ 수집·이용 목적: 청소년의 건강, 사고관리 및 우선지원 대상 확인\n" +
      "■ 보유·이용 기간: 3년\n" +
      `■ ${REFUSE}`,
    noReason: "필수 동의 항목이라 '아니오'를 고르면 신청서를 제출할 수 없습니다.",
  },
  {
    key: "optional_email",
    title: "선택정보 수집·이용 동의(선택)",
    required: false,
    body:
      "■ 수집 항목: 청소년·학부모 이메일\n" +
      "■ 수집·이용 목적: 프로그램 안내 및 소식지\n" +
      "■ 보유·이용 기간: 3년\n" +
      "■ 동의를 거부할 권리가 있으며, 거부하셔도 청소년방과후아카데미에 참여하실 수 있습니다.",
  },
  {
    key: "third_party",
    title: "개인정보 제3자 제공 동의(필수)",
    required: true,
    body:
      "■ 제공받는 기관: 성평등가족부, 한국청소년활동진흥원\n" +
      "■ 제공 목적: 청소년방과후아카데미 사업관리 및 지원\n" +
      "■ 제공 항목: (청소년) 성명, 성별, 생년월일, 학교, 학년, 반, 연락처, 주소, 가족정보(가정환경), 의료정보(건강상태) / (보호자) 성명, 연락처, 복지지원 자격정보\n" +
      "■ 보유·이용 기간: 5년\n" +
      `■ ${REFUSE}`,
    noReason: "필수 동의 항목이라 '아니오'를 고르면 신청서를 제출할 수 없습니다.",
  },
  {
    key: "attendance",
    title: "출석률 유지 동의(필수)",
    required: true,
    body:
      "1) 방과후아카데미 수업에 분기별 무단결석 3회 이상 시 경고 후 퇴소 조치를 할 수 있다.\n" +
      "2) 다른 사람의 수업을 방해하거나 수업 중 무단 이탈, 고성방가, 폭력 등에 대해서 경고 후 퇴소 조치 할 수 있다.\n" +
      "3) 특별한 사유(질병, 여행 등)에 대해서는 사전(당일 16시 이전)에 담당지도자와 상의하고 적절한 조치를 받을 수 있도록 한다.\n" +
      "4) 1호~3호에 대해 지켜지지 않을 경우, 출석률 유지를 위한 관리계획에 따라 비자발적 중도탈락 처리절차에 동의한다.",
    noReason: "출석률 유지에 동의해야 신청서를 제출할 수 있습니다.",
  },
];

export const consentByKey = (k: string) => CONSENTS.find((c) => c.key === k);

// --- 식품 알레르기 -------------------------------------------------------
//   원인 식품 19종 = 학교급식 표준 번호(lib/allergens ALLERGENS 와 같은 번호). 증상 부위는 양식 그대로.
export const ALLERGY_SYMPTOMS = [
  { key: "mouth", label: "입(가려움·따가움·부풀어 오름)" },
  { key: "skin", label: "피부(가려움·붉어짐·두드러기·부풀어 오름)" },
  { key: "stomach", label: "소화기(구토·설사·메스꺼움·복부 경련)" },
  { key: "throat", label: "목(조여옴·목이 쉼·기침)" },
  { key: "lung", label: "폐(숨이 가쁨·기침·천식)" },
  { key: "heart", label: "심장(저혈압·기절·창백·푸르게 변함)" },
  { key: "other", label: "기타(직접 기재)" },
] as const;
export const allergySymptomLabel = (k: string) =>
  ALLERGY_SYMPTOMS.find((s) => s.key === k)?.label ?? k;

// --- 입력값 모양(bk_applications.data / sensitive) -------------------------
export type YouthInfo = {
  name: string;
  gender: "M" | "F" | "";
  birth: string; // YYYY-MM-DD
  zip: string;
  addr1: string;
  addr2: string;
  tel: string;
  mobile: string;
  email: string;
  school: string;
  grade: string;
  class_no: string;
  teacher: string;
  motive: string;
};
export type GuardianInfo = { name: string; relation: "legal" | "proxy" | ""; email: string };
export type ConsentAnswers = {
  pledge: boolean[]; // PLEDGE_ITEMS 각각
  answers: Record<string, boolean | null>; // CONSENTS 키 → 예/아니오(null = 아직)
};
export type ReturnInfo = {
  method: "shuttle" | "guardian" | "alone" | "other" | "";
  other: string;
  stop_seq: number | typeof STOP_ETC | null; // 'etc' = 기타(직접 입력) → stop_place 에 장소
  stop_place: string;
};
export const STOP_ETC = "etc" as const;
export type AllergyInfo = {
  has: boolean | null;
  foods: number[];
  other: string;
  symptoms: string[];
  symptom_other: string; // 증상 '기타' 직접 기재
  treated: boolean | null; // 진료를 받고 있음
  self_aware: boolean | null; // 스스로 원인 식품을 구분할 수 있음
};
export type AppData = {
  youth: YouthInfo;
  guardian: GuardianInfo;
  priority: string[];
  consent: ConsentAnswers;
  ret: ReturnInfo;
};
export type AppSensitive = { allergy: AllergyInfo };

export const GUARDIAN_RELATION_LABEL: Record<string, string> = {
  legal: "법적보호자",
  proxy: "보호자 대리인",
};

export function emptyData(): AppData {
  return {
    youth: {
      name: "",
      gender: "",
      birth: "",
      zip: "",
      addr1: "",
      addr2: "",
      tel: "",
      mobile: "",
      email: "",
      school: "",
      grade: "",
      class_no: "",
      teacher: "",
      motive: "",
    },
    guardian: { name: "", relation: "", email: "" },
    priority: [],
    consent: { pledge: PLEDGE_ITEMS.map(() => false), answers: {} },
    ret: { method: "", other: "", stop_seq: null, stop_place: "" },
  };
}

export function emptySensitive(): AppSensitive {
  return { allergy: { has: null, foods: [], other: "", symptoms: [], symptom_other: "", treated: null, self_aware: null } };
}

// 저장된 jsonb(옛 버전·일부만 있음)를 지금 모양으로 맞춤.
export function normalizeData(raw: unknown): AppData {
  const e = emptyData();
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<AppData>;
  return {
    youth: { ...e.youth, ...(r.youth ?? {}) },
    guardian: { ...e.guardian, ...(r.guardian ?? {}) },
    priority: Array.isArray(r.priority) ? r.priority.filter((k) => PRIORITY_KEYS.includes(k)) : [],
    consent: {
      pledge: PLEDGE_ITEMS.map((_, i) => !!r.consent?.pledge?.[i]),
      answers: { ...(r.consent?.answers ?? {}) },
    },
    ret: { ...e.ret, ...(r.ret ?? {}) },
  };
}

export function normalizeSensitive(raw: unknown): AppSensitive {
  const e = emptySensitive();
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<AppSensitive>;
  return { allergy: { ...e.allergy, ...(r.allergy ?? {}) } };
}

// --- 검사(서버·브라우저 같은 규칙) -------------------------------------------
const digits = (s: string) => (s ?? "").replace(/\D/g, "");
export const isMobile = (s: string) => /^01[0-9]{8,9}$/.test(digits(s));
export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((s ?? "").trim());

// 단계별 빠진 것 — 비어 있으면 통과. 다음 단계로 갈 때·제출할 때 씀.
export function sectionProblems(
  key: SectionKey,
  d: AppData,
  s: AppSensitive,
  ctx: {
    hasPhoto: boolean;
    filesByKind: Record<string, number>;
    hasRecommender: boolean;
    shuttleStopCount: number;
    targetGrades: string[];
  },
): string[] {
  const p: string[] = [];
  if (key === "youth") {
    const y = d.youth;
    if (!y.name.trim()) p.push("청소년 이름을 적어 주세요.");
    if (!y.gender) p.push("성별을 골라 주세요.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(y.birth)) p.push("생년월일을 골라 주세요.");
    if (!y.addr1.trim()) p.push("주소를 찾아 넣어 주세요.");
    if (!y.mobile.trim() && !y.tel.trim()) p.push("청소년 전화나 휴대전화 중 하나는 적어 주세요.");
    if (y.mobile.trim() && !isMobile(y.mobile)) p.push("청소년 휴대전화 번호를 다시 확인해 주세요.");
    if (y.email.trim() && !isEmail(y.email)) p.push("청소년 이메일 형식을 확인해 주세요.");
    if (!y.school.trim()) p.push("학교를 적어 주세요.");
    if (!y.grade) p.push("학년을 골라 주세요.");
    else if (ctx.targetGrades.length > 0 && !ctx.targetGrades.includes(y.grade))
      p.push(`이번 모집 대상 학년은 ${ctx.targetGrades.join("·")} 입니다.`);
    if (!ctx.hasPhoto) p.push("청소년 사진을 올려 주세요(증명사진이 아니어도 됩니다).");
  }
  if (key === "guardian") {
    if (!d.guardian.name.trim()) p.push("보호자 성명을 적어 주세요.");
    if (!d.guardian.relation) p.push("관계를 골라 주세요.");
    if (d.guardian.email.trim() && !isEmail(d.guardian.email)) p.push("보호자 이메일 형식을 확인해 주세요.");
  }
  if (key === "priority") {
    if (d.priority.length === 0) p.push("해당하는 우선지원 유형을 하나 이상 골라 주세요.");
  }
  if (key === "docs") {
    for (const k of docKindsFor(d.priority)) {
      if (k.required && !(ctx.filesByKind[k.key] > 0)) p.push(`'${k.label}'을(를) 올려 주세요.`);
    }
    if (d.priority.includes("recommended") && !ctx.hasRecommender)
      p.push("추천자 이름·연락처를 넣고 [추천서 요청 문자 보내기]를 눌러 주세요.");
  }
  if (key === "consent") {
    if (!d.consent.pledge.every(Boolean)) p.push("보호자 동의서 1~5번에 모두 동의해 주세요.");
    if (!d.ret.method) p.push("귀가 방법을 골라 주세요.");
    if (d.ret.method === "other" && !d.ret.other.trim()) p.push("기타 귀가 방법을 적어 주세요.");
    for (const c of CONSENTS) {
      const a = d.consent.answers[c.key];
      if (a == null) p.push(`'${c.title}'에 예/아니오를 골라 주세요.`);
      else if (c.required && a === false) p.push(`'${c.title}' — ${c.noReason ?? "동의해야 제출할 수 있습니다."}`);
    }
    if (d.consent.answers.optional_email === false && (d.youth.email.trim() || d.guardian.email.trim()))
      p.push("이메일 수집에 동의하지 않으셨으면 입력한 이메일을 지워 주세요.");
  }
  if (key === "extra") {
    if (d.ret.method === "shuttle" && ctx.shuttleStopCount > 0 && d.ret.stop_seq == null)
      p.push("귀가차량 하차 장소를 골라 주세요.");
    if (d.ret.method === "shuttle" && d.ret.stop_seq === STOP_ETC && !d.ret.stop_place.trim())
      p.push("기타 하차 장소를 적어 주세요.");
    const a = s.allergy;
    if (a.has == null) p.push("식품 알레르기가 있는지 골라 주세요.");
    if (a.has) {
      if (a.foods.length === 0 && !a.other.trim()) p.push("알레르기 원인 식품을 골라 주세요.");
      if (a.symptoms.length === 0) p.push("알레르기 증상 부위를 골라 주세요.");
      if (a.symptoms.includes("other") && !a.symptom_other.trim()) p.push("기타 증상을 적어 주세요.");
      if (a.treated == null) p.push("진료를 받고 있는지 골라 주세요.");
      if (a.self_aware == null) p.push("스스로 원인 식품을 구분할 수 있는지 골라 주세요.");
    }
  }
  return p;
}

// 보완요청 중 이 단계(또는 서류 칸)를 고칠 수 있는지.
export function canEditSection(
  status: AppStatus,
  fixItems: readonly string[],
  key: SectionKey | "photo" | `doc:${string}` | "recommend",
): boolean {
  if (status === "draft") return true;
  if (status !== "needs_fix") return false;
  if (key === "docs") return fixItems.some((k) => k.startsWith("doc:")) || fixItems.includes("recommend");
  if (key === "youth") return fixItems.includes("youth") || fixItems.includes("photo");
  return fixItems.includes(key);
}

// 목록용 컬럼 — data/sensitive 에서 뽑아 bk_applications 컬럼에 같이 씀.
export function columnsFrom(d: AppData, s: AppSensitive) {
  return {
    youth_name: d.youth.name.trim() || null,
    youth_gender: d.youth.gender || null,
    youth_birth: /^\d{4}-\d{2}-\d{2}$/.test(d.youth.birth) ? d.youth.birth : null,
    school: d.youth.school.trim() || null,
    grade: d.youth.grade || null,
    guardian_name: d.guardian.name.trim() || null,
    priority_types: d.priority,
    return_method: d.ret.method || null,
    has_allergy: s.allergy.has,
  };
}

// 모집 예정 화면의 "미리 준비해 주세요" 기본 문구(prep_notice 가 비었을 때) — 서류 칸 표에서 만듭니다.
export function defaultPrepNotice(): string {
  const lines: string[] = ["■ 모든 신청자 공통"];
  for (const d of DOC_KINDS.filter((x) => x.forType === "common")) lines.push(`· ${d.label}${d.hint ? ` (${d.hint})` : ""}`);
  lines.push("", "■ 우선지원 유형별(해당하는 경우만)");
  for (const p of PRIORITY_TYPES) {
    const docs = DOC_KINDS.filter((x) => x.forType === p.key);
    if (p.key === "recommended") {
      lines.push(`· ${p.label}: 추천서 — 신청 중에 추천자(학교 선생님 등) 휴대폰 번호를 적으면 추천자에게 작성 링크가 갑니다`);
    } else if (docs.length === 0) {
      lines.push(`· ${p.label}: 추가 서류 없음(가족관계증명서로 확인)`);
    } else if (p.key === "dual_income") {
      lines.push(`· ${p.label}: 부·모 각각 ${docs[0].hint ?? "맞벌이 증명 서류"}`);
    } else {
      lines.push(`· ${p.label}: ${docs.map((d) => d.label).join(" / ")}${docs[0].hint ? ` (${docs[0].hint})` : ""}`);
    }
  }
  lines.push("", "서류는 휴대폰으로 찍은 사진이나 PDF로 올릴 수 있습니다.");
  return lines.join("\n");
}

// 보호자 첫 화면에 보일 회차 단계 — open 이라도 시작 전이면 '모집 예정', 마감이 지났으면 '마감'.
//   draft·ended 는 보이지 않음(null).
export type RecruitmentPhase = "open" | "scheduled" | "closed";
export function recruitmentPhase(
  r: { status: string; apply_start_at: string; apply_end_at: string },
  nowMs = Date.now(),
): RecruitmentPhase | null {
  const startMs = new Date(r.apply_start_at).getTime();
  const endMs = new Date(r.apply_end_at).getTime();
  if (r.status === "scheduled") return "scheduled";
  if (r.status === "closed") return "closed";
  if (r.status !== "open") return null;
  if (nowMs < startMs) return "scheduled";
  if (nowMs >= endMs) return "closed";
  return "open";
}

// 회차가 지금 접수중인지(상태 open + 기간 안).
export function isRecruitmentOpen(
  r: { status: string; apply_start_at: string; apply_end_at: string },
  nowMs = Date.now(),
): boolean {
  return (
    r.status === "open" &&
    new Date(r.apply_start_at).getTime() <= nowMs &&
    nowMs < new Date(r.apply_end_at).getTime()
  );
}

// 한국 시간 표시 "2026. 11. 20.(금) 18:00"
export function fmtKst(iso: string | null | undefined, withTime = true): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).format(d);
}

export type ShuttleStop = { seq: number; time: string; place: string };
// '도보 귀가'처럼 차를 타지 않는 항목은 시간을 보이지 않는다.
export const stopShowsTime = (st: ShuttleStop) => !!st.time && st.place.replace(/\s/g, "") !== "도보귀가";
// 신청서에서 고른 하차 장소 — 목록 번호면 그 항목, '기타'면 { seq:'etc', place: 직접 적은 곳 }. 귀가차량이 아니면 null.
export type ChosenStop = { seq: number | typeof STOP_ETC; time: string; place: string };
export function chosenStop(stops: ShuttleStop[], ret: ReturnInfo): ChosenStop | null {
  if (ret.method !== "shuttle" || ret.stop_seq == null) return null;
  if (ret.stop_seq === STOP_ETC) return ret.stop_place?.trim() ? { seq: STOP_ETC, time: "", place: ret.stop_place.trim() } : null;
  const st = stops.find((x) => x.seq === ret.stop_seq);
  return st ? { ...st, time: stopShowsTime(st) ? st.time : "" } : null;
}
export function stopText(st: ChosenStop | null): string {
  if (!st) return "";
  if (st.seq === STOP_ETC) return `기타 — ${st.place}`;
  return `${st.seq}. ${st.time ? `${st.time} ` : ""}${st.place}`;
}
export function parseStops(raw: unknown): ShuttleStop[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => x as Partial<ShuttleStop>)
    .filter((x) => typeof x.seq === "number" && typeof x.place === "string")
    .map((x) => ({ seq: x.seq!, time: String(x.time ?? ""), place: x.place! }))
    .sort((a, b) => a.seq - b.seq);
}
