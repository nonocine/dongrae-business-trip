import "server-only";

// =====================================================================
// 매일 아침 "확인할 일" 슬랙 DM — /api/cron/pending-digest(한국 평일 08:30).
//   * 대상자(M0 또는 hr 직무, 재직)마다 lib/pendingTasks 로 목록을 만들고, 1건 이상일 때만 DM.
//   * 받는 사람 슬랙 ID: 직원 프로필에는 슬랙 ID 칸이 없어(스키마 변경 금지) 아래 상수만 씁니다.
//     이메일로 슬랙 사용자를 찾는 방식은 쓰지 않습니다(관장 계정에서 users_not_found 로 실패했던 이력).
//     상수에 없거나 빈 값이면 그 사람은 건너뛰고 결과에 skipped 로 남깁니다.
//   * 링크는 운영 주소(APP_BASE_URL) 기준 — 다른 주소로 들어가면 구글 로그인이 안 될 수 있음.
// =====================================================================

import { sendSlackDMToUser } from "@/lib/slack";
import {
  listPendingTaskTargets,
  loadPendingTaskSource,
  pendingTaskTotal,
  tasksFromSource,
  type PendingTask,
} from "@/lib/pendingTasks";

export const APP_BASE_URL = "https://dongrae-business-trip.vercel.app";

// 직원 이름 → 슬랙 사용자 ID.
export const PENDING_DIGEST_SLACK_IDS: Record<string, string> = {
  허일수: "U0ADUPN08Q3", // 관장
  김혜지: "U0BMRE13PSR",
  노미현: "U0B7MMKN30A", // 부장
};

export function formatPendingDigest(name: string, tasks: PendingTask[]): string {
  const total = pendingTaskTotal(tasks);
  const lines = tasks.map((t) => {
    const who = t.names.length ? ` — ${t.names.slice(0, 5).join(", ")}${t.names.length > 5 ? ` 외 ${t.names.length - 5}` : ""}` : "";
    return `• ${t.label} ${t.count}건${who}  <${APP_BASE_URL}${t.href}|바로가기>`;
  });
  return [`🔔 ${name} 님, 오늘 확인할 일 ${total}건`, ...lines, `<${APP_BASE_URL}/|동업자씨 열기>`].join("\n");
}

// 연차 사용촉진 '기한 경과' 는 화요일(KST) DM 에만 — 월요일은 휴관(2026-11 관장 지시).
//   'D-3 이내'(임박)는 평일 매일. 메인 카드·헤더 배지는 이 규칙과 무관하게 매일 전부 보입니다.
export function kstWeekday(at: Date = new Date()): number {
  return new Date(at.getTime() + 9 * 3600 * 1000).getUTCDay(); // 0=일 … 2=화
}
export function digestTasksFor(tasks: PendingTask[], weekday: number): PendingTask[] {
  return weekday === 2 ? tasks : tasks.filter((t) => t.kind !== "leavePromotionOverdue");
}

export type PendingDigestResult = {
  sent: string[];
  skipped: { name: string; reason: string }[];
  failed: { name: string; reason: string }[];
};

// dryRun 이면 보내지 않고 누구에게 무엇이 갈지만 돌려줍니다.
export async function runPendingDigest(opts: { dryRun?: boolean; now?: Date } = {}): Promise<
  PendingDigestResult & { preview: { name: string; total: number; text: string }[] }
> {
  const [people, src] = await Promise.all([listPendingTaskTargets(), loadPendingTaskSource()]);
  const out: PendingDigestResult = { sent: [], skipped: [], failed: [] };
  const preview: { name: string; total: number; text: string }[] = [];
  const weekday = kstWeekday(opts.now);
  for (const p of people) {
    const tasks = digestTasksFor(tasksFromSource(p, src), weekday);
    const total = pendingTaskTotal(tasks);
    if (total === 0) {
      out.skipped.push({ name: p.name, reason: "할 일 0건" });
      continue;
    }
    const text = formatPendingDigest(p.name, tasks);
    preview.push({ name: p.name, total, text });
    const slackId = (PENDING_DIGEST_SLACK_IDS[p.name] ?? "").trim();
    if (!slackId) {
      out.skipped.push({ name: p.name, reason: "슬랙 ID 없음" });
      continue;
    }
    if (opts.dryRun) continue;
    const res = await sendSlackDMToUser(slackId, text);
    if (res.ok) out.sent.push(p.name);
    else out.failed.push({ name: p.name, reason: res.reason ?? "알 수 없음" });
  }
  return { ...out, preview };
}
