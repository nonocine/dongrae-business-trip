import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isMailCategory, type MailCategory } from "@/lib/mail";

// =====================================================================
// 공용 메일함 — 발신자 학습 (분류 2순위)
//
//   "이 발신자는 늘 광고였다" 를 근거로 분류합니다. 제목 키워드가 못 잡는
//   메일을 크레딧 없이 잡아내는 것이 목적입니다(실측 커버리지 14% → 26%).
//
//   판정 규칙(실측으로 정한 값 — 아래 주석 참고):
//     · 같은 발신자의 살아있는 메일 중 근거가 되는 것들을 셉니다.
//     · 가중 합이 3 이상이고, 한 분류가 80% 이상이면 그 분류로 확정.
//     · 못 미치면 null → AI 가 판단하거나 "기타" 로 남습니다.
//
//   ★ "기타" 는 근거에서 뺍니다 — 분류를 포기한 상태이지 판단이 아닙니다.
//     기타가 많다고 새 메일을 기타로 확정하면 포기를 학습하는 셈입니다.
//
//   ★ category_source='sender' 인 행도 근거에서 뺍니다. 자기가 매긴 값을
//     다시 근거로 삼으면 한 번의 오답이 스스로 굳어집니다(되먹임 고리).
//     근거가 되는 것은 사람(manual)·키워드(keyword)·AI(ai)·기존(null)뿐입니다.
//
//   ★ 사람이 고친 것(manual)은 1건만 있어도 즉시 그 분류로 확정합니다.
//     3건·80% 를 manual 에도 그대로 적용하면 자기모순이 생깁니다 — 사람이
//     고쳐도 3건이 쌓일 때까지 반영되지 않는데, 3건째부터는 이미 자동으로
//     잡혀서 고칠 일이 없습니다. 그러면 수동 수정이 영원히 학습에 반영되지
//     않습니다. 사람 판단이 가장 정확하므로 자동 근거보다 앞에 둡니다.
//     (manual 이 서로 다른 분류로 갈리면 판단을 유보하고 일반 규칙으로.)
// =====================================================================

// 실측 기준값. 1062건에 leave-one-out 으로 재서 고른 값입니다.
//   3건·80%  : 적중 127 · 정확도 87% · 커버리지 26.0%   ← 채택
//   3건·90%  : 적중  86 · 정확도 86% · 커버리지 22.1%   (정확도 이득 없음)
//   3건·70%  : 적중 164 · 정확도 73% · 커버리지 29.5%   (충돌 15→40 급증)
export const SENDER_MIN_COUNT = 3;
export const SENDER_MIN_SHARE = 0.8;

// PostgREST 는 한 번에 1000행까지만 돌려줍니다. 발신자 한 명이 수백 통을
//   보낸 경우까지 감안해 페이징합니다(분포가 조용히 잘리면 판정이 틀어집니다).
const PAGE = 1000;

export type SenderRef = { fromEmail: string; fromName: string };

// 발신자 키 — from_email 우선, 없으면 이름. 실데이터에는 빈 from_email 이
//   없지만(0건), 파싱 실패 대비로 폴백을 남깁니다.
export function senderKey(ref: SenderRef): string {
  const email = (ref.fromEmail ?? "").trim().toLowerCase();
  if (email) return email;
  return (ref.fromName ?? "").trim().toLowerCase();
}

export type SenderLearning = {
  predict(ref: SenderRef): MailCategory | null;
  /** 근거를 찾은 발신자 수 — 로그·시뮬레이션용. */
  size: number;
};

// 빈 판정기 — 조회에 실패해도 분류 전체가 멈추지 않게 합니다.
const EMPTY: SenderLearning = { predict: () => null, size: 0 };

