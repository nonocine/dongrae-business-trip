// =====================================================================
// 방카톡(동래방카 요청 2·4·10번) — 직원 화면 공용 상수·형식(서버·브라우저).
//   동래방카 lib/talk.ts 와 코드값이 같아야 합니다(bk_talk_* 를 함께 씀).
//   설계: docs/설계_방카톡.md
// =====================================================================

export const TALK_MAX_BODY = 2000;

export type TalkStatus = "open" | "answered" | "closed";
export const TALK_STATUS_LABEL: Record<TalkStatus, string> = {
  open: "미답변",
  answered: "답변함",
  closed: "닫힘",
};
export const isTalkStatus = (v: unknown): v is TalkStatus => v === "open" || v === "answered" || v === "closed";

export type TalkView = "open" | "all" | "closed";
export type TalkClassFilter = "all" | "ieum" | "jieum";

export type TalkThreadRow = {
  id: string;
  status: TalkStatus;
  topicTitle: string; // 연결 글 제목 스냅숏 또는 "일반 문의"
  guardianName: string;
  studentName: string | null;
  classCodes: string[]; // 자녀 반(자녀를 골랐으면 그 자녀, 아니면 보호자 연결 자녀 전부)
  lastMessageAt: string;
  lastGuardianAt: string | null;
  preview: string;
  waiting: string | null; // 미답변일 때 "3시간째" 등
  stale: boolean; // 다음 운영일이 끝났는데도 답이 없음(결정 3)
};

export type TalkMessageRow = {
  id: string;
  authorType: "guardian" | "staff";
  authorName: string;
  body: string;
  createdAt: string;
  edited: boolean;
  deleted: boolean;
  hiddenAt: string | null;
  hiddenBy: string | null;
  hiddenReason: string | null;
  mine: boolean; // 로그인 직원이 쓴 답글 — 이것만 고치기·지우기
};

export type TalkThreadDetail = {
  id: string;
  status: TalkStatus;
  topicTitle: string;
  topicType: "general" | "post" | "session";
  postId: string | null;
  guardianName: string;
  studentName: string | null;
  classLabel: string;
  closedAt: string | null;
  closedBy: string | null;
  messages: TalkMessageRow[];
};

// 기다린 시간 — "40분째" / "3시간째" / "2일째".
export function waitingLabel(sinceMs: number, nowMs: number): string {
  const min = Math.max(0, Math.floor((nowMs - sinceMs) / 60000));
  if (min < 60) return `${min}분째`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}시간째`;
  return `${Math.floor(h / 24)}일째`;
}
