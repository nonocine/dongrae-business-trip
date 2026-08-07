-- 사업실적 v2 — 담당자 / 운영일수 / 인원 청소년·기타 구분 / 레지스트리 FK.
--   * 적용 순서: business_program_registry.sql 을 먼저 적용해야 program_id FK가 붙습니다.
--   * 기존 컬럼은 삭제·rename 하지 않습니다. 전부 default 포함 additive alter 이므로
--     과거 행은 청/기 0 상태로 남고 화면·문서에서 '-'/계 표기로 처리합니다.
--   * participants / attendance 합계 컬럼은 유지하고 저장 시 청+기 로 동기화합니다.
--   * 여러 번 실행해도 안전(멱등)합니다.

alter table business_results
  add column if not exists program_id uuid references business_programs(id) on delete set null,
  add column if not exists manager_name text not null default '',
  add column if not exists operating_days integer not null default 0,
  add column if not exists participants_youth integer not null default 0,
  add column if not exists participants_other integer not null default 0,
  add column if not exists attendance_youth integer not null default 0,
  add column if not exists attendance_other integer not null default 0;

create index if not exists business_results_program_idx
  on business_results (program_id);

-- 실별(실인원) 청/기 는 기존 youth_uses / other_uses 를 그대로 사용합니다(의미 동일).
