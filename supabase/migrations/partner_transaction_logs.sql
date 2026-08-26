-- 거래처 거래이력 — partner_transaction_logs.
--   * 한 거래처와 실제로 주고받은 일을 시간순으로 남깁니다
--     (예: "2026-03 간판 제작", "2026-07 인테리어 공사").
--     담당자 명단(partner_contacts)과는 다른 개념이라 별도 테이블입니다.
--   * 권한(관장 결정 2026-08-25): 등록은 거래처를 볼 수 있는 직원 누구나,
--     수정·삭제는 등록자 본인 또는 M0(관장·부장). 판정은 서버 액션이 합니다.
--   * business_partners 와 같은 잠금 — RLS on(정책 0개) + anon/authenticated
--     권한 회수 → service_role(서버 액션) 경유만 접근할 수 있습니다.
--     비공개 거래처의 이력은 액션이 거래처 가드를 태워 함께 가려집니다.
--   * 거래처를 지우면 이력도 함께 지워집니다(on delete cascade).
--   * 여러 번 실행해도 안전(멱등)합니다.
create extension if not exists "pgcrypto";

create table if not exists partner_transaction_logs (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references business_partners(id) on delete cascade,
  -- 거래 일자. 화면에서는 필수로 받지만, 옛 데이터 이관 여지를 남겨 null 허용.
  occurred_on date,
  content text not null default '',
  -- 등록자 이름(drivers.name). 수정·삭제 권한 판정에 씁니다.
  created_by text not null default '',
  created_at timestamptz not null default now()
);

comment on table partner_transaction_logs is
  '거래처 거래이력(거래처당 여러 건). 예: "2026-03 간판 제작". 등록은 전 직원, 수정·삭제는 등록자 본인 또는 M0. 담당자 명단(partner_contacts)과는 별개.';

-- 거래처 상세에서 최신순으로 끌어올 때.
create index if not exists partner_transaction_logs_partner_idx
  on partner_transaction_logs (partner_id, occurred_on desc, created_at desc);

alter table partner_transaction_logs enable row level security;

revoke all on table partner_transaction_logs from anon, authenticated;

grant select, insert, update, delete on table partner_transaction_logs to service_role;
