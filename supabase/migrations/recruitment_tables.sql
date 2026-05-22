-- =========================================================
-- 채용 시스템 v1.2 — 신규 객체만 (기존 테이블 불변)
-- 확장 1 + 함수 1 + 테이블 4 + 인덱스 4 + RLS 16 + 트리거 4
-- 재실행 안전(idempotent). FK 의존성 순서대로 작성.
-- Supabase SQL Editor 에 통째로 붙여넣고 Run.
-- =========================================================

-- 1) 확장: gen_random_uuid() 의존 (이미 설치돼 있어도 무해)
create extension if not exists "pgcrypto";

-- 2) updated_at 자동 갱신 함수 (공용 인스턴스 충돌 회피용 recruitment_ 접두사)
create or replace function recruitment_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================================================
-- 3) 테이블 1: recruitment_postings (채용 공고)
-- =========================================================
create table if not exists recruitment_postings (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  field text not null,
  recruit_count integer not null default 1,
  application_start timestamptz not null,
  application_end timestamptz not null,
  qualifications text,
  preferred text,
  salary_info text,
  process_info text,
  notice text,
  attachment_url text,
  required_documents jsonb not null default '[
    {"key": "diploma", "label": "졸업증명서", "required": true},
    {"key": "transcript", "label": "성적증명서", "required": true},
    {"key": "license", "label": "자격증 사본", "required": true},
    {"key": "career_cert", "label": "경력증명서", "required": false},
    {"key": "award_cert", "label": "수상실적 증빙", "required": false}
  ]'::jsonb,
  status text not null default 'draft'
    check (status in ('draft','published','closed')),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by text
);

create index if not exists recruitment_postings_status_idx
  on recruitment_postings (status);
create index if not exists recruitment_postings_application_end_idx
  on recruitment_postings (application_end);

alter table recruitment_postings enable row level security;

drop policy if exists "anon read recruitment_postings" on recruitment_postings;
create policy "anon read recruitment_postings"
  on recruitment_postings for select using (true);
drop policy if exists "anon insert recruitment_postings" on recruitment_postings;
create policy "anon insert recruitment_postings"
  on recruitment_postings for insert with check (true);
drop policy if exists "anon update recruitment_postings" on recruitment_postings;
create policy "anon update recruitment_postings"
  on recruitment_postings for update using (true) with check (true);
drop policy if exists "anon delete recruitment_postings" on recruitment_postings;
create policy "anon delete recruitment_postings"
  on recruitment_postings for delete using (true);

drop trigger if exists recruitment_postings_set_updated_at on recruitment_postings;
create trigger recruitment_postings_set_updated_at
  before update on recruitment_postings
  for each row execute function recruitment_set_updated_at();

