// =====================================================================
// 언론보도 → 홈페이지 게시 (press_articles 기록 포함) — PRESS_AUTOMATION 3-8
//   * 서버 전용. 권한 검사는 호출하는 서버 액션이 합니다(여기는 권한을 보지 않음).
//   * 범위(homepage_scope): 이 환경의 키 범위(test|live). 개발·운영이 같은 DB 를 쓰므로
//     다른 범위로 올린 기록은 "아직 안 올림"으로 봅니다.
//   * external_id: 처음은 press_articles.id. 같은 범위에서 내린(deleted) 뒤 다시 올리면
//     {id}-r2, -r3 … (홈페이지는 지운 글도 ID 를 계속 점유합니다).
//   * 첫 등록은 항상 draft. 공개 전환은 별도 동작입니다.
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  HOMEPAGE_NEWS_LIMITS,
  HomepageNewsError,
  homepageNewsConfig,
  homepageNewsCreate,
  homepageNewsErrorText,
  type HomepageNewsPost,
  type HomepageScope,
} from "@/lib/homepageNewsPublish";
import { fetchArticleImage, loadPressImage, PressImageError } from "@/lib/pressImage";

export type PressHomepageRow = {
  id: string;
  published_at: string;
  outlet: string;
  title: string;
  url: string;
  is_roundup: boolean;
  review_status: "auto" | "needs_review" | "approved" | "rejected";
  homepage_scope: HomepageScope | null;
  homepage_external_id: string | null;
  homepage_no: number | null;
  homepage_status: "draft" | "published" | "deleted" | null;
  homepage_summary: string | null;
  homepage_image_path: string | null;
};

const COLS =
  "id,published_at,outlet,title,url,is_roundup,review_status,homepage_scope,homepage_external_id,homepage_no,homepage_status,homepage_summary,homepage_image_path";

async function loadRow(articleId: string): Promise<PressHomepageRow> {
  const { data, error } = await supabaseAdmin.from("press_articles").select(COLS).eq("id", articleId).maybeSingle();
  if (error) throw new Error(`기사 조회 실패: ${error.message}`);
  if (!data) throw new Error("기사를 찾을 수 없습니다.");
  return data as PressHomepageRow;
}

// 요약 초안 — 본문을 복사하지 않습니다(링크·요약 원칙). 직원이 화면에서 다듬습니다.
export function defaultHomepageSummary(row: Pick<PressHomepageRow, "outlet" | "published_at" | "title">): string {
  const [y, m, d] = row.published_at.split("-").map(Number);
  return `${row.outlet}에서 ${y}년 ${m}월 ${d}일 보도한 기사입니다.\n${row.title}`;
}

// 이 범위에서 다음에 쓸 external_id.
function nextExternalId(row: PressHomepageRow, scope: HomepageScope): string {
  if (row.homepage_scope !== scope || !row.homepage_external_id) return row.id;
  if (row.homepage_status !== "deleted") return row.homepage_external_id; // 재시도 — 같은 ID
  const m = row.homepage_external_id.match(/-r(\d+)$/);
  return `${row.id}-r${m ? Number(m[1]) + 1 : 2}`;
}

// 대표 이미지 준비 — 이미 보관된 게 있으면 그대로, 없으면 기사 페이지 og:image 를 가져와 보관.
//   못 찾으면 null(이미지 없이 등록 가능). 실패 사유는 note 로 돌려줍니다.
export async function ensureArticleImage(
  articleId: string,
): Promise<{ path: string | null; sourceUrl: string | null; note: string | null }> {
  const row = await loadRow(articleId);
  if (row.homepage_image_path) return { path: row.homepage_image_path, sourceUrl: null, note: null };
  try {
    const img = await fetchArticleImage(row.id, row.url);
    if (!img) return { path: null, sourceUrl: null, note: "기사 페이지에 대표 이미지가 없습니다." };
    const { error } = await supabaseAdmin
      .from("press_articles")
      .update({ homepage_image_path: img.path })
      .eq("id", row.id);
    if (error) throw new Error(`이미지 기록 실패: ${error.message}`);
    return { path: img.path, sourceUrl: img.sourceUrl, note: null };
  } catch (e) {
    const note = e instanceof PressImageError ? e.message : "대표 이미지를 가져오지 못했습니다.";
    return { path: null, sourceUrl: null, note };
  }
}

