-- =====================================================================
-- 동래방카 신규 청소년 온라인 접수(모집) — 매년 재사용하는 회차 구조 · 2026-11-03 설계
--   설계: docs/설계_방카신규접수.md
--   · 보호자 신청 화면: 동래방카 /apply (로그인 없이 휴대폰 인증번호 → 서명 쿠키 24시간)
--   · 직원 화면: 동업자씨 /bangka/enroll (방과후아카데미 직무 + M0)
--   · 증빙·사진·서명: 새 비공개 버킷 bk-applications, 경로 {recruitment_id}/{application_id}/{uuid}.ext
--   · 모든 표 RLS 켜고 정책 0개 — 두 앱 서버(service_role)만 읽고 씀. 브라우저 키로는 아무것도 못 함.
--   · consent_records 는 동업자씨 OS 공용 동의 기록표(앞으로 모든 동의를 여기에). 철회는 새 행(agreed=false).
--   멱등: 여러 번 실행해도 결과가 같습니다. begin/commit 은 넣지 않았습니다.
--   순서: 이 SQL → 두 앱 배포(동업자씨·동래방카). 기존 표는 bk_students 에 칸 추가만 합니다.
-- =====================================================================

-- 1) 모집 회차 ----------------------------------------------------------
create table if not exists public.bk_recruitments (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 100),   -- "2027년 신규 모집"
  apply_start_at timestamptz not null,
  apply_end_at timestamptz not null,
  capacity integer check (capacity is null or capacity >= 0),          -- 정원(모르면 비움)
  target_grades text[] not null default '{}',                          -- 대상 학년 {"초4","초5","초6","중1"}
  -- draft(준비) / open(접수중) / closed(마감 — 심사 중) / ended(종료 — 보관기간 계산 시작)
  status text not null default 'draft' check (status in ('draft', 'open', 'closed', 'ended')),
  notice text,                                                         -- 신청 화면 첫 안내 문구
  shuttle_stops jsonb not null default '[]'::jsonb,                    -- [{ "seq": 1, "time": "18:10", "place": "명륜역 1번 출구" }]
  retention_accepted_years smallint not null default 3 check (retention_accepted_years between 0 and 10),   -- 합격자 증빙: 합격한 해 연말 + N년
  retention_rejected_months smallint not null default 6 check (retention_rejected_months between 0 and 60), -- 불합격·대기·미제출: 결정(종료) 후 N개월
  consent_version text not null default '2027-v1',                    -- 동의서 문구 버전(consent_records.doc_version 에 그대로 남음)
  app_seq integer not null default 0,                                  -- 접수번호 일련번호(제출할 때 1씩)
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bk_recruitments_period check (apply_start_at < apply_end_at),
  constraint bk_recruitments_stops_array check (jsonb_typeof(shuttle_stops) = 'array')
);

create index if not exists bk_recruitments_status_idx on public.bk_recruitments (status, apply_start_at desc);

-- 2) 신청서 -------------------------------------------------------------
--    입력값 전체는 data(jsonb), 민감정보(알레르기·의료)는 sensitive(jsonb) 에 따로 —
--    보관기간이 지나면 sensitive 를 비우고 증빙 파일을 지웁니다. 검색·목록 칸만 컬럼으로 뺍니다.
create table if not exists public.bk_applications (
  id uuid primary key default gen_random_uuid(),
  recruitment_id uuid not null references public.bk_recruitments(id) on delete restrict,
  app_no text unique,                                   -- 접수번호 "2027-0001" (제출할 때 매김)
  guardian_phone text not null check (guardian_phone ~ '^01[0-9]{8,9}$'),  -- 인증된 보호자 번호(숫자만) = 신청서 주인
  -- draft(작성중) / submitted(제출) / needs_fix(보완요청) / docs_ok(서류확인) / accepted(합격) / waitlisted(대기) / rejected(불합격)
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'needs_fix', 'docs_ok', 'accepted', 'waitlisted', 'rejected')),
  current_step smallint not null default 1 check (current_step between 1 and 7),
  -- 목록·검색용 칸(data 에서 저장할 때마다 같이 씀)
  youth_name text,
  youth_gender text check (youth_gender is null or youth_gender in ('M', 'F')),
  youth_birth date,
  school text,
  grade text,
  guardian_name text,
  priority_types text[] not null default '{}',          -- 우선지원 유형 키(설계 4장)
  return_method text check (return_method is null or return_method in ('shuttle', 'guardian', 'alone', 'other')),
  has_allergy boolean,
  data jsonb not null default '{}'::jsonb,              -- 입력값 전체(설계 5장)
  sensitive jsonb,                                      -- 알레르기 상세 등 — 직원 [민감정보 보기]로만, 보관기간 뒤 null
  photo_path text,                                      -- bk-applications 안 경로
  guardian_signature_path text,
  youth_signature_path text,
  fix_items text[] not null default '{}',               -- 보완요청으로 다시 열린 항목(설계 6장) — 보호자가 다시 제출하면 비움
  fix_reason text,
  fix_requested_at timestamptz,
  fix_requested_by text,
  submitted_at timestamptz,                             -- 처음 제출
  resubmitted_at timestamptz,                           -- 보완 후 다시 제출
  decided_at timestamptz,
  decided_by text,
  student_id uuid references public.bk_students(id) on delete set null,   -- 합격 처리로 만든(연결한) 학생
  guardian_id uuid references public.bk_guardians(id) on delete set null, -- 합격 처리로 만든(연결한) 보호자
  staff_memo text,
  retention_until timestamptz,                          -- 이 시각이 지나면 Cron 이 증빙 삭제 + sensitive 비움
  purged_at timestamptz,
  submit_ip text,
  submit_user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bk_applications_data_object check (jsonb_typeof(data) = 'object')
);

