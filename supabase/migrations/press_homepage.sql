-- 홈페이지(onnainna.kr) 언론보도 게시 기록 — docs/PRESS_AUTOMATION.md 3-8
--   * press_articles 에 칸만 추가합니다(additive, 여러 번 실행해도 안전). 기존 칸 변경·삭제 없음.
--   * homepage_scope: 어느 키 범위(test|live)에 올린 글인지. 개발·운영이 같은 DB 를 쓰므로
--     TEST 키로 올린 번호가 운영 게시 여부로 오인되지 않게 구분합니다. test 와 live 는
--     번호·external_id 범위가 서로 다릅니다.
--   * homepage_external_id: 실제로 보낸 ID. 기본은 press_articles.id, 내린 뒤 다시 올리면 {id}-r2 …
--   * RSS 로 다시 들어오는 홍보실적 중복 차단은 (homepage_scope='live', homepage_no) 로 판정합니다.
--   * press-images: 대표 이미지 보관(비공개). 브라우저 역할 정책 없음 → 서버(service_role)만 접근.

alter table press_articles
  add column if not exists homepage_scope       text,
  add column if not exists homepage_external_id text,
  add column if not exists homepage_no          integer,
  add column if not exists homepage_status      text,
  add column if not exists homepage_summary     text,
  add column if not exists homepage_image_path  text,
  add column if not exists homepage_posted_at   timestamptz,
  add column if not exists homepage_updated_at  timestamptz,
  add column if not exists homepage_error       text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'press_articles_homepage_scope_check') then
    alter table press_articles add constraint press_articles_homepage_scope_check
      check (homepage_scope in ('test', 'live'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'press_articles_homepage_status_check') then
    alter table press_articles add constraint press_articles_homepage_status_check
      check (homepage_status in ('draft', 'published', 'deleted'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'press_articles_homepage_summary_len') then
    alter table press_articles add constraint press_articles_homepage_summary_len
      check (homepage_summary is null or char_length(homepage_summary) <= 4000);
  end if;
end $$;

create unique index if not exists press_articles_homepage_no_uniq
  on press_articles (homepage_scope, homepage_no) where homepage_no is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('press-images', 'press-images', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;
