-- 사업별 세부입력 — 일자형(date) / 회차형(session).
--   * 구청 보고 서식(이용인원.hwpx)의 사업별 세부표를 이 데이터로 생성합니다.
--   * 본 행(business_results)이 집계 원본이고 세부표는 부속 표이므로,
--     세부 합계와 본 행 수치의 불일치는 막지 않습니다.
--   * 여러 번 실행해도 안전(멱등)합니다.
create extension if not exists "pgcrypto";

create table if not exists business_result_details (
  id uuid primary key default gen_random_uuid(),
  result_id uuid not null references business_results(id) on delete cascade,
  entry_type text not null check (entry_type in ('date', 'session')),
  entry_date date,
  session_no integer,
  session_days integer,
  content text not null default '',
  participants_youth integer not null default 0 check (participants_youth >= 0),
  participants_other integer not null default 0 check (participants_other >= 0),
  room_youth integer not null default 0 check (room_youth >= 0),
  room_other integer not null default 0 check (room_other >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists business_result_details_result_idx
  on business_result_details (result_id, sort_order);

alter table business_result_details enable row level security;
revoke all on table business_result_details from anon, authenticated;
grant select, insert, update, delete on table business_result_details to service_role;
