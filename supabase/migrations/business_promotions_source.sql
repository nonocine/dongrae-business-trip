-- 홍보실적 수집 출처 — 'manual'(사람이 입력) / 'auto'([가져오기]로 수집).
--   * 운영 DB 에는 컬럼이 이미 적용돼 있습니다(2026-09, 기존 124건 전부 manual).
--     새로 세팅하는 환경에서 컬럼이 빠지지 않도록 여기에 남깁니다.
--     ⚠️ 아래 check 제약은 운영 DB 에 아직 없습니다 — 값 두 가지를 강제하려면
--     이 파일을 한 번 실행하세요(현재 데이터는 전부 manual 이라 그대로 통과).
--   * additive alter 라 여러 번 실행해도 안전(멱등)합니다. 기존 행은 default 로
--     manual 이 되고, 컬럼을 지우거나 rename 하지 않습니다.
--   * 쓰임새: 자동 수집 행은 author_name 이 '버튼을 누른 사람'이라 임의에
--     가까워, 잘못 수집된 게시물을 아무 직원이나 지울 수 있게 하는 근거입니다
--     (app/business-results/actions.ts 의 deletePromotion).
--   * 중복 방지는 url 컬럼 기준이라 여기서 따로 인덱스를 만들지 않습니다
--     (수기 입력은 링크 없이 등록할 수 있어 unique 를 걸 수 없습니다).

alter table business_promotions
  add column if not exists source text not null default 'manual';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'business_promotions_source_check'
  ) then
    alter table business_promotions
      add constraint business_promotions_source_check
      check (source in ('manual', 'auto'));
  end if;
end $$;