-- =========================================================
-- 4) 테이블 2: recruitment_applicants (지원자) — family 컬럼 없음
-- =========================================================
create table if not exists recruitment_applicants (
  id uuid primary key default gen_random_uuid(),
  applicant_number text not null unique,

  name text not null,
  name_hanja text,
  birth_date date not null,
  gender text check (gender in ('M','F')),
  address text,
  email text not null,
  phone text not null,
  photo_url text,

  education jsonb default '[]'::jsonb,
  licenses jsonb default '[]'::jsonb,
  career jsonb default '[]'::jsonb,
  awards jsonb default '[]'::jsonb,
  trainings jsonb default '[]'::jsonb,

  motivation text,
  self_development text,
  career_summary text,
  philosophy text,

  documents jsonb default '{}'::jsonb,

  agreed_privacy boolean not null default false,
  agreed_criminal_check boolean not null default false,
  agreed_truth boolean not null default false,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists recruitment_applicants_email_idx on recruitment_applicants (email);

alter table recruitment_applicants enable row level security;

drop policy if exists "anon read recruitment_applicants" on recruitment_applicants;
create policy "anon read recruitment_applicants"
  on recruitment_applicants for select using (true);
drop policy if exists "anon insert recruitment_applicants" on recruitment_applicants;
create policy "anon insert recruitment_applicants"
  on recruitment_applicants for insert with check (true);
drop policy if exists "anon update recruitment_applicants" on recruitment_applicants;
create policy "anon update recruitment_applicants"
  on recruitment_applicants for update using (true) with check (true);
drop policy if exists "anon delete recruitment_applicants" on recruitment_applicants;
create policy "anon delete recruitment_applicants"
  on recruitment_applicants for delete using (true);

drop trigger if exists recruitment_applicants_set_updated_at on recruitment_applicants;
create trigger recruitment_applicants_set_updated_at
  before update on recruitment_applicants
  for each row execute function recruitment_set_updated_at();

-- =========================================================
-- 5) 테이블 3: recruitment_applications (지원 접수)
-- =========================================================
create table if not exists recruitment_applications (
  id uuid primary key default gen_random_uuid(),
  posting_id uuid not null
    references recruitment_postings(id) on delete restrict,
  applicant_id uuid not null
    references recruitment_applicants(id) on delete restrict,
  submitted_at timestamptz,
  status text not null default 'submitted'
    check (status in (
      'draft',
      'submitted',
      'screening_passed',
      'screening_failed',
      'interview_passed',
      'interview_failed',
      'final_passed',
      'final_rejected'
    )),
  screening_total numeric,
  interview_total numeric,
  hired_at date,
  converted_to_employee_id uuid
    references drivers(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (posting_id, applicant_id)
);

create index if not exists recruitment_applications_posting_id_status_idx
  on recruitment_applications (posting_id, status);

alter table recruitment_applications enable row level security;

drop policy if exists "anon read recruitment_applications" on recruitment_applications;
create policy "anon read recruitment_applications"
  on recruitment_applications for select using (true);
drop policy if exists "anon insert recruitment_applications" on recruitment_applications;
create policy "anon insert recruitment_applications"
  on recruitment_applications for insert with check (true);
drop policy if exists "anon update recruitment_applications" on recruitment_applications;
create policy "anon update recruitment_applications"
  on recruitment_applications for update using (true) with check (true);
drop policy if exists "anon delete recruitment_applications" on recruitment_applications;
create policy "anon delete recruitment_applications"
  on recruitment_applications for delete using (true);

drop trigger if exists recruitment_applications_set_updated_at on recruitment_applications;
create trigger recruitment_applications_set_updated_at
  before update on recruitment_applications
  for each row execute function recruitment_set_updated_at();

-- =========================================================
-- 6) 테이블 4: recruitment_scores (채점)
-- =========================================================
create table if not exists recruitment_scores (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null
    references recruitment_applications(id) on delete cascade,
  stage text not null check (stage in ('screening','interview')),
  reviewer_name text not null,
  reviewer_id text,
  scores jsonb not null default '{}'::jsonb,
  total_score numeric,
  max_score numeric not null,
  is_absent boolean default false,
  memo text,
  submitted_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  -- unique 제약이 (application_id, stage, reviewer_name) 인덱스를 자동 생성.
  -- leftmost-prefix 로 (application_id, stage)·application_id 조회까지 커버하므로
  -- 별도 인덱스는 두지 않음.
  unique (application_id, stage, reviewer_name)
);

alter table recruitment_scores enable row level security;

drop policy if exists "anon read recruitment_scores" on recruitment_scores;
create policy "anon read recruitment_scores"
  on recruitment_scores for select using (true);
drop policy if exists "anon insert recruitment_scores" on recruitment_scores;
create policy "anon insert recruitment_scores"
  on recruitment_scores for insert with check (true);
drop policy if exists "anon update recruitment_scores" on recruitment_scores;
create policy "anon update recruitment_scores"
  on recruitment_scores for update using (true) with check (true);
drop policy if exists "anon delete recruitment_scores" on recruitment_scores;
create policy "anon delete recruitment_scores"
  on recruitment_scores for delete using (true);

drop trigger if exists recruitment_scores_set_updated_at on recruitment_scores;
create trigger recruitment_scores_set_updated_at
  before update on recruitment_scores
  for each row execute function recruitment_set_updated_at();
