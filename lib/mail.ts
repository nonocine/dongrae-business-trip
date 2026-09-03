// =====================================================================
// 공용 메일함 — 공용 타입·상수 (클라이언트 안전).
//   * 서버 액션("use server")은 async 함수만 export 할 수 있으므로 타입·상수는
//     이 모듈에 모읍니다. 화면(클라이언트 컴포넌트)도 여기서 가져다 씁니다.
//   * DB 접근 코드는 두지 않습니다(순수 타입·상수·표시 헬퍼만).
// =====================================================================

export const MAIL_BUCKET = "shared-mail"; // 비공개 Storage 버킷
export const MAIL_STATUSES = ["unread", "processing", "done"] as const;
export type MailStatus = (typeof MAIL_STATUSES)[number];

export const MAIL_STATUS_LABEL: Record<MailStatus, string> = {
  unread: "미처리",
  processing: "처리중",
  done: "완료",
};

// 목록 행 앞의 상태 점 — 미처리 빨강 / 처리중 주황 / 완료 회색.
export const MAIL_STATUS_DOT: Record<MailStatus, string> = {
  unread: "bg-stamp",
  processing: "bg-brand-yellow",
  done: "bg-ink-hint",
};

// 점 색의 의미 — 툴팁·범례에 그대로 씁니다.
//   ★ 이 점은 '처리 상태' 이지 '읽음 여부' 가 아닙니다(읽음은 opened_at).
export const MAIL_STATUS_DOT_HINT: Record<MailStatus, string> = {
  unread: "빨강 = 미처리",
  processing: "주황 = 처리중",
  done: "회색 = 완료",
};

export const MAIL_STATUS_BADGE: Record<MailStatus, string> = {
  unread: "bg-stamp-soft text-stamp",
  processing: "bg-warning-soft text-warning",
  done: "bg-surface text-ink-muted",
};

// attachments jsonb 한 항목.
//   storage_path 가 null 이면 사본을 두지 못한 경우인데, 이유가 두 가지입니다.
//   skip_reason 으로 구분합니다 — 예전에는 화면이 둘 다 "용량 초과" 로
//   안내해서 508KB PDF 가 "용량이 커서" 로 잘못 표시됐습니다.
//     - "too_large": 10MB 초과라 의도적으로 건너뜀
//     - "failed"   : 업로드 실패(권한·키 제한 등)
//     - null       : 2단계 이전에 저장된 기존 행(이유 미상)
export type AttachmentSkipReason = "too_large" | "failed";

export type MailAttachmentMeta = {
  name: string;
  size: number;
  storage_path: string | null;
  skip_reason?: AttachmentSkipReason | null;
};

export type MailListItem = {
  id: string;
  from_name: string;
  from_email: string;
  subject: string;
  received_at: string | null;
  has_attachments: boolean;
  assignee_name: string;
  status: MailStatus;
  ai_summary: string;
  ai_category: string;
  ai_suggested_assignee: string;
  // AI 분석을 이미 거쳤는지(ai_processed_at 유무). 분석 전 메일은 요약 자리를
  // 비워 두고 상세에서 [AI 분석] 버튼을 띄우는 데 씁니다.
  ai_processed: boolean;
  // 상세를 한 번이라도 열었는지(opened_at 유무). status(처리 상태)와 별개 축.
  opened: boolean;
  deleted_at: string | null;
};

// 담당자 표시 문구 — 미지정이고 AI 추천이 있으면 "미지정 (추천: 김혜지)".
export function assigneeLabel(item: {
  assignee_name: string;
  ai_suggested_assignee: string;
}): string {
  if (item.assignee_name) return item.assignee_name;
  return item.ai_suggested_assignee
    ? `미지정 (추천: ${item.ai_suggested_assignee})`
    : "미지정";
}

