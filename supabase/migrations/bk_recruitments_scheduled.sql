-- =====================================================================
-- 방카 신규 모집 — '모집 예정' 상태 · 준비 서류 안내 · 회차 숨김 · 2026-11-05
--   ※ 관장 쪽에서 이미 적용함. 기록용(여러 번 실행해도 결과가 같습니다).
--   · status 'scheduled'(모집 예정): 보호자 /apply 에 회차·기간·준비 서류만 미리 보이고 인증·신청은 막힘
--   · prep_notice: 모집 예정 화면의 "미리 준비해 주세요" 안내(여러 줄)
--   · deleted_at·deleted_by: 제출된 신청서가 있는 회차를 [종료·숨김] 할 때 — 행은 남기고 목록·보호자 화면에서 숨김
--   설계: docs/설계_방카신규접수.md
-- =====================================================================

alter table public.bk_recruitments drop constraint if exists bk_recruitments_status_check;
alter table public.bk_recruitments add constraint bk_recruitments_status_check
  check (status in ('draft', 'scheduled', 'open', 'closed', 'ended'));

alter table public.bk_recruitments add column if not exists prep_notice text;
alter table public.bk_recruitments add column if not exists deleted_at timestamptz;
alter table public.bk_recruitments add column if not exists deleted_by text;
