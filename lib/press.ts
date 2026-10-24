// =====================================================================
// 보도자료 기자·기사 — 타입과 순수 헬퍼 (docs/PRESS_AUTOMATION.md).
//   * 서버(입구 lib/pressIngest, 화면 액션)와 클라이언트 화면이 함께 import 합니다.
//     DB·비밀값에 닿는 코드는 여기 두지 않습니다.
//   * 칸 구분이 핵심입니다.
//       자동 칸 — 헤르메스 입구가 씀: first_seen_at, last_article_*, article_count
//       수동 칸 — 관장만 씀:         phone, beat, memo, receive_press_release,
//                                    last_thanks_sent_at
//     입구는 수동 칸을 어떤 경우에도 쓰지 않습니다(source='manual' 기자 포함).
// =====================================================================

export type PressReporter = {
  id: string;
  name: string;
  email: string | null;
  outlet: string;
  first_seen_at: string | null;
  last_article_at: string | null;
  last_article_title: string | null;
  last_article_url: string | null;
  article_count: number;
  phone: string | null;
  beat: string | null;
  memo: string | null;
  receive_press_release: boolean;
  last_thanks_sent_at: string | null;
  source: "hermes" | "manual";
  pending_email: string | null;
  pending_email_url: string | null;
  pending_email_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PressReporterStatus = "found" | "name_only" | "not_found";

export type PressArticle = {
  id: string;
  published_at: string;
  outlet: string;
  title: string;
  url: string;
  event_group: string | null;
  is_roundup: boolean;
  reporter_id: string | null;
  reporter_status: PressReporterStatus;
  promotion_id: string | null;
  release_id: string | null;
  source: "hermes" | "manual";
  created_at: string;
};

// 홍보 실적(business_promotions) 연결 — 구분값은 BusinessResultsDashboard 의
//   promotionCategories 안의 값을 그대로 씁니다(새 구분을 만들지 않습니다).
export const PRESS_PROMOTION_CATEGORY = "언론보도";
export const PRESS_PROMOTION_AUTHOR = "헤르메스 자동";

// 입력 길이 상한 — 입구·관장 입력 공통.
export const PRESS_LIMITS = {
  url: 2000,
  title: 500,
  outlet: 100,
  eventGroup: 200,
  name: 50,
  email: 254,
  phone: 30,
  beat: 100,
  memo: 2000,
} as const;

// 한 번에 받는 기사 수 상한({ items: [...] }).
export const PRESS_BATCH_MAX = 50;

// 실용 수준의 이메일 형식 검사 — 공백 없음, @ 하나, 도메인에 점.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(s: string): boolean {
  return s.length <= PRESS_LIMITS.email && EMAIL_RE.test(s);
}

export function isHttpUrl(s: string): boolean {
  if (s.length > PRESS_LIMITS.url) return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// YYYY-MM-DD 이면서 실제 달력 날짜(2026-02-30 거부).
export function isYmd(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    y >= 2000 &&
    y <= 2100 &&
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d
  );
}

// 문자열 칸 정리 — 앞뒤 공백 제거, 빈 문자열은 null.
export function cleanText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

// --- 입구 입력 검증 -----------------------------------------------------

export type PressIngestArticle = {
  published_at: string;
  outlet: string;
  title: string;
  url: string;
  event_group: string | null;
  is_roundup: boolean;
};

// 기자 칸: 이름·이메일 둘 다 못 찾았으면 null(=not_found).
export type PressIngestReporter = {
  name: string | null;
  email: string | null;
  outlet: string;
} | null;

export type PressIngestItem = {
  article: PressIngestArticle;
  reporter: PressIngestReporter;
};

export type PressValidation =
  | { ok: true; item: PressIngestItem }
  | { ok: false; error: string };

function textField(
  obj: Record<string, unknown>,
  key: string,
  label: string,
  max: number,
  required: boolean,
): { ok: true; value: string | null } | { ok: false; error: string } {
  const raw = obj[key];
  if (raw != null && typeof raw !== "string") {
    return { ok: false, error: `${label} 는 문자열이어야 합니다.` };
  }
  const value = cleanText(raw);
  if (required && !value) return { ok: false, error: `${label} 가 비었습니다.` };
  if (value && value.length > max) {
    return { ok: false, error: `${label} 는 ${max}자 이하여야 합니다.` };
  }
  return { ok: true, value };
}

