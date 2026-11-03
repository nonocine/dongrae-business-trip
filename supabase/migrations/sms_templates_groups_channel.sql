-- =====================================================================
-- 문자 발송 개편 — 문구함 · 주소록(그룹) · 발송 수단(channel) · 2026-11-03
--   화면: /sms (lib/sms/*, docs/SMS_SOURCES.md)
--   · sms_templates              : 문구함. 공개 범위 나만/전 직원 공유. 많이 쓴 순(use_count)·즐겨찾기.
--                                  kakao_template_code·kakao_status 는 나중에 알림톡 검수 템플릿 연결용
--                                  (지금 화면에는 보이지 않음).
--   · sms_contact_groups         : 주소록(그룹). 공유 그룹은 모든 직원의 ⑦주소록 카드에 보임.
--   · sms_contact_group_members  : 그룹 안 사람. DB 출처 사람은 {source, ref_id} 참조만 저장하고
--                                  번호를 복사하지 않음(늘 최신 번호로 발송). source='manual' 만 phone 저장.
--   · sms_send_logs.channel      : 발송 수단(sms / 나중에 kakao-alimtalk 등). 기본 'sms'.
--   · 출처 요약은 기존 sms_send_logs.audience_desc 를 그대로 씀("동래미래 4차시 158 + 강사 5") —
--     같은 뜻의 칸이 이미 있어 source_summary 는 만들지 않음.
--   · 모든 표 RLS 켜고 정책 없음(sms_send_logs 와 같음) — 동업자씨 서버(service_role)만 읽고 씀.
--   · 만든 사람(owner_id)은 drivers FK, 직원 행을 지워도 문구·주소록은 남도록 on delete set null
--     (sms_send_logs.sent_by 와 같은 방식).
--   멱등: 여러 번 실행해도 결과가 같습니다. begin/commit 은 넣지 않았습니다.
-- =====================================================================

-- 1) 문구함 -------------------------------------------------------------
create table if not exists public.sms_templates (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null,
  body                text not null,
  category            text not null default '기타',
  visibility          text not null default 'private',
  owner_id            uuid references public.drivers(id) on delete set null,
  use_count           integer not null default 0,
  is_favorite         boolean not null default false,
  kakao_template_code text,
  kakao_status        text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint sms_templates_visibility_check check (visibility in ('private', 'shared')),
  constraint sms_templates_category_check check (category in ('안내', '공지', '강사', '모집', '기타'))
);
-- 이미 표가 있던 경우를 위해 알림톡 칸은 따로 보강합니다.
alter table public.sms_templates add column if not exists kakao_template_code text;
alter table public.sms_templates add column if not exists kakao_status text;

create index if not exists sms_templates_owner_idx on public.sms_templates (owner_id);
create index if not exists sms_templates_order_idx
  on public.sms_templates (is_favorite desc, use_count desc, created_at desc);

-- 2) 주소록(그룹) -------------------------------------------------------
create table if not exists public.sms_contact_groups (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  category            text,
  visibility          text not null default 'private',
  business_program_id uuid references public.business_programs(id) on delete set null,
  owner_id            uuid references public.drivers(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint sms_contact_groups_visibility_check check (visibility in ('private', 'shared'))
);
create index if not exists sms_contact_groups_owner_idx on public.sms_contact_groups (owner_id);
create index if not exists sms_contact_groups_program_idx on public.sms_contact_groups (business_program_id);

-- 3) 주소록 사람 --------------------------------------------------------
create table if not exists public.sms_contact_group_members (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.sms_contact_groups(id) on delete cascade,
  source     text not null,          -- 출처 key(lib/sms/sources): employees, instructors, manual …
  ref_id     text,                   -- DB 출처 사람의 id(번호는 저장하지 않음)
  name       text not null default '',
  phone      text,                   -- source='manual' 일 때만
  created_at timestamptz not null default now(),
  -- manual 은 번호만, 나머지는 참조만 — 번호가 DB 출처 사람에게 복사되지 않게 막습니다.
  constraint sms_contact_group_members_ref_check check (
    (source = 'manual' and phone is not null and ref_id is null)
    or (source <> 'manual' and ref_id is not null and phone is null)
  )
);
create index if not exists sms_contact_group_members_group_idx on public.sms_contact_group_members (group_id);

-- 4) 발송 이력 — 발송 수단 ----------------------------------------------
alter table public.sms_send_logs add column if not exists channel text not null default 'sms';

-- 5) RLS — 켜고 정책 없음(서버 service_role 전용, sms_send_logs 와 같음) ----
alter table public.sms_templates enable row level security;
alter table public.sms_contact_groups enable row level security;
alter table public.sms_contact_group_members enable row level security;
