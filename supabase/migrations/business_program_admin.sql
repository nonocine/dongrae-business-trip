-- 사업실적 [프로그램 관리] 탭 — 담당자·다른 이름·메모 + '프로그램 아님' 표시.
--   * 운영 DB에는 검토 후 적용합니다(코드는 미적용 상태에서도 동작 — 새 칸 없이 읽기).
--   * 여러 번 실행해도 안전(멱등)합니다. 기존 컬럼은 건드리지 않습니다.
--   * 이름 변경 기록: 별도 이력 테이블 없이, 이름을 바꿀 때 예전 이름을 aliases 에
--     자동으로 넣습니다(앱 코드 updateBusinessProgram). 과거 실적의 '당시 이름'은
--     business_results.program_name 에 저장된 글자 그대로 남습니다(스냅샷).

alter table business_programs
  add column if not exists manager_driver_id uuid references drivers(id) on delete set null,
  add column if not exists aliases text[] not null default '{}',
  add column if not exists note text not null default '',
  add column if not exists updated_at timestamptz not null default now();

create index if not exists business_programs_manager_idx
  on business_programs (manager_driver_id);

-- '프로그램 아님' 표시 — 직접 입력 이름 정리 목록에서 숨길 이름.
--   name_key = 공백·따옴표를 뺀 소문자 키(lib/businessProgramNames.programNameKey).
--   실적 행 자체에는 아무 표시도 하지 않습니다(숫자·이름 그대로).
create table if not exists business_program_name_exclusions (
  name_key text primary key,
  sample_name text not null,
  created_by text,
  created_at timestamptz not null default now()
);

alter table business_program_name_exclusions enable row level security;
revoke all on table business_program_name_exclusions from anon, authenticated;
grant select, insert, update, delete on table business_program_name_exclusions to service_role;
