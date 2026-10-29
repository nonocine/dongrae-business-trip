-- =====================================================================
-- 직인사용대장 — 센터 직인이 들어가는 증서 신청·결재·발급 대장 · 2026-10-29 설계
--   요청: 노미현 부장(슬랙 #08, 2026-10-27) + 관장 결정
--   설계: docs/설계_직인사용대장.md
--   · approvals          : 공통 결재(종류·대상id·신청자·결재자·상태·시각·반려사유·ERP 문서번호 칸).
--                           이번엔 직인대장(doc_kind = 'seal_use')만 사용. 공결·계약서 결재는 그대로 둠.
--   · seal_requests      : 신청 한 건(종류·제목·증서 날짜·항목 틀·본문 틀)
--   · seal_recipients    : 대상자 한 줄 = 발급번호 한 개(제2026-01호). 1인 1쪽.
--   · seal_number_counters: 연도별 다음 번호(관장이 연도별 시작 번호를 한 번 입력)
--   · seal_print_logs    : 출력·재출력 기록
--   · 발급번호는 승인 함수(seal_approve_request) 안에서만 붙음 — 연도 줄을 잠그고 차례로 부여해
--     동시 승인에도 중복·건너뜀 없음. 승인이 실패하면 번호도 함께 되돌아감.
--   · 삭제 불가: 발급된 줄은 내용·번호를 못 바꾸고 못 지움. 잘못 발급한 건은 '취소'(사유·취소자·시각) → 결번.
--   · 모든 표 RLS 켜고 정책 없음(브라우저 키로는 못 읽음) — 동업자씨 서버(service_role)만 씀.
--   · 보관 기간·파일 보관은 넣지 않음(PDF 는 저장하지 않고 snapshot 으로 매번 다시 만듦).
--   멱등: 여러 번 실행해도 결과가 같습니다. begin/commit 은 넣지 않았습니다.
-- =====================================================================

-- 1) 공통 결재 -------------------------------------------------------
--    한 번 올릴 때마다 한 줄(round 1, 2, …). 반려 후 다시 올리면 새 줄 — 반려 이력이 그대로 남음.
create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  doc_kind text not null check (doc_kind in ('seal_use')),   -- 결재 종류(나중에 늘림)
  target_id uuid not null,                                     -- 대상 문서 id(seal_requests.id 등)
  round integer not null default 1 check (round >= 1),         -- 몇 번째 올림인지
  requester_driver_id uuid references public.drivers(id) on delete set null,
  requester_name text not null,                                -- 그때 이름 스냅숏
  -- pending(결재 대기) / approved(승인) / rejected(반려) / withdrawn(신청자가 회수)
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  approver_driver_id uuid references public.drivers(id) on delete set null,
  approver_name text,
  approver_rank text,                                          -- 관장 / 부장(그때 직급)
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  reject_reason text,
  -- ERP 전자결재로 넘어갈 때 쓸 칸(지금은 비워 둠) — 설계 9장
  erp_system text,                                             -- 예: 'erp' / 시스템 이름
  erp_doc_no text,                                             -- ERP 문서번호
  erp_status text,                                             -- ERP 쪽 상태 원문
  erp_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approvals_round_unique unique (doc_kind, target_id, round),
  constraint approvals_decided check (
    status not in ('approved', 'rejected') or (decided_at is not null and approver_name is not null)
  ),
  constraint approvals_reject_reason check (
    status <> 'rejected' or char_length(btrim(coalesce(reject_reason, ''))) > 0
  )
);

-- 한 문서에 결재 대기는 한 줄만
create unique index if not exists approvals_one_pending
  on public.approvals (doc_kind, target_id) where status = 'pending';
create unique index if not exists approvals_erp_doc_no
  on public.approvals (erp_system, erp_doc_no) where erp_doc_no is not null;
create index if not exists approvals_status_idx on public.approvals (doc_kind, status, requested_at desc);
create index if not exists approvals_requester_idx on public.approvals (requester_driver_id, requested_at desc);