create index if not exists bk_applications_recruitment_idx on public.bk_applications (recruitment_id, status, submitted_at);
create index if not exists bk_applications_phone_idx on public.bk_applications (guardian_phone, recruitment_id);
create index if not exists bk_applications_retention_idx on public.bk_applications (retention_until) where purged_at is null;

-- 3) 증빙 파일(서류 칸마다 여러 장) ----------------------------------------
create table if not exists public.bk_application_files (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.bk_applications(id) on delete cascade,
  recruitment_id uuid not null references public.bk_recruitments(id) on delete restrict,
  doc_kind text not null check (doc_kind ~ '^[a-z_]{2,40}$'),   -- 서류 종류 키(설계 4장, 예: resident_register)
  path text not null unique,                                     -- {recruitment_id}/{application_id}/{uuid}.ext
  name text,
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size integer not null check (size > 0 and size <= 10485760),
  -- uploaded(올림) / confirmed(확인) / needs_fix(보완요청)
  status text not null default 'uploaded' check (status in ('uploaded', 'confirmed', 'needs_fix')),
  fix_reason text,
  rrn_masked_checked boolean not null default false,             -- 주민번호 뒷자리 가림 확인(직원)
  checked_by text,
  checked_at timestamptz,
  uploaded_at timestamptz not null default now(),
  purged_at timestamptz                                          -- 보관기간 뒤 파일 삭제 시각(행은 기록으로 남김)
);

create index if not exists bk_application_files_app_idx on public.bk_application_files (application_id, doc_kind);

-- 4) 추천서('추천(돌봄 필요)' 유형) --------------------------------------
--    추천자에게 1회용 링크(토큰 원문은 문자로만, DB 에는 sha256 해시) 14일 유효.
create table if not exists public.bk_application_recommendations (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.bk_applications(id) on delete cascade,
  token_hash text not null unique,
  recommender_name text not null,
  recommender_phone text not null check (recommender_phone ~ '^0[0-9]{8,10}$'),
  expires_at timestamptz not null,
  sms_sent_at timestamptz,
  sms_count smallint not null default 0,
  -- 추천자가 쓰는 칸
  org text,                -- 소속
  position text,           -- 직위
  writer_name text,        -- 성명(작성자)
  writer_phone text,       -- 연락처
  reasons text[] not null default '{}',   -- 추천사유 체크 키
  opinion text,            -- 추천의견
  notes text,              -- 특이사항
  signature_path text,
  submitted_at timestamptz,
  submit_ip text,
  revoked_at timestamptz,  -- 보호자가 추천자를 바꾸면 옛 링크 무효
  created_at timestamptz not null default now()
);

create index if not exists bk_application_recommendations_app_idx on public.bk_application_recommendations (application_id);

-- 5) 휴대폰 인증번호(해시로만) ---------------------------------------------
--    · 유효 5분, 한 번호에 5회 틀리면 10분 잠금(locked_until), 번호당 하루(한국 시간) 10회 발송.
--    · code_hash = sha256(번호:인증번호:서버 비밀값) — 원문은 저장하지 않음.
create table if not exists public.bk_application_otps (
  id uuid primary key default gen_random_uuid(),
  phone text not null check (phone ~ '^01[0-9]{8,9}$'),
  purpose text not null default 'apply' check (purpose in ('apply')),
  code_hash text not null,
  expires_at timestamptz not null,
  attempts smallint not null default 0,
  locked_until timestamptz,
  consumed_at timestamptz,
  ip text,
  created_at timestamptz not null default now()
);

create index if not exists bk_application_otps_phone_idx on public.bk_application_otps (phone, created_at desc);

