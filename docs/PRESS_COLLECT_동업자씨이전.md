# 언론 보도 수집 — 헤르메스 → 동업자씨 이전 설계

> 작성: 2026-11-03 / 대상: 동업자씨(dongrae-business-trip) 작업하는 Claude Code
> 관련 문서: `docs/PRESS_AUTOMATION.md` (3-8 홈페이지 게시 포함)
> **원칙: 기존 표·입구(`press_articles`, `press_reporters`, `lib/pressIngest.ts`, `/api/press/ingest`)를 그대로 재사용한다. 새로 만들지 않는다.**

---

## 1. 왜 옮기나

| | 지금 (헤르메스) | 옮긴 뒤 (동업자씨) |
|---|---|---|
| 실행 장소 | 관장 PC | Vercel 서버 (항상 켜짐) |
| PC 꺼지면 | 수집 멈춤 | 상관없음 |
| 비용 | 매번 Claude API (Sonnet) | 검색 무료 + 애매한 것만 Haiku |
| 결과 | 그날 판단에 따라 조금씩 다름 | 정해진 규칙대로 같음 |

옮긴 뒤 헤르메스는 **공모사업·위수탁 공고 수집, 텔레그램 아침 브리핑**만 맡는다.

---

## 2. 전체 흐름

```
Vercel Cron — 평일 08:00 KST
  │
  ├─ ① 네이버 API HUB 뉴스 검색 (주력)
  ├─ ② 구글 뉴스 RSS 검색 (보충)
  │
  ├─ ③ 합치기 + 중복 제거
  ├─ ④ 걸러내기
  │     4-1 규칙 필터 (무료)
  │     4-2 애매한 것만 Haiku 판정 (아주 적은 비용)
  │
  ├─ ⑤ 저장: 기존 lib/pressIngest.ts 로 press_articles 에 넣기
  │         (기자 추출·홍보 실적 연결은 기존 로직 그대로)
  ├─ ⑥ 새 기사만 슬랙 #14_보도자료관련 공유
  └─ ⑦ 실행 기록 저장 + 문제 있으면 관장에게 텔레그램 알림
```

---

## 3. ① 네이버 API HUB (주력)

- 호스트: `naverapihub.apigw.ntruss.com` (정확한 경로는 NAVER API HUB 공식 문서 확인)
- 헤더: `X-NCP-APIGW-API-KEY-ID`, `X-NCP-APIGW-API-KEY`
- 환경변수: `NAVER_API_HUB_ID`, `NAVER_API_HUB_KEY` (헤르메스 `.env`와 같은 값 → 관장이 Vercel에 등록)
- 파라미터: `display=100`, `sort=date`, `start=1,101,...`
- **최근 7일보다 오래된 결과가 나오면 다음 페이지 요청 중단** (호출 수 절약)
- 링크는 `originallink`(언론사 원문) 우선, 없으면 `link`

**검색어 (따옴표로 정확히 일치)**
```
"동래구청소년센터"
"동래구 청소년센터"
"동래구청소년수련관"      ← 예전 이름
"허일수 센터장"
"어울리고GO"
"동래읍성GO"
"사직동 청소년 자유공간"
"조선놀이터"              ← 본문/요약에 "동래"가 있을 때만 통과
```
검색어 목록은 코드에 박지 말고 **설정 표 또는 설정 파일 한 곳**에 두어 관장이 나중에 추가할 수 있게.

---

## 4. ② 구글 뉴스 RSS (보충)

- 주소: `https://news.google.com/rss/search?q=<검색어>&hl=ko&gl=KR&ceid=KR:ko`
- 같은 검색어 사용, `when:7d` 붙여 최근 7일만
- 키 없음, 무료

**링크 문제**
- 구글 RSS 링크는 `news.google.com/rss/articles/...` 경유 주소
- 서버에서 실제 언론사 주소로 변환 시도 (리다이렉트 따라가기 등)
- **실패하면 구글 주소로 저장 + `url_status = 'needs_check'` 표시** → `/press` 화면에 "주소 확인 필요" 배지, 직원이 실제 주소로 고침
- 변환 방식은 구글이 바꿀 수 있으므로 실패해도 전체 수집이 멈추지 않게

**접속 제한 대비**
- 검색어 사이 1~2초 간격
- 구글이 막거나 오류 나면 구글 부분만 건너뛰고 네이버 결과로 계속 진행, 실행 기록에 남김

---

## 5. ③ 합치기 + 중복 제거

순서대로 같은 기사로 본다.
1. 실제 언론사 URL이 같음 (쿼리스트링 정리 후 비교)
2. 이미 `press_articles`에 있는 URL
3. 언론사 + 제목이 거의 같음 (공백·특수문자 제거 후 비교)

같은 행사를 여러 언론사가 쓴 건 **각각 저장**하고 `event_group`으로 묶는다 (기존 방식 유지).

---

## 6. ④ 걸러내기