// 배치에 등장하는 발신자들의 분포를 한 번에 읽어 메모리 판정기를 만듭니다.
//   ★ 메일 1건마다 쿼리하면 30건 배치에 30회가 나가므로 반드시 배치로 읽습니다.
export async function loadSenderLearning(
  refs: SenderRef[],
): Promise<SenderLearning> {
  try {
    const emails = new Set<string>();
    const names = new Set<string>();
    for (const r of refs) {
      const email = (r.fromEmail ?? "").trim().toLowerCase();
      if (email) emails.add(email);
      else {
        const n = (r.fromName ?? "").trim();
        if (n) names.add(n);
      }
    }
    if (emails.size === 0 && names.size === 0) return EMPTY;

    const rows: Record<string, unknown>[] = [];
    // from_email 로 묶이는 것과 이름으로만 묶이는 것을 나눠 읽습니다.
    for (const [column, values] of [
      ["from_email", [...emails]],
      ["from_name", [...names]],
    ] as [string, string[]][]) {
      if (values.length === 0) continue;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabaseAdmin
          .from("mail_messages")
          .select("from_email, from_name, ai_category, category_source")
          .in(column, values)
          .is("deleted_at", null)
          .not("ai_category", "is", null)
          .neq("ai_category", "기타")
          // category_source 가 null 인 기존 행도 근거에 포함해야 하므로
          //   neq 단독으로는 안 됩니다(NULL 비교는 NULL 이라 걸러집니다).
          .or("category_source.is.null,category_source.neq.sender")
          .range(from, from + PAGE - 1);
        if (error) {
          console.warn("[mail-sender] 분포 조회 실패:", error.message);
          return EMPTY;
        }
        const page = (data ?? []) as Record<string, unknown>[];
        rows.push(...page);
        if (page.length < PAGE) break;
      }
    }

    // 발신자 → 분류별 건수. 사람이 고친 것과 자동 분류를 따로 셉니다 —
    //   manual 은 건수와 무관하게 먼저 보기 때문입니다.
    type Tally = { manual: Map<string, number>; auto: Map<string, number> };
    const dist = new Map<string, Tally>();
    for (const r of rows) {
      const category = String(r.ai_category ?? "");
      if (!isMailCategory(category) || category === "기타") continue;
      const key = senderKey({
        fromEmail: String(r.from_email ?? ""),
        fromName: String(r.from_name ?? ""),
      });
      if (!key) continue;
      if (!dist.has(key)) dist.set(key, { manual: new Map(), auto: new Map() });
      const t = dist.get(key)!;
      const m =
        String(r.category_source ?? "") === "manual" ? t.manual : t.auto;
      m.set(category, (m.get(category) ?? 0) + 1);
    }

    // 최다 항목 — 동점이면 null(판단 유보).
    function topOf(m: Map<string, number>): { name: string; n: number } | null {
      let name = "";
      let n = 0;
      let tied = false;
      for (const [k, v] of m) {
        if (v > n) {
          name = k;
          n = v;
          tied = false;
        } else if (v === n) tied = true;
      }
      if (!name || tied) return null;
      return { name, n };
    }

    return {
      size: dist.size,
      predict(ref: SenderRef): MailCategory | null {
        const t = dist.get(senderKey(ref));
        if (!t) return null;

        // 1) 사람이 고친 것이 있으면 그것으로 확정 — 1건이면 충분합니다.
        if (t.manual.size > 0) {
          const top = topOf(t.manual);
          if (top && isMailCategory(top.name)) return top.name;
          // manual 이 갈리면 아래 일반 규칙으로 내려갑니다.
        }

        // 2) 자동 근거 — 3건 이상 + 한 분류가 80% 이상.
        //    manual 도 한 표로 함께 셉니다(갈린 경우에도 근거는 근거입니다).
        const all = new Map(t.auto);
        for (const [k, v] of t.manual) all.set(k, (all.get(k) ?? 0) + v);
        let total = 0;
        for (const v of all.values()) total += v;
        if (total < SENDER_MIN_COUNT) return null;
        const top = topOf(all);
        if (!top) return null;
        if (top.n / total < SENDER_MIN_SHARE) return null;
        return isMailCategory(top.name) ? top.name : null;
      },
    };
  } catch (e) {
    // 학습은 부가기능입니다 — 실패해도 AI 경로로 계속 갑니다.
    console.warn(
      "[mail-sender] 학습 준비 실패:",
      e instanceof Error ? e.message : e,
    );
    return EMPTY;
  }
}
