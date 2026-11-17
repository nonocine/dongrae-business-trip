import "server-only";

// =====================================================================
// 인스타그램 토큰 보관·자동 연장·상태 확인 (2026-11 토큰 만료 사고 후속)
//   * 연결 방식: Instagram API with Instagram Login(graph.instagram.com). 페이지 연결형이
//     아니라 '만료 없는 페이지 토큰' 이 없고, 장기 토큰이 60일마다 만료됩니다.
//   * 보관: integration_tokens(provider='instagram') → 없으면 환경변수 INSTAGRAM_ACCESS_TOKEN.
//     연장된 토큰은 DB 에만 씁니다(환경변수는 앱이 못 바꾸고, 바꿔도 재배포해야 반영됨).
//   * 자동 연장: /api/cron/instagram-token 이 매일 부르고, 마지막 발급·연장 후 50일이
//     지났을 때만 refresh_access_token 을 부릅니다(발급 24시간 안에는 Meta 가 거부).
//   * 상태 확인: 매주 화요일 '확인할 일' Cron(lib/pendingDigest)이 checkInstagramTokenHealth
//     를 불러 14일 이내 만료·오류면 관장에게 DM.
//     ⚠️ debug_token 은 graph.facebook.com(페이스북 로그인형) 전용이라 이 방식 토큰에는
//     못 씁니다 — 만료일은 발급·연장 때 받은 expires_in 으로 DB 에 적어 두고, 유효성은
//     /me 호출로 확인합니다.
//   * ⚠️ 토큰 값은 어디에도 출력하지 않습니다. 사유 문자열은 redact 통과.
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { instagramGet, InstagramTokenError, redact } from "@/lib/instagramApi";

const PROVIDER = "instagram";
const DAY = 24 * 3600 * 1000;
export const REFRESH_AFTER_DAYS = 50;
export const WARN_WITHIN_DAYS = 14;

type StoredToken = {
  access_token: string;
  expires_at: string | null;
  refreshed_at: string;
};

// DB 보관 토큰. 표가 아직 없거나 읽기 실패면 null(환경변수로 폴백).
export async function loadStoredInstagramToken(): Promise<StoredToken | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("integration_tokens")
      .select("access_token,expires_at,refreshed_at")
      .eq("provider", PROVIDER)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as StoredToken;
    return row.access_token?.trim() ? row : null;
  } catch {
    return null;
  }
}

// 지금 쓸 토큰 — DB 우선, 없으면 환경변수.
export async function currentInstagramToken(): Promise<string | null> {
  const stored = await loadStoredInstagramToken();
  return stored?.access_token.trim() || process.env.INSTAGRAM_ACCESS_TOKEN?.trim() || null;
}

export async function saveInstagramToken(token: string, expiresInSec: number | null): Promise<void> {
  const now = new Date();
  const { error } = await supabaseAdmin.from("integration_tokens").upsert({
    provider: PROVIDER,
    access_token: token,
    expires_at: expiresInSec ? new Date(now.getTime() + expiresInSec * 1000).toISOString() : null,
    refreshed_at: now.toISOString(),
    last_error: null,
    updated_at: now.toISOString(),
  });
  if (error) throw new Error(`토큰 저장 실패: ${error.message}`);
}

async function recordError(reason: string) {
  await supabaseAdmin
    .from("integration_tokens")
    .update({ last_error: reason.slice(0, 500), updated_at: new Date().toISOString() })
    .eq("provider", PROVIDER);
}

// 장기 토큰 연장(60일). 새 토큰과 남은 초를 돌려줍니다. 실패는 throw(redact 됨).
export async function refreshInstagramToken(token: string): Promise<{ token: string; expiresIn: number | null }> {
  const body = await instagramGet(
    "/refresh_access_token",
    { grant_type: "ig_refresh_token" },
    token,
    { versioned: false },
  );
  const next = typeof body.access_token === "string" ? body.access_token.trim() : "";
  if (!next) throw new Error("연장 응답에 토큰이 없습니다.");
  const expiresIn = Number(body.expires_in);
  return { token: next, expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : null };
}