-- 2) 직인 사용 신청 ---------------------------------------------------
create table if not exists public.seal_requests (
  id uuid primary key default gen_random_uuid(),
  requester_driver_id uuid references public.drivers(id) on delete set null,
  requester_name text not null,
  -- award_confirm(수상확인증) / completion(수료증) / commendation(표창장) / prize(상장)
  -- / appointment(위촉장) / custom(기타 — 제목·항목 직접)
  doc_type text not null check (doc_type in ('award_confirm', 'completion', 'commendation', 'prize', 'appointment', 'custom')),
  title text not null check (char_length(btrim(title)) between 1 and 20),  -- "수상확인증"(PDF 에서 글자 사이 띄움)
  cert_date date not null,                 -- 증서에 찍히는 날짜("2026년 10월 17일")
  purpose text,                            -- 사용 목적·메모(대장에만, PDF 에는 안 나옴)
  -- 신청 화면을 다시 열 때 쓰는 틀: [{"label":"행 사 명","scope":"common","value":"…"},{"label":"수상부문","scope":"person"}]
  item_template jsonb not null default '[]'::jsonb check (jsonb_typeof(item_template) = 'array'),
  body_template text not null default '' check (char_length(body_template) <= 1000),  -- {성명} 같은 자리표시 포함
  -- draft(작성 중 — 올리기 전) / pending(결재 대기) / rejected(반려 — 고쳐서 다시 올림)
  -- / withdrawn(신청자가 회수) / issued(승인·발급 완료 — 끝)
  status text not null default 'draft' check (status in ('draft', 'pending', 'rejected', 'withdrawn', 'issued')),
  current_approval_id uuid references public.approvals(id) on delete restrict,
  issue_year integer,                      -- 발급 연도(승인 순간 KST)
  issued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seal_requests_issued check ((status = 'issued') = (issued_at is not null and issue_year is not null))
);

create index if not exists seal_requests_requester_idx on public.seal_requests (requester_driver_id, created_at desc);
create index if not exists seal_requests_status_idx on public.seal_requests (status, created_at desc);

-- 3) 대상자 줄 = 발급번호 한 개 ----------------------------------------
create table if not exists public.seal_recipients (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.seal_requests(id) on delete restrict,
  line_no integer not null check (line_no between 1 and 200),   -- 번호를 붙이는 차례
  recipient_name text not null check (char_length(btrim(recipient_name)) between 1 and 100),  -- 성명 또는 팀명
  -- PDF ○ 항목(순서대로): [{"label":"행 사 명","value":"제32회 동래읍성역사축제"}, …]
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 8),
  body text not null check (char_length(btrim(body)) between 1 and 1000),  -- 본문(직원 수정 가능, 자리표시 채운 결과)
  issue_year integer,
  issue_seq integer check (issue_seq >= 1),
  issued_at timestamptz,
  snapshot jsonb,                          -- 발급 순간 내용 통째(재출력은 이것만으로 같은 PDF)
  canceled_at timestamptz,
  canceled_by_driver_id uuid references public.drivers(id) on delete set null,
  canceled_by_name text,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seal_recipients_line_unique unique (request_id, line_no),
  constraint seal_recipients_no_unique unique (issue_year, issue_seq),          -- 번호 중복 불가
  constraint seal_recipients_issued check (
    (issue_seq is null and issue_year is null and issued_at is null and snapshot is null)
    or (issue_seq is not null and issue_year is not null and issued_at is not null and snapshot is not null)
  ),
  constraint seal_recipients_cancel check (
    canceled_at is null
    or (issue_seq is not null and canceled_by_name is not null and char_length(btrim(coalesce(cancel_reason, ''))) > 0)
  )
);

create index if not exists seal_recipients_request_idx on public.seal_recipients (request_id, line_no);
create index if not exists seal_recipients_year_idx on public.seal_recipients (issue_year, issue_seq) where issue_seq is not null;

