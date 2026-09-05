-- 공용 메일함 — 분류 출처(category_source)
--
--   ★ 이 파일은 기록용입니다. 2026-09 운영 DB 에 이미 적용되어 있습니다.
--     코드에서 실행하지 않습니다(앱은 컬럼이 있다고 가정합니다).
--
--   왜 필요한가:
--     분류가 어디서 왔는지 알아야 두 가지가 가능해집니다.
--     1) 사람이 고친 분류(manual)를 자동 분류가 덮어쓰지 않게 막는다.
--     2) 발신자 학습이 자기가 매긴 값(sender)을 다시 근거로 삼지 않게 막는다.
--        이걸 막지 않으면 한 번의 오답이 다음 학습의 근거가 되어 스스로
--        굳어집니다(되먹임 고리).
--
--   값: keyword = 제목 키워드 (lib/mailKeywordRules.ts)
--       sender  = 발신자 학습 (lib/mailSenderLearning.ts)
--       ai      = Anthropic 분류 (lib/mailClassifier.ts)
--       manual  = 사람이 화면에서 수정 (app/mail/actions.ts setMailCategory)
--       null    = 출처 불명. 2026-09 이전에 분류된 기존 행(1062건)이 여기 해당.
--                 학습 근거로는 씁니다(sender 가 아니므로).

alter table mail_messages
  add column if not exists category_source text;

alter table mail_messages
  drop constraint if exists mail_messages_category_source_check;
alter table mail_messages
  add constraint mail_messages_category_source_check
  check (category_source is null
         or category_source in ('keyword', 'sender', 'ai', 'manual'));

-- 사람이 고친 건만 모으는 부분 인덱스.
--   자동 분류·재분류가 매번 "manual 인가" 를 확인하고, 발신자 학습이
--   가중치 3배를 매길 때 찾습니다. 전체 대비 소수라 부분 인덱스가 적합합니다.
create index if not exists idx_mail_messages_manual_category
  on mail_messages (from_email)
  where category_source = 'manual';

comment on column mail_messages.category_source is
  'ai_category 를 정한 주체: keyword=제목 키워드, sender=발신자 학습, ai=AI, manual=사람이 수정. null=출처 불명(2026-09 이전). manual 은 자동 분류가 덮어쓰지 않고, sender 는 학습 근거에서 제외한다(오답 자가증식 방지).';
