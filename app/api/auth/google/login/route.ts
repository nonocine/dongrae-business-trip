import { NextResponse } from "next/server";

// Google Workspace 로그인 시작 — /api/auth/google/login?next=/hr 진입 시
// Google 인가 페이지로 302 redirect. 로그인 후 이동 경로는 state 로 전달.

export const dynamic = "force-dynamic";

// 콜백 redirect_uri — 토큰 교환과 반드시 동일해야 하므로 login/callback 동일 규칙.
//   GOOGLE_REDIRECT_URI 가 있으면 그것을, 없으면 요청 origin 기준으로 파생.
function callbackUri(request: Request): string {
  const env = process.env.GOOGLE_REDIRECT_URI;
  if (env) return env;
  return new URL(
    "/api/auth/google/callback",
    new URL(request.url).origin
  ).toString();
}

// 오픈 리다이렉트 방지 — 내부 절대경로만 허용.
function safeNext(raw: string): string {
  const n = raw.trim();
  if (n.startsWith("/") && !n.startsWith("//")) return n;
  return "/hr";
}

export async function GET(request: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return new NextResponse(
      "Google 로그인 설정이 누락되었습니다. (GOOGLE_CLIENT_ID)",
      { status: 500 }
    );
  }

  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next") ?? "/hr");

  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("client_id", clientId);
  auth.searchParams.set("redirect_uri", callbackUri(request));
  auth.searchParams.set("scope", "openid email profile");
  // [DEBUG] hd 파라미터 임시 제거 테스트 — 진단 후 원복 예정.
  auth.searchParams.set("prompt", "select_account");
  auth.searchParams.set("state", next);

  return NextResponse.redirect(auth.toString());
}