-- 4) 연도별 번호 ------------------------------------------------------
create table if not exists public.seal_number_counters (
  year integer primary key check (year between 2000 and 2999),
  next_seq integer not null default 1 check (next_seq >= 1),   -- 다음에 붙일 번호
  start_seq integer,                                           -- 관장이 넣은 시작 번호(없으면 1부터)
  start_set_by text,
  start_set_at timestamptz,
  updated_at timestamptz not null default now()
);

-- 5) 출력·재출력 기록 --------------------------------------------------
create table if not exists public.seal_print_logs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.seal_requests(id) on delete restrict,
  recipient_ids uuid[] not null,           -- 이번에 뽑은 줄(PDF 한 파일, 1인 1쪽)
  is_reprint boolean not null,             -- 같은 줄을 전에 뽑은 적 있으면 true
  printed_by_driver_id uuid references public.drivers(id) on delete set null,
  printed_by_name text not null,
  printed_at timestamptz not null default now()
);

create index if not exists seal_print_logs_request_idx on public.seal_print_logs (request_id, printed_at desc);

-- 6) RLS: 켜고 정책 없음 ----------------------------------------------
alter table public.approvals enable row level security;
alter table public.seal_requests enable row level security;
alter table public.seal_recipients enable row level security;
alter table public.seal_number_counters enable row level security;
alter table public.seal_print_logs enable row level security;

-- 7) updated_at ------------------------------------------------------
create or replace function public.seal_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists approvals_touch on public.approvals;
create trigger approvals_touch before update on public.approvals
  for each row execute function public.seal_touch_updated_at();
drop trigger if exists seal_requests_touch on public.seal_requests;
create trigger seal_requests_touch before update on public.seal_requests
  for each row execute function public.seal_touch_updated_at();
drop trigger if exists seal_recipients_touch on public.seal_recipients;
create trigger seal_recipients_touch before update on public.seal_recipients
  for each row execute function public.seal_touch_updated_at();

-- 8) 지우기 막기 — 대장·결재·출력 기록은 지우지 않음 ------------------
--    예외: 한 번도 올리지 않은 작성 중(draft) 신청과 그 대상자 줄, 결재 대기 전(draft·rejected·withdrawn)의 대상자 줄.
create or replace function public.seal_block_delete()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  st text;
begin
  if tg_table_name = 'seal_requests' then
    if old.status = 'draft' and not exists (select 1 from public.approvals a where a.doc_kind = 'seal_use' and a.target_id = old.id) then
      return old;
    end if;
  elsif tg_table_name = 'seal_recipients' then
    select r.status into st from public.seal_requests r where r.id = old.request_id;
    if old.issue_seq is null and st in ('draft', 'rejected', 'withdrawn') then
      return old;
    end if;
  end if;
  raise exception '직인사용대장 기록은 지울 수 없습니다. 발급된 건은 취소로 처리하세요.' using errcode = 'check_violation';
end;
$$;

drop trigger if exists approvals_block_delete on public.approvals;
create trigger approvals_block_delete before delete on public.approvals
  for each row execute function public.seal_block_delete();
drop trigger if exists seal_requests_block_delete on public.seal_requests;
create trigger seal_requests_block_delete before delete on public.seal_requests
  for each row execute function public.seal_block_delete();
drop trigger if exists seal_recipients_block_delete on public.seal_recipients;
create trigger seal_recipients_block_delete before delete on public.seal_recipients
  for each row execute function public.seal_block_delete();
drop trigger if exists seal_print_logs_block_delete on public.seal_print_logs;
create trigger seal_print_logs_block_delete before delete on public.seal_print_logs
  for each row execute function public.seal_block_delete();

