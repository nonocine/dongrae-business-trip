import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendSlack, siteBaseUrl, slackLink } from "@/lib/slack";
import { MAIL_BUCKET } from "@/lib/mail";

// =====================================================================
// 공용 메일함 2단계 — 하루 1회 다이제스트 + 휴지통 자동 비우기 (ML-6 / ML-7)
//   * 기존에는 수집할 때마다 관리자 채널에 건별 알림을 보냈습니다(1단계 ML-3).
//     10분 주기라 알림이 잦아, 매일 아침 9시 요약 1건으로 바꿉니다.
//   * 같은 Cron 에서 30일 지난 휴지통 메일을 실제로 삭제합니다.
//     - 첨부 Storage 파일 → mail_messages 행 순으로 정리.
//     - ★ 네이버 원본은 건드리지 않습니다(POP3 DELE 없음, 1단계 규칙 유지).
//   * 슬랙 실패는 격리 — 휴지통 정리 결과에 영향을 주지 않습니다.
// =====================================================================

const TRASH_RETENTION_DAYS = 30;

export type MailDigestSummary = {
  arrived: number; // 어제(KST) 도착 건수
  byAssignee: { name: string; count: number }[];
  purged: number; // 실제 삭제한 휴지통 메일 수
  purgeFailed: number;
  notified: boolean; // 슬랙 발송 성공 여부
};

// KST 어제 00:00 ~ 오늘 00:00 을 UTC ISO 로. KST 는 UTC+9 고정(DST 없음).
export function yesterdayKstRange(now: Date): { start: string; end: string } {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  // KST 기준 오늘 00:00 을 UTC 로 되돌리면 -9h.
  const kstMidnight = Date.UTC(
    kst.getUTCFullYear(),
    kst.getUTCMonth(),
    kst.getUTCDate(),
  );
  const end = new Date(kstMidnight - 9 * 60 * 60 * 1000);
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

// 30일 지난 휴지통 메일을 실제 삭제. 첨부 파일도 함께 정리합니다.
async function purgeTrash(): Promise<{ purged: number; failed: number }> {
  let purged = 0;
  let failed = 0;
  try {
    const cutoff = new Date(
      Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { data, error } = await supabaseAdmin
      .from("mail_messages")
      .select("id, attachments")
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoff);
    if (error) {
      console.warn("[mail] 휴지통 조회 실패:", error.message);
      return { purged, failed };
    }

    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const id = String(row.id ?? "");
      if (!id) continue;
      try {
        // 1) 첨부 Storage 파일 정리 — 실패해도 행 삭제는 진행합니다.
        const paths = (Array.isArray(row.attachments) ? row.attachments : [])
          .map((a) => {
            const o = (a ?? {}) as Record<string, unknown>;
            return typeof o.storage_path === "string" ? o.storage_path : null;
          })
          .filter((p): p is string => !!p);
        if (paths.length > 0) {
          const { error: removeError } = await supabaseAdmin.storage
            .from(MAIL_BUCKET)
            .remove(paths);
          if (removeError)
            console.warn(
              `[mail] 첨부 삭제 실패(id=${id}):`,
              removeError.message,
            );
        }

        // 2) 답장 이력 → 메일 행 순으로 삭제(FK 가 있어도 안전한 순서).
        await supabaseAdmin.from("mail_replies").delete().eq("mail_id", id);
        const { error: deleteError } = await supabaseAdmin
          .from("mail_messages")
          .delete()
          .eq("id", id);
        if (deleteError) throw new Error(deleteError.message);
        purged++;
      } catch (e) {
        failed++;
        console.warn(
          `[mail] 휴지통 비우기 실패(id=${id}):`,
          e instanceof Error ? e.message : e,
        );
      }
    }
  } catch (e) {
    console.warn(
      "[mail] 휴지통 정리 중 오류:",
      e instanceof Error ? e.message : e,
    );
  }
  return { purged, failed };
}

// 매일 아침 9시(KST) 1회. 어제 도착분을 담당별로 집계해 관리자 채널에 보냅니다.
//   unreachable: 슬랙 DM 이 닿지 않은 담당자(수집 시점에 모아둔 값이 있으면 전달).
export async function runMailDigest(options?: {
  // 이름만 주면 "슬랙 미연결" 로, 사유까지 주면 사유를 함께 표시합니다.
  unreachable?: { name: string; reason?: string }[] | string[];
}): Promise<MailDigestSummary> {
  const summary: MailDigestSummary = {
    arrived: 0,
    byAssignee: [],
    purged: 0,
    purgeFailed: 0,
    notified: false,
  };

  const { start, end } = yesterdayKstRange(new Date());

  // 1) 어제 도착분 집계 — fetched_at 기준(수집된 시각).
  try {
    const { data, error } = await supabaseAdmin
      .from("mail_messages")
      .select("assignee_name")
      .gte("fetched_at", start)
      .lt("fetched_at", end)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);

    const counts = new Map<string, number>();
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const name = String(row.assignee_name ?? "").trim() || "미지정";
      counts.set(name, (counts.get(name) ?? 0) + 1);
      summary.arrived++;
    }
    summary.byAssignee = [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      // 많은 순 → 같으면 이름순. "미지정" 은 항상 마지막에 둡니다.
      .sort((a, b) => {
        if (a.name === "미지정") return 1;
        if (b.name === "미지정") return -1;
        if (b.count !== a.count) return b.count - a.count;
        return a.name.localeCompare(b.name, "ko");
      });
  } catch (e) {
    console.warn(
      "[mail] 다이제스트 집계 실패:",
      e instanceof Error ? e.message : e,
    );
  }

  // 2) 휴지통 비우기 — 집계와 독립적으로 항상 수행합니다.
  const purgeResult = await purgeTrash();
  summary.purged = purgeResult.purged;
  summary.purgeFailed = purgeResult.failed;

  // 3) 슬랙 발송 — 도착 0건이면 보내지 않습니다(조용한 날은 조용하게).
  if (summary.arrived > 0) {
    const base = siteBaseUrl();
    const link = base ? slackLink(`${base}/mail`, "공용 메일함 열기") : "/mail";
    const breakdown = summary.byAssignee
      .map((b) => `${b.name} ${b.count}`)
      .join("·");

    const lines = [`📬 어제 도착 ${summary.arrived}건 (담당별: ${breakdown})`];
    for (const entry of options?.unreachable ?? []) {
      const name = typeof entry === "string" ? entry : entry.name;
      const reason = typeof entry === "string" ? "" : (entry.reason ?? "");
      lines.push(
        reason
          ? `⚠️ ${name} 슬랙 DM 실패(${reason}) — 화면에서 확인 필요`
          : `⚠️ ${name} 슬랙 미연결 — 화면에서 확인 필요`,
      );
    }
    if (summary.purged > 0) {
      lines.push(`🗑 휴지통 ${summary.purged}건 영구 삭제(30일 경과)`);
    }
    lines.push(link);
    summary.notified = await sendSlack("SLACK_WEBHOOK_ADMIN", lines.join("\n"));
  }

  return summary;
}
