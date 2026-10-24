# 보도자료·기자 리스트 자동화 — 동업자씨 연동 안내

> 이 문서는 **우리 동업자씨** 프로젝트에서 작업하는 Claude Code가 읽고 이해하기 위한 문서입니다.
> 센터 바깥에서 이미 돌아가고 있는 자동화(헤르메스)와, 앞으로 동업자씨에 만들 기능을 정리했습니다.
> 작성일: 2026-10-24 / 작성 맥락: 동래구청소년센터 관장(허일수)과 Claude의 작업 세션

---

## 1. 한눈에 보기

```
[헤르메스 에이전트 — 별도 PC에서 상시 실행]
 매일 08:30 아침 브리핑
  ├─ ① 언론 보도 검색 (네이버 API HUB + 구글 뉴스 RSS)
  │     └─ 새 기사 → 슬랙 #14_보도자료관련 (직원 공유)
  ├─ ② 공모사업·공지, 부산 위수탁 공고 수집 → 텔레그램 (관장 전용)
  └─ ③ (매주 월) 블로그·카페 언급 요약 → 텔레그램 (관장 전용)

[앞으로 만들 것 — 동업자씨]
  ④ 기사 원문에서 기자 이름·이메일 추출 (헤르메스)
  ⑤ 동업자씨 "보도자료 기자" 탭에 자동 추가·갱신 (전용 입구 Edge Function)
  ⑥ 연 1회 기자 감사 메일 초안 생성 (관장 확인 후 발송)
  ⑦ 언론 보도 실적을 동업자씨에 누적 (사업 실적·결과보고 활용)
```

**현재 상태:** ①②③은 헤르메스에서 동작 중. ④~⑦은 아직 없음 → **동업자씨 쪽 작업 대상**.

---

## 2. 이미 돌아가고 있는 것 (헤르메스)

### 2-1. 실행 환경
| 항목 | 내용 |
|---|---|
| 에이전트 | Hermes 데스크톱 앱 (Windows), 백그라운드 게이트웨이로 예약 작업 실행 |
| 모델 | Anthropic API (claude-sonnet-5) |
| 예약 | 매일 08:30 KST "아침 브리핑" 1개 |
| 설정 파일 | `%LOCALAPPDATA%\hermes\.env` |
| 작업 폴더 | `D:\hermes-test\` (수집 대상 목록, 보고서, 기자명단 테스트 파일) |
| 승인 방식 | Smart (안전한 명령은 자동, 위험한 명령만 확인) |
| 향후 | 전용 윈도우 미니PC로 이전 예정 |

### 2-2. 보고 채널 규칙 (반드시 지킬 것)
| 채널 | 대상 | 내용 |
|---|---|---|
| 텔레그램 `@nonocine_hermes_bot` | 관장 전용 | 공모사업, 위수탁 공고, 블로그·카페 언급, 작업 결과, 오류 |
| 슬랙 `#14_보도자료관련` | 직원 공유 | **언론 보도 기사만** (날짜·언론사·제목·링크) |

- 슬랙에는 기사 외 어떤 내용도 올리지 않음. 새 종류 내용은 관장 허락 후.
- 동업자씨에 기능을 추가해도 **이 구분은 유지**한다. (기자 명단·감사 메일은 관장 전용)

### 2-3. 언론 보도 검색 방식
**검색어 (정확히 일치, 따옴표 검색)**
- `"동래구청소년센터"`, `"동래구 청소년센터"`
- `"동래구청소년수련관"` — 센터 **예전 이름**. 블로그·카페에서 아직 많이 쓰임
- `"허일수 센터장"` — ("허일수 관장"은 기사에 안 쓰여서 제외)
- `"어울리고GO"`, `"동래읍성GO"` — 센터가 만든 AI 체험 앱
- `"조선놀이터"` — 동래읍성역사축제 체험 부스. **"동래"가 함께 나온 글만**
- `"사직동 청소년 자유공간"` — 신규 공간 조성 사업

**제외할 유사 명칭 기관** (본문 확인 후 제외)
- 동래구청소년상담복지센터, 동래구진로교육지원센터, 구덕청소년수련관 등

**정리 규칙**
- 같은 내용 기사는 한 묶음, 그 아래 **언론사 링크 전부** 나열 ("언론사 N곳")
- 묶음기사(브리핑 모음, 주요일정 등)는 "📌 지역 소식 묶음 기사"로 따로 표시
- 본문 복사 금지, 링크·요약만
- 이미 올린 기사는 `press_shared.json`에 기록 → 중복 게시 방지