-- 9) 신청 줄 — 내용은 고칠 수 있을 때만, 상태는 정해진 길로만 ------------
create or replace function public.seal_requests_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.current_approval_id is not null or new.issued_at is not null then
      raise exception '신청은 작성 중(draft)으로 만든 뒤 올리기(seal_submit_request)로만 결재에 올립니다.' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- 내용(종류·제목·날짜·틀·신청자)은 올리기 전·반려·회수 상태에서만
  if (new.doc_type, new.title, new.cert_date, new.purpose, new.item_template, new.body_template,
      new.requester_driver_id, new.requester_name)
     is distinct from
     (old.doc_type, old.title, old.cert_date, old.purpose, old.item_template, old.body_template,
      old.requester_driver_id, old.requester_name)
     and old.status not in ('draft', 'rejected', 'withdrawn') then
    raise exception '결재 중이거나 발급된 신청은 고칠 수 없습니다.' using errcode = 'check_violation';
  end if;

  -- 상태 길: draft·rejected·withdrawn → pending → rejected·withdrawn·issued. issued 는 끝.
  if new.status is distinct from old.status then
    if not (
      (old.status in ('draft', 'rejected', 'withdrawn') and new.status = 'pending')
      or (old.status = 'pending' and new.status in ('rejected', 'withdrawn', 'issued'))
    ) then
      raise exception '신청 상태를 % 에서 % 로 바꿀 수 없습니다.', old.status, new.status using errcode = 'check_violation';
    end if;
  end if;

  if old.status = 'issued' and (new.issue_year, new.issued_at) is distinct from (old.issue_year, old.issued_at) then
    raise exception '발급 정보는 바꿀 수 없습니다.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists seal_requests_guard on public.seal_requests;
create trigger seal_requests_guard before insert or update on public.seal_requests
  for each row execute function public.seal_requests_guard();

-- 10) 대상자 줄 — 발급 뒤 내용·번호 고정, 취소는 한 번만·되돌리기 없음 ----
create or replace function public.seal_recipients_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  st text;
begin
  select r.status into st from public.seal_requests r where r.id = new.request_id;

  if tg_op = 'INSERT' then
    if new.issue_seq is not null or new.canceled_at is not null then
      raise exception '발급번호·취소는 처음 만들 때 넣을 수 없습니다.' using errcode = 'check_violation';
    end if;
    if st is null or st not in ('draft', 'rejected', 'withdrawn') then
      raise exception '결재 중이거나 발급된 신청에는 대상자를 더할 수 없습니다.' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- 이미 발급된 줄: 내용·번호 고정. 바뀔 수 있는 것은 취소 칸(비어 있을 때 한 번)뿐.
  if old.issue_seq is not null then
    if (new.request_id, new.line_no, new.recipient_name, new.items, new.body,
        new.issue_year, new.issue_seq, new.issued_at, new.snapshot)
       is distinct from
       (old.request_id, old.line_no, old.recipient_name, old.items, old.body,
        old.issue_year, old.issue_seq, old.issued_at, old.snapshot) then
      raise exception '발급된 증서의 내용·번호는 바꿀 수 없습니다. 잘못 발급했으면 취소하고 새로 신청하세요.' using errcode = 'check_violation';
    end if;
    if old.canceled_at is not null
       and (new.canceled_at, new.canceled_by_driver_id, new.canceled_by_name, new.cancel_reason)
           is distinct from
           (old.canceled_at, old.canceled_by_driver_id, old.canceled_by_name, old.cancel_reason) then
      raise exception '취소는 되돌리거나 고칠 수 없습니다.' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- 아직 번호 없는 줄
  if new.canceled_at is not null then
    raise exception '발급되지 않은 줄은 취소할 수 없습니다.' using errcode = 'check_violation';
  end if;
  if new.issue_seq is not null then
    -- 번호는 결재 대기 중인 신청에 승인 함수가 붙일 때만(내용은 그대로)
    if st <> 'pending'
       or (new.request_id, new.line_no, new.recipient_name, new.items, new.body)
          is distinct from (old.request_id, old.line_no, old.recipient_name, old.items, old.body) then
      raise exception '발급번호는 승인할 때만 붙습니다.' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if st not in ('draft', 'rejected', 'withdrawn') then
    raise exception '결재 중인 신청의 대상자는 고칠 수 없습니다. 회수한 뒤 고치세요.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists seal_recipients_guard on public.seal_recipients;
