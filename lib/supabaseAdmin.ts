import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// =====================================================================
// service_role 전용 Supabase 클라이언트 — 서버 전용
//   * service_role 키는 RLS 를 우회하는 강력한 키입니다. 절대 클라이언트
//     번들에 포함되면 안 됩니다.
//   * SUPABASE_SERVICE_ROLE_KEY 는 NEXT_PUBLIC_ 접두사가 없으므로 Next 가
//     브라우저 번들로 인라인하지 않습니다(1차 방어선).
//   * 추가 안전장치로, 혹시라도 클라이언트 코드에서 import 되어 실행되면
//     window 가드가 즉시 throw 합니다(2차 방어선).
//   * 따라서 이 모듈은 "use server" 액션/서버 컴포넌트에서만 import 하세요.
//     ('server-only' 패키지는 이 프로젝트에 hoist 되어 있지 않아 import 시
//      해석 실패하므로 사용하지 않습니다. window 가드로 대체합니다.)
//   * anon 클라이언트(@/lib/supabase 의 supabase)와 키만 다르고 형태는 동일.
//     공개 테이블은 계속 anon 을 쓰고, 민감 테이블만 이 클라이언트를 씁니다.
// =====================================================================

let _admin: SupabaseClient | null = null;

function getAdminClient(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error(
      "supabaseAdmin 는 서버 전용입니다. 'use client' 컴포넌트에서 import 하지 마세요."
    );
  }
  if (_admin) return _admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "service_role 환경변수가 설정되지 않았습니다. .env.local 또는 Vercel 에 SUPABASE_SERVICE_ROLE_KEY 를 설정해주세요."
    );
  }
  _admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}

// lib/supabase.ts 의 supabase 와 동일한 lazy Proxy 패턴.
// 단순 import 만으로는 클라이언트가 생성되지 않으므로(첫 사용 시 초기화),
// 키가 없는 빌드 환경에서도 모듈 로드 자체는 실패하지 않습니다.
export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getAdminClient() as unknown as Record<
      string | symbol,
      unknown
    >;
    const value = client[prop as string];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(client)
      : Reflect.get(client as object, prop, receiver);
  },
});
