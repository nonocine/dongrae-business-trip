// =====================================================================
// 직인사용대장 — 화면·서버·PDF 가 함께 쓰는 타입·종류별 틀·순수 헬퍼
//   설계: docs/설계_직인사용대장.md · DB: supabase/migrations/seal_register.sql(운영 적용됨)
//   * 재직·경력증명서(lib/certificates)와 완전히 별개 — 번호 형식도 다릅니다
//     (증명서 "제2026년-10호" / 직인대장 "제2026-01호").
//   * 서버 전용 아님 — 신청 화면(클라이언트)도 틀·자리표시 채우기를 씁니다.
// =====================================================================

export type SealDocType = "award_confirm" | "completion" | "commendation" | "prize" | "appointment" | "custom";
export type SealStatus = "draft" | "pending" | "rejected" | "withdrawn" | "issued";

export const SEAL_DOC_TYPES: { key: SealDocType; label: string }[] = [
  { key: "award_confirm", label: "수상확인증" },
  { key: "completion", label: "수료증" },
  { key: "commendation", label: "표창장" },
  { key: "prize", label: "상장" },
  { key: "appointment", label: "위촉장" },
  { key: "custom", label: "기타(직접 입력)" },
];
export function sealDocTypeLabel(t: string): string {
  return SEAL_DOC_TYPES.find((d) => d.key === t)?.label ?? t;
}
export function normalizeDocType(v: unknown): SealDocType | null {
  return SEAL_DOC_TYPES.some((d) => d.key === v) ? (v as SealDocType) : null;
}

export const SEAL_STATUS_LABEL: Record<SealStatus, string> = {
  draft: "작성중",
  pending: "결재대기",
  rejected: "반려",
  withdrawn: "회수",
  issued: "발급",
};

// DB 칸 한도(seal_register.sql 과 같게)
export const SEAL_MAX_RECIPIENTS = 200;
export const SEAL_MAX_ITEMS = 8;
export const SEAL_TITLE_MAX = 20;
export const SEAL_BODY_MAX = 1000;
export const SEAL_NAME_MAX = 100;

// ○ 항목 틀
//   scope common = 모든 대상자 같음(행사명·참가일시) / person = 사람마다(참가팀/명·수상부문)
//   isName = 대상자 이름 칸(seal_recipients.recipient_name). 틀마다 정확히 하나.
//   date = 날짜 칸 — 날짜 고르기로 넣고 "2026. 10. 17. (토)" 로 표시, 본문 자리표시는 "2026년 10월 17일(토)".
export type SealItemDef = {
  label: string;
  scope: "common" | "person";
  isName?: boolean;
  date?: boolean;
  value?: string; // common 값(또는 date 칸의 YYYY-MM-DD)
};

export type SealTemplate = { title: string; items: SealItemDef[]; body: string };

export const SEAL_TEMPLATES: Record<SealDocType, SealTemplate> = {
  award_confirm: {
    title: "수상확인증",
    items: [
      { label: "행 사 명", scope: "common" },
      { label: "참가팀/명", scope: "person", isName: true },
      { label: "참가일시", scope: "common", date: true },
      { label: "수상부문", scope: "person" },
    ],
    body: "위 사람은 {참가일시} 부산광역시 동래구에서 주최하고 동래구청소년센터가 주관하는 {행사명}에서 {수상부문}을 수상하였음을 확인합니다.",
  },
  completion: {
    title: "수료증",
    items: [
      { label: "과 정 명", scope: "common" },
      { label: "성 명", scope: "person", isName: true },
      { label: "교육기간", scope: "common" },
    ],
    body: "위 사람은 동래구청소년센터에서 실시한 {과정명}({교육기간})을 성실히 이수하였기에 이 증서를 드립니다.",
  },
  commendation: {
    title: "표창장",
    items: [
      { label: "성 명", scope: "person", isName: true },
      { label: "소 속", scope: "person" },
    ],
    body: "위 사람은 평소 맡은 바 활동에 성실히 임하여 남다른 모범을 보였으므로 이에 표창합니다.",
  },
  prize: {
    title: "상장",
    items: [
      { label: "성 명", scope: "person", isName: true },
      { label: "소 속", scope: "person" },
    ],
    body: "위 사람은 평소 맡은 바 활동에 성실히 임하여 우수한 성과를 거두었으므로 이 상장을 드립니다.",
  },
  appointment: {
    title: "위촉장",
    items: [
      { label: "성 명", scope: "person", isName: true },
      { label: "위 촉 직", scope: "common" },
      { label: "위촉기간", scope: "common" },
    ],
    body: "위 사람을 동래구청소년센터 {위촉직}(으)로 위촉합니다.\n(위촉기간: {위촉기간})",
  },
  custom: {
    title: "",
    items: [{ label: "성 명", scope: "person", isName: true }],
    body: "",
  },
};