**최근 3개월 기준 실제 건수 (2026-10-24 조사)**
| 뉴스 | 블로그 | 카페 |
|---|---|---|
| 17건 | 57건 | 77건 |

### 2-4. 네이버 검색 API (중요 — 방식이 바뀜)
- 네이버 개발자센터 검색 API는 **2026-07-31부터 신규 신청 불가**, 2027-06-30 종료.
- 현재 사용: **NAVER API HUB (네이버 클라우드 플랫폼)**
- 등록 앱: `dongnae-hermes` / 사용 API: **뉴스, 블로그, 카페**
- 한도: 하루 25,000회, 월 775,000회 (현재 한시적 무료, 유료 전환 시 사전 공지)
- 인증 헤더 (예전 개발자센터와 이름이 다름)
  ```
  X-NCP-APIGW-API-KEY-ID : Client ID
  X-NCP-APIGW-API-KEY    : Client Secret
  ```
- 호스트: `naverapihub.apigw.ntruss.com`
- 환경 변수 이름: `NAVER_API_HUB_ID`, `NAVER_API_HUB_KEY` (값은 문서·코드·로그에 절대 노출 금지)
- 요금은 **검색 호출 횟수** 기준. 결과 총 건수(total)와 무관.

### 2-5. 슬랙 연동
- 앱: 온나인나-Bot (A0BL6RH8CNS), 수신 웹훅
- 환경 변수: `SLACK_WEBHOOK_14_PRESS`
- 주의: 한글은 UTF-8로 전송. 웹훅으로 보낸 메시지는 봇이 삭제할 수 없음(사람이 직접 삭제).

---

## 3. 동업자씨에 만들 것

### 3-1. 기자 리스트 ("보도자료 기자" 탭)

**목적**
- 우리 센터 기사를 쓴 기자를 자동으로 모아 관리
- 새 보도자료 배포 명단으로 활용
- 연 1회 감사 메일 대상 선정

**데이터 흐름**
```
헤르메스: 새 기사 발견
  → 기사 원문 페이지 열기
  → 본문 끝 "홍길동 기자 hong@kookje.co.kr" 형태에서 이름·이메일 추출
  → 동업자씨 전용 입구(Edge Function)로 전송
동업자씨:
  → 처음 보는 기자 = 새로 추가
  → 이미 있는 기자 = 최근 기사·기사 수만 갱신
  → 관장이 직접 입력한 칸(메모, 전화 등)은 절대 덮어쓰지 않음
```

**추출 규칙 (헤르메스 쪽)**
- 이름·이메일을 못 찾으면 비워두고 "못 찾음" 표시. **추측해서 채우지 않음**.
- 언론사마다 표기 방식이 다르므로 이름만 있고 이메일이 없는 경우 허용.

### 3-2. 테이블 초안 (Supabase)

> 아래는 출발점입니다. 기존 동업자씨 스키마·네이밍 규칙에 맞춰 조정하세요.

```sql
-- 기자
create table press_reporters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,                         -- 없을 수 있음
  outlet text not null,               -- 언론사
  -- 자동 갱신 칸 (헤르메스가 씀)
  first_seen_at date,
  last_article_at date,
  last_article_title text,
  last_article_url text,
  article_count int default 0,
  -- 관장 수동 입력 칸 (자동 갱신이 절대 덮어쓰지 않음)
  phone text,
  beat text,                          -- 담당 분야
  memo text,
  receive_press_release boolean default true,  -- 보도자료 받기
  last_thanks_sent_at date,           -- 마지막 감사 메일
  -- 관리
  source text default 'hermes',       -- 'hermes' | 'manual'
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 중복 판정: 이메일 있으면 이메일, 없으면 (이름 + 언론사)
create unique index press_reporters_email_uniq
  on press_reporters (lower(email)) where email is not null;
create unique index press_reporters_name_outlet_uniq
  on press_reporters (name, outlet) where email is null;

-- 기사 (보도 실적 누적, 연도별 기자 순위 계산용)
create table press_articles (
  id uuid primary key default gen_random_uuid(),
  published_at date not null,
  outlet text not null,
  title text not null,
  url text not null unique,
  event_group text,                   -- 같은 내용 묶음 키 (예: '2026 동래읍성역사축제 AI 체험')
  is_roundup boolean default false,   -- 묶음기사 여부
  reporter_id uuid references press_reporters(id),
  created_at timestamptz default now()
);
```

