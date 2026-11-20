-- =====================================================================
-- 급여 레코드에 "생성 시점 소속" 칸 추가 (2026-11 김혜지 팀장 요청)
--   * 지금까지 급여대장의 소속(센터/방과후아카데미)은 대장을 받을 때마다
--     직원별 급여 설정(employee_salary_profiles.extra.team)의 "지금 값"으로
--     정했습니다 → 나중에 소속을 바꾸면 지난달 급여대장도 바뀌었습니다.
--   * 이 칸이 생기면 급여 생성 때 소속을 레코드에 저장하고, 대장·명세서는
--     그 값을 씁니다(앱 코드는 칸이 없거나 null 이면 예전처럼 지금 값 사용).
--   * 값: center(센터) / placement(배치지도사) / afterschool(방과후아카데미).
--   * 기존 레코드는 "지금 급여대장에 보이는 소속" 그대로 채웁니다(backfill) —
--     앱의 resolveTeam/effectiveTeamValue 와 같은 규칙:
--       같은 직원·같은 연도 급여 설정 구간 중 지정된 team 우선 → 없으면 이름
--       시드(김소연·한지형·권수현·박수선 = 방과후아카데미) → 그 외 센터.
-- =====================================================================

alter table payroll_records
  add column if not exists team text;

alter table payroll_records
  drop constraint if exists payroll_records_team_check;
alter table payroll_records
  add constraint payroll_records_team_check
  check (team is null or team in ('center', 'placement', 'afterschool'));

-- 기존 레코드 채우기(이미 값이 있는 행은 건드리지 않음).
update payroll_records pr
set team = coalesce(
  (
    select p.extra->>'team'
    from employee_salary_profiles p
    where p.driver_id = pr.driver_id
      and p.year = pr.year
      and p.extra->>'team' in ('center', 'placement', 'afterschool')
    order by p.start_month
    limit 1
  ),
  case
    when (
      select regexp_replace(coalesce(d.name, ''), '\s+', '', 'g')
      from drivers d
      where d.id = pr.driver_id
    ) in ('김소연', '한지형', '권수현', '박수선') then 'afterschool'
    else 'center'
  end
)
where pr.team is null;

-- PostgREST 스키마 캐시 갱신.
notify pgrst, 'reload schema';
