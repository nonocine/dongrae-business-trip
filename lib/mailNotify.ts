import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendSlackDM, siteBaseUrl, slackLink } from "@/lib/slack";
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
  const result: DmResult = { sent: 0, unreachable: [] };
  if (items.length === 0) return result;

  const base = siteBaseUrl();
  const link = base ? slackLink(`${base}/mail`, "공용 메일함 열기") : "/mail";

  // 같은 직원의 이메일을 반복 조회하지 않도록 캐시합니다.
  const emailCache = new Map<string, string | null>();
  const failed = new Set<string>();

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

      // 이메일이 없으면 DM 자체가 불가능 — 미연결로 처리합니다.
      const ok = email ? await sendSlackDM(email, text) : false;
      if (ok) result.sent++;
      else failed.add(item.assignee);
    } catch (e) {
      console.warn(
        `[mail] 담당자 DM 실패(${item.assignee}):`,
        e instanceof Error ? e.message : e,
      );
      failed.add(item.assignee);
    }
  }

  result.unreachable = [...failed].sort((a, b) => a.localeCompare(b, "ko"));
  return result;
}