create trigger seal_recipients_guard before insert or update on public.seal_recipients
  for each row execute function public.seal_recipients_guard();

-- 11) 결재 줄 — 결정된 줄은 ERP 칸 말고는 고정 -------------------------
create or replace function public.approvals_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status <> 'pending' then
    if (new.doc_kind, new.target_id, new.round, new.requester_driver_id, new.requester_name, new.status,
        new.approver_driver_id, new.approver_name, new.approver_rank, new.requested_at, new.decided_at, new.reject_reason)
       is distinct from
       (old.doc_kind, old.target_id, old.round, old.requester_driver_id, old.requester_name, old.status,
        old.approver_driver_id, old.approver_name, old.approver_rank, old.requested_at, old.decided_at, old.reject_reason) then
      raise exception '끝난 결재는 바꿀 수 없습니다.' using errcode = 'check_violation';
    end if;
  elsif (new.doc_kind, new.target_id, new.round, new.requester_driver_id, new.requester_name, new.requested_at)
        is distinct from
        (old.doc_kind, old.target_id, old.round, old.requester_driver_id, old.requester_name, old.requested_at) then
    raise exception '결재 대상·신청자는 바꿀 수 없습니다.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists approvals_guard on public.approvals;
create trigger approvals_guard before update on public.approvals
  for each row execute function public.approvals_guard();

-- 12) 결재에 올리기(처음·반려 후 다시·회수 후 다시) ------------------------
create or replace function public.seal_submit_request(p_request_id uuid)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  r public.seal_requests%rowtype;
  next_round integer;
  new_id uuid;
begin
  select * into r from public.seal_requests where id = p_request_id for update;
  if not found then
    raise exception '신청을 찾을 수 없습니다.' using errcode = 'no_data_found';
  end if;
  if r.status not in ('draft', 'rejected', 'withdrawn') then
    raise exception '이미 결재 중이거나 발급된 신청입니다.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.seal_recipients x where x.request_id = r.id) then
    raise exception '대상자를 한 명 이상 넣어 주세요.' using errcode = 'check_violation';
  end if;

  select coalesce(max(a.round), 0) + 1 into next_round
    from public.approvals a where a.doc_kind = 'seal_use' and a.target_id = r.id;

  insert into public.approvals (doc_kind, target_id, round, requester_driver_id, requester_name)
  values ('seal_use', r.id, next_round, r.requester_driver_id, r.requester_name)
  returning id into new_id;

  update public.seal_requests set status = 'pending', current_approval_id = new_id where id = r.id;
  return new_id;
end;
$$;

-- 13) 회수(결재 전 신청자가 거둬들임) ------------------------------------
create or replace function public.seal_withdraw_request(p_request_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  r public.seal_requests%rowtype;
begin
  select * into r from public.seal_requests where id = p_request_id for update;
  if not found or r.status <> 'pending' then
    raise exception '결재 대기 중인 신청만 회수할 수 있습니다.' using errcode = 'check_violation';
  end if;
  update public.approvals set status = 'withdrawn' where id = r.current_approval_id and status = 'pending';
  update public.seal_requests set status = 'withdrawn' where id = r.id;
end;
$$;

-- 13-1) 결재자 확인 — drivers.rank 가 관장·부장일 때만 그 직급을 돌려줌 ------------
--    반려·승인 함수가 맨 앞에서 부름. 결재 기록(approver_rank·snapshot.approvedRank)에는
--    앱이 넘긴 p_approver_rank 대신 이 값(DB 직급)을 씀.
create or replace function public.seal_check_approver(p_approver_driver_id uuid)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_rank text;
begin
  if p_approver_driver_id is null then
    raise exception '결재자 정보가 없습니다.' using errcode = 'check_violation';
  end if;
  select d.rank into v_rank from public.drivers d where d.id = p_approver_driver_id;
  if v_rank is null or v_rank not in ('관장', '부장') then
    raise exception '직인 사용 결재는 관장·부장만 할 수 있습니다.' using errcode = 'check_violation';
  end if;
  return v_rank;
