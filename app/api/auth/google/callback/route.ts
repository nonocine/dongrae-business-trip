import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  GOOGLE_SESSION_COOKIE,
  GOOGLE_SESSION_MAX_AGE,
  GOOGLE_WORKSPACE_DOMAIN,
  isAllowedGoogleEmail,
  isMasterEmail,
  serializeGoogleSession,
  type GoogleSession,
} from "@/lib/googleAuth";

// Google 콜백 — 인가 코드 수신 → 토큰 교환 → 사용자 조회 →
//   onnainna.kr 도메인 검증(이중 안전장치) → employee_profiles 매칭 →
//   dongrae_google_session 쿠키 발급 → next(기본 /hr) 로 redirect.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SEC-3b: 발급 경로가 제거된 구버전 쿠키 — 남아있는 값 정리용으로만 지웁니다.
const LEGACY_ADMIN_COOKIE = "dongrae_admin";
const EMPLOYEE_COOKIE = "dongrae_employee";

function callbackUri(request: Request): string {
  const env = process.env.GOOGLE_REDIRECT_URI;
  if (env) return env;
  return new URL(
    "/api/auth/google/callback",
    new URL(request.url).origin
  ).toString();
}

function safeNext(raw: string): string {
  const n = raw.trim();
  if (n.startsWith("/") && !n.startsWith("//")) return n;
  return "/hr";
}

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type GoogleUserInfo = {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  hd?: string;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = new URL(callbackUri(request)).origin;
  const code = (url.searchParams.get("code") ?? "").trim();
  const next = safeNext(url.searchParams.get("state") ?? "/hr");
  const oauthError = url.searchParams.get("error");

  const fail = (reason: string) => {
    const back = new URL("/", origin);
    back.searchParams.set("google_error", reason);
    return NextResponse.redirect(back.toString());
  };

  if (oauthError) return fail(oauthError);
  if (!code) return fail("missing_code");

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return new NextResponse(
      "Google 로그인 설정이 누락되었습니다. (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)",
      { status: 500 }
    );
  }

  // 1) 토큰 교환
  const tokenParams = new URLSearchParams();
  tokenParams.set("grant_type", "authorization_code");
  tokenParams.set("code", code);
  tokenParams.set("client_id", clientId);
  tokenParams.set("client_secret", clientSecret);
  tokenParams.set("redirect_uri", callbackUri(request));

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenParams.toString(),
    cache: "no-store",
  });
  const tokenJson = (await tokenRes
    .json()
    .catch(() => ({}))) as GoogleTokenResponse;
  if (!tokenRes.ok || !tokenJson.access_token) {
    return fail(
      "token_" + (tokenJson.error ?? tokenRes.status.toString())
    );
  }

  // 2) 사용자 정보 조회
  const userRes = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
      cache: "no-store",
    }
  );
  const user = (await userRes.json().catch(() => ({}))) as GoogleUserInfo;
  const email = (user.email ?? "").trim().toLowerCase();
  const googleName = (user.name ?? "").trim();

  // 3) 도메인 이중 검증 — Google Internal 설정 + 서버측 재확인.
  //    이메일 도메인 + hd 클레임 + 인증여부를 모두 확인.
  if (!userRes.ok || !email) return fail("userinfo");
  const hdOk = !user.hd || user.hd === GOOGLE_WORKSPACE_DOMAIN;
  if (
    !isAllowedGoogleEmail(email) ||
    !hdOk ||
    user.email_verified === false
  ) {
    return fail("domain_not_allowed");
  }

  // 4) 마스터 계정 — employee_profiles 매핑 없이도 무조건 관장 권한.
  const isMaster = isMasterEmail(email);

  // 5) employee_profiles 매칭(이메일) → drivers(이름·직급). 없으면 프로필 없음.
  let driverId: string | null = null;
  let driverName: string | null = null;
  let rank: string | null = null;
  try {
    const { data: prof } = await supabaseAdmin
      .from("employee_profiles")
      .select("driver_id")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();
    const did = (prof as { driver_id?: unknown } | null)?.driver_id;
    if (typeof did === "string" && did.length > 0) {
      driverId = did;
      const { data: drv } = await supabaseAdmin
        .from("drivers")
        .select("name, rank")
        .eq("id", did)
        .maybeSingle();
      driverName =
        ((drv as { name?: unknown } | null)?.name as string | null) ?? null;
      rank = ((drv as { rank?: unknown } | null)?.rank as string | null) ?? null;
    }
  } catch {
    // 조회 실패는 매칭 실패와 동일하게 취급 — 아래 정책에서 거부될 수 있음.
  }

  // 6) 등록 정책 — 매칭 실패 AND 마스터 아님 → 세션 발급 없이 거부.
  if (!isMaster && driverId === null) {
    return fail("not_registered");
  }

  const session: GoogleSession = {
    email,
    name: driverName ?? googleName,
    driverId,
    driverName,
    // 마스터는 매핑/직급과 무관하게 관장으로 고정.
    rank: isMaster ? "관장" : rank,
    hasProfile: driverId !== null,
    isMaster,
  };

  // 7) 쿠키 발급 — 다른 세션과의 우선순위 혼선을 막기 위해 기존 세션 정리.
  const store = await cookies();
  store.delete(LEGACY_ADMIN_COOKIE);
  store.delete(EMPLOYEE_COOKIE);
  store.set(GOOGLE_SESSION_COOKIE, serializeGoogleSession(session), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: GOOGLE_SESSION_MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  });

  return NextResponse.redirect(new URL(next, origin).toString());
}