- 연도별 기사 수는 `press_articles`에서 집계 (기자 표에 연도별 칸을 따로 두지 않음).
- RLS 활성화. 관장(관리자) 계정만 읽기·수정. 일반 직원 권한은 관장 결정에 따름.

### 3-3. 헤르메스 전용 입구 (Edge Function) — 보안 핵심

> **2026-10-24 구현 변경:** 입구는 Edge Function 이 아니라 동업자씨 Next.js API
> `POST /api/press/ingest` 로 만들었습니다(토큰은 Vercel 환경변수 `HERMES_INGEST_TOKEN`).
> 동작·요청 형식은 맨 끝 **"동업자씨 입구 사용법"** 이 기준입니다.

**원칙: 헤르메스에게 `service_role` 키를 주지 않는다.**
service_role이 있으면 직원 정보·실적 등 동업자씨 전체를 건드릴 수 있음.
대신 **기자·기사 추가/갱신만 가능한 함수 하나**를 만든다.

```
POST /functions/v1/press-ingest
Header: x-hermes-token: <HERMES_INGEST_TOKEN>   ← Supabase secret에 저장
Body:
{
  "article": { "published_at", "outlet", "title", "url", "event_group", "is_roundup" },
  "reporter": { "name", "email", "outlet" } | null
}
```

**함수 동작**
1. 토큰 불일치 → 401
2. 입력값 검증 (URL 형식, 이메일 형식, 길이 제한)
3. 기사 `url` 기준 upsert (이미 있으면 무시)
4. 기자 upsert — **자동 갱신 칸만 갱신**, 수동 입력 칸은 건드리지 않음
5. `article_count` 증가는 새 기사일 때만
6. 결과 반환: `{ article: "created|exists", reporter: "created|updated|skipped" }`

- 함수 내부에서만 service_role 사용 (함수 밖으로 키가 나가지 않음)
- 헤르메스 `.env`에는 `DONGEOPJA_INGEST_URL`, `HERMES_INGEST_TOKEN`만 저장

### 3-4. "보도자료 기자" 탭 화면
| 기능 | 설명 |
|---|---|
| 목록 | 이름, 언론사, 이메일, 올해 기사 수, 최근 기사일, 보도자료 받기 여부 |
| 정렬 | 올해 기사 수 많은 순 (기본) |
| 상세 | 해당 기자의 우리 센터 기사 전체 목록 (press_articles) |
| 수정 | 메모·전화·담당 분야·보도자료 받기 체크 (수동 칸만) |
| 표시 | 자동 추가 / 수동 추가 구분 배지, 출처(기사 링크) |
| 삭제 | 기자 요청 시 즉시 삭제 가능 |
| 내보내기 | 보도자료 배포용 이메일 목록 복사 (`receive_press_release = true`만) |

### 3-5. 연 1회 감사 메일
```
매년 12월 첫 주 (헤르메스 예약)
 ① 올해 우리 기사 3건 이상 쓴 기자 조회 (동업자씨)
 ② 기자별 맞춤 초안 작성 — 그 기자가 쓴 우리 기사 제목을 넣어서
 ③ 텔레그램으로 관장에게 "초안 N통 준비됨"
 ④ 관장 확인·수정 후 직접 발송 → last_thanks_sent_at 기록
```
- **자동 발송하지 않음.** 초안까지만.
- 같은 해 두 번 보내지 않도록 `last_thanks_sent_at` 확인.

---

## 4. 지켜야 할 것

### 보안
- `NAVER_API_HUB_*`, `SLACK_WEBHOOK_*`, `HERMES_INGEST_TOKEN`, Supabase 키는 코드·커밋·로그에 넣지 않음
- 헤르메스에는 service_role 금지. Edge Function 토큰만.
- 작업 PC의 app-guard 규칙 그대로 적용 (운영 DB 변경 전 확인, `.env` 커밋 차단 등)

### 개인정보
- 기자 이메일은 기사에 공개된 **업무용 연락처**. 보도자료 배포·감사 인사 목적으로만 사용.
- 출처(기사 링크) 보관. 기자 요청 시 바로 삭제.
- 기자 명단은 슬랙 공유 금지 (관장 전용).

