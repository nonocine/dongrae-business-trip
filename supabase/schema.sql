-- 동래구청소년센터 출장일지 스키마
-- Supabase SQL Editor에서 실행하세요. (CREATE IF NOT EXISTS 기반이라 재실행 안전)

create extension if not exists "pgcrypto";

-- =========================================================
-- 출장일지 테이블
-- =========================================================
create table if not exists business_trips (
  id uuid primary key default gen_random_uuid(),
  trip_date date not null,
  destination text not null,
  author text not null,
  companion text[] not null default '{}',
  purpose text not null,
  transport_type text not null check (transport_type in ('vehicle','public','walk')),
  transport_cost numeric(10,0),
  meeting_content text not null default '',
  main_agenda text not null default '',
  result text not null default '',
  photos text[] not null default '{}',
  receipts text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists business_trips_trip_date_idx on business_trips (trip_date desc);
create index if not exists business_trips_traveler_idx on business_trips (traveler);
create index if not exists business_trips_created_at_idx on business_trips (created_at desc);

alter table business_trips enable row level security;

drop policy if exists "anon read business_trips" on business_trips;
create policy "anon read business_trips"
  on business_trips for select
  using (true);

drop policy if exists "anon insert business_trips" on business_trips;
create policy "anon insert business_trips"
  on business_trips for insert
  with check (true);

drop policy if exists "anon update business_trips" on business_trips;
create policy "anon update business_trips"
  on business_trips for update
  using (true)
  with check (true);

drop policy if exists "anon delete business_trips" on business_trips;
create policy "anon delete business_trips"
  on business_trips for delete
  using (true);

-- =========================================================
-- 직원 테이블 (출장자/동행자 드롭다운 + 직원 로그인)
-- =========================================================
create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  position text,
  rank text,
  password text,
  created_at timestamptz not null default now()
);

-- 기존 테이블이 있다면 새 컬럼 추가
alter table employees add column if not exists rank text;
alter table employees add column if not exists password text;

-- 직급 값 제약 (관장/부장/팀장/팀원 중 하나)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'employees_rank_check'
  ) then
    alter table employees add constraint employees_rank_check
      check (rank is null or rank in ('관장','부장','팀장','팀원'));
  end if;
end $$;

create index if not exists employees_name_idx on employees (name);

alter table employees enable row level security;

drop policy if exists "anon read employees" on employees;
create policy "anon read employees"
  on employees for select
  using (true);

drop policy if exists "anon insert employees" on employees;
create policy "anon insert employees"
  on employees for insert
  with check (true);

drop policy if exists "anon update employees" on employees;
create policy "anon update employees"
  on employees for update
  using (true)
  with check (true);

drop policy if exists "anon delete employees" on employees;
create policy "anon delete employees"
  on employees for delete
  using (true);

-- =========================================================
-- 통합 활동 테이블 (외근 / 출장 / 국내연수 / 해외연수 / 교육)
-- =========================================================
create table if not exists activities (
  id uuid primary key default gen_random_uuid(),
  activity_type text not null check (activity_type in (
    'outside_work','business_trip','domestic_training','overseas_training','education'
  )),
  author text not null,
  companion text[] not null default '{}',
  purpose text not null default '',
  content text not null default '',
  result text not null default '',
  photos text[] not null default '{}',
  receipts text[] not null default '{}',
  certificate text[] not null default '{}',

  start_date date,
  end_date date,
  location text,
  organization text,
  city text,
  country text,

  transport_type text,
  transport_cost numeric(10,0),
  accommodation boolean,
  accommodation_cost numeric(10,0),
  training_cost numeric(10,0),

  course_name text,
  visa_info text,
  education_type text,
  instructor text,
  education_hours numeric(5,1),
  attendees_count integer,

  created_at timestamptz not null default now()
);

-- 기존 테이블이 있다면 누락된 컬럼을 idempotent하게 추가
alter table activities add column if not exists activity_type text;
alter table activities add column if not exists author text;
alter table activities add column if not exists companion text[] not null default '{}';
alter table activities add column if not exists purpose text not null default '';
alter table activities add column if not exists content text not null default '';
alter table activities add column if not exists result text not null default '';
alter table activities add column if not exists photos text[] not null default '{}';
alter table activities add column if not exists receipts text[] not null default '{}';
alter table activities add column if not exists certificate text[] not null default '{}';
alter table activities add column if not exists start_date date;
alter table activities add column if not exists end_date date;
alter table activities add column if not exists location text;
alter table activities add column if not exists organization text;
alter table activities add column if not exists city text;
alter table activities add column if not exists country text;
alter table activities add column if not exists transport_type text;
alter table activities add column if not exists transport_cost numeric(10,0);
alter table activities add column if not exists accommodation boolean;
alter table activities add column if not exists accommodation_cost numeric(10,0);
alter table activities add column if not exists training_cost numeric(10,0);
alter table activities add column if not exists course_name text;
alter table activities add column if not exists visa_info text;
alter table activities add column if not exists education_type text;
alter table activities add column if not exists instructor text;
alter table activities add column if not exists education_hours numeric(5,1);
alter table activities add column if not exists attendees_count integer;
alter table activities add column if not exists created_at timestamptz not null default now();

create index if not exists activities_activity_type_idx on activities (activity_type);
create index if not exists activities_start_date_idx on activities (start_date desc);
create index if not exists activities_author_idx on activities (author);
create index if not exists activities_created_at_idx on activities (created_at desc);

alter table activities enable row level security;

drop policy if exists "anon read activities" on activities;
create policy "anon read activities"
  on activities for select using (true);

drop policy if exists "anon insert activities" on activities;
create policy "anon insert activities"
  on activities for insert with check (true);

drop policy if exists "anon update activities" on activities;
create policy "anon update activities"
  on activities for update using (true) with check (true);

drop policy if exists "anon delete activities" on activities;
create policy "anon delete activities"
  on activities for delete using (true);

-- =========================================================
-- Storage 버킷 생성 (인증샷 / 영수증)
--   * activities는 동일 버킷을 재사용합니다 (photos→trip-photos,
--     receipts/certificate→trip-receipts).
--   * Supabase Storage 대시보드에서 생성해도 동일합니다.
-- =========================================================
insert into storage.buckets (id, name, public)
values
  ('trip-photos', 'trip-photos', true),
  ('trip-receipts', 'trip-receipts', true)
on conflict (id) do nothing;

-- 공개 버킷이라 SELECT 정책은 자동으로 허용됨. 익명 업로드 정책만 명시.
drop policy if exists "anon upload trip-photos" on storage.objects;
create policy "anon upload trip-photos"
  on storage.objects for insert
  with check (bucket_id = 'trip-photos');

drop policy if exists "anon delete trip-photos" on storage.objects;
create policy "anon delete trip-photos"
  on storage.objects for delete
  using (bucket_id = 'trip-photos');

drop policy if exists "anon upload trip-receipts" on storage.objects;
create policy "anon upload trip-receipts"
  on storage.objects for insert
  with check (bucket_id = 'trip-receipts');

drop policy if exists "anon delete trip-receipts" on storage.objects;
create policy "anon delete trip-receipts"
  on storage.objects for delete
  using (bucket_id = 'trip-receipts');
