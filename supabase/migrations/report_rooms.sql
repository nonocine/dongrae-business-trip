-- 보고용 실 목록(26개) + 사업실적별 실 사용인원.
--   * 비품관리 facility_locations 와는 별개의 마스터입니다(김혜지 확정). 층 정보 포함.
--   * 실인원 = 실별 사용 인원의 합. business_results.youth_uses/other_uses 는
--     이 테이블의 합계로 서버 액션이 동기화합니다.
--   * 여러 번 실행해도 안전(멱등)합니다.
create extension if not exists "pgcrypto";

create table if not exists report_rooms (
  id uuid primary key default gen_random_uuid(),
  floor text not null,
  name text not null unique,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists business_result_rooms (
  id uuid primary key default gen_random_uuid(),
  result_id uuid not null references business_results(id) on delete cascade,
  room_id uuid not null references report_rooms(id) on delete cascade,
  youth_count integer not null default 0 check (youth_count >= 0),
  other_count integer not null default 0 check (other_count >= 0),
  created_at timestamptz not null default now(),
  unique (result_id, room_id)
);

create index if not exists business_result_rooms_result_idx
  on business_result_rooms (result_id);

alter table report_rooms enable row level security;
alter table business_result_rooms enable row level security;
revoke all on table report_rooms from anon, authenticated;
revoke all on table business_result_rooms from anon, authenticated;
grant select, insert, update, delete on table report_rooms to service_role;
grant select, insert, update, delete on table business_result_rooms to service_role;

-- --------------------------------------------------------------------
-- 시드: 보고용 26개 실 (지하1층 4 · 1층 4 · 2층 12 · 3층 5 · 온나 1)
--   sort_order 는 전체 연번 1..26 — 화면·문서 정렬 기준입니다.
-- --------------------------------------------------------------------
insert into report_rooms (floor, name, sort_order) values
  ('지하1층', '청소년운영위원회', 1),
  ('지하1층', '와글와글 다목적실', 2),
  ('지하1층', '디지털 드로잉 공작소', 3),
  ('지하1층', '뒹굴뒹굴존', 4),
  ('1층', '디지털유스카페', 5),
  ('1층', '꿈틀꿈틀 놀이터', 6),
  ('1층', '스낵바', 7),
  ('1층', 'E-스포츠존', 8),
  ('2층', '또박또박 배움터', 9),
  ('2층', '차근차근 배움터', 10),
  ('2층', '옹기종기 배움터', 11),
  ('2층', '알쏭달쏭 배움터', 12),
  ('2층', '속닥속닥 상담실', 13),
  ('2층', '소곤소곤 상담실', 14),
  ('2층', '토닥토닥 상담실', 15),
  ('2층', '어울림 놀이마당', 16),
  ('2층', '꿈지락 스튜디오', 17),
  ('2층', '상상하는 코딩랩', 18),
  ('2층', '뚝딱뚝딱 목공방', 19),
  ('2층', '하늘 드론 축구장', 20),
  ('3층', '꿈 나누는 마당', 21),
  ('3층', '띵가띵가 밴드실', 22),
  ('3층', '지글지글 요리실', 23),
  ('3층', '두둠칫 댄스실', 24),
  ('3층', 'N-PORTS ZONE', 25),
  ('온나', '온나', 26)
on conflict (name) do nothing;
