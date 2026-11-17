// =====================================================================
// 인스타그램 토큰 등록(일회성·비상용) — 2026-11 토큰 만료 사고 후속
//   실행: 새 토큰을 복사(Ctrl+C)한 뒤
//         node --env-file=.env.local --import tsx scripts/instagram-token-setup.ts
//   * 토큰은 클립보드에서 읽고(화면 입력 없음), 다 읽은 뒤 클립보드를 비웁니다.
//     ⚠️ 토큰 값은 화면·로그 어디에도 찍지 않습니다(모든 출력은 redact 통과).
//   * 연결 방식은 Instagram API with Instagram Login(graph.instagram.com)입니다.
//     페이스북 토큰(EAA… — Graph API Explorer 기본값)은 이 방식에 못 쓰므로 중단합니다.
//   * 순서:
//     1) 단기 토큰이면 앱 시크릿(INSTAGRAM_APP_SECRET, 환경변수에 있을 때만)으로
//        장기 토큰(60일)으로 교환. 대시보드 'Generate token' 으로 받은 토큰은 이미 장기라
//        교환을 건너뜁니다.
//     2) /me 로 센터 계정 확인 + /me/media 로 게시물 읽기 확인
//     3) DB(integration_tokens)에 저장 — 앱은 DB 토큰을 먼저 씁니다(배포 없이 즉시 반영)
//     4) Vercel 운영(Production) 환경변수 INSTAGRAM_ACCESS_TOKEN 교체(rm → add, 민감 변수)
//        값은 표준입력으로만 넘깁니다(명령줄 인자에 안 실음).
//   * Vercel 단계만 다시: node --env-file=.env.local --import tsx scripts/instagram-token-setup.ts --vercel-only
//   * 이후 연장은 /api/cron/instagram-token 이 50일마다 자동으로 합니다.
// =====================================================================
import { execFileSync, spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { instagramGet, InstagramTokenError, redact } from "../lib/instagramApi";

const VERCEL = "vercel@65.17.0";
const ENV_NAME = "INSTAGRAM_ACCESS_TOKEN";
const SIXTY_DAYS = 60 * 24 * 3600;

function readClipboard(): string {
  return execFileSync("powershell", ["-NoProfile", "-Command", "Get-Clipboard -Raw"], {
    encoding: "utf8",
  }).trim();
}
function clearClipboard() {
  try {
    execFileSync("powershell", ["-NoProfile", "-Command", "Set-Clipboard -Value ' '"]);
  } catch {
    /* 비우기 실패는 무시 */
  }
}

function fail(msg: string): never {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

async function main() {
  const input = readClipboard();
  clearClipboard();
  if (!input || /\s/.test(input)) fail("클립보드에 토큰 한 줄만 복사한 뒤 다시 실행해 주세요.");
  if (input.startsWith("EAA")) {
    fail(
      "페이스북 사용자 토큰(EAA…)입니다. 이 앱은 '인스타그램 로그인형'이라 graph.instagram.com 용 토큰(IG…)이 필요합니다.\n" +
        "  메타 개발자 대시보드 → 앱 → Instagram → 'API setup with Instagram login' → 2. Generate access tokens 에서 센터 계정 토큰을 발급해 복사해 주세요.",
    );
  }
  const secret = process.env.INSTAGRAM_APP_SECRET?.trim();
  const hide = (t: string) => redact(t, [input, secret]);
  console.log(`· 토큰 ${input.length}자 읽음 — 형식: ${input.startsWith("IG") ? "인스타그램(IG…)" : "확인 필요"} (값은 표시하지 않음)`);

  // 1) 단기 → 장기 교환(시크릿이 있을 때만). 이미 장기면 Meta 가 거부 → 그대로 사용.
  let token = input;
  let expiresIn: number | null = null;
  if (secret) {
    try {
      const r = await instagramGet(
        "/access_token",
        { grant_type: "ig_exchange_token", client_secret: secret },
        input,
        { versioned: false, secrets: [secret] },
      );
      if (typeof r.access_token === "string" && r.access_token) {
        token = r.access_token;
        expiresIn = Number(r.expires_in) || null;
        console.log("✔ 단기 토큰 → 장기 토큰(60일) 교환 완료");
      }
    } catch (e) {
      console.log(`· 교환 건너뜀(이미 장기 토큰일 수 있음): ${hide(e instanceof InstagramTokenError ? e.reason : String(e))}`);
    }
  } else {
    console.log("· INSTAGRAM_APP_SECRET 없음 — 대시보드에서 받은 장기 토큰으로 보고 교환을 건너뜁니다.");
  }

  // 2) 계정·게시물 읽기 확인
  try {
    const me = await instagramGet("/me", { fields: "user_id,username" }, token);
    console.log(`✔ 연결 계정: @${String(me.username ?? "?")} (user_id ${String(me.user_id ?? "?")})`);
    const media = await instagramGet("/me/media", { fields: "id,timestamp", limit: "1" }, token);
    const n = Array.isArray(media.data) ? media.data.length : 0;
    console.log(`✔ 게시물 읽기 확인(${n}건 응답)`);
  } catch (e) {
    fail(`토큰 확인 실패 — ${hide(e instanceof InstagramTokenError ? e.reason : String(e))}`);
  }
  if (expiresIn === null) {
    // 교환을 안 했으면 만료일을 모릅니다 — 대시보드 발급 토큰 기준 60일로 적어 둡니다.
    expiresIn = SIXTY_DAYS;
    console.log("· 만료일: 발급 시점 기준 60일로 기록(첫 자동 연장 때 정확한 값으로 바뀜)");
  }

  // 3) DB 저장
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없습니다(.env.local 확인).");
  const db = createClient(url, key, { auth: { persistSession: false } });
  const now = new Date();
  const { error } = await db.from("integration_tokens").upsert({
    provider: "instagram",
    access_token: token,
    expires_at: new Date(now.getTime() + expiresIn * 1000).toISOString(),
    refreshed_at: now.toISOString(),
    last_error: null,
    updated_at: now.toISOString(),
  });
  if (error) fail(`DB 저장 실패: ${hide(error.message)}`);
  console.log(`✔ DB 저장 완료(만료 예정 ${new Date(now.getTime() + expiresIn * 1000).toISOString().slice(0, 10)})`);

  // 4) Vercel 운영 환경변수 교체
  replaceVercelEnv(token, hide);
  console.log("완료 — 앱은 DB 토큰을 바로 씁니다. 환경변수는 다음 배포부터 반영(비상용 예비).");
}

// Vercel 운영 환경변수 교체 — rm 후 add(민감 변수). 값은 stdin 으로만.
//   ⚠️ 기존 변수가 여러 환경(개발·미리보기·운영)에 한 줄로 걸려 있으면 운영만 따로 못 지워
//   변수 전체를 지웁니다(옛 값은 이미 만료된 토큰). 새 값은 운영(Production)에만 둡니다.
function replaceVercelEnv(token: string, hide: (t: string) => string) {
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const run = (args: string[], input?: string) =>
    spawnSync(npx, ["--yes", VERCEL, ...args], {
      input,
      encoding: "utf8",
      shell: process.platform === "win32",
    });
  const last = (r: ReturnType<typeof run>) =>
    hide(
      [r.stderr ?? "", r.stdout ?? ""]
        .join("\n")
        .split("\n")
        .filter((l) => /error/i.test(l))
        .pop() ?? "",
    );

  // 비대화형 삭제는 --confirm-name 으로 변수 이름을 한 번 더 적어야 합니다(Vercel CLI 65).
  const rm = run(["env", "rm", ENV_NAME, "--confirm-name", ENV_NAME]);
  console.log(rm.status === 0 ? "✔ 기존 환경변수 삭제" : `· 기존 값 삭제 건너뜀(없을 수 있음): ${last(rm)}`);
  const add = run(["env", "add", ENV_NAME, "--environment", "production", "--sensitive", "--yes"], token);
  if (add.status !== 0) fail(`Vercel 환경변수 등록 실패: ${last(add)}`);
  console.log("✔ Vercel 운영(Production) 환경변수 등록(민감 변수)");
}

// --vercel-only: DB 에 이미 저장된 토큰으로 Vercel 교체만 다시 합니다(클립보드 안 씀).
async function vercelOnly() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없습니다(.env.local 확인).");
  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await db
    .from("integration_tokens")
    .select("access_token")
    .eq("provider", "instagram")
    .maybeSingle();
  const token = (data as { access_token?: string } | null)?.access_token?.trim();
  if (error || !token) fail("DB 에 저장된 인스타그램 토큰이 없습니다.");
  replaceVercelEnv(token, (t) => redact(t, [token]));
  console.log("완료 — 다음 배포부터 운영 환경변수에도 새 토큰이 반영됩니다.");
}

(process.argv.includes("--vercel-only") ? vercelOnly() : main()).catch((e) => fail(redact(e instanceof Error ? e.message : String(e))));
