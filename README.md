# 동업자씨

동래구청소년센터의 반복 업무를 한곳에서 처리하는 내부 업무 자동화 시스템입니다.

초기 차량·출장일지 앱에서 시작했지만 현재는 인사, 급여, 채용, 강사 관리,
사업실적, 시설, 공용메일, 문서 발급과 백업을 포함하는 내부 ERP로 운영됩니다.

> 이 저장소에는 직원·지원자·급여·거래처 등 민감정보를 다루는 코드가 있습니다.
> 운영 데이터, API 키, 서비스 계정 키와 개인정보를 저장소에 커밋하지 마세요.

## 주요 기능

- 직원 프로필, 인사기록, 권한, 증명서와 교육 관리
- 채용 공고, 지원 접수, 심사위원 배정과 채점 문서 생성
- 급여 기준표, 월 급여 계산, 급여대장과 명세서 발송
- 강사, 프로그램, 출석, 근무일지와 강사비 정산
- 사업실적, 홍보실적, 동전PAY와 종사자교육 집계
- 거래처·담당자와 명함 OCR 관리
- 시설·자산·안전점검 관리
- 공용메일 수집·분류·회신
- 외근·출장·교육·연수 통합 활동일지
- Google Drive 정기 백업과 Slack 알림

## 기술 구성

- Next.js 16 App Router, React 19, TypeScript
- Tailwind CSS 4
- Supabase PostgreSQL 및 Storage
- Vercel 배포와 Cron
- Google Workspace OAuth 및 서명된 HttpOnly 세션 쿠키
- ExcelJS, XLSX, DOCX, PDF 문서 생성
- Playwright E2E 테스트

## 주요 경로

| 경로 | 설명 |
| --- | --- |
| `/` | 공개 진입 화면 및 로그인 후 직원 대시보드 |
| `/activities` | 통합 활동일지 |
| `/new` | 활동 유형 선택 및 작성 |
| `/hr` | 인사·채용 관리 |
| `/hr/salary` | 급여 관리 |
| `/hr/saems` | 강사·프로그램·정산 관리 |
| `/hr/facility` | 시설·자산·안전점검 |
| `/hr/partners` | 거래처 관리 |
| `/business-results` | 사업실적 관리 |
| `/mail` | 공용메일함 |
| `/admin` | 관리자 대시보드 |

## 권한과 보안 경계

- 직원 로그인은 `onnainna.kr` Google Workspace 계정과 등록된 직원 프로필을
  함께 확인합니다.
- 마스터 계정과 권한 등급은 서버에서 판정합니다.
- 세션과 신뢰 기기 쿠키는 `SESSION_SECRET`으로 서명하며 HttpOnly로 발급합니다.
- 민감 테이블은 서버 전용 `SUPABASE_SERVICE_ROLE_KEY`로 접근합니다.
- `service_role`은 RLS를 우회하므로 모든 서버 액션과 라우트에서 별도의 권한
  검사가 필요합니다.
- 인사문서 등 민감 파일은 비공개 Storage와 시간제한 서명 URL을 사용합니다.

`NEXT_PUBLIC_` 환경변수는 브라우저에 전달됩니다. 비밀키에는 이 접두사를 절대
사용하지 마세요.

## 환경변수

`.env.local.example`을 복사해 로컬 `.env.local`을 만들고 필요한 값을 채웁니다.

```powershell
Copy-Item .env.local.example .env.local
```

핵심 환경변수:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SESSION_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
```

메일, Slack, Google Drive 백업 등 선택 기능의 환경변수는
`.env.local.example`의 설명을 따릅니다.

## 로컬 실행

```bash
npm install
npm run dev
```

기본 개발 주소는 `http://localhost:3000`입니다.

## 검증

```bash
npm run lint
npm run build
npm run test:e2e
```

도메인별 계산·문서 테스트는 `package.json`의 `test:*` 스크립트를 사용합니다.

## 데이터베이스 변경 원칙

`supabase/schema.sql`은 프로젝트 초기 구조를 남긴 참고자료이며 현재 운영 DB의
전체 기준 스키마가 아닙니다. 운영 환경이나 새 환경에 이 파일을 그대로 실행하지
마세요.

데이터베이스 변경은 다음 원칙을 지킵니다.

1. 운영 DB의 실제 구조와 기존 데이터를 먼저 확인합니다.
2. Supabase CLI로 이름이 명확한 마이그레이션을 생성합니다.
3. 공개 스키마의 모든 테이블은 RLS와 역할별 권한을 함께 검토합니다.
4. `anon` 또는 `authenticated` 권한을 부여할 때 행 단위 소유권 조건을 확인합니다.
5. 적용 전 백업하고, 적용 후 테스트 쿼리와 보안 Advisor를 확인합니다.

## 저장소 구조

```text
app/                    화면, Server Actions, Route Handlers
  business-results/     사업실적
  hr/                   인사·급여·채용·강사·시설·거래처
  api/auth/             Google·카카오 인증
  api/cron/             백업·메일·교육 알림
lib/                    도메인 계산, 권한, 문서 생성, 외부 연동
scripts/                계산·문서 회귀 테스트
supabase/migrations/    추적 가능한 DB 변경
supabase/schema.sql     초기 구조 참고자료
e2e/                    Playwright 시나리오
```

## 구형 출장일지 정리

초기의 독립 `business_trips` 화면과 서버 기능은 통합 `activities`로 대체되어
제거되었습니다. 통합 활동일지의 `business_trip` 유형, 차량 운행기록
`driving_logs`, 사진·영수증 Storage는 현재 기능에서 계속 사용합니다.

운영 DB의 구형 `business_trips` 데이터는 코드 배포와 동시에 삭제하지 않습니다.
백업과 보존기간을 확인한 뒤 익명 접근 권한을 먼저 회수하고, 별도 승인된
마이그레이션으로 보관 또는 폐기해야 합니다.
