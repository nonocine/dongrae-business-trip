-- =========================================================
-- 채용 시스템 v1.2 — 테스트용 더미 공고
--   * recruitment_postings 만 건드립니다.
--   * Supabase SQL Editor 에 붙여넣고 Run.
--   * on conflict (slug) do nothing — 재실행 안전.
--     내용을 바꿔 다시 넣으려면 기존 row 를 먼저 삭제하세요.
--   * 접속 경로: /recruitment/2026-1
-- =========================================================
insert into recruitment_postings (
  slug, title, field, recruit_count,
  application_start, application_end,
  qualifications, preferred, salary_info, process_info, notice,
  status, created_by
) values (
  '2026-1',
  '동래구청소년센터 직원 채용 (2026년 1차)',
  '청소년사업담당',
  1,
  now(),
  now() + interval '14 days',
  E'- 학력: 전문대학 졸업 이상\n- 청소년지도사 2급 이상 자격 소지자\n- 청소년 관련 사업 기획·운영이 가능한 자\n- 성별 및 연령 제한 없음',
  E'- 청소년수련시설 근무 경력자\n- 청소년활동 프로그램 기획·운영 경험자\n- 문서작성(워드·엑셀) 능력 우수자\n- 운전면허 소지자',
  E'- 센터 보수 규정에 따름 (연봉 협의 후 결정)\n- 4대 보험 가입, 명절휴가비·복지포인트 별도 지급\n- 수습기간 3개월 (수습기간 중 급여 동일)',
  E'1차 서류전형 → 2차 면접전형 → 최종합격자 발표\n- 서류 합격자에 한해 개별 면접 일정을 안내합니다.\n- 면접 시 자격증 원본 및 증빙서류를 지참해야 합니다.',
  E'- 제출 서류에 허위 사실이 있을 경우 합격을 취소합니다.\n- 접수 마감 시각 이후 제출된 서류는 인정되지 않습니다.\n- 제출된 서류는 일절 반환하지 않습니다.\n- 문의: 동래구청소년센터 (051-000-0000)',
  'published',
  '관장'
)
on conflict (slug) do nothing;
