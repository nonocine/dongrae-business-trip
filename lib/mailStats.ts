import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  MAIL_CATEGORY_ETC,
  MAIL_CATEGORY_INDEX,
  isMailFetchStale,
  type MailCategory,
} from "@/lib/mail";

// =====================================================================
// 공용 메일함 통계 — 화면 윗부분(분류 배지·미처리·수집 시각)과 MCP 가 같은
//   쿼리를 씁니다. 메일 본문·제목·보낸사람은 읽지 않습니다(건수와 시각만).
//   권한 확인은 호출부 책임입니다.
// =====================================================================

// "기타" = 분류가 기타이거나 아직 분류되지 않은(NULL) 메일.
export const ETC_OR_FILTER = `ai_category.is.null,ai_category.eq.${MAIL_CATEGORY_ETC}`;

// 분류 인덱스 배지용 — "안읽음(opened_at IS NULL)" 건수를 세는 쿼리.
//   ★ 상태·담당자·검색은 일부러 넣지 않습니다. 인덱스 숫자는 어떤 필터를
//     걸어도 같아야 "그 분류에 몇 건 남았나" 로 읽힙니다.
//   ★ 삭제된 메일은 목록과 마찬가지로 제외합니다(deleted_at IS NULL).
//   category 를 주지 않으면 분류 무관 전체("전체" 칸) 건수입니다.
function unopenedCountQuery(category: MailCategory | null) {
  const q = supabaseAdmin
    .from("mail_messages")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .is("opened_at", null);
  if (!category) return q;
  // 목록 필터와 같은 조건을 써야 배지 숫자와 실제 목록이 어긋나지 않습니다.
  return category === MAIL_CATEGORY_ETC ? q.or(ETC_OR_FILTER) : q.eq("ai_category", category);
}

export type MailStats = {
  unreadCount: number; // 상태 '미처리'(status=unread), 삭제 제외
  categoryUnopened: Record<string, number>; // 분류별 아무도 안 연 메일
  unopenedCount: number; // 분류 무관 아무도 안 연 메일
  lastFetchedAt: string | null; // 수집기가 네이버에 마지막으로 접속한 시각
  lastMailAt: string | null; // 마지막으로 새 메일이 들어온 시각
  fetchStale: boolean;
};

export async function loadMailStats(): Promise<MailStats> {
  const [unreadQuery, lastFetchQuery, lastMailQuery, categoryCounts] =
    await Promise.all([
      supabaseAdmin
        .from("mail_messages")
        .select("id", { count: "exact", head: true })
        .eq("status", "unread")
        .is("deleted_at", null),
      // 마지막 수집 시각 = settings.mail_last_fetch_at.
      //   ★ 2026-09 이전에는 MAX(mail_messages.fetched_at) 을 썼는데, 그건
      //     "마지막으로 메일을 저장한 시각" 이라 새 메일이 없는 밤·주말에는
      //     갱신되지 않았고, Cron 이 10분마다 멀쩡히 돌아도 경고가 떴습니다.
      //     지금 값은 수집기가 네이버에 접속·인증까지 성공할 때마다 갱신됩니다
      //     (가져온 메일이 0건이어도 — lib/mailCollector.ts markLastFetch).
      supabaseAdmin
        .from("settings")
        .select("value")
        .eq("key", "mail_last_fetch_at")
        .maybeSingle(),
      // 마지막으로 새 메일이 들어온 시각 = MAX(fetched_at). 표시 전용입니다 —
      //   지연 판정에 쓰면 위의 오작동이 그대로 재발합니다. 휴지통·삭제 여부와
      //   무관하게 봅니다(목록 상태가 아니라 수집 이력이므로).
      supabaseAdmin
        .from("mail_messages")
        .select("fetched_at")
        .not("fetched_at", "is", null)
        .order("fetched_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      // 분류 인덱스 배지 — 각 분류 + 마지막 하나는 "전체"(분류 무관).
      Promise.all([
        ...MAIL_CATEGORY_INDEX.map((c) => unopenedCountQuery(c)),
        unopenedCountQuery(null),
      ]),
    ]);

  // settings 행이 없으면 null — 신규 배포 직후 첫 Cron 전까지가 그렇습니다.
  //   isMailFetchStale 이 null 을 "경고 없음" 으로 보므로 별도 처리가 없습니다.
  const lastFetchedAt =
    ((lastFetchQuery.data as { value?: string | null } | null)?.value) ?? null;
  const lastMailAt =
    ((lastMailQuery.data as { fetched_at?: string | null } | null)
      ?.fetched_at) ?? null;

  const categoryUnopened: Record<string, number> = {};
  MAIL_CATEGORY_INDEX.forEach((c, i) => {
    categoryUnopened[c] = categoryCounts[i]?.count ?? 0;
  });

  return {
    unreadCount: unreadQuery.count ?? 0,
    categoryUnopened,
    unopenedCount: categoryCounts[MAIL_CATEGORY_INDEX.length]?.count ?? 0,
    lastFetchedAt,
    lastMailAt,
    // 지연 판정은 서버에서 — 클라이언트에서 계산하면 하이드레이션이 어긋납니다.
    //   판정 입력은 반드시 lastFetchedAt(접속 시각). lastMailAt 이 아닙니다.
    fetchStale: isMailFetchStale(lastFetchedAt, Date.now()),
  };
}

// 상태별 건수(삭제 제외) — MCP 요약 전용. 화면 목록은 300건 상한이라 전체
//   건수를 따로 세지 않으므로, 위 unreadCount 와 같은 조건(deleted_at IS NULL)
//   으로 상태만 바꿔 셉니다.
export type MailStatusCounts = {
  unread: number;
  processing: number;
  done: number;
  total: number;
};
export async function loadMailStatusCounts(): Promise<MailStatusCounts> {
  const count = (status?: string) => {
    let q = supabaseAdmin
      .from("mail_messages")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null);
    if (status) q = q.eq("status", status);
    return q;
  };
  const results = await Promise.all([
    count("unread"),
    count("processing"),
    count("done"),
    count(),
  ]);
  for (const r of results) if (r.error) throw new Error(r.error.message);
  const [unread, processing, done, total] = results.map((r) => r.count ?? 0);
  return { unread, processing, done, total };
}
