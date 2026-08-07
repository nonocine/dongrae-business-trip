-- 동전PAY 실적 — 건별이 아닌 "월 합계"만 기록합니다.
--   * 한 행 = 해당 월 × 구분(적립/차감) × 사용처 의 합계.
--   * 최종 금액(센터 전체 누적)은 조회 기간과 무관하게 테이블 전체에서
--     적립 누계 − 차감 누계 로 산출합니다.
--   * 여러 번 실행해도 안전(멱등)합니다.
create extension if not exists "pgcrypto";

create table if not exists coin_pay_results (
  id uuid primary key default gen_random_uuid(),
  report_year integer not null check (report_year between 2020 and 2100),
  report_month integer not null check (report_month between 1 and 12),
  entry_type text not null check (entry_type in ('적립', '차감')),
  place text not null,
  headcount integer not null default 0 check (headcount >= 0),
  amount bigint not null default 0,
  note text not null default '',
  author_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists coin_pay_results_month_idx
  on coin_pay_results (report_year, report_month);

alter table coin_pay_results enable row level security;
revoke all on table coin_pay_results from anon, authenticated;
grant select, insert, update, delete on table coin_pay_results to service_role;