### 청탁금지법
- 기자는 청탁금지법 적용 대상. 감사 메일·감사 카드는 문제없음.
- 선물·식사 동반 시 법정 한도 별도 확인 필요.

---

## 5. 작업 순서 (권장)

1. **[헤르메스]** 기자 추출 테스트 — 앱 연결 없이 `D:\hermes-test\기자명단.md`에 파일로만 저장, 정확도 확인
2. **[동업자씨]** 테이블 2개 + RLS 마이그레이션 (개발 DB 먼저)
3. **[동업자씨]** `press-ingest` Edge Function + 토큰 secret 설정
4. **[동업자씨]** "보도자료 기자" 탭 화면
5. **[연결]** 헤르메스 `.env`에 입구 URL·토큰 추가 → 1번 테스트 데이터로 시험 전송
6. **[헤르메스]** 매일 08:30 작업에 기자 전송 단계 추가, 텔레그램에 "새 기자 N명" 한 줄
7. **[헤르메스]** 12월 감사 메일 초안 예약 작업 등록

## 6. 완료 기준
- [ ] 같은 기사를 두 번 보내도 기사·기사 수가 늘지 않음
- [ ] 같은 기자 다른 기사 → 기자 1명, 기사 수만 증가
- [ ] 관장이 적은 메모가 자동 갱신 후에도 그대로 남음
- [ ] 잘못된 토큰으로 호출 시 401, DB 변화 없음
- [ ] 기자 정보 못 찾은 기사도 기사 자체는 저장됨
- [ ] 슬랙에는 기사만 올라가고 기자 정보는 안 올라감

## 7. 정해야 할 것 (관장 결정)
- 일반 직원에게 기자 탭을 보여줄지 (기본: 관장만)
- 감사 메일 기준 건수 (기본: 연 3건 이상)
- 블로그·카페 글도 동업자씨에 실적으로 쌓을지 (현재는 텔레그램 보고만)
- 동업자씨 기존 테이블·폴더 구조 → Claude Code가 `D:\projects` 안 동업자씨 프로젝트를 먼저 확인 후 맞출 것

---

## 8. 동업자씨 입구 사용법 (헤르메스 → 동업자씨)

> 2026-10-24 구현 기준. 3-3 의 Edge Function 대신 이 경로를 씁니다.

### 8-1. 설정
| 위치 | 이름 | 값 |
|---|---|---|
| Vercel (동업자씨) 환경변수 | `HERMES_INGEST_TOKEN` | 32자 이상 임의 문자열. 없거나 32자 미만이면 입구는 항상 401 |
| 헤르메스 `.env` | `DONGEOPJA_INGEST_URL` | `https://<동업자씨 주소>/api/press/ingest` |
| 헤르메스 `.env` | `HERMES_INGEST_TOKEN` | 위와 같은 값 |

- 토큰 값은 문서·코드·로그·슬랙·텔레그램에 쓰지 않습니다. 입구도 토큰을 로그·응답에 남기지 않습니다.
- 헤르메스에는 service_role 키를 주지 않습니다. 입구가 할 수 있는 일은 기사·기자 추가와 자동 칸 갱신, 언론보도 실적 1줄뿐입니다.

### 8-2. 요청
- `POST`, 헤더 `x-hermes-token: <TOKEN>`, `Content-Type: application/json; charset=utf-8`
- 단건: `{ "article": {...}, "reporter": {...} | null }`
- 여러 건: `{ "items": [ { "article", "reporter" }, ... ] }` — 최대 50건, 차례로 처리

| 칸 | 필수 | 규칙 |
|---|---|---|
| `article.published_at` | ✓ | `YYYY-MM-DD` 실제 날짜 |
| `article.outlet` | ✓ | 100자 이하 |
| `article.title` | ✓ | 500자 이하 |
| `article.url` | ✓ | http(s), 2000자 이하. **중복 판정 기준** |
| `article.event_group` | | 같은 내용 묶음 키, 200자 이하 |
| `article.is_roundup` | | true/false (기본 false). true 면 실적에 넣지 않음 |
| `reporter` | | 못 찾았으면 `null` (또는 이름·이메일 빈 값) |
| `reporter.name` | | 50자 이하. 없으면 기자를 만들지 않고 기사만 저장 |
| `reporter.email` | | 이메일 형식. **추측해서 채우지 말 것** |
| `reporter.outlet` | | 생략하면 `article.outlet` |

