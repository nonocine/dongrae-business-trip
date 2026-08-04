-- 사업실적 v1: 운영 DB에는 이 파일을 검토한 뒤 적용합니다.
create extension if not exists "pgcrypto";

create table if not exists business_results (
  id uuid primary key default gen_random_uuid(),
  report_year integer not null check (report_year between 2020 and 2100),
  report_month integer not null check (report_month between 1 and 12),
  category text not null default '기타',
  program_name text not null,
  sessions integer not null default 0 check (sessions >= 0),
  participants integer not null default 0 check (participants >= 0),
  attendance integer not null default 0 check (attendance >= 0),
  youth_uses integer not null default 0 check (youth_uses >= 0),
  other_uses integer not null default 0 check (other_uses >= 0),
  summary text not null default '',
  evaluation text not null default '',
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  author_name text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists business_results_month_idx
  on business_results (report_year, report_month);

create table if not exists business_promotions (
  id uuid primary key default gen_random_uuid(),
  report_year integer not null check (report_year between 2020 and 2100),
  report_month integer not null check (report_month between 1 and 12),
  activity_date date not null,
  category text not null default '기타',
  title text not null,
  count integer not null default 1 check (count >= 0),
  url text not null default '',
  description text not null default '',
  author_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists business_promotions_month_idx
  on business_promotions (report_year, report_month);

-- 브라우저에서 직접 접근하지 못하게 하고 서버 액션(service_role)만 사용합니다.
alter table business_results enable row level security;
alter table business_promotions enable row level security;

-- public 스키마의 기본 권한 설정과 무관하게 브라우저 역할은 차단하고,
-- 서버 전용 service_role 에만 필요한 권한을 명시적으로 부여합니다.
revoke all on table business_results from anon, authenticated;
revoke all on table business_promotions from anon, authenticated;
grant select, insert, update, delete on table business_results to service_role;
grant select, insert, update, delete on table business_promotions to service_role;
