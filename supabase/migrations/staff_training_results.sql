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

-- =========================================================
-- 이미 만들어진 테이블에 나중에 추가된 컬럼 (재실행 안전)
--   ⚠️ 이 블록이 없어서 운영 DB 에 updated_at 이 반영되지 않은 채로
--     코드가 그 컬럼을 보내, 종사자 교육 수동 입력이 PGRST204 로 통째로
--     막혀 있었습니다(수동 0건·반입 183건). 파일과 운영 스키마를 반드시
--     일치시켜 주세요.
-- =========================================================
alter table staff_training_results
  add column if not exists updated_at timestamptz not null default now(),
  -- 수정한 사람(등록자는 author_name). 수정 시에만 채워지므로 nullable.
  add column if not exists updated_by text,
  -- 교육 기간 종료일. 하루 교육은 training_date 와 같은 값입니다
  --   (activities 의 start_date/end_date 패턴, is_multi_day 플래그 없음).
  add column if not exists training_end_date date;

-- 기존 행은 하루 교육이므로 종료일 = 시작일 로 채운 뒤 NOT NULL 로 만듭니다.
update staff_training_results
  set training_end_date = training_date
  where training_end_date is null;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'staff_training_results'
      and column_name = 'training_end_date'
      and is_nullable = 'YES'
  ) then
    alter table staff_training_results
      alter column training_end_date set not null;
  end if;
end $$;

-- 종료일이 시작일보다 앞서는 값 차단.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'staff_training_results_period_check'
  ) then
    alter table staff_training_results
      add constraint staff_training_results_period_check
      check (training_end_date >= training_date);
  end if;
end $$;

create index if not exists staff_training_results_month_idx
  on staff_training_results (report_year, report_month);

alter table staff_training_results enable row level security;
revoke all on table staff_training_results from anon, authenticated;
grant select, insert, update, delete on table staff_training_results to service_role;