export function templateFor(t: SealDocType): SealTemplate {
  const tpl = SEAL_TEMPLATES[t];
  return { title: tpl.title, body: tpl.body, items: tpl.items.map((i) => ({ ...i })) };
}

// --- 날짜·번호 표기 -----------------------------------------------------
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
export function isYmd(s: unknown): s is string {
  return typeof s === "string" && YMD.test(s);
}
function parts(ymd: string): { y: number; m: number; d: number; w: string } | null {
  const mm = ymd.match(YMD);
  if (!mm) return null;
  const [y, m, d] = [Number(mm[1]), Number(mm[2]), Number(mm[3])];
  return { y, m, d, w: WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] };
}
// "2026. 10. 17. (토)" — ○ 항목 표기
export function dotDateLabel(ymd: string): string {
  const p = parts(ymd);
  return p ? `${p.y}. ${p.m}. ${p.d}. (${p.w})` : ymd;
}
// "2026년 10월 17일(토)" — 본문 자리표시
export function longDateWithDay(ymd: string): string {
  const p = parts(ymd);
  return p ? `${p.y}년 ${p.m}월 ${p.d}일(${p.w})` : ymd;
}
// "2026년 10월 17일" — 증서 날짜 줄
export function certDateLabel(ymd: string): string {
  const p = parts(ymd);
  return p ? `${p.y}년 ${p.m}월 ${p.d}일` : ymd;
}

// DB(seal_approve_request) 와 같은 규칙: 두 자리, 100부터는 그대로.
export function sealIssueLabel(year: number, seq: number): string {
  return `제${year}-${seq < 10 ? `0${seq}` : seq}호`;
}

// 제목 글자 사이 띄움("수 상 확 인 증")
export function spacedTitle(s: string): string {
  return Array.from(s.replace(/\s+/g, "")).join(" ");
}

// --- 자리표시 ----------------------------------------------------------
//   {행사명} 처럼 ○ 항목 이름(띄어쓰기 뺀 것)을 넣으면 그 대상자의 값으로 바뀝니다.
//   {성명}·{이름} 은 언제나 대상자 이름, {날짜} 는 증서 날짜.
export const placeholderKey = (label: string) => label.replace(/\s+/g, "");

export type SealItemValue = { label: string; value: string };

// 한 대상자의 ○ 항목(표시값) — 틀 + 그 사람 값(person 칸)으로.
export function recipientItems(
  defs: SealItemDef[],
  name: string,
  personValues: Record<string, string>,
): SealItemValue[] {
  return defs.map((d) => {
    if (d.isName) return { label: d.label, value: name };
    if (d.scope === "person") return { label: d.label, value: (personValues[d.label] ?? "").trim() };
    const v = (d.value ?? "").trim();
    return { label: d.label, value: d.date && isYmd(v) ? dotDateLabel(v) : v };
  });
}

export function fillBody(
  template: string,
  defs: SealItemDef[],
  name: string,
  personValues: Record<string, string>,
  certDate: string,
): string {
  const map = new Map<string, string>();
  for (const d of defs) {
    const k = placeholderKey(d.label);
    if (d.isName) map.set(k, name);
    else if (d.scope === "person") map.set(k, (personValues[d.label] ?? "").trim());
    else {
      const v = (d.value ?? "").trim();
      map.set(k, d.date && isYmd(v) ? longDateWithDay(v) : v);
    }
  }
  map.set("성명", name);
  map.set("이름", name);
  if (isYmd(certDate)) map.set("날짜", certDateLabel(certDate));
  return template.replace(/\{([^{}]{1,30})\}/g, (all, key: string) => {
    const v = map.get(placeholderKey(key));
    return v === undefined ? all : v;
  });
}