### 4-1. 규칙 필터 (먼저, 무료)
**확실히 제외**
- 제목/요약에 아래가 있고, "동래구청소년센터" 단독 언급이 없음
  - 동래구청소년상담복지센터, 동래구진로교육지원센터, 구덕청소년수련관, 그 외 등록된 유사 명칭
- "조선놀이터"로만 잡혔는데 "동래" 없음

**확실히 통과**
- 제목에 "동래구청소년센터" / "동래구 청소년센터" / "허일수 센터장" 포함

**애매함 → 4-2로**
- 위 둘 다 아닌 것 (예: 요약에만 언급, 예전 이름으로만 언급, 묶음기사)

### 4-2. Haiku 판정 (애매한 것만)
- 모델: Claude Haiku (최신 Haiku 모델 문자열은 Anthropic 문서 확인)
- 입력: 제목, 언론사, 요약(네이버 description), 가능하면 본문 앞부분 1500자
- 출력 JSON만: `{"ours": true|false, "is_roundup": true|false, "reason": "한 줄"}`
- 환경변수: `ANTHROPIC_API_KEY_PRESS` (헤르메스와 **별도 키** 권장 → 비용 따로 보임)
- 키가 없거나 호출 실패하면 → 버리지 말고 `review_status = 'needs_review'`로 저장, 화면에서 사람이 판단
- 하루 판정 건수 상한 (예: 30건) — 넘으면 나머지는 needs_review

---

## 7. ⑤ 저장

- **기존 `lib/pressIngest.ts` 재사용.** 헤르메스가 `/api/press/ingest`로 보내던 것과 같은 함수 호출.
- `source` 칸: `'collector:naver'` / `'collector:google'` (헤르메스 것은 기존 값 유지)
- 기자 추출: 기존 로직이 기사 원문에서 하던 방식 그대로. 원문을 못 열면 기자 정보 없이 저장.
- 홍보 실적(`business_promotions`) 연결도 기존 그대로.

**칸 추가 (승인 후, 추가만)**
```sql
alter table press_articles
  add column if not exists url_status    text default 'ok'
    check (url_status in ('ok','needs_check')),
  add column if not exists review_status text default 'auto'
    check (review_status in ('auto','needs_review','approved','rejected')),
  add column if not exists review_reason text;
```
- `needs_review` 기사는 **슬랙 공유·홍보 실적 집계에서 제외**, 사람이 승인하면 그때 반영

---

## 8. ⑥ 슬랙 공유

- 웹훅: `SLACK_WEBHOOK_14_PRESS` (헤르메스와 같은 값 → Vercel에 등록)
- **새로 저장된 `auto`/`approved` 기사만**
- 형식은 지금과 같게: 행사별 묶음, 언론사 링크 전부, 묶음기사는 "📌 지역 소식 묶음 기사"로 따로
- 새 기사 없으면 보내지 않음
- 슬랙에는 기사 외 아무것도 보내지 않음 (오류, 비용, 기자 정보 금지)

---

## 9. ⑦ 실행 기록 + 알림

**실행 기록 표 (승인 후)**
```sql
create table if not exists press_collect_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  naver_calls int default 0,
  google_calls int default 0,
  haiku_calls int default 0,
  found int default 0,          -- 검색 결과 수
  new_saved int default 0,      -- 새로 저장
  needs_review int default 0,
  url_needs_check int default 0,
  status text,                  -- 'ok' | 'partial' | 'failed'
  error text
);
alter table press_collect_runs enable row level security;
revoke all on press_collect_runs from anon, authenticated;
```
- `/press` 화면 위쪽에 "마지막 수집: 11/3 08:00 · 새 기사 2건 · 확인 필요 1건"

**관장 알림 (텔레그램, 슬랙 아님)**
- 수집 실패, 확인 필요 기사 생김 → 텔레그램 봇으로 한 줄
- 환경변수: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (관장 개인)
- 정상이고 새 기사만 있으면 알림 안 보냄 (헤르메스 아침 브리핑에 "언론 보도 N건"은 헤르메스가 동업자씨에서 읽어서 표시)

---

## 10. Vercel Cron 설정

`vercel.json`
```json
{ "crons": [{ "path": "/api/cron/press-collect", "schedule": "0 23 * * 0-4" }] }
```
- UTC 23:00 일~목 = **한국 시간 월~금 08:00**
- `/api/cron/press-collect`는 `Authorization: Bearer ${CRON_SECRET}` 확인 (Vercel이 자동으로 붙임). 없으면 401.
- 함수 실행 시간 제한 확인. 오래 걸리면 네이버/구글을 나눠 실행하거나 최대 실행 시간 설정.
- 수동 실행: `/press` 화면에 관장 전용 [지금 수집] 버튼 (같은 함수 호출)

---

## 11. 비용

