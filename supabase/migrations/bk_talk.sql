-- =====================================================================
-- 방카톡(동래방카 요청 2·4·10번) — 보호자 문의·글 아래 질문 + 직원 답글 + 운영시간 · 2026-10-28 설계
--   설계: docs/설계_방카톡.md
--   · 2번 댓글과 4번 방카톡은 같은 표: 글(공지·알림장)·수업기록에 연결된 질문 / 연결 없는 일반 문의
--   · 보호자 글은 본인과 직원만 봄 — 이 표들은 RLS 켜고 정책 없음(브라우저 키로는 못 읽음).
--     두 앱 서버(service_role)가 보호자 본인 것만 골라 줌(설계 6장).
--   · 운영시간(10번): bk_talk_settings 한 줄. 보호자 작성 가능 여부는 앱 서버가 판단(공휴일 표는 코드).
--   · 사진(bk_talk_files)은 표와 규칙(말 하나에 최대 3장)만 — 화면은 다음 배포(관장 결정 2026-10-28).
--   · 보관 기간은 아직 정하지 않음(따로 결정 후 추가).
--   멱등: 여러 번 실행해도 결과가 같습니다. begin/commit 은 넣지 않았습니다.
-- =====================================================================

-- 1) 대화(보호자 한 명의 문의 한 건) ---------------------------------
create table if not exists public.bk_talk_threads (
  id uuid primary key default gen_random_uuid(),
  guardian_id uuid not null references public.bk_guardians(id) on delete cascade, -- 주인(보는 사람 결정)
  student_id uuid references public.bk_students(id) on delete set null,           -- 어느 자녀 일인지(선택)
  -- 무엇에 대한 질문인지: general(방카톡 일반 문의) / post(공지·알림장) / session(수업기록)
  topic_type text not null default 'general' check (topic_type in ('general', 'post', 'session')),
  post_id uuid references public.bk_posts(id) on delete set null,
  session_id uuid references public.saem_sessions(id) on delete set null,
  topic_title text,               -- 그때 글 제목 스냅숏("공지 · 11월 일정 안내") — 원글이 지워져도 남음
  -- open(답변 기다림) / answered(직원이 답함) / closed(직원이 닫음 — 보호자 추가 글 불가)
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  last_message_at timestamptz not null default now(),
  last_guardian_at timestamptz,
  last_staff_at timestamptz,
  guardian_read_at timestamptz,   -- 보호자가 마지막으로 본 시각 → "새 답글" = last_staff_at > guardian_read_at
  closed_at timestamptz,
  closed_by text,
  deleted_at timestamptz,         -- 보호자가 지운 대화(답글 달리기 전만, 숨김 처리)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bk_talk_threads_general_no_link check (topic_type <> 'general' or (post_id is null and session_id is null))
);

create index if not exists bk_talk_threads_guardian_idx on public.bk_talk_threads (guardian_id, last_message_at desc);
create index if not exists bk_talk_threads_status_idx on public.bk_talk_threads (status, last_message_at desc);
create index if not exists bk_talk_threads_post_idx on public.bk_talk_threads (post_id) where post_id is not null;
create index if not exists bk_talk_threads_session_idx on public.bk_talk_threads (session_id) where session_id is not null;

-- 2) 말(보호자 글 · 직원 답글) ---------------------------------------
create table if not exists public.bk_talk_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.bk_talk_threads(id) on delete cascade,
  author_type text not null check (author_type in ('guardian', 'staff')),
  -- 보호자 계정을 지우면 그 보호자 글도 함께 삭제(대화도 함께 지워짐). set null 이면 아래 작성자 제약에 걸려 계정 삭제가 막힘.
  guardian_id uuid references public.bk_guardians(id) on delete cascade,
  staff_driver_id uuid,           -- 동업자씨 직원(drivers.id) — 기록용
  staff_name text,                -- 답글에 보이는 "담당 선생님" 이름(그때 이름 스냅숏)
  body text not null check (char_length(body) between 1 and 2000),
  edited_at timestamptz,
  deleted_at timestamptz,         -- 지운 글: 내용 대신 "삭제된 글입니다"
  hidden_at timestamptz,          -- 직원이 가린 부적절한 글(보호자 본인에게도 내용 대신 안내)
  hidden_by text,
  hidden_reason text,
  created_at timestamptz not null default now(),
  constraint bk_talk_messages_author check (
    (author_type = 'guardian' and guardian_id is not null) or (author_type = 'staff' and staff_name is not null)
  )
);

create index if not exists bk_talk_messages_thread_idx on public.bk_talk_messages (thread_id, created_at);

-- 3) 사진(설계 7장 — 화면은 다음 배포, 말 하나에 최대 3장(SQL 8), bangka-media 비공개 버킷 talk/{thread_id}/...) ---
create table if not exists public.bk_talk_files (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.bk_talk_messages(id) on delete cascade,
  path text not null,
  name text,
  mime text,
  size integer,
  width integer,
  height integer,
  created_at timestamptz not null default now()
);

