import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendSlackDMDetailed, siteBaseUrl, slackLink } from "@/lib/slack";
import type { AutoAssigned } from "@/lib/mailClassifier";

// =====================================================================
// 공용 메일함 2단계 — 담당자 슬랙 DM (ML-6)
//   * AI 가 자동 지정한 메일을 해당 직원에게 DM 으로 알립니다.
//   * ★ 슬랙 미연결 직원(사내 슬랙 계정이 없거나 이메일이 다른 경우)은
//     DM 이 실패하지만 조용히 넘어갑니다. 대신 이름을 모아 돌려주고,
//     관리자 다이제스트에 "⚠️ {이름} 슬랙 미연결 — 화면에서 확인 필요" 로
//     한 번만 표시합니다(개인을 반복해서 호출하지 않기 위함).
//   * 알림은 전부 부가기능 — 어떤 실패도 throw 하지 않습니다.
// =====================================================================

export type DmResult = {
  sent: number;
  // DM 이 닿지 않은 직원 이름(중복 제거). 다이제스트에서 안내합니다.
  unreachable: string[];
  // 직원별 실패 사유 — 화면·로그에 "왜 안 갔는지" 를 남기기 위함.
  failures: { name: string; reason: string }[];
};

// 직원 이름 → employee_profiles.email. 없으면 null.
async function emailOf(name: string): Promise<string | null> {
  try {
    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("id")
      .eq("name", name)
      .maybeSingle();
    const driverId = driver ? String((driver as { id: unknown }).id ?? "") : "";
    if (!driverId) return null;

    const { data: profile } = await supabaseAdmin
      .from("employee_profiles")
      .select("email")
      .eq("driver_id", driverId)
      .maybeSingle();
    const email = (profile as { email?: string | null } | null)?.email ?? null;
    return email && email.trim() ? email.trim() : null;
  } catch (e) {
    console.warn(
      `[mail] 이메일 조회 실패(${name}):`,
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

// 자동 지정된 메일들을 담당자별로 DM. 전부 격리.
export async function notifyAutoAssigned(
  items: AutoAssigned[],
): Promise<DmResult> {
  const result: DmResult = { sent: 0, unreachable: [], failures: [] };
  if (items.length === 0) return result;

  const base = siteBaseUrl();
  const link = base ? slackLink(`${base}/mail`, "공용 메일함 열기") : "/mail";

  // 같은 직원의 이메일을 반복 조회하지 않도록 캐시합니다.
  const emailCache = new Map<string, string | null>();
  // 같은 직원이 여러 통 받으면 사유가 중복되므로 이름당 1건만 남깁니다.
  const failedReason = new Map<string, string>();

  for (const item of items) {
    try {
      if (!emailCache.has(item.assignee)) {
        emailCache.set(item.assignee, await emailOf(item.assignee));
      }
      const email = emailCache.get(item.assignee) ?? null;

      const text = [
        "📧 새 공용 메일 담당 지정",
        item.subject,
        `요약: ${item.summary}`,
        `보낸사람: ${item.from}`,
        link,
      ].join("\n");

      const { ok, reason } = await sendSlackDMDetailed(email, text);
      if (ok) {
        result.sent++;
      } else {
        const why = reason ?? "알 수 없는 사유";
        console.warn(`[mail] 담당자 DM 실패 (${item.assignee}) — ${why}`);
        if (!failedReason.has(item.assignee))
          failedReason.set(item.assignee, why);
      }
    } catch (e) {
      const why = e instanceof Error ? e.message : "알 수 없는 오류";
      console.warn(`[mail] 담당자 DM 실패 (${item.assignee}) — ${why}`);
      if (!failedReason.has(item.assignee))
        failedReason.set(item.assignee, why);
    }
  }

  result.unreachable = [...failedReason.keys()].sort((a, b) =>
    a.localeCompare(b, "ko"),
  );
  result.failures = result.unreachable.map((name) => ({
    name,
    reason: failedReason.get(name) ?? "알 수 없는 사유",
  }));
  if (result.failures.length > 0) {
    console.warn(
      `[mail] DM 실패 요약: ${result.failures
        .map((f) => `${f.name}(${f.reason})`)
        .join(" / ")}`,
    );
  }
  return result;
}