end;
$$;

-- 14) 반려(사유 필수) --------------------------------------------------
--    p_approver_rank 는 호환용으로 남겨 둔 매개변수(쓰지 않음) — 직급은 seal_check_approver 값.
create or replace function public.seal_reject_request(
  p_request_id uuid,
  p_approver_driver_id uuid,
  p_approver_name text,
  p_approver_rank text,
  p_reason text
)
returns void
language plpgsql
set search_path = public
as $$
declare
  r public.seal_requests%rowtype;
  v_rank text;
begin
  v_rank := public.seal_check_approver(p_approver_driver_id);
  if char_length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception '반려 사유를 적어 주세요.' using errcode = 'check_violation';
  end if;
  select * into r from public.seal_requests where id = p_request_id for update;
  if not found or r.status <> 'pending' then
    raise exception '이미 처리된 신청입니다.' using errcode = 'check_violation';
  end if;
  if r.requester_driver_id is not null and r.requester_driver_id = p_approver_driver_id then
    raise exception '본인 신청은 결재할 수 없습니다.' using errcode = 'check_violation';
  end if;
  update public.approvals
     set status = 'rejected', approver_driver_id = p_approver_driver_id, approver_name = p_approver_name,
         approver_rank = v_rank, decided_at = now(), reject_reason = btrim(p_reason)
   where id = r.current_approval_id and status = 'pending';
  update public.seal_requests set status = 'rejected' where id = r.id;
end;
$$;

-- 15) 승인 = 발급번호 부여(한 번에 처리) ----------------------------------
--    · 신청 줄을 잠가 같은 신청 두 번 승인 막음(부장·관장이 동시에 눌러도 한 명만 성공)
--    · 그해 번호 줄을 잠가 다른 신청 승인과 차례로 처리 → 중복·건너뜀 없음
--    · 연도는 승인 순간 한국 시각 기준. 대상자 줄 순서(line_no)대로 번호.
--    · p_approver_rank 는 호환용으로 남겨 둔 매개변수(쓰지 않음) — 직급은 seal_check_approver 값.
create or replace function public.seal_approve_request(
  p_request_id uuid,
  p_approver_driver_id uuid,
  p_approver_name text,
  p_approver_rank text
)
returns table (recipient_id uuid, issue_year integer, issue_seq integer, issue_label text)
language plpgsql
set search_path = public
as $$
declare
  r public.seal_requests%rowtype;
  x record;
  y integer := extract(year from (now() at time zone 'Asia/Seoul'))::integer;
  n integer;
  lbl text;
  ts timestamptz := now();
  v_rank text;
begin
  v_rank := public.seal_check_approver(p_approver_driver_id);
  if char_length(btrim(coalesce(p_approver_name, ''))) = 0 then
    raise exception '결재자 이름이 없습니다.' using errcode = 'check_violation';
  end if;
  select * into r from public.seal_requests where id = p_request_id for update;
  if not found or r.status <> 'pending' then
    raise exception '이미 처리된 신청입니다.' using errcode = 'check_violation';
  end if;
  if r.requester_driver_id is not null and r.requester_driver_id = p_approver_driver_id then
    raise exception '본인 신청은 결재할 수 없습니다.' using errcode = 'check_violation';
  end if;

  insert into public.seal_number_counters (year) values (y) on conflict (year) do nothing;
  select c.next_seq into n from public.seal_number_counters c where c.year = y for update;

  for x in
    select s.id, s.recipient_name, s.items, s.body
      from public.seal_recipients s
     where s.request_id = r.id
     order by s.line_no
  loop
    lbl := '제' || y || '-' || case when n < 10 then '0' || n else n::text end || '호';
    update public.seal_recipients s
       set issue_year = y, issue_seq = n, issued_at = ts,
           snapshot = jsonb_build_object(
             'issueLabel', lbl,
             'docType', r.doc_type,
             'title', r.title,
             'recipientName', x.recipient_name,
             'items', x.items,
             'body', x.body,
             'certDate', r.cert_date,
             'certifier', '동래구청소년센터장',
             'approvedBy', p_approver_name,
             'approvedRank', v_rank,
             'issuedAt', ts
           )
     where s.id = x.id;
    recipient_id := x.id; issue_year := y; issue_seq := n; issue_label := lbl;
    return next;
    n := n + 1;
  end loop;

  if n = (select c.next_seq from public.seal_number_counters c where c.year = y) then
    raise exception '대상자가 없습니다.' using errcode = 'check_violation';
  end if;

  update public.seal_number_counters set next_seq = n, updated_at = ts where year = y;
  update public.approvals
     set status = 'approved', approver_driver_id = p_approver_driver_id, approver_name = p_approver_name,
         approver_rank = v_rank, decided_at = ts
   where id = r.current_approval_id and status = 'pending';
  update public.seal_requests set status = 'issued', issue_year = y, issued_at = ts where id = r.id;
