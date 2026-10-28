-- =====================================================================
-- 동래방카 요청 5번 — 전화 공결 증빙(학부모가 앱에서 올림) · 2026-10-28 설계
--   설계: docs/설계_전화공결증빙.md
--   흐름: 전화 공결 입력(evidence_pending 증빙 대기) → 학부모 증빙 업로드(submitted, 직원 화면 "증빙 제출됨")
--         → 담임 확인(teacher_checked) → 팀장 결재(approved). 증빙 없으면 담임 확인·결재 불가(DB 에서도 막음).
--   멱등: 여러 번 실행해도 결과가 같습니다. begin/commit 은 넣지 않았습니다(마이그레이션 도구가 감쌈).
--   순서: 이 SQL → 두 앱 배포(동업자씨·동래방카). SQL 만 먼저 들어가도 기존 화면은 그대로 동작하고,
--         "증빙 없는 건의 결재"만 DB 가 막습니다(바뀐 규칙 그대로).
-- =====================================================================

-- 1) 상태에 evidence_pending(증빙 대기) 추가
alter table public.bk_absences drop constraint if exists bk_absences_status_check;
alter table public.bk_absences add constraint bk_absences_status_check
  check (status = any (array['evidence_pending', 'submitted', 'teacher_checked', 'approved', 'rejected', 'cancelled']::text[]));

-- 2) 증빙 요청·제출 기록(누가 언제)
alter table public.bk_absences add column if not exists evidence_requested_at timestamptz;
alter table public.bk_absences add column if not exists evidence_submitted_at timestamptz;
alter table public.bk_absences add column if not exists evidence_submitted_by text;

-- 3) 증빙 파일을 누가 올렸는지(보호자 / 직원)
alter table public.bk_absence_files add column if not exists uploaded_by text;
alter table public.bk_absence_files add column if not exists uploaded_by_guardian_id uuid
  references public.bk_guardians(id) on delete set null;

-- 4) 인덱스 — 증빙 유무 확인(결재 막기)·처리할 목록
create index if not exists bk_absence_files_absence_idx on public.bk_absence_files (absence_id);
create index if not exists bk_absences_status_idx on public.bk_absences (status);

-- 5) 운영 데이터 정리
--   5-a) 아직 결재 전인 전화 공결 중 증빙이 없는 건 → 증빙 대기(2026-10-28 기준 0건)
update public.bk_absences a
   set status = 'evidence_pending',
       evidence_requested_at = coalesce(a.evidence_requested_at, now()),
       updated_at = now()
 where a.channel = 'phone'
   and a.status in ('submitted', 'teacher_checked')
   and not exists (select 1 from public.bk_absence_files f where f.absence_id = a.id);

--   5-b) 이미 결재된 전화 공결 중 증빙이 없는 건(2026-10-28 기준 1건) → 결재는 그대로 두고 "증빙 요청"만 표시.
--        학부모 앱에 "증빙 서류를 올려 주세요"가 뜨고, 올리면 상태는 바뀌지 않고 서류만 붙습니다(설계 문서 6장 A안).
update public.bk_absences a
   set evidence_requested_at = coalesce(a.evidence_requested_at, now()),
       updated_at = now()
 where a.channel = 'phone'
   and a.status = 'approved'
   and a.evidence_requested_at is null
   and not exists (select 1 from public.bk_absence_files f where f.absence_id = a.id);

--   (B안을 고르면 5-b 대신 아래 — 결재를 되돌려 증빙 대기로. 결재 기록 approved_by/at 은 지움)
--   update public.bk_absences a
--      set status = 'evidence_pending', approved_by = null, approved_at = null,
--          evidence_requested_at = coalesce(a.evidence_requested_at, now()), updated_at = now()
--    where a.channel = 'phone' and a.status = 'approved'
--      and not exists (select 1 from public.bk_absence_files f where f.absence_id = a.id);

-- 6) 증빙 없이는 담임 확인·결재 불가 — 앱 버튼을 막는 것과 별개로 DB 에서도 막음(직접 수정·옛 화면 대비).
--    상태가 teacher_checked / approved 로 "바뀌는" 순간에만 검사(이미 결재된 옛 건은 건드리지 않음).
create or replace function public.bk_absences_require_evidence()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status in ('teacher_checked', 'approved')
     and new.status is distinct from old.status
     and not exists (select 1 from public.bk_absence_files f where f.absence_id = new.id) then
    raise exception '증빙 서류가 없어 담임 확인·결재할 수 없습니다.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists bk_absences_require_evidence on public.bk_absences;
create trigger bk_absences_require_evidence
  before update of status on public.bk_absences
  for each row execute function public.bk_absences_require_evidence();
