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

export const MAIL_STATUS_BADGE: Record<MailStatus, string> = {
  unread: "bg-stamp-soft text-stamp",
  processing: "bg-warning-soft text-warning",
  done: "bg-surface text-ink-muted",
};

// attachments jsonb 한 항목. storage_path 가 null 이면 10MB 초과·업로드 실패로
// 사본을 두지 않은 경우 — 화면에서 "원본은 네이버 확인" 으로 안내합니다.
export type MailAttachmentMeta = {
  name: string;
  size: number;
  storage_path: string | null;
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
};

export type MailDetail = MailListItem & {
  body_text: string;
  body_html: string | null;
  memo: string;
  attachments: MailAttachmentMeta[];
  fetched_at: string | null;
};

export type MailListView = {
  configured: boolean;
  items: MailListItem[];
  unreadCount: number;
  assignees: string[]; // 재직자 목록(담당자 셀렉트)
  usedAssignees: string[]; // 실제 배정된 담당자(필터용)
};

export function isMailStatus(v: unknown): v is MailStatus {
  return (MAIL_STATUSES as readonly unknown[]).includes(v);
}

// 바이트 → 사람이 읽는 크기.
export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "0B";
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)}KB`;
  return `${(size / (1024 * 1024)).toFixed(1)}MB`;
}
