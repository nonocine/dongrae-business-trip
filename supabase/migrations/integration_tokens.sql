-- =====================================================================
-- 외부 연동 토큰 보관 — 2026-11-17 (인스타그램 토큰 만료 사고 후속)
--   · 인스타그램 로그인형 장기 토큰은 60일마다 만료되고, 연장(refresh)하면 새 값이
--     돌아올 수 있습니다. Vercel 환경변수는 앱이 스스로 바꿀 수 없고 바꿔도 재배포해야
--     반영되므로, 연장된 최신 토큰은 이 표에 둡니다.
--   · 읽는 순서: 이 표(provider='instagram') → 없으면 환경변수 INSTAGRAM_ACCESS_TOKEN.
--   · 쓰는 곳: scripts/instagram-token-setup.ts(최초 등록), /api/cron/instagram-token(자동 연장).
--   · RLS 켜고 정책 없음(브라우저 키로는 못 읽음) — 동업자씨 서버(service_role)만 씀.
--   멱등: 여러 번 실행해도 결과가 같습니다.
-- =====================================================================

create table if not exists public.integration_tokens (
  provider text primary key,                 -- 'instagram'
  access_token text not null,                -- ⚠️ 비밀값 — 화면·로그에 내보내지 않음
  expires_at timestamptz,                    -- 만료 예정 시각(모르면 null)
  refreshed_at timestamptz not null default now(), -- 마지막 발급·연장 시각
  last_error text,                           -- 마지막 연장 실패 사유(토큰 값 없음)
  updated_at timestamptz not null default now()
);

alter table public.integration_tokens enable row level security;
