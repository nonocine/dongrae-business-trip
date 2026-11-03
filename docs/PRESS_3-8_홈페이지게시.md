# 홈페이지 언론보도 게시 — PRESS_AUTOMATION 3-8 (추가분)

> 기존 docs/PRESS_AUTOMATION.md 는 덮어쓰지 말고, 이 내용을 3-8 항목으로 추가할 것.
> 실제 표 구조(press_articles 의 reporter_status, promotion_id, source, release_id 등)는 운영 DB 기준을 따른다. 아래 SQL은 초안.

### 3-8. 홈페이지 "언론보도" 게시판 등록 (API 확정)

- 현재: 홈페이지(onnainna.kr) 언론보도 게시판에 직원이 기사를 캡처해서 수동 등록
- 결정: 홈페이지 제작사(박준석 팀장)가 만든 **보도자료 API**로 동업자씨에서 등록
- API 상세 명세: **`docs/API_홈페이지_보도자료.md`** (박준석 팀장 제공 원문, 반드시 먼저 읽을 것)
- **헤르메스는 홈페이지에 직접 올리지 않는다.** 동업자씨에서 사람이 확인 후 버튼으로만.

**API 요약**
| 항목 | 내용 |
|---|---|
| 주소 | `POST https://www.onnainna.kr/api/newsWrite` (모든 작업 POST, `action`으로 구분) |
| 인증 | `X-API-Key` 헤더. **동업자씨 서버 환경변수에만**. 브라우저 코드 금지 |
| 필수 헤더 | `User-Agent: Mozilla/5.0` (사이트 차단 규칙 회피) |
| 키 종류 | `test` = 비공개 글만, `published` 불가 / `live` = 공개 발행 가능 |
| action | `create` / `get` / `update` / `delete` |
| 등록 필수 | `external_id`, `title`, `publisher`, `reported_date`(YYYY-MM-DD), `source_url`, `summary` |
| 선택 | `status`(기본 `draft`), `image`(multipart 파일 1개) |
| 이미지 | JPG/JPEG/PNG/GIF, **최대 2MiB**, 4천만 픽셀 |
| 성공 | 201, `no`(게시글 번호), `url`, `admin_url`, `image_url` |
| 중복 | 같은 `external_id` → 409 + 기존 `no` |

**환경변수 (값은 관장이 직접 입력, 문서·코드·로그에 금지)**
```
ONNA_NEWS_API_KEY_TEST   # 개발·미리보기
ONNA_NEWS_API_KEY        # 운영(live)
```
- Vercel: Preview 환경에는 TEST 키만, Production에만 live 키
- 로컬 `.env.local`에는 TEST 키만

**동업자씨 쪽 구현**

1. `press_articles`에 칸 추가
   ```sql
   alter table press_articles
     add column if not exists homepage_no int,              -- 홈페이지 게시글 번호
     add column if not exists homepage_status text,         -- 'draft' | 'published' | 'deleted'
     add column if not exists homepage_summary text,        -- 홈페이지용 요약(직원이 다듬음)
     add column if not exists homepage_image_path text,     -- 동업자씨 저장소에 보관한 대표 이미지
     add column if not exists homepage_posted_at timestamptz,
     add column if not exists homepage_error text;
   ```
2. `external_id` = `press_articles.id` (uuid 그대로, 규칙 `영문·숫자·_.:-` 충족)
   - test와 live는 ID 범위가 분리됨 → 같은 uuid 써도 됨
   - 삭제된 글도 ID를 계속 점유 → 지운 뒤 다시 올릴 땐 `{id}-r2` 처럼 새 ID
3. **대표 이미지는 동업자씨가 준비** (API는 링크에서 사진을 뽑아주지 않음)
   - 기사 페이지의 `og:image` 주소를 찾아 내려받기 → 동업자씨 스토리지에 보관
   - **2MiB 이하 JPG로 변환·축소** 후 전송 (WebP 등은 거절됨, 415)
   - 대표 이미지 없으면 직원이 센터 사진 선택, 그것도 없으면 이미지 없이 등록
4. 화면 흐름 (기사 상세 또는 "홈페이지 게시 대기" 목록)
   ```
   [게시 대기] 기사 확인 → 요약 다듬기 → 대표 이미지 확인/교체
     → [홈페이지 비공개 등록] create, status=draft → no·admin_url 저장
     → admin_url로 실제 모양 확인
     → [공개 전환] update, status=published
     → [수정] update(보낸 필드만 변경) / [내리기] delete
   ```
   - 첫 등록은 항상 `draft`. 공개는 따로 버튼.
   - 공개 전환·삭제는 관장·부장 등 권한자만
5. 호출 규칙
   - **서버 코드에서만** 호출 (Next.js 서버 액션 또는 API 라우트)
   - 이미지 포함 시 Node 기본 `FormData` 사용, **Content-Type 직접 지정 금지** (지정하면 400 invalid_multipart)
   - JSON 최대 128KiB, multipart 전체 최대 2,228,224바이트
   - 응답 Content-Type이 JSON이 아니면 서버 차단 화면으로 보고 오류 처리
6. 오류·재시도
   | 응답 | 처리 |
   |---|---|
   | 201 | `no`, `status` 저장 |
   | 409 | 반환된 `no`로 `get` 호출해 확인 → 저장. 내용 다르면 `update` |
   | 타임아웃·500 | **같은 external_id로** 재시도 → 409면 위와 같이 |
   | 400/413/415 | `homepage_error`에 기록, 화면에 사유 표시 (재시도 안 함) |
   | 401/403 | 키 설정 문제, 관장에게 알림 |
7. 주의
   - API로 수정하면 홈페이지 본문이 다시 만들어짐 → 관리자 화면에서 손으로 고친 본문은 덮어씀. **수정은 동업자씨에서만** 하도록 직원 안내
   - 홈페이지 이미지 주소는 인증 없이 열림 → 기사 대표 이미지 외 내부 자료 올리지 않기
   - 이 API는 API로 만든 글만 다룸. 예전에 손으로 올린 글은 못 건드림

**테스트 순서**
1. TEST 키로 이미지 없는 `create` → 201, `admin_url`에서 비공개 글 확인
2. 같은 `external_id`로 다시 `create` → 409, 기존 `no` 반환 확인
3. 이미지 포함 `create` → 이미지 표시 확인
4. `update`로 요약 수정 → 반영 확인
5. TEST 키로 `published` 시도 → 403 확인
6. `delete` → 200, 다시 `get` → 404 확인
7. 모두 통과 후 Production에 live 키 설정, 실제 기사 1건 draft → 공개

