-- 공용 메일함 — 읽음/안읽음 구분용 opened_at (ML-10)
--   * status(미처리/처리중/완료)와는 별개의 축입니다.
--       status     = 업무 처리 상태 (담당자가 일을 끝냈는가)
--       opened_at  = 열람 여부      (누군가 상세를 한 번이라도 열었는가)
--     둘을 한 컬럼으로 합치면 "읽었지만 아직 처리 안 함" 을 표현할 수 없어
--     새 컬럼으로 둡니다. read_at 이 아니라 opened_at 인 이유도 같습니다 —
--     '읽음' 은 사람이 내용을 이해했다는 뜻으로 읽히지만, 실제로 기록하는
--     사실은 '상세 모달을 열었다' 뿐입니다.
--   * NULL = 아직 아무도 열지 않음(안읽음). 최초 열람 시 1회만 기록하고
--     이후에는 덮어쓰지 않습니다(최초 열람 시각을 보존).
--   * 여러 번 실행해도 안전(멱등)합니다.

alter table mail_messages
  add column if not exists opened_at timestamptz;

comment on column mail_messages.opened_at is
  '상세를 처음 연 시각. NULL 이면 안읽음. status(처리 상태)와는 별개.';

-- 목록 기본 정렬(수신 최신순) + "안읽음만" 필터를 함께 타는 부분 인덱스.
--   안읽음만 담으므로 전체 행 수와 무관하게 작게 유지됩니다.
create index if not exists mail_messages_unopened_idx
  on mail_messages (received_at desc)
  where opened_at is null and deleted_at is null;
