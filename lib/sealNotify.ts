// =====================================================================
// 직인사용대장 슬랙 DM — 기존 개인 DM 헬퍼(sendSlackDMDetailed)만 씁니다. 채널 게시 없음.
//   * 결재 올림 → 관장·부장(신청자가 부장이면 관장만, 관장이면 부장만)
//   * 승인·반려 → 신청자(반려 사유 포함)
//   * SEAL_NOTIFY_LIVE=1 일 때만 실제 대상에게. 아니면 관장에게만 "[시험]" 을 붙여 보냅니다
//     (원래 받을 사람을 문구에 적어 둠).
//   * 대상자(청소년) 이름은 넣지 않습니다 — 종류·인원·번호만.
//   * 알림은 부가기능: 실패해도 결재 처리는 그대로(로그만). 절대 throw 하지 않음.
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendSlackDMDetailed, siteBaseUrl, slackLink } from "@/lib/slack";

type Person = { driverId: string; name: string; rank: string | null; email: string | null };

const live = () => process.env.SEAL_NOTIFY_LIVE === "1";

async function peopleByRank(ranks: string[]): Promise<Person[]> {
  const { data: drivers } = await supabaseAdmin
    .from("drivers")
    .select("id, name, rank, is_active")
    .in("rank", ranks);
  const active = ((drivers ?? []) as { id: string; name: string; rank: string | null; is_active?: boolean | null }[]).filter(
    (d) => d.is_active !== false,
  );
  return withEmails(active.map((d) => ({ driverId: d.id, name: d.name, rank: d.rank })));
}

async function withEmails(list: Omit<Person, "email">[]): Promise<Person[]> {
  if (!list.length) return [];
  const { data } = await supabaseAdmin
    .from("employee_profiles")
    .select("driver_id, email")
    .in(
      "driver_id",
      list.map((p) => p.driverId),
    );
  const emails = new Map(((data ?? []) as { driver_id: string; email: string | null }[]).map((r) => [String(r.driver_id), r.email?.trim() || null]));
  return list.map((p) => ({ ...p, email: emails.get(p.driverId) ?? null }));
}

function link(requestId: string, label: string): string {
  const base = siteBaseUrl();
  return base ? ` ${slackLink(`${base}/seal-register/${requestId}`, label)}` : "";
}

// 실제 대상(live) 또는 관장(시험)에게 보냄
async function deliver(targets: Person[], text: string): Promise<void> {
  try {
    let sendTo = targets;
    let body = text;
    if (!live()) {
      sendTo = await peopleByRank(["관장"]);
      const intended = targets.map((t) => `${t.rank ?? ""} ${t.name}`.trim()).join(", ") || "없음";
      body = `[시험] ${text}\n(실제 운영 때 받을 사람: ${intended})`;
    }
    for (const p of sendTo) {
      const { ok, reason } = await sendSlackDMDetailed(p.email, body);
      if (!ok) console.warn(`[sealNotify] DM 실패(${p.name}) — ${reason ?? "사유 미상"}`);
    }
  } catch (e) {
    console.warn("[sealNotify] DM 실패:", e instanceof Error ? e.message : e);
  }
}

export async function notifySealSubmitted(input: {
  requestId: string;
  requesterDriverId: string;
  requesterName: string;
  requesterRank: string | null;
  docLabel: string;
  count: number;
  round: number;
}): Promise<void> {
  const ranks = input.requesterRank === "부장" ? ["관장"] : input.requesterRank === "관장" ? ["부장"] : ["관장", "부장"];
  const targets = (await peopleByRank(ranks)).filter((p) => p.driverId !== input.requesterDriverId);
  const again = input.round > 1 ? `(${input.round}차 — 고쳐서 다시 올림) ` : "";
  await deliver(
    targets,
    `📝 직인 사용 신청 ${again}— ${input.requesterName} · ${input.docLabel} ${input.count}명${link(input.requestId, "결재하기")}`,
  );
}

export async function notifySealDecided(input: {
  requestId: string;
  requesterDriverId: string | null;
  requesterName: string;
  approved: boolean;
  approverName: string;
  approverRank: string | null;
  docLabel: string;
  count: number;
  issueRange?: string | null;
  reason?: string | null;
}): Promise<void> {
  const requester = input.requesterDriverId
    ? await withEmails([{ driverId: input.requesterDriverId, name: input.requesterName, rank: null }])
    : [];
  const who = `${input.approverRank ?? ""} ${input.approverName}`.trim();
  const text = input.approved
    ? `✅ 직인 사용 승인(${who}) — ${input.docLabel} ${input.count}명 ${input.issueRange ?? ""}${link(input.requestId, "출력하기")}`
    : `↩️ 직인 사용 반려(${who}) — ${input.docLabel} ${input.count}명 · 사유: ${input.reason ?? ""}${link(input.requestId, "고치기")}`;
  await deliver(requester, text);
}