### 8-3. 입구가 하는 일
1. 토큰 불일치·미설정 → 401 (본문을 읽지 않음, DB 변화 없음)
2. 검증 실패 → 400 (단건) / 그 건만 `ok:false, status:400` (여러 건)
3. 같은 `url` 기사가 이미 있으면 `article:"exists"` — 기자·실적 모두 건너뜀(기사 수 안 늘어남)
4. 새 기사이고 묶음기사가 아니면 사업실적 홍보(`business_promotions`)에 `언론보도` 1줄(source `auto`, 작성자 `헤르메스 자동`). 같은 url 의 언론보도 행이 이미 있으면(수기 포함) 새로 만들지 않고 연결
5. 기자: 이메일(대소문자 무시) → 없으면 이름+언론사로 찾음
   - 찾으면 자동 칸만 갱신(기사 수 +1, 최근 기사, 처음 본 날). 수동 칸(메모·전화·담당 분야·보도자료 받기·감사 메일)은 절대 안 씀. 관장이 직접 넣은 기자도 동일
   - 이름·언론사가 같은데 이메일이 다르면 이메일은 그대로 두고 `pending_email` 로 보류 → 화면에 "이메일 변경 확인" 배지
   - 없으면 새 기자(source `hermes`)
6. `reporter_status`: 이메일까지 있으면 `found`, 이름만 `name_only`, 없으면 `not_found`

### 8-4. 응답
```json
{ "url": "https://...", "article": "created", "reporter": "created", "reporter_status": "found", "promotion": "created" }
```
- `article`: `created` | `exists`
- `reporter`: `created` | `updated` | `skipped`
- `promotion`: `created` | `linked` | `skipped` (묶음기사·이미 있던 기사)
- `pending_email: true` — 이메일 변경 확인으로 보류됨 (텔레그램 관장 보고에 한 줄 넣을 것)
- 여러 건: `{ "results": [ { "ok": true, ... } | { "ok": false, "status": 400|500, "error": "..." } ] }`
- 500 이면 그 건은 되돌려져 있으니 다음 실행에서 다시 보내면 됩니다.

### 8-5. PowerShell 예시 (헤르메스)
```powershell
# 토큰·주소는 .env 에서 읽은 값을 씁니다. 여기 <TOKEN> 자리에 직접 적지 마세요.
$uri     = $env:DONGEOPJA_INGEST_URL      # https://<동업자씨 주소>/api/press/ingest
$headers = @{ "x-hermes-token" = "<TOKEN>" }  # 실제로는 $env:HERMES_INGEST_TOKEN

# 1) 단건
$body = @{
  article = @{
    published_at = "2026-10-20"
    outlet       = "국제신문"
    title        = "동래구청소년센터, 동래읍성역사축제서 AI 체험 부스 운영"
    url          = "https://www.kookje.co.kr/news2011/asp/newsbody.asp?code=0300&key=20261020.99099000000"
    event_group  = "2026 동래읍성역사축제 AI 체험"
    is_roundup   = $false
  }
  reporter = @{ name = "홍길동"; email = "hong@kookje.co.kr"; outlet = "국제신문" }
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Method Post -Uri $uri -Headers $headers `
  -ContentType "application/json; charset=utf-8" `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($body))

# 2) 기자 못 찾은 기사 — reporter 는 $null
$body = @{
  article  = @{ published_at = "2026-10-21"; outlet = "부산일보"; title = "..."; url = "https://..." }
  reporter = $null
} | ConvertTo-Json -Depth 5

# 3) 여러 건 (최대 50건)
$items = @(
  @{ article = @{ published_at = "2026-10-21"; outlet = "부산일보"; title = "..."; url = "https://..."; is_roundup = $true }; reporter = $null },
  @{ article = @{ published_at = "2026-10-22"; outlet = "연합뉴스"; title = "..."; url = "https://..." }; reporter = @{ name = "김기자" } }
)
$body = @{ items = $items } | ConvertTo-Json -Depth 6
$res  = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers `
          -ContentType "application/json; charset=utf-8" `
          -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
$res.results | Format-Table ok, article, reporter, promotion, status, error
```
- 한글이 깨지지 않도록 본문은 반드시 UTF-8 바이트로 보냅니다(`[System.Text.Encoding]::UTF8.GetBytes`).
- 401 이 나오면 토큰 값·Vercel 환경변수 설정(32자 이상, 재배포)을 확인합니다. 응답·로그에 토큰을 찍지 마세요.