create index if not exists bk_talk_files_message_idx on public.bk_talk_files (message_id);

-- 4) 운영시간 설정(한 줄) — 동업자씨 관리 화면에서 바꿈 ------------------
create table if not exists public.bk_talk_settings (
  id smallint primary key default 1 check (id = 1),
  weekdays smallint[] not null default '{1,2,3,4,5}',   -- 0=일 … 6=토(한국 시간 기준 요일)
  open_time time not null default '13:00',
  close_time time not null default '20:00',             -- 이 시각 전까지 작성 가능(20:00 정각부터 막힘)
  block_holidays boolean not null default true,         -- 법정 공휴일(앱 코드의 공휴일 표) 막기
  extra_closed_dates date[] not null default '{}',      -- 센터 휴무일·임시공휴일 등 추가로 막을 날
  closed_notice text not null default
    '방카톡은 평일 오후 1시부터 8시까지 쓸 수 있습니다. 급한 결석은 공결 신청을 이용하시거나 센터로 전화해 주세요.',
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint bk_talk_settings_hours check (open_time < close_time)
);

insert into public.bk_talk_settings (id) values (1) on conflict (id) do nothing;

-- 5) 보안 — 브라우저 키(anon·authenticated)로는 아무것도 못 하게(정책 없음 = 전부 거부) ---------
alter table public.bk_talk_threads enable row level security;
alter table public.bk_talk_messages enable row level security;
alter table public.bk_talk_files enable row level security;
alter table public.bk_talk_settings enable row level security;
revoke all on public.bk_talk_threads, public.bk_talk_messages, public.bk_talk_files, public.bk_talk_settings
  from anon, authenticated;

-- 6) 말이 새로 들어오면 대화 상태·시각 갱신(두 앱 공통 규칙을 DB 한 곳에서) ------------
--    보호자 글 → open(답변 기다림), 직원 답글 → answered. 닫힌 대화는 상태 유지.
create or replace function public.bk_talk_after_message()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.author_type = 'guardian' then
    update public.bk_talk_threads
       set status = case when status = 'closed' then status else 'open' end,
           last_message_at = new.created_at,
           last_guardian_at = new.created_at,
           guardian_read_at = new.created_at,   -- 자기가 쓴 글은 읽은 것으로
           updated_at = now()
     where id = new.thread_id;
  else
    update public.bk_talk_threads
       set status = case when status = 'closed' then status else 'answered' end,
           last_message_at = new.created_at,
           last_staff_at = new.created_at,
           updated_at = now()
     where id = new.thread_id;
  end if;
  return new;
end;
$$;

drop trigger if exists bk_talk_after_message on public.bk_talk_messages;
create trigger bk_talk_after_message
  after insert on public.bk_talk_messages
  for each row execute function public.bk_talk_after_message();

-- 7) 보호자 글 — 자기 대화에만, 닫힌 대화(closed)에는 못 씀. 앱 서버 확인과 별개로 DB 에서도 막음 ----------
--    (직원 답글은 닫힌 대화에도 가능 — 닫으면서 마지막 안내를 남길 수 있게)
create or replace function public.bk_talk_guardian_owns_thread()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  t_status text;
begin
  if new.author_type = 'guardian' then
    select t.status into t_status
      from public.bk_talk_threads t
     where t.id = new.thread_id and t.guardian_id = new.guardian_id;
    if not found then
      raise exception '본인 대화에만 글을 쓸 수 있습니다.' using errcode = 'check_violation';
    end if;
    if tg_op = 'INSERT' and t_status = 'closed' then
      raise exception '닫힌 문의입니다.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists bk_talk_guardian_owns_thread on public.bk_talk_messages;
create trigger bk_talk_guardian_owns_thread
  before insert or update of thread_id, guardian_id on public.bk_talk_messages
  for each row execute function public.bk_talk_guardian_owns_thread();

-- 8) 사진은 말 하나에 최대 3장 — 화면은 나중이어도 규칙은 미리(관장 결정 2026-10-28) ----------
--    같은 말에 동시에 올려도 3장을 넘지 않게 그 말 줄을 잠근 뒤 셈.
create or replace function public.bk_talk_files_limit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform 1 from public.bk_talk_messages m where m.id = new.message_id for update;
  if (select count(*) from public.bk_talk_files f where f.message_id = new.message_id) >= 3 then
    raise exception '사진은 글 하나에 3장까지 올릴 수 있습니다.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists bk_talk_files_limit on public.bk_talk_files;
create trigger bk_talk_files_limit
  before insert or update of message_id on public.bk_talk_files
  for each row execute function public.bk_talk_files_limit();