// 본문에 아직 남은(채워지지 않은) 자리표시
export function unfilledPlaceholders(body: string): string[] {
  return [...new Set(Array.from(body.matchAll(/\{([^{}]{1,30})\}/g), (m) => m[1]))];
}

// 증서 날짜 기본값 — 수상확인증은 날짜 칸(참가일시), 나머지는 오늘
export function defaultCertDate(type: SealDocType, defs: SealItemDef[], today: string): string {
  if (type === "award_confirm") {
    const d = defs.find((x) => x.date && isYmd(x.value));
    if (d?.value) return d.value;
  }
  return today;
}

// --- 화면 타입 ----------------------------------------------------------
export type SealRecipientView = {
  id: string;
  lineNo: number;
  name: string;
  items: SealItemValue[];
  body: string;
  issueYear: number | null;
  issueSeq: number | null;
  issueLabel: string | null;
  issuedAt: string | null;
  canceledAt: string | null;
  canceledBy: string | null;
  cancelReason: string | null;
  printed: boolean; // 한 번이라도 출력됨
};

export type SealApprovalView = {
  round: number;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  requestedAt: string;
  approverName: string | null;
  approverRank: string | null;
  decidedAt: string | null;
  rejectReason: string | null;
};

export type SealPrintLogView = { printedAt: string; printedBy: string; count: number; isReprint: boolean };

export type SealRequestSummary = {
  id: string;
  docType: SealDocType;
  title: string;
  certDate: string;
  status: SealStatus;
  requesterName: string;
  requesterDriverId: string | null;
  recipientCount: number;
  firstName: string | null;
  issueRange: string | null; // "제2026-15호 ~ 제2026-17호"
  createdAt: string;
  updatedAt: string;
};

export type SealRequestDetail = SealRequestSummary & {
  purpose: string | null;
  itemTemplate: SealItemDef[];
  bodyTemplate: string;
  recipients: SealRecipientView[];
  approvals: SealApprovalView[];
  prints: SealPrintLogView[];
  lastRejectReason: string | null;
};

export type SealLedgerRow = {
  recipientId: string;
  requestId: string;
  issueYear: number;
  issueSeq: number;
  issueLabel: string;
  docType: SealDocType;
  title: string;
  name: string;
  certDate: string;
  requesterName: string;
  approverName: string | null;
  issuedAt: string;
  canceledAt: string | null;
  cancelReason: string | null;
  canceledBy: string | null;
};

// 신청 화면 → 서버 저장 입력
export type SealDraftInput = {
  id?: string | null;
  docType: SealDocType;
  title: string;
  certDate: string;
  purpose: string;
  itemTemplate: SealItemDef[];
  bodyTemplate: string;
  recipients: { name: string; values: Record<string, string>; body: string }[];
};

// 신청 내용을 화면 입력 형태로 되돌림(고치기). person 값은 저장된 ○ 항목에서 읽습니다.
export function recipientValuesFrom(defs: SealItemDef[], items: SealItemValue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of defs) {
    if (d.scope === "person" && !d.isName) out[d.label] = items.find((x) => x.label === d.label)?.value ?? "";
  }
  return out;
}

export function normalizeItemDefs(raw: unknown): SealItemDef[] {
  if (!Array.isArray(raw)) return [];
  const out: SealItemDef[] = [];
  for (const r of raw.slice(0, SEAL_MAX_ITEMS)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const label = String(o.label ?? "").trim().slice(0, 20);
    if (!label) continue;
    out.push({
      label,
      scope: o.scope === "common" ? "common" : "person",
      ...(o.isName ? { isName: true } : {}),
      ...(o.date ? { date: true } : {}),
      ...(o.scope === "common" ? { value: String(o.value ?? "").trim().slice(0, 200) } : {}),
    });
  }
  return out;
}

export function normalizeItemValues(raw: unknown): SealItemValue[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({ label: String(r.label ?? ""), value: String(r.value ?? "") }));
}
