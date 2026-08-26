// =====================================================================
// 거래처 관리 — 공용 타입·순수 헬퍼 (클라이언트 안전).
//   * 서버 액션(app/hr/partners)·화면이 공유하는 단일 출처.
//     여기에는 DB 접근 코드를 두지 않습니다(순수 함수·상수만).
//   * 테이블: business_partners(거래처) 1 : N partner_contacts(담당자),
//     그리고 1 : N partner_transaction_logs(거래이력).
//     모두 RLS on → service_role 경유만 가능.
//   * 명함첩(business_cards)이 "받은편지함"이라면 거래처는 "정리된 주소록"입니다.
//     명함이 없어도(학교·프로그램 의뢰처처럼) 수기로 등록할 수 있어야 합니다.
//   * ⚠️ 거래처 담당자는 외부인 개인정보입니다. 값을 로그로 출력하지 마세요.
// =====================================================================

// 분야 — 관장이 인수인계 때 "시설 거래처만", "학교 목록만" 뽑아보는 축입니다.
//   DB 에 check 제약이 없어(자유 text) 저장 전 이 목록으로 정규화합니다.
export const PARTNER_CATEGORIES = [
  "시설",
  "안전",
  "회계",
  "구매",
  "학교",
  "프로그램의뢰처",
  "기타",
] as const;

export type PartnerCategory = (typeof PARTNER_CATEGORIES)[number];

export const DEFAULT_PARTNER_CATEGORY: PartnerCategory = "기타";

// 분야별 배지 색 — 목록에서 분야를 한눈에 구분합니다(lib/ui 토큰 사용).
export const PARTNER_CATEGORY_BADGE: Record<PartnerCategory, string> = {
  시설: "bg-brand-blue-soft text-brand-blue",
  안전: "bg-brand-red/15 text-brand-red",
  회계: "bg-brand-green/15 text-brand-green",
  구매: "bg-violet-100 text-violet-700",
  학교: "bg-brand-yellow/25 text-amber-800",
  프로그램의뢰처: "bg-navy-soft text-navy",
  기타: "bg-surface text-ink-muted",
};

// business_partners 한 행.
export type BusinessPartner = {
  id: string;
  name: string;
  category: PartnerCategory;
  phone: string;
  fax: string;
  address: string;
  website: string;
  memo: string;
  is_active: boolean;
  // 비공개 — true 면 관리자(M0·hr)에게만 보입니다. 소속 담당자도 함께 가려집니다.
  //   일반 직원에게는 서버에서 걸러져 아예 전달되지 않습니다.
  is_private: boolean;
  registered_by: string;
  created_at: string;
  updated_at: string;
};

// partner_contacts 한 행. card_id 는 2단계(명함첩 연결)에서 씁니다.
export type PartnerContact = {
  id: string;
  partner_id: string;
  person_name: string;
  title: string;
  department: string;
  mobile: string;
  phone: string;
  email: string;
  memo: string;
  card_id: string | null;
  is_primary: boolean;
  registered_by: string;
  created_at: string;
  updated_at: string;
};

// partner_transaction_logs 한 행 — 그 거래처와 실제로 주고받은 일의 기록.
//   담당자 명단(누구와 연락하는가)과 거래이력(무엇을 했는가)은 다른 개념이라
//   테이블을 나눴습니다. 예: "2026-03 간판 제작", "2026-07 인테리어 공사".
export type PartnerTransactionLog = {
  id: string;
  partner_id: string;
  // 거래 일자 "YYYY-MM-DD" (미입력이면 "").
  occurred_on: string;
  content: string;
  created_by: string;
  created_at: string;
  // 이 이력을 수정·삭제할 수 있는지 — 서버가 판정해 내려줍니다(M0 또는 등록자
  //   본인). 실제 차단은 액션이 다시 확인합니다.
  canEdit: boolean;
};

// 목록·상세가 함께 쓰는 형태 — 거래처 + 소속 담당자 + 거래이력.
export type PartnerWithContacts = BusinessPartner & {
  contacts: PartnerContact[];
  logs: PartnerTransactionLog[];
};

// --- 화면 라벨 (등록 폼·상세 공용) ---
export type PartnerFieldKey = "phone" | "fax" | "address" | "website";

export const PARTNER_FIELD_LABELS: { key: PartnerFieldKey; label: string }[] = [
  { key: "phone", label: "대표전화" },
  { key: "fax", label: "팩스" },
  { key: "website", label: "웹사이트" },
  { key: "address", label: "주소" },
];

export type ContactFieldKey =
  | "person_name"
  | "title"
  | "department"
  | "mobile"
  | "phone"
  | "email";

export const CONTACT_FIELD_LABELS: { key: ContactFieldKey; label: string }[] = [
  { key: "person_name", label: "이름" },
  { key: "title", label: "직책" },
  { key: "department", label: "부서" },
  { key: "mobile", label: "휴대전화" },
  { key: "phone", label: "직통전화" },
  { key: "email", label: "이메일" },
];

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// 자유 text 로 들어온 분야를 목록 값으로 맞춥니다. 모르면 "기타".
export function normalizePartnerCategory(v: unknown): PartnerCategory {
  const s = str(v);
  return (PARTNER_CATEGORIES as readonly string[]).includes(s)
    ? (s as PartnerCategory)
    : DEFAULT_PARTNER_CATEGORY;
}

