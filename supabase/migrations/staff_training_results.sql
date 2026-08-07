-- 종사자 교육 실적 — 의무교육 자동 반입 + 외부 연수·기타 교육 수동 추가.
--   * mandatory_trainings 에 장소/주최/수료시간을 nullable 로 추가합니다.
--     교육(과정) 단위 속성이라 마스터에 1회 입력하면 반입 행에 자동 적용됩니다.
--     기존 화면은 이 컬럼을 읽지 않으므로 회귀 없음(전부 nullable).
--   * source_completion_id 는 unique — "의무교육에서 가져오기" 재클릭 시 중복 방지.
--   * 여러 번 실행해도 안전(멱등)합니다.
create extension if not exists "pgcrypto";

alter table mandatory_trainings
  add column if not exists location text,
  add column if not exists organizer text,
  add column if not exists hours text;

create table if not exists staff_training_results (
  id uuid primary key default gen_random_uuid(),
  report_year integer not null check (report_year between 2020 and 2100),
  report_month integer not null check (report_month between 1 and 12),
  training_date date not null,
  staff_name text not null,
  training_name text not null,
  location text not null default '',
  organizer text not null default '',
  hours text not null default '',
  source text not null default 'manual' check (source in ('mandatory', 'manual')),
  source_completion_id uuid unique,
  author_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists staff_training_results_month_idx
  on staff_training_results (report_year, report_month);

alter table staff_training_results enable row level security;
revoke all on table staff_training_results from anon, authenticated;
grant select, insert, update, delete on table staff_training_results to service_role;