export type RefreshOutcome =
  | { status: "not_configured" }
  | { status: "not_due"; daysSinceRefresh: number; expiresAt: string | null }
  | { status: "refreshed"; expiresAt: string | null }
  | { status: "failed"; reason: string };

// 매일 Cron 이 부릅니다. 마지막 발급·연장 후 50일이 지났거나(=만료 10일 전),
//   DB 기록이 없을 때(환경변수 토큰만 있는 상태)만 실제로 연장합니다.
export async function refreshInstagramTokenIfDue(now: Date = new Date()): Promise<RefreshOutcome> {
  const stored = await loadStoredInstagramToken();
  const token = stored?.access_token.trim() || process.env.INSTAGRAM_ACCESS_TOKEN?.trim();
  if (!token) return { status: "not_configured" };

  if (stored) {
    const days = (now.getTime() - new Date(stored.refreshed_at).getTime()) / DAY;
    if (days < REFRESH_AFTER_DAYS) {
      return { status: "not_due", daysSinceRefresh: Math.floor(days), expiresAt: stored.expires_at };
    }
  }
  try {
    const r = await refreshInstagramToken(token);
    await saveInstagramToken(r.token, r.expiresIn);
    const after = await loadStoredInstagramToken();
    return { status: "refreshed", expiresAt: after?.expires_at ?? null };
  } catch (e) {
    const reason = redact(e instanceof InstagramTokenError ? e.reason : e instanceof Error ? e.message : String(e), [token]);
    if (stored) await recordError(reason).catch(() => {});
    return { status: "failed", reason };
  }
}

export type InstagramTokenHealth =
  | { status: "not_configured" }
  | { status: "ok"; expiresAt: string | null; daysLeft: number | null }
  | { status: "expiring"; expiresAt: string; daysLeft: number }
  | { status: "invalid"; reason: string }
  | { status: "error"; reason: string };

// 유효성(/me 호출) + 만료일(DB 기록). 화요일 '확인할 일' Cron 이 부릅니다.
export async function checkInstagramTokenHealth(now: Date = new Date()): Promise<InstagramTokenHealth> {
  const stored = await loadStoredInstagramToken();
  const token = stored?.access_token.trim() || process.env.INSTAGRAM_ACCESS_TOKEN?.trim();
  if (!token) return { status: "not_configured" };

  try {
    await instagramGet("/me", { fields: "user_id,username" }, token);
  } catch (e) {
    if (e instanceof InstagramTokenError) return { status: "invalid", reason: e.reason };
    return { status: "error", reason: redact(e instanceof Error ? e.message : String(e), [token]) };
  }

  const expiresAt = stored?.expires_at ?? null;
  if (!expiresAt) return { status: "ok", expiresAt: null, daysLeft: null };
  const daysLeft = Math.floor((new Date(expiresAt).getTime() - now.getTime()) / DAY);
  if (daysLeft <= WARN_WITHIN_DAYS) return { status: "expiring", expiresAt, daysLeft };
  return { status: "ok", expiresAt, daysLeft };
}

// 관장 DM 문구. 문제 없으면 null.
export function formatInstagramTokenAlert(h: InstagramTokenHealth): string | null {
  const fix = "조치: 메타 개발자 대시보드에서 토큰을 다시 발급해 `npx tsx scripts/instagram-token-setup.ts` 로 등록해 주세요.";
  switch (h.status) {
    case "expiring":
      return [
        `⚠️ 인스타그램 연결 토큰이 ${h.daysLeft <= 0 ? "오늘" : `${h.daysLeft}일 뒤`} 만료됩니다(${h.expiresAt.slice(0, 10)}).`,
        "자동 연장이 실패하고 있을 수 있습니다. 만료되면 홍보실적 '인스타그램 가져오기' 가 멈춥니다.",
        fix,
      ].join("\n");
    case "invalid":
      return [`🚨 인스타그램 연결 토큰이 만료되었거나 쓸 수 없습니다.`, `사유: ${h.reason}`, fix].join("\n");
    case "error":
      return [`⚠️ 인스타그램 연결 상태를 확인하지 못했습니다(일시 장애일 수 있음).`, `사유: ${h.reason}`].join("\n");
    default:
      return null;
  }
}
