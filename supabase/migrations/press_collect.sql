-- 언론 보도 자동 수집(동업자씨 이전) — docs/PRESS_COLLECT_동업자씨이전.md 7·9
--   * press_articles: source 허용값만 넓힘(기존 'hermes'·'manual' 그대로) + 칸 추가(additive).
--     기존 행은 url_status='ok', review_status='auto' 가 됩니다.
--   * review_status: 'needs_review' 는 슬랙·홍보 실적에서 빠지고, 사람이 승인하면 그때 반영.
--     'rejected' 행은 지우지 않고 남겨 다음 수집 때 같은 주소가 다시 들어오지 않게 합니다.
--   * press_collect_runs: 실행 기록. 브라우저 역할 차단, 서버(service_role)만.
--   * 여러 번 실행해도 안전(멱등).

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'press_articles_source_check'
      and pg_get_constraintdef(oid) not like '%collector:naver%'
  ) then
    alter table press_articles drop constraint press_articles_source_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'press_articles_source_check') then
    alter table press_articles add constraint press_articles_source_check
      check (source in ('hermes', 'manual', 'collector:naver', 'collector:google'));
  end if;
end $$;

alter table press_articles
  add column if not exists url_status    text not null default 'ok',
  add column if not exists review_status text not null default 'auto',
  add column if not exists review_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'press_articles_url_status_check') then
    alter table press_articles add constraint press_articles_url_status_check
      check (url_status in ('ok', 'needs_check'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'press_articles_review_status_check') then
    alter table press_articles add constraint press_articles_review_status_check
      check (review_status in ('auto', 'needs_review', 'approved', 'rejected'));
  end if;
end $$;

create table if not exists press_collect_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null default 'cron' check (trigger in ('cron', 'manual')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  naver_calls integer not null default 0,
  google_calls integer not null default 0,
  haiku_calls integer not null default 0,
  found integer not null default 0,          -- 검색 결과(후보) 수
  new_saved integer not null default 0,      -- 새로 저장
  needs_review integer not null default 0,
  url_needs_check integer not null default 0,
  status text check (status in ('ok', 'partial', 'failed')),
  error text
);

create index if not exists press_collect_runs_started_idx on press_collect_runs (started_at desc);

alter table press_collect_runs enable row level security;
revoke all on table press_collect_runs from anon, authenticated;
grant select, insert, update, delete on table press_collect_runs to service_role;