export type HomepageDraftResult =
  | { ok: true; kind: "created" | "existing"; scope: HomepageScope; post: HomepageNewsPost }
  | { ok: false; message: string };

// [홈페이지 비공개 등록]. summary 를 주면 저장 후 사용, 없으면 저장된 요약 → 초안 순.
export async function createHomepageDraft(
  articleId: string,
  opts: { summary?: string; withImage?: boolean } = {},
): Promise<HomepageDraftResult> {
  const cfg = homepageNewsConfig();
  if (!cfg) return { ok: false, message: "홈페이지 게시 키가 설정되지 않았습니다." };

  const row = await loadRow(articleId);
  // 자동 수집의 확인 필요·제외 기사는 올리지 않습니다(승인한 기사만).
  if (row.review_status !== "auto" && row.review_status !== "approved") {
    return { ok: false, message: "확인 필요(또는 제외)인 기사는 홈페이지에 올릴 수 없습니다. 먼저 승인해 주세요." };
  }
  if (row.homepage_scope === cfg.scope && row.homepage_no !== null && row.homepage_status !== "deleted") {
    return { ok: false, message: `이미 홈페이지에 올린 기사입니다(글 번호 ${row.homepage_no}).` };
  }

  const summary = (opts.summary ?? row.homepage_summary ?? defaultHomepageSummary(row)).trim();
  if (!summary || summary.length > HOMEPAGE_NEWS_LIMITS.summary) {
    return { ok: false, message: "요약은 1~4000자로 적어 주세요." };
  }

  let image: { bytes: Uint8Array; filename: string; mime: string } | null = null;
  if (opts.withImage !== false && row.homepage_image_path) {
    image = { bytes: await loadPressImage(row.homepage_image_path), filename: "press.jpg", mime: "image/jpeg" };
  }

  const externalId = nextExternalId(row, cfg.scope);
  try {
    const r = await homepageNewsCreate({
      external_id: externalId,
      title: row.title.slice(0, HOMEPAGE_NEWS_LIMITS.title),
      publisher: row.outlet.slice(0, HOMEPAGE_NEWS_LIMITS.publisher),
      reported_date: row.published_at,
      source_url: row.url,
      summary,
      status: "draft",
      image,
    });
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from("press_articles")
      .update({
        homepage_scope: cfg.scope,
        homepage_external_id: externalId,
        homepage_no: r.post.no,
        homepage_status: r.post.status,
        homepage_summary: summary,
        homepage_posted_at: now,
        homepage_updated_at: now,
        homepage_error: null,
      })
      .eq("id", row.id);
    if (error) {
      // 홈페이지에는 올라갔음 — 다시 누르면 같은 external_id 409 → 이 글로 연결됩니다.
      return { ok: false, message: `홈페이지 등록은 됐지만 기록에 실패했습니다. 다시 눌러 주세요. (${error.message})` };
    }
    return { ok: true, kind: r.kind, scope: cfg.scope, post: r.post };
  } catch (e) {
    const message = homepageNewsErrorText(e);
    // 형식 오류(4xx)는 사유를 남겨 화면에 보여 줍니다. 키 값은 메시지에 들어가지 않습니다.
    if (e instanceof HomepageNewsError) {
      await supabaseAdmin
        .from("press_articles")
        .update({ homepage_error: message, homepage_updated_at: new Date().toISOString(), homepage_summary: summary })
        .eq("id", row.id);
    }
    return { ok: false, message };
  }
}