// 추천 적용 버튼을 띄울지 — 담당자가 비어 있고 추천이 있을 때만.
export function hasPendingSuggestion(item: {
  assignee_name: string;
  ai_suggested_assignee: string;
}): boolean {
  return !item.assignee_name && !!item.ai_suggested_assignee;
}

export type MailDetail = MailListItem & {
  body_text: string;
  body_html: string | null;
  memo: string;
  attachments: MailAttachmentMeta[];
  fetched_at: string | null;
};

// 답장 이력 한 건 — 누가·언제·무엇을 보냈는지 공유가 목적입니다.
export type MailReply = {
  id: string;
  to_email: string;
  subject: string;
  body: string;
  sent_by: string;
  sent_at: string;
  status: "sent" | "failed";
  error_message: string | null;
};

export type MailListView = {
  configured: boolean;
  items: MailListItem[];
  unreadCount: number; // 미처리(status=unread) 건수 — 안읽음(opened_at)과 다른 축
  // 분류 인덱스 배지용 — "안읽음(opened_at IS NULL)" 건수.
  //   ★ 상태·담당자·검색 필터와 무관하게 항상 같은 값입니다(삭제된 메일만 제외).
  //     담당자를 걸었다고 인덱스 숫자가 흔들리면 "어디에 몇 건 남았나" 를 볼 수
  //     없기 때문입니다.
  categoryUnopened: Record<string, number>; // 키: MAIL_CATEGORY_INDEX 항목
  unopenedCount: number; // 분류 무관 전체 안읽음(=인덱스의 "전체" 배지)
  assignees: string[]; // 재직자 목록(담당자 셀렉트)
  usedAssignees: string[]; // 실제 배정된 담당자(필터용)
  lastFetchedAt: string | null; // MAX(fetched_at) — 마지막으로 수집이 성공한 시각
  fetchStale: boolean; // 그 시각이 너무 오래됐는지(서버에서 판정)
};

// --- 수집 지연 경고 ---
//   Cron 이 10분 주기이므로 2시간이면 12번 연속으로 못 가져왔다는 뜻입니다.
export const MAIL_FETCH_STALE_MS = 2 * 60 * 60 * 1000;

// ★ 판정은 반드시 서버(getMailList)에서 합니다. 클라이언트 렌더에서 Date.now()
//   를 쓰면 SSR 결과와 어긋나 하이드레이션 불일치가 납니다(lib/datetime.ts 주석).
//   수집 기록이 아예 없으면(신규 설치) 경고하지 않습니다 — 고장이 아니라 아직
//   한 통도 안 온 상태일 수 있습니다.
export function isMailFetchStale(
  lastFetchedAt: string | null,
  now: number,
): boolean {
  if (!lastFetchedAt) return false;
  const at = Date.parse(lastFetchedAt);
  if (Number.isNaN(at)) return false;
  return now - at > MAIL_FETCH_STALE_MS;
}

export function isMailStatus(v: unknown): v is MailStatus {
  return (MAIL_STATUSES as readonly unknown[]).includes(v);
}

// 목록 필터의 특수값 — 상태가 아니라 "삭제된 메일만" 을 뜻합니다.
export const MAIL_TRASH_FILTER = "trash";

// --- AI 분류(ML-5) 공용 상수 ---
//   분류 로직은 lib/mailClassifier.ts(서버 전용, supabaseAdmin·SDK 사용)에
//   있지만, 목록 뱃지는 클라이언트 컴포넌트가 그려야 하므로 상수만 여기에
//   둡니다. (클라이언트가 mailClassifier 를 import 하면 service_role 클라이언트가
//   브라우저 번들에 끌려 들어갑니다.)
export const MAIL_CATEGORIES = [
  "공문",
  "회계",
  "방과후",
  "청소년활동",
  "시설",
  "홍보",
  "기타",
] as const;
export type MailCategory = (typeof MAIL_CATEGORIES)[number];

export function isMailCategory(v: unknown): v is MailCategory {
  return (MAIL_CATEGORIES as readonly unknown[]).includes(v);
}

