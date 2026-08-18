-- 거래처 관리 — business_partners / partner_contacts.
--   * 테이블은 이미 생성되어 있고, 이 파일은 접근 잠금(RLS·권한)을 맞춥니다.
--     컬럼은 건드리지 않습니다.
--   * ⚠️ 거래처 담당자는 외부인 개인정보(이름·휴대전화·이메일)입니다. 생성 직후에는
--     RLS 가 꺼져 있고 anon 에 SELECT/INSERT/UPDATE/DELETE 가 모두 열려 있어,
--     브라우저에 실리는 anon 키만으로 전체 주소록을 읽고 지울 수 있었습니다.
--     명함첩(business_cards)과 동일하게 RLS 를 켜고 anon/authenticated 권한을
--     회수한 뒤 service_role 에만 부여합니다.
--     → 애플리케이션은 서버 액션(supabaseAdmin = service_role)으로만 접근하며,
--       service_role 은 RLS 를 우회하므로 정책(policy)은 두지 않습니다.
--   * 조회 축(분야별 보기·거래처별 담당자)에 맞춰 인덱스만 보강합니다.
--   * 여러 번 실행해도 안전(멱등)합니다.

-- 분야별 목록(시설/회계/학교/프로그램의뢰처/기타) — 거래 중인 곳 위주로 봅니다.
create index if not exists business_partners_category_idx
  on business_partners (category, is_active);

-- 거래처명 정렬·검색.
create index if not exists business_partners_name_idx
  on business_partners (name);

-- 거래처 상세에서 소속 담당자를 끌어올 때.
create index if not exists partner_contacts_partner_idx
  on partner_contacts (partner_id);

alter table business_partners enable row level security;
alter table partner_contacts enable row level security;

revoke all on table business_partners from anon, authenticated;
revoke all on table partner_contacts from anon, authenticated;

grant select, insert, update, delete on table business_partners to service_role;
grant select, insert, update, delete on table partner_contacts to service_role;
