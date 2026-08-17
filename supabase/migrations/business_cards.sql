-- 명함첩 — business_cards.
--   * 테이블은 이미 생성되어 있고, 이 파일은 접근 잠금(RLS·권한)을 맞춥니다.
--   * ⚠️ 명함은 외부인 개인정보(이름·휴대전화·이메일)입니다. 브라우저에 실리는
--     anon 키로는 절대 읽히면 안 되므로, 다른 민감 테이블(business_results,
--     staff_training_results 등)과 동일하게 RLS 를 켜고 anon/authenticated 의
--     권한을 회수한 뒤 service_role 에만 부여합니다.
--     → 애플리케이션은 서버 액션(supabaseAdmin = service_role)으로만 접근하며,
--       service_role 은 RLS 를 우회하므로 정책(policy)은 두지 않습니다.
--   * 원본 이미지는 비공개 버킷 hr-documents 의 business-cards/ 아래에 두고
--     1시간 서명 URL 로만 열람합니다(경로만 image_path 에 저장).
--   * 여러 번 실행해도 안전(멱등)합니다.

create table if not exists business_cards (
  id uuid primary key default gen_random_uuid(),
  company text,
  department text,
  title text,
  person_name text,
  mobile text,
  phone text,
  fax text,
  email text,
  address text,
  website text,
  memo text,
  image_path text,
  ocr_raw jsonb,
  registered_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists business_cards_created_idx
  on business_cards (created_at desc);

alter table business_cards enable row level security;

revoke all on table business_cards from anon, authenticated;
grant select, insert, update, delete on table business_cards to service_role;