// 헤르메스가 보낸 기사 1건 검증. 통과하면 정리된 값(공백 제거·기본값)을 돌려줍니다.
export function validateIngestItem(raw: unknown): PressValidation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "본문은 { article, reporter } 객체여야 합니다." };
  }
  const body = raw as Record<string, unknown>;
  const a = body.article;
  if (!a || typeof a !== "object" || Array.isArray(a)) {
    return { ok: false, error: "article 객체가 필요합니다." };
  }
  const art = a as Record<string, unknown>;

  const url = textField(art, "url", "article.url", PRESS_LIMITS.url, true);
  if (!url.ok) return url;
  if (!isHttpUrl(url.value!)) {
    return { ok: false, error: "article.url 은 http(s) 주소여야 합니다." };
  }
  const title = textField(art, "title", "article.title", PRESS_LIMITS.title, true);
  if (!title.ok) return title;
  const outlet = textField(art, "outlet", "article.outlet", PRESS_LIMITS.outlet, true);
  if (!outlet.ok) return outlet;
  const published = textField(art, "published_at", "article.published_at", 10, true);
  if (!published.ok) return published;
  if (!isYmd(published.value!)) {
    return { ok: false, error: "article.published_at 은 YYYY-MM-DD 날짜여야 합니다." };
  }
  const group = textField(art, "event_group", "article.event_group", PRESS_LIMITS.eventGroup, false);
  if (!group.ok) return group;
  if (art.is_roundup != null && typeof art.is_roundup !== "boolean") {
    return { ok: false, error: "article.is_roundup 은 true/false 여야 합니다." };
  }

  const article: PressIngestArticle = {
    url: url.value!,
    title: title.value!,
    outlet: outlet.value!,
    published_at: published.value!,
    event_group: group.value,
    is_roundup: art.is_roundup === true,
  };

  let reporter: PressIngestReporter = null;
  const r = body.reporter;
  if (r != null) {
    if (typeof r !== "object" || Array.isArray(r)) {
      return { ok: false, error: "reporter 는 객체 또는 null 이어야 합니다." };
    }
    const rep = r as Record<string, unknown>;
    const name = textField(rep, "name", "reporter.name", PRESS_LIMITS.name, false);
    if (!name.ok) return name;
    const email = textField(rep, "email", "reporter.email", PRESS_LIMITS.email, false);
    if (!email.ok) return email;
    if (email.value && !isValidEmail(email.value)) {
      return { ok: false, error: "reporter.email 형식이 올바르지 않습니다." };
    }
    const rOutlet = textField(rep, "outlet", "reporter.outlet", PRESS_LIMITS.outlet, false);
    if (!rOutlet.ok) return rOutlet;
    if (name.value || email.value) {
      reporter = {
        name: name.value,
        email: email.value ? email.value.toLowerCase() : null,
        outlet: rOutlet.value ?? article.outlet,
      };
    }
  }
  return { ok: true, item: { article, reporter } };
}

// 기사 → 기자 찾기 결과 표시값.
//   이름이 없으면 기자를 만들 수 없으므로(name not null) 이메일만 있어도 not_found.
export function reporterStatusOf(reporter: PressIngestReporter): PressReporterStatus {
  if (!reporter || !reporter.name) return "not_found";
  return reporter.email ? "found" : "name_only";
}

// --- 화면용 집계 ----------------------------------------------------------

// 기자별 해당 연도 기사 수 — press_articles 에서 셉니다(기자 표에 연도 칸 없음).
export function articleCountsForYear(
  articles: Pick<PressArticle, "reporter_id" | "published_at">[],
  year: number,
): Map<string, number> {
  const prefix = `${year}-`;
  const counts = new Map<string, number>();
  for (const a of articles) {
    if (!a.reporter_id || !a.published_at.startsWith(prefix)) continue;
    counts.set(a.reporter_id, (counts.get(a.reporter_id) ?? 0) + 1);
  }
  return counts;
}

// 보도자료 배포용 이메일 목록 — 받기 체크 + 이메일 있는 기자만, 중복 제거.
export function pressReleaseEmails(
  reporters: Pick<PressReporter, "email" | "receive_press_release">[],
): string[] {
  const seen = new Set<string>();
  for (const r of reporters) {
    if (!r.receive_press_release || !r.email) continue;
    seen.add(r.email.trim().toLowerCase());
  }
  return [...seen];
}
