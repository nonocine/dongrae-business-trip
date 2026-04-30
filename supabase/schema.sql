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
-- 직원 테이블 (drivers; 차량 어플과 공유)
--   * 과거 명: employees → drivers 로 통합
--   * 차량 어플과 동일한 테이블을 공유합니다.
-- =========================================================
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'employees')
     and not exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'drivers')
  then
    execute 'alter table employees rename to drivers';
  end if;
end $$;

create table if not exists drivers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  rank text,
  password text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 기존 테이블이 있다면 새 컬럼 추가
alter table drivers add column if not exists rank text;
alter table drivers add column if not exists password text;
alter table drivers add column if not exists is_active boolean not null default true;

-- 직급 값 제약 (관장/부장/팀장/팀원 중 하나)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'drivers_rank_check'
  ) then
    alter table drivers add constraint drivers_rank_check
      check (rank is null or rank in ('관장','부장','팀장','팀원'));
  end if;
end $$;

create index if not exists drivers_name_idx on drivers (name);
create index if not exists drivers_is_active_idx on drivers (is_active);

alter table drivers enable row level security;

drop policy if exists "anon read drivers" on drivers;
create policy "anon read drivers"
  on drivers for select using (true);

drop policy if exists "anon insert drivers" on drivers;
create policy "anon insert drivers"
  on drivers for insert with check (true);

drop policy if exists "anon update drivers" on drivers;
create policy "anon update drivers"
  on drivers for update using (true) with check (true);

drop policy if exists "anon delete drivers" on drivers;
create policy "anon delete drivers"
  on drivers for delete using (true);

-- =========================================================
-- 차량 운행 일지 (driving_logs; 차량 어플과 공유)
-- =========================================================
create table if not exists driving_logs (
  id uuid primary key default gen_random_uuid(),
  driven_at date not null,
  driver text not null,
  purpose text not null default '',
  departure text,
  waypoint text,
  destination text,
  distance numeric(10,1),
  total_distance numeric(10,1),
  confirmed_by text,
  created_at timestamptz not null default now()
);

create index if not exists driving_logs_driven_at_idx on driving_logs (driven_at desc);
create index if not exists driving_logs_driver_idx on driving_logs (driver);

alter table driving_logs enable row level security;

drop policy if exists "anon read driving_logs" on driving_logs;
create policy "anon read driving_logs"
  on driving_logs for select using (true);

drop policy if exists "anon insert driving_logs" on driving_logs;
create policy "anon insert driving_logs"
  on driving_logs for insert with check (true);

drop policy if exists "anon update driving_logs" on driving_logs;
create policy "anon update driving_logs"
  on driving_logs for update using (true) with check (true);

drop policy if exists "anon delete driving_logs" on driving_logs;
create policy "anon delete driving_logs"
  on driving_logs for delete using (true);

-- =========================================================
-- 차량 정보 / 누적거리 (settings; 차량 어플과 공유)
--   * 컬럼 형식이 아닌 Key-Value 방식으로 저장됩니다.
--   * key 예시: 'initial_mileage', 'vehicle_number',
--     'vehicle_model', 'insurance_company'
--   * value 는 항상 text. 숫자값은 어플에서 읽을 때 변환합니다.
-- =========================================================
create table if not exists settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value text,
  created_at timestamptz not null default now()
);

create index if not exists settings_key_idx on settings (key);

-- 누적거리 기본값 (없을 때만 추가)
insert into settings (key, value)
values ('initial_mileage', '0')
on conflict (key) do nothing;

alter table settings enable row level security;

drop policy if exists "anon read settings" on settings;
create policy "anon read settings"
  on settings for select using (true);

drop policy if exists "anon update settings" on settings;
create policy "anon update settings"
  on settings for update using (true) with check (true);

drop policy if exists "anon insert settings" on settings;
create policy "anon insert settings"
  on settings for insert with check (true);

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

  driving_log_id uuid references driving_logs(id) on delete set null,

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
alter table activities add column if not exists driving_log_id uuid references driving_logs(id) on delete set null;
alter table activities add column if not exists created_at timestamptz not null default now();

create index if not exists activities_driving_log_id_idx on activities (driving_log_id);

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
