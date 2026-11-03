-- =====================================================================
-- 문자 발송 이력(sms_send_logs) — 보낸 사람을 동업자씨 직원(drivers)으로 · 2026-11-03
--   sms_send_logs 는 처음에 sent_by → profiles(id) 로 만들어졌으나, 동업자씨 직원은
--   drivers 에 있어(18명 중 profiles 와 id 일치 0) 기록이 FK 에 막힙니다.
--   적용 당시 0행이라 데이터 이동은 없습니다. 직원 행을 지워도 이력은 남도록 set null.
--   멱등: 여러 번 실행해도 결과가 같습니다.
-- =====================================================================

alter table public.sms_send_logs
  drop constraint if exists sms_send_logs_sent_by_fkey;

alter table public.sms_send_logs
  add constraint sms_send_logs_sent_by_fkey
  foreign key (sent_by) references public.drivers(id) on delete set null;

create index if not exists sms_send_logs_created_at_idx
  on public.sms_send_logs (created_at desc);