-- 6) 열람·변경 기록(누가, 언제, 무엇을) -------------------------------------
--    파일 열람·다운로드·민감정보 열람·상태 변경·보완요청·합격 처리·엑셀 내보내기·보관기간 삭제.
create table if not exists public.bk_application_access_logs (
  id bigint generated always as identity primary key,
  application_id uuid references public.bk_applications(id) on delete set null,
  recruitment_id uuid references public.bk_recruitments(id) on delete set null,
  actor_type text not null check (actor_type in ('staff', 'guardian', 'recommender', 'system')),
  actor_id text,           -- 직원 drivers.id / 보호자 번호 끝 4자리 / 'cron'
  actor_name text,
  action text not null check (action ~ '^[a-z_]{2,40}$'),   -- view_file, download_file, view_sensitive, status_change, file_check, fix_request, accept, export, purge, submit …
  target text,             -- 파일 id·서류 종류·상태 등
  detail jsonb,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists bk_application_access_logs_app_idx on public.bk_application_access_logs (application_id, created_at desc);
create index if not exists bk_application_access_logs_time_idx on public.bk_application_access_logs (created_at desc);

-- 7) 공통 동의 기록표(동업자씨 OS 공용) ----------------------------------
--    동의 1건 = 1행. 철회·변경은 지우지 않고 새 행(agreed=false)을 추가 — 가장 최근 행이 현재 상태.
create table if not exists public.consent_records (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type ~ '^[a-z_]{2,40}$'),   -- 'bk_application' 등
  subject_id text not null,                                             -- 대상 id(uuid 를 글자로)
  person_name text,
  person_role text not null check (person_role in ('guardian', 'youth', 'recommender')),
  phone_verified text,              -- 인증된 번호(숫자만) — 인증 없이 동의한 경우 null
  phone_last4 text check (phone_last4 is null or phone_last4 ~ '^[0-9]{4}$'),
  consent_key text not null check (consent_key ~ '^[a-z_]{2,60}$'),   -- privacy_required, sensitive_medical_disability, optional_email, third_party, guardian_pledge, attendance, marketing_sms …
  agreed boolean not null,
  doc_version text not null,
  agreed_at timestamptz not null default now(),
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists consent_records_subject_idx on public.consent_records (subject_type, subject_id, consent_key, agreed_at desc);
create index if not exists consent_records_phone_idx on public.consent_records (phone_last4);

-- 8) 학생 정보에 합격 서류에서 옮겨 오는 칸 ---------------------------------
alter table public.bk_students add column if not exists gender text;
alter table public.bk_students add column if not exists return_method text;   -- shuttle/guardian/alone/other
alter table public.bk_students add column if not exists return_note text;     -- 기타 귀가 방법 설명
alter table public.bk_students add column if not exists shuttle_stop jsonb;   -- { "seq": 1, "time": "18:10", "place": "…" } (그해 회차 값 스냅숏)
alter table public.bk_students add column if not exists allergy_info jsonb;   -- { "has": true, "foods": [1,2], "other": "…", "symptoms": [...], "treated": true, "self_aware": true }
alter table public.bk_students add column if not exists application_id uuid references public.bk_applications(id) on delete set null;

alter table public.bk_students drop constraint if exists bk_students_gender_check;
alter table public.bk_students add constraint bk_students_gender_check
  check (gender is null or gender in ('M', 'F'));
alter table public.bk_students drop constraint if exists bk_students_return_method_check;
alter table public.bk_students add constraint bk_students_return_method_check
  check (return_method is null or return_method in ('shuttle', 'guardian', 'alone', 'other'));

-- 9) 접수번호 일련번호 — 동시에 제출해도 겹치지 않게 회차 줄을 잠그고 1 올림 ----------
create or replace function public.bk_recruitment_next_seq(rid uuid)
returns integer
language sql
set search_path = public
as $$
  update public.bk_recruitments
     set app_seq = app_seq + 1
   where id = rid
  returning app_seq;
$$;

-- 10) 보안 — 브라우저 키(anon·authenticated)로는 아무것도 못 하게(정책 없음 = 전부 거부) ---------
alter table public.bk_recruitments enable row level security;
alter table public.bk_applications enable row level security;
alter table public.bk_application_files enable row level security;
alter table public.bk_application_recommendations enable row level security;
alter table public.bk_application_otps enable row level security;
alter table public.bk_application_access_logs enable row level security;
alter table public.consent_records enable row level security;
revoke all on public.bk_recruitments, public.bk_applications, public.bk_application_files,
  public.bk_application_recommendations, public.bk_application_otps,
  public.bk_application_access_logs, public.consent_records
  from anon, authenticated;
revoke all on sequence public.bk_application_access_logs_id_seq from anon, authenticated;
revoke execute on function public.bk_recruitment_next_seq(uuid) from public, anon, authenticated;

-- 11) 비공개 버킷 bk-applications — 공개 URL 없음, 1장 10MB, JPG·PNG·WebP·PDF 만 ----------
--     storage.objects 에 정책을 만들지 않으므로 브라우저 키로는 읽기·쓰기 모두 불가.
--     (업로드는 서버가 발급한 1회용 서명 업로드 URL, 열람은 서버가 발급한 5분 서명 URL 로만.)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bk-applications', 'bk-applications', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