end;
$$;

-- 16) 발급 취소(번호는 결번으로 남음) ------------------------------------
create or replace function public.seal_cancel_recipient(
  p_recipient_id uuid,
  p_by_driver_id uuid,
  p_by_name text,
  p_reason text
)
returns void
language plpgsql
set search_path = public
as $$
begin
  if char_length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception '취소 사유를 적어 주세요.' using errcode = 'check_violation';
  end if;
  update public.seal_recipients
     set canceled_at = now(), canceled_by_driver_id = p_by_driver_id,
         canceled_by_name = p_by_name, cancel_reason = btrim(p_reason)
   where id = p_recipient_id and issue_seq is not null and canceled_at is null;
  if not found then
    raise exception '발급된(취소되지 않은) 증서만 취소할 수 있습니다.' using errcode = 'check_violation';
  end if;
end;
$$;

-- 17) 연도별 시작 번호(관장, 그해 첫 발급 전에 한 번) ---------------------
--    예: 올해 종이로 제2026-14호까지 냈으면 15 를 넣음 → 첫 발급이 제2026-15호.
create or replace function public.seal_set_start_no(p_year integer, p_start integer, p_by text)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_start is null or p_start < 1 then
    raise exception '시작 번호는 1 이상입니다.' using errcode = 'check_violation';
  end if;
  insert into public.seal_number_counters (year) values (p_year) on conflict (year) do nothing;
  perform 1 from public.seal_number_counters c where c.year = p_year for update;
  if exists (select 1 from public.seal_recipients s where s.issue_year = p_year) then
    raise exception '%년에는 이미 발급한 증서가 있어 시작 번호를 바꿀 수 없습니다.', p_year using errcode = 'check_violation';
  end if;
  update public.seal_number_counters
     set next_seq = p_start, start_seq = p_start, start_set_by = p_by, start_set_at = now(), updated_at = now()
   where year = p_year;
end;
$$;

-- 18) 함수는 서버(service_role)만 부름 ------------------------------------
revoke all on function public.seal_check_approver(uuid) from public, anon, authenticated;
revoke all on function public.seal_submit_request(uuid) from public, anon, authenticated;
revoke all on function public.seal_withdraw_request(uuid) from public, anon, authenticated;
revoke all on function public.seal_reject_request(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.seal_approve_request(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.seal_cancel_recipient(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.seal_set_start_no(integer, integer, text) from public, anon, authenticated;
grant execute on function public.seal_check_approver(uuid) to service_role;
grant execute on function public.seal_submit_request(uuid) to service_role;
grant execute on function public.seal_withdraw_request(uuid) to service_role;
grant execute on function public.seal_reject_request(uuid, uuid, text, text, text) to service_role;
grant execute on function public.seal_approve_request(uuid, uuid, text, text) to service_role;
grant execute on function public.seal_cancel_recipient(uuid, uuid, text, text) to service_role;
grant execute on function public.seal_set_start_no(integer, integer, text) to service_role;