// 분류 인덱스(목록 위 한 줄)의 표시 순서 — 팀이 자기 것을 찾는 순서라
//   MAIL_CATEGORIES(분류기 프롬프트용 순서)와 따로 둡니다.
//   ★ "기타" 는 맨 뒤. AI 가 판단하지 못한 메일이므로 숨기지 않고 남깁니다.
export const MAIL_CATEGORY_INDEX: readonly MailCategory[] = [
  "공문",
  "청소년활동",
  "방과후",
  "회계",
  "시설",
  "홍보",
  "기타",
];

// 인덱스에서 "기타" 를 눌렀을 때 포함할 범위.
//   ai_category 가 NULL 인 메일(수집만 되고 아직 분석 전이거나 분석 실패)도
//   여기 넣습니다 — 어느 칸에도 없으면 영영 안 보이기 때문입니다.
export const MAIL_CATEGORY_ETC: MailCategory = "기타";

export const MAIL_CATEGORY_BADGE: Record<string, string> = {
  공문: "bg-navy-soft text-navy",
  회계: "bg-brand-green/15 text-brand-green",
  방과후: "bg-brand-blue-soft text-brand-blue",
  청소년활동: "bg-brand-yellow/25 text-amber-800",
  시설: "bg-warning-soft text-warning",
  홍보: "bg-stamp-soft text-stamp",
  기타: "bg-surface text-ink-muted",
};

// 분류 인덱스(공용 메일함 목록 위 한 줄)의 로고색 — 배지 숫자와 선택 칸 밑줄에만.
//   * globals.css 의 로고 4색 토큰(--logo-*)을 그대로 참조합니다. 새 색·새 토큰 없음.
//   * 7분류를 4색에 배분하다 보니 계열이 같은 칸끼리 색을 공유합니다.
//       공문 파랑(행정) / 청소년활동·방과후 초록(사업) / 회계 빨강(돈) /
//       시설·홍보 노랑(관리·대외)
//   * "기타"·"전체" 는 일부러 넣지 않습니다 — AI가 판단하지 못한 칸이라
//     강조하지 않고 기존 무채색 그대로 둡니다.
//   * 클래스(text-logo-blue)가 아니라 CSS 변수 문자열인 이유:
//     lib/ui 의 tabItemCls·badgeNeutral 이 이미 border-*/text-* 를 갖고 있어
//     같은 유틸리티를 덧붙이면 어느 쪽이 이길지 클래스 나열 순서가 아니라
//     생성된 CSS 순서에 달립니다. 인라인 style 은 항상 이기고, 공용 탭 상수를
//     건드리지 않아 HR·시설·관리자 탭에는 영향이 없습니다.
export const MAIL_CATEGORY_INDEX_COLOR: Record<string, string> = {
  공문: "var(--logo-blue)",
  청소년활동: "var(--logo-green)",
  방과후: "var(--logo-green)",
  회계: "var(--logo-red)",
  시설: "var(--logo-yellow)",
  홍보: "var(--logo-yellow)",
};

// 첨부 사본이 없는 이유 안내 문구. 이유를 모르면 원인을 단정하지 않습니다.
export function attachmentSkipNotice(
  name: string,
  reason: AttachmentSkipReason | null | undefined,
): string {
  if (reason === "too_large")
    return `${name} 은(는) 10MB를 넘어 사본을 저장하지 않았습니다. 네이버 메일에서 확인하세요.`;
  if (reason === "failed")
    return `${name} 사본 저장에 실패했습니다. 네이버 메일에서 확인하세요.`;
  return `${name} 은(는) 사본이 없습니다. 네이버 메일에서 확인하세요.`;
}

// 바이트 → 사람이 읽는 크기.
export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "0B";
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)}KB`;
  return `${(size / (1024 * 1024)).toFixed(1)}MB`;
}
