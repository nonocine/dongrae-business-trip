import { getSession, isManagerAdmin } from "@/app/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { PressArticle } from "@/lib/press";

// =====================================================================
// 언론보도(공통 메뉴) 데이터 — 로그인한 직원 누구나 '조회'만.
//   * 2026-11 관장 지시로 관리자 영역 '보도자료 기자' 의 기사 탭을 여기로 옮겼습니다.
//     기자 명단(이메일·전화·메모)·확인 대기열·수집·홈페이지 게시는 /press(관장 전용)에 남습니다.
//   * press_* 테이블은 RLS on + 정책 없음 → service_role 로 읽으므로, 여기서 직접
//     세션을 확인하고 내려보낼 칸을 좁힙니다(기자는 기사 바이라인 이름만).
//   * 관장(isManagerAdmin)에게는 모든 기사(확인 대기·제외 포함)가 내려갑니다 — 되돌리기 버튼도 관장만.
//   * 직원에게는 '승인된 기사'(auto·approved, lib/press isConfirmedArticle 과 같은 기준)만 내려갑니다.
//     확인 대기(needs_review)·제외(rejected)는 서버에서 걸러 화면에 아예 가지 않습니다.
// =====================================================================

export type PressNewsArticle = Pick<
  PressArticle,
  | "id"
  | "published_at"
  | "outlet"
  | "title"
  | "url"
  | "event_group"
  | "is_roundup"
  | "reporter_id"
  | "reporter_status"
  | "promotion_id"
  | "source"
  | "url_status"
  | "review_status"
>;

const COLS =
  "id,published_at,outlet,title,url,event_group,is_roundup,reporter_id,reporter_status,promotion_id,source,url_status,review_status";

export type PressNewsData = {
  articles: PressNewsArticle[];
  // 기사에 연결된 기자 이름만(id → 이름). 이메일·전화·메모는 내려보내지 않습니다.
  reporterNames: Record<string, string>;
  canManage: boolean;
};

// 로그인하지 않았으면 null — 화면이 "/" 로 돌려보냅니다.
export async function loadPressNews(): Promise<PressNewsData | null> {
  if (!(await getSession())) return null;
  const canManage = await isManagerAdmin();

  let q = supabaseAdmin.from("press_articles").select(COLS).order("published_at", { ascending: false });
  if (!canManage) q = q.in("review_status", ["auto", "approved"]);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const articles = (data ?? []) as PressNewsArticle[];

  // 명단이 수백 명 규모라 id·이름 두 칸만 한 번에 읽고, 기사에 연결된 사람만 남깁니다.
  const linked = new Set(articles.map((a) => a.reporter_id).filter((v): v is string => !!v));
  const reporterNames: Record<string, string> = {};
  if (linked.size > 0) {
    const rep = await supabaseAdmin.from("press_reporters").select("id,name");
    if (rep.error) throw new Error(rep.error.message);
    for (const r of (rep.data ?? []) as { id: string; name: string }[]) {
      if (linked.has(r.id)) reporterNames[r.id] = r.name;
    }
  }
  return { articles, reporterNames, canManage };
}
