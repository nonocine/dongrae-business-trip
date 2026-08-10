import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { signPayload } from "@/lib/signedCookie";

// 카카오 콜백 — 인가 코드 수신 → 토큰 교환 → 사용자 조회 → 쿠키 세션 발급.
// 끝에 /recruitment/{state}/apply 로 redirect.

export const dynamic = "force-dynamic";

const KAKAO_ID_COOKIE = "kakao_id";
const KAKAO_NICKNAME_COOKIE = "kakao_nickname";
// 세션 유지 — 30일. 외부 지원자라 너무 길게 잡지는 않습니다.
const KAKAO_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

type KakaoTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type KakaoUserResponse = {
  id?: number | string;
  properties?: { nickname?: string };
  kakao_account?: { profile?: { nickname?: string } };
};

function fallbackOrigin(request: Request): string {
  // 콜백 redirect 대상은 우리 서비스 도메인. 환경변수 KAKAO_REDIRECT_URI 의
  // origin 을 사용하면 로컬/배포 어느 쪽에서든 일관됩니다.
  const redirect = process.env.KAKAO_REDIRECT_URI;
  if (redirect) {
    try {
      return new URL(redirect).origin;
    } catch {
      // fallthrough
    }
  }
  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = (url.searchParams.get("code") ?? "").trim();
  const state = (url.searchParams.get("state") ?? "").trim();
  const error = url.searchParams.get("error");

  const origin = fallbackOrigin(request);
  const applyPath = state
    ? `/recruitment/${encodeURIComponent(state)}/apply`
    : "/recruitment";

  if (error) {
    const back = new URL(applyPath, origin);
    back.searchParams.set("kakao_error", error);
    return NextResponse.redirect(back.toString());
  }

  if (!code) {
    const back = new URL(applyPath, origin);
    back.searchParams.set("kakao_error", "missing_code");
    return NextResponse.redirect(back.toString());
  }

  const clientId = process.env.KAKAO_REST_API_KEY;
  const clientSecret = process.env.KAKAO_CLIENT_SECRET;
  const redirectUri = process.env.KAKAO_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return new NextResponse(
      "카카오 로그인 설정이 누락되었습니다. (KAKAO_REST_API_KEY / KAKAO_REDIRECT_URI)",
      { status: 500 }
    );
  }

  // 1) 토큰 교환
  const tokenParams = new URLSearchParams();
  tokenParams.set("grant_type", "authorization_code");
  tokenParams.set("client_id", clientId);
  tokenParams.set("redirect_uri", redirectUri);
  tokenParams.set("code", code);
  if (clientSecret) tokenParams.set("client_secret", clientSecret);

  const tokenRes = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
    },
    body: tokenParams.toString(),
    cache: "no-store",
  });
  const tokenJson = (await tokenRes.json().catch(() => ({}))) as KakaoTokenResponse;
  if (!tokenRes.ok || !tokenJson.access_token) {
    return new NextResponse(
      `카카오 토큰 발급 실패: ${
        tokenJson.error_description ?? tokenJson.error ?? "unknown"
      }`,
      { status: 500 }
    );
  }

  // 2) 사용자 정보 조회
  const userRes = await fetch("https://kapi.kakao.com/v2/user/me", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
    },
    cache: "no-store",
  });
  const userJson = (await userRes.json().catch(() => ({}))) as KakaoUserResponse;
  if (!userRes.ok || userJson.id == null) {
    return new NextResponse("카카오 사용자 정보 조회 실패", { status: 500 });
  }

  const kakaoId = String(userJson.id);
  const nickname =
    userJson.kakao_account?.profile?.nickname ??
    userJson.properties?.nickname ??
    "";

  // 3) 쿠키 세팅 — kakao_id / nickname
  //    kakao_id 는 본인 판별 키이므로 HMAC 서명본으로 저장합니다(SEC-3a 패턴).
  //    이 값을 임의로 바꿔 타인 지원서를 여는 것을 원천 차단합니다.
  //    nickname 은 화면 표시용(httpOnly:false)이라 서명하지 않습니다.
  const store = await cookies();
  store.set(KAKAO_ID_COOKIE, signPayload({ kakaoId }), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: KAKAO_COOKIE_MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  });
  // 닉네임은 한글이 들어갈 수 있어 그대로 둡니다(Set-Cookie 는 UTF-8 안전).
  store.set(KAKAO_NICKNAME_COOKIE, nickname, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: KAKAO_COOKIE_MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  });

  return NextResponse.redirect(new URL(applyPath, origin).toString());
}
