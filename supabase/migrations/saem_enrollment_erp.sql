-- =====================================================================
-- SA-18 / S-24. 수강생 명단(ERP 업로드) + 출석 체크 준비
--   실행 위치: Supabase SQL Editor (idempotent — 여러 번 실행해도 안전)
--
--   ⚠ 확인 결과 saem_enrollments.erp_no 는 아직 없습니다.
--     이 파일을 실행하지 않으면 명단 업로드가 동작하지 않습니다.
-- =====================================================================

-- --- 파트 A(동업자씨) 필수 -------------------------------------------
-- ERP 신청번호 = 재업로드 대조의 고유키. 수동 추가 수강생은 NULL 로 남는다.
alter table saem_enrollments
  add column if not exists erp_no text;

-- 같은 프로그램 안에서 ERP 신청번호는 유일. NULL(수동 추가)은 제약 대상 아님
-- → 부분 유니크 인덱스로 "수동 추가 여러 명"과 "ERP 중복 방지"를 동시에 만족.
create unique index if not exists saem_enrollments_program_erp_uniq
  on saem_enrollments (program_id, erp_no)
  where erp_no is not null;

-- 프로그램별 명단 조회 경로.
create index if not exists saem_enrollments_program_idx
  on saem_enrollments (program_id);

-- --- 파트 B(동래샘들) 준비 — 출석 upsert 대상 제약 -------------------
-- 회차 × 수강생 1건. 강사가 다시 저장하면 갱신되어야 하므로 유니크 필요.
create unique index if not exists saem_attendance_session_enrollment_uniq
  on saem_attendance (session_id, enrollment_id);

-- 회차별 출석 집계(근무일지 화면의 "출석 n/정원") 경로.
create index if not exists saem_attendance_session_idx
  on saem_attendance (session_id);