| 항목 | 하루 예상 | 비용 |
|---|---|---|
| 네이버 API HUB | 검색어 8개 × 1~2페이지 ≈ 10~20회 | 지금 무료 (한도 하루 25,000회) |
| 구글 뉴스 RSS | 8회 | 무료 |
| Vercel Cron·함수 | 하루 1회 실행 | 현재 요금제 안 |
| Haiku 판정 | 애매한 기사 0~5건 | **하루 몇 원 수준, 월 1천 원 미만** |
| 슬랙·텔레그램 | | 무료 |

→ 헤르메스(Sonnet)로 하던 것보다 **훨씬 쌈.** Haiku 키는 별도 워크스페이스에 월 한도(예: $5) 걸어두기.

---

## 12. 옮기는 순서

1. **[관장]** Vercel 환경변수 등록: `NAVER_API_HUB_ID`, `NAVER_API_HUB_KEY`, `SLACK_WEBHOOK_14_PRESS`, `ANTHROPIC_API_KEY_PRESS`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `CRON_SECRET`
2. **[Claude Code]** 수집 모듈 작성 + 칸 추가·실행 기록 표 (DB는 승인 후)
3. **[Claude Code]** 시험 실행: **저장·슬랙 끄고** "찾은 결과만 보고"하는 드라이런 모드로 최근 7일 → 관장 확인
4. **[병행 1주]** 동업자씨 수집 켜고, 헤르메스 수집도 그대로. URL 중복은 자동으로 막힘. 둘이 찾은 것 비교
   - 슬랙은 **동업자씨 쪽만** 보내도록 (헤르메스 슬랙 공유는 이 단계에서 끔)
5. **[전환]** 차이 없으면 헤르메스 아침 브리핑에서 언론 보도 수집 부분 제거
   - 헤르메스는 동업자씨에서 "어제 새 기사 N건"만 읽어서 브리핑에 한 줄
6. **[나중]** 블로그·카페 주간 요약도 같은 방식으로 옮길지 결정

---

## 13. 완료 기준

- [ ] PC가 꺼져 있어도 평일 08:00에 수집 실행됨
- [ ] 같은 기사가 두 번 저장되지 않음 (헤르메스와 병행해도)
- [ ] 유사 기관 기사는 저장되지 않거나 `needs_review`로만 들어감
- [ ] 구글 주소 변환 실패해도 수집 전체는 계속됨, `needs_check` 표시
- [ ] 새 기사 없는 날 슬랙 조용함
- [ ] 슬랙에 기사 외 내용 안 감, 오류는 텔레그램으로만
- [ ] 키 값이 코드·로그·응답에 없음
- [ ] `CRON_SECRET` 없이 호출하면 401

## 14. 관장이 정할 것

- 수집 시각 (기본: 평일 08:00, 헤르메스 브리핑 08:30 전에)
- `needs_review` 기사 판단 담당자 (기본: 관장)
- 블로그·카페도 옮길지 (기본: 이번엔 뉴스만)

---

## 15. 관장 결정·구현 기록 (2026-11-03)

**판정 정책 (Haiku 프롬프트 `lib/pressCollect/filter.ts`에 반영)**
- 센터가 **장소로만** 언급된 기사(예: 순회상영 장소 목록 중 하나) → `ours=true, venue_only=true` → `needs_review`(저장하되 실적·슬랙 제외, 사람이 판단)
- **묶음기사**는 여러 기관·여러 소식을 모은 것만("부산 브리핑 모음", "동래구 소식", "[부산은 오늘]")
- 축제 예고처럼 **한 행사 기사 안에 우리 프로그램이 소개**된 것은 일반 기사(실적 반영)

**구글 주소 찾기 순서** — ① 네이버 제목 검색 → ② 리다이렉트 → ③ batchexecute 변환(`decodeGoogleNewsLink`, 비공식) → 실패하면 구글 주소 + `needs_check`

**백필** — 9월 1일 이후 승인 14건 저장(`scripts/press-collect-backfill.mts`, 슬랙·텔레그램 끔). 13건 auto(실적 8건 — 묶음 5건 제외), 베이비뉴스 1건 needs_review.

**E 구현**
- `ingestPressItem(item, { source, reviewStatus, reviewReason, urlStatus })` — 옵션 없으면 헤르메스와 동일
- `needs_review`: 기사 행만 → `/press` [승인] 때 원문 다시 읽어 기자·실적 연결 / [제외]는 숨김(행 유지, 되돌리기 가능)
- `needs_check`: `/press` [주소 고치기] → 기사·연결된 실적 주소 갱신, 기자 비어 있으면 새 주소에서 읽어 연결
- `/api/cron/press-collect` + `vercel.json` `0 23 * * 0-4`, `CRON_SECRET` 없으면 401
- 실행 잠금: 10분 안에 시작해 안 끝난 실행이 있으면 거절(크론·[지금 수집] 겹침 방지)
- 텔레그램: 실패·확인 필요·주소 확인·저장 실패가 있을 때만 한 줄
- 홈페이지 게시(`createHomepageDraft`)는 `auto`/`approved` 기사만