// --- DB row 정규화 (service_role 조회 결과 → 타입) ---
export function toBusinessPartner(
  raw: Record<string, unknown>,
): BusinessPartner {
  return {
    id: String(raw.id ?? ""),
    name: str(raw.name),
    category: normalizePartnerCategory(raw.category),
    phone: str(raw.phone),
    fax: str(raw.fax),
    address: str(raw.address),
    website: str(raw.website),
    memo: str(raw.memo),
    // 기본값 true — 옛 행에 null 이 있어도 "거래 중"으로 봅니다.
    is_active: raw.is_active !== false,
    // 기본값 false(공개) — 명시적으로 true 일 때만 비공개입니다.
    is_private: raw.is_private === true,
    registered_by: str(raw.registered_by),
    created_at: String(raw.created_at ?? ""),
    updated_at: String(raw.updated_at ?? ""),
  };
}

export function toPartnerContact(raw: Record<string, unknown>): PartnerContact {
  return {
    id: String(raw.id ?? ""),
    partner_id: String(raw.partner_id ?? ""),
    person_name: str(raw.person_name),
    title: str(raw.title),
    department: str(raw.department),
    mobile: str(raw.mobile),
    phone: str(raw.phone),
    email: str(raw.email),
    memo: str(raw.memo),
    card_id: (raw.card_id as string | null) ?? null,
    is_primary: raw.is_primary === true,
    registered_by: str(raw.registered_by),
    created_at: String(raw.created_at ?? ""),
    updated_at: String(raw.updated_at ?? ""),
  };
}

// 거래이력 한 행. canEdit 은 서버가 계산해 넘깁니다(클라이언트에서 만들지 않습니다).
export function toPartnerTransactionLog(
  raw: Record<string, unknown>,
  canEdit: boolean,
): PartnerTransactionLog {
  return {
    id: String(raw.id ?? ""),
    partner_id: String(raw.partner_id ?? ""),
    // date 컬럼은 "YYYY-MM-DD" 로 옵니다. null 이면 빈 문자열.
    occurred_on: str(raw.occurred_on),
    content: str(raw.content),
    created_by: str(raw.created_by),
    created_at: String(raw.created_at ?? ""),
    canEdit,
  };
}

// 거래이력 정렬 — 최신순(거래 일자 내림차순, 같으면 등록 늦은 것 먼저).
//   일자가 비어 있는 행은 뒤로 보냅니다.
export function sortTransactionLogs(
  list: PartnerTransactionLog[],
): PartnerTransactionLog[] {
  return [...list].sort((a, b) => {
    if (a.occurred_on !== b.occurred_on) {
      if (!a.occurred_on) return 1;
      if (!b.occurred_on) return -1;
      return b.occurred_on.localeCompare(a.occurred_on);
    }
    return b.created_at.localeCompare(a.created_at);
  });
}

// 목록 미리보기용 — 가장 최근 거래이력 한 건(없으면 null).
export function latestTransactionLog(
  logs: PartnerTransactionLog[],
): PartnerTransactionLog | null {
  return sortTransactionLogs(logs)[0] ?? null;
}

// 담당자 정렬 — 대표담당자 먼저, 그다음 등록순.
export function sortContacts(list: PartnerContact[]): PartnerContact[] {
  return [...list].sort((a, b) => {
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
    return a.created_at.localeCompare(b.created_at);
  });
}

// 담당자 한 줄 표기 — "홍길동 · 교감 · 행정실".
export function contactLine(c: PartnerContact): string {
  return [c.person_name, c.title, c.department].filter(Boolean).join(" · ");
}

// 대표담당자(없으면 첫 담당자, 그것도 없으면 null).
export function primaryContact(
  contacts: PartnerContact[],
): PartnerContact | null {
  return contacts.find((c) => c.is_primary) ?? contacts[0] ?? null;
}

// 목록 검색용 — 거래처명뿐 아니라 담당자명·연락처까지 훑습니다.
//   화면(클라이언트)에서만 씁니다. 개인정보라 서버 로그에 남기지 않습니다.
export function partnerSearchText(p: PartnerWithContacts): string {
  return [
    p.name,
    p.category,
    p.phone,
    p.fax,
    p.address,
    p.website,
    p.memo,
    ...p.contacts.flatMap((c) => [
      c.person_name,
      c.title,
      c.department,
      c.mobile,
      c.phone,
      c.email,
      c.memo,
    ]),
  ]
    .join(" ")
    .toLowerCase();
}

// 분야별 건수 — 분야 탭·인수인계용 요약에 씁니다.
export function countByCategory(
  list: PartnerWithContacts[],
): Record<PartnerCategory, number> {
  const out = {} as Record<PartnerCategory, number>;
  for (const cat of PARTNER_CATEGORIES) out[cat] = 0;
  for (const p of list) out[p.category] += 1;
  return out;
}
