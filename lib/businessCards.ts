// =====================================================================
// 명함첩 — 공용 타입·순수 헬퍼 (클라이언트 안전).
//   * 서버 액션(app/hr/cards)·화면이 공유하는 단일 출처.
//     여기에는 DB 접근 코드를 두지 않습니다(순수 함수·상수만).
//   * 테이블: business_cards (RLS on → service_role 경유).
//   * ⚠️ 명함은 외부인 개인정보입니다. 값을 로그로 출력하지 마세요.
// =====================================================================

// business_cards 한 행.
export type BusinessCard = {
  id: string;
  company: string;
  department: string;
  title: string;
  person_name: string;
  mobile: string;
  phone: string;
  fax: string;
  email: string;
  address: string;
  website: string;
  memo: string;
  image_path: string | null;
  // 비공개 — true 면 관리자(M0·hr)에게만 보입니다(원본 이미지 URL 포함).
  //   일반 직원에게는 서버에서 걸러져 아예 전달되지 않습니다.
  is_private: boolean;
  registered_by: string;
  created_at: string;
  updated_at: string;
};

// AI 가 추출하는 항목(메모·이미지 제외) — 폼 필드와 1:1 로 대응합니다.
export const OCR_FIELD_KEYS = [
  "company",
  "department",
  "title",
  "person_name",
  "mobile",
  "phone",
  "fax",
  "email",
  "address",
  "website",
] as const;

export type OcrFieldKey = (typeof OCR_FIELD_KEYS)[number];
export type CardFields = Record<OcrFieldKey, string>;

// 화면 라벨 — 등록 폼·상세 보기 공용.
export const CARD_FIELD_LABELS: { key: OcrFieldKey; label: string }[] = [
  { key: "company", label: "업체명" },
  { key: "person_name", label: "이름" },
  { key: "department", label: "부서" },
  { key: "title", label: "직책" },
  { key: "mobile", label: "휴대전화" },
  { key: "phone", label: "전화" },
  { key: "fax", label: "팩스" },
  { key: "email", label: "이메일" },
  { key: "website", label: "웹사이트" },
  { key: "address", label: "주소" },
];

export const EMPTY_FIELDS: CardFields = {
  company: "",
  department: "",
  title: "",
  person_name: "",
  mobile: "",
  phone: "",
  fax: "",
  email: "",
  address: "",
  website: "",
};

// 업로드 허용 형식 — 촬영(jpeg)·캡처(png)·최신 브라우저(webp).
export const CARD_IMAGE_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const CARD_ACCEPT = "image/jpeg,image/png,image/webp";
// 압축 후 기준 상한. 원본은 클라이언트에서 리사이즈·재인코딩해 보냅니다.
export const CARD_MAX_BYTES = 4 * 1024 * 1024;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// --- DB row 정규화 (service_role 조회 결과 → 타입) ---
export function toBusinessCard(raw: Record<string, unknown>): BusinessCard {
  return {
    id: String(raw.id ?? ""),
    company: str(raw.company),
    department: str(raw.department),
    title: str(raw.title),
    person_name: str(raw.person_name),
    mobile: str(raw.mobile),
    phone: str(raw.phone),
    fax: str(raw.fax),
    email: str(raw.email),
    address: str(raw.address),
    website: str(raw.website),
    memo: str(raw.memo),
    image_path: (raw.image_path as string | null) ?? null,
    // 기본값 false(공개) — 명시적으로 true 일 때만 비공개입니다.
    is_private: raw.is_private === true,
    registered_by: str(raw.registered_by),
    created_at: String(raw.created_at ?? ""),
    updated_at: String(raw.updated_at ?? ""),
  };
}

// 모델 응답 텍스트 → CardFields. 형식이 어긋나면 null.
//   프롬프트로 JSON 만 요구하지만, 코드펜스나 앞뒤 설명이 섞여도 첫 번째
//   { … } 구간을 잘라내 최대한 살려봅니다(메일 분류기와 같은 방식).
export function parseCardFields(raw: string): CardFields | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;

  const out = { ...EMPTY_FIELDS };
  let filled = 0;
  for (const key of OCR_FIELD_KEYS) {
    const v = str(o[key]).slice(0, 300);
    // "없음"·"-" 같은 자리표시자는 빈 값으로 정리합니다.
    out[key] = /^(없음|미상|해당\s*없음|n\/?a|null|-|—)$/i.test(v) ? "" : v;
    if (out[key]) filled += 1;
  }
  return filled > 0 ? out : null;
}

// 목록 검색용 — 화면에서 소문자 포함 검색에 씁니다(개인정보라 서버 로그 금지).
export function cardSearchText(card: BusinessCard): string {
  return [
    card.company,
    card.person_name,
    card.department,
    card.title,
    card.mobile,
    card.phone,
    card.email,
    card.address,
    card.website,
    card.memo,
  ]
    .join(" ")
    .toLowerCase();
}

// "YYYY-MM-DD" (created_at ISO → KST 날짜)
export function cardDate(iso: string): string {
  if (!iso) return "-";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "-";
  const kst = new Date(t + 9 * 60 * 60 * 1000);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${kst.getUTCFullYear()}-${p2(kst.getUTCMonth() + 1)}-${p2(kst.getUTCDate())}`;
}
