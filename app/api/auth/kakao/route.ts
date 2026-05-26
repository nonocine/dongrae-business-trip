import { NextResponse } from "next/server";

// 카카오 로그인 시작 — /api/auth/kakao?slug=foo 진입 시
// 카카오 인가 페이지로 302 redirect. 콜백에서 슬러그를 다시 받아야 하므로
// OAuth state 파라미터에 슬러그를 실어 보냅니다(간이 용도; CSRF nonce 아님).

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = (url.searchParams.get("slug") ?? "").trim();

  const clientId = process.env.KAKAO_REST_API_KEY;
  const redirectUri = process.env.KAKAO_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return new NextResponse(
      "카카오 로그인 설정이 누락되었습니다. (KAKAO_REST_API_KEY / KAKAO_REDIRECT_URI)",
      { status: 500 }
    );
  }

  const authUrl = new URL("https://kauth.kakao.com/oauth/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  if (slug) authUrl.searchParams.set("state", slug);

  return NextResponse.redirect(authUrl.toString());
}
