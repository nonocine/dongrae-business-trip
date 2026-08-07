-- 사업명·세부사업명 등록제(레지스트리) — 운영 DB에는 이 파일을 검토한 뒤 적용합니다.
--   * 적용 순서: 이 파일 → business_results_v2.sql (program_id FK가 이 테이블을 참조).
--   * 자유 입력으로 인한 표기 불일치를 없애기 위해 7대 분야·30개 세부사업을 시드합니다.
--   * 여러 번 실행해도 안전(멱등)합니다.
create extension if not exists "pgcrypto";

create table if not exists business_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists business_programs (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references business_categories(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (category_id, name)
);

create index if not exists business_programs_category_idx
  on business_programs (category_id, sort_order);

-- 브라우저에서 직접 접근하지 못하게 하고 서버 액션(service_role)만 사용합니다.
alter table business_categories enable row level security;
alter table business_programs enable row level security;
revoke all on table business_categories from anon, authenticated;
revoke all on table business_programs from anon, authenticated;
grant select, insert, update, delete on table business_categories to service_role;
grant select, insert, update, delete on table business_programs to service_role;

-- --------------------------------------------------------------------
-- 시드: 7대 분야 (김혜지 확정, 2026-08-07)
-- --------------------------------------------------------------------
insert into business_categories (name, sort_order) values
  ('디지털 기반 청소년 활동기회 확대', 1),
  ('청소년 정책제안 및 실현', 2),
  ('청소년활동 프로그램 다양화', 3),
  ('학교안팎 청소년 활동지원 강화', 4),
  ('문화예술 여가활동 다양화', 5),
  ('지역사회 연계', 6),
  ('디지털 기반 활동', 7)
on conflict (name) do nothing;

-- --------------------------------------------------------------------
-- 시드: 세부사업명 30개 (표기 그대로, sort_order = 분야 내 나열 순서)
-- --------------------------------------------------------------------
insert into business_programs (category_id, name, sort_order)
select c.id, v.name, v.sort_order
from (values
  ('디지털 기반 청소년 활동기회 확대', '특성화체험활동 On-나-Go', 1),
  ('디지털 기반 청소년 활동기회 확대', '청소년 수련활동 해결해ON-나', 2),
  ('디지털 기반 청소년 활동기회 확대', 'AI 인공지능 코딩 자격증반', 3),
  ('디지털 기반 청소년 활동기회 확대', '디지털 드로잉 공작소 "상상ON 아트데이"', 4),
  ('디지털 기반 청소년 활동기회 확대', 'AR(증강현실) 피구 스포츠 "동(래)키(즈)"', 5),
  ('청소년 정책제안 및 실현', '청소년운영위원회 ''청동거울''', 1),
  ('청소년 정책제안 및 실현', '청소년참여위원회 ''동참해''', 2),
  ('청소년 정책제안 및 실현', '연합동아리대표회 ''유쓰 띵동''', 3),
  ('청소년 정책제안 및 실현', '청소년 자치기구 연합 활동 ''동래화합''', 4),
  ('청소년 정책제안 및 실현', '정보기술자격(ITQ) 한글 자격증반', 5),
  ('청소년활동 프로그램 다양화', '대학교 자원봉사 및 멘토링', 1),
  ('청소년활동 프로그램 다양화', '사직동 자유공간 ''온나''', 2),
  ('청소년활동 프로그램 다양화', '달마다 달라지는 해볼거리', 3),
  ('학교안팎 청소년 활동지원 강화', '방과후아카데미 이음Z음', 1),
  ('학교안팎 청소년 활동지원 강화', '초등 통합방과후학교 동래미래 아카데미', 2),
  ('학교안팎 청소년 활동지원 강화', '오케스트라 합주부 동래 feel 하모니', 3),
  ('학교안팎 청소년 활동지원 강화', '플루트 연습부 동래 feel 하모니', 4),
  ('학교안팎 청소년 활동지원 강화', '바이올린 연습부 동래 feel 하모니', 5),
  ('학교안팎 청소년 활동지원 강화', '청소년동아리연합회 Do Go Do Go 동래', 6),
  ('학교안팎 청소년 활동지원 강화', '청소년 쿠킹 클래스 ''밥 해달레''', 7),
  ('문화예술 여가활동 다양화', '청소년오락 게임존', 1),
  ('문화예술 여가활동 다양화', '청소년만 ON NA', 2),
  ('문화예술 여가활동 다양화', '청소년 E-스포츠존 ''롤(LOL)면 뭐하니''', 3),
  ('문화예술 여가활동 다양화', '스낵바(간식·문구) 동래점빵 다있소', 4),
  ('지역사회 연계', '시설대관', 1),
  ('지역사회 연계', '회의 및 기관방문', 2),
  ('지역사회 연계', '종사자 역량 강화', 3),
  ('디지털 기반 활동', '동전-PAY 우리 동래 동전', 1),
  ('디지털 기반 활동', '홈페이지 회원가입수', 2),
  ('디지털 기반 활동', '홍보활동', 3)
) as v(category_name, name, sort_order)
join business_categories c on c.name = v.category_name
on conflict (category_id, name) do nothing;
