# E2E 테스트 (Playwright)

브라우저 레벨에서 채용 흐름을 검증합니다.

## 실행

```bash
npx playwright install chromium   # 최초 1회 (브라우저 바이너리)
npm run test:e2e                  # 헤드리스 실행
npm run test:e2e:ui               # UI 모드(디버깅)
```

`playwright.config.ts` 의 `webServer` 가 `npm run dev` 를 자동 기동하며, 이미 떠 있는
3000 포트 서버가 있으면 재사용합니다. 라이브 Supabase 데이터를 사용하므로 CI 보다는
로컬 검증용입니다.

## 환경변수 (`.env.local`, 저장소 미커밋)

| 변수 | 용도 | 기본값 |
|------|------|--------|
| `E2E_HR_NAME` | 관장·부장 직원 이름. HR 세션 쿠키(`dongrae_employee`)를 **서명해서** 심어 인증이 필요한 페이지를 테스트. **미설정 시 HR 테스트는 자동 skip.** | (없음) |
| `E2E_SLUG` | 테스트 대상 채용공고 slug | `2026-1` |
| `SESSION_SECRET` | 세션 쿠키 HMAC 서명 키(SEC-3a). **필수** — 없으면 테스트가 세션을 만들 수 없습니다. | (없음) |

직원 실명을 저장소에 남기지 않기 위해 `.env.local`(gitignore 대상)에서만 읽습니다.

## 세션 쿠키 (SEC-3a 이후)

세션 쿠키는 HMAC 서명본만 유효합니다. 평문 JSON·이름 평문을 심는 예전 방식은
서버가 거부하므로, 테스트는 `e2e/helpers.ts` 의 헬퍼로 실제 로그인과 동일하게
서명된 쿠키를 심습니다.

```ts
import { setGoogleSession, setEmployeeSession } from "./helpers";

await setGoogleSession(context, baseURL, { email: "x@onnainna.kr", rank: "관장" });
await setEmployeeSession(context, baseURL, "홍길동");
```

두 헬퍼 모두 `lib/signedCookie.ts` 의 `signPayload` 를 그대로 사용하며, 서명 키는
`playwright.config.ts` 가 `.env.local` 에서 읽어 `process.env` 로 주입합니다.

## 커버리지

- `public-pages.spec.ts` — 무인증 공개 페이지(공고/지원/면접 진입)가 브라우저에서
  하이드레이션 에러 없이 마운트되는지. (lint 리팩터한 클라이언트 컴포넌트 회귀 감지)
- `recruitment-docs.spec.ts` — HR 세션으로 문서 4종(ERP xlsx, 서류/최종/면접 docx)을
  실제 다운로드하고 확장자를 검증. 채용 관리 탭의 공고·상태 배지 렌더, 심사 대시보드
  하이드레이션 무에러(접수일시 포맷) 확인.

## 날짜/시간 포맷 주의

클라이언트 컴포넌트에서 시각을 렌더할 때 `Date#toLocaleString` 은 서버/브라우저 ICU
차이로 하이드레이션 mismatch(오후 vs PM, 공백 vs NBSP)를 일으킵니다. 대신 결정적
포맷터 `lib/datetime.ts`(`fmtKstDateTime`/`fmtKstDate`)를 사용하세요.
