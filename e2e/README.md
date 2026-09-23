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
| `E2E_FORWARD_TO` | **실제로 메일을 보낼 주소.** 설정했을 때만 `mail-send.spec.ts` 의 마지막 테스트가 진짜 전달 1건을 발송합니다. **미설정 시 skip.** | (없음) |
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

## 공용 메일함 — 실제 발송 검증 (1단계)

메일은 한 번 나가면 되돌릴 수 없으므로 **기본적으로 보내지 않습니다.** 보내지 않고
확인할 수 있는 것(한글 첨부 파일명 인코딩·제목 접두사·인용 형태·첨부 상한)은
네트워크 없이 MIME 만 만들어 검사합니다.

```bash
npm run test:forward      # scripts/test-mail-forward.ts — 발송 없음
```

진짜로 한 통 보내 **받는 쪽에 원본 한글 파일명으로 도착하는지**까지 확인하려면
받을 주소를 직접 주고 실행합니다.

```bash
E2E_FORWARD_TO=본인주소@example.com npx playwright test e2e/mail-send.spec.ts
```

> ⚠️ **로컬 `.env.local` 에는 네이버 발신 자격증명이 없습니다.**
> `NAVER_POP_USER` / `NAVER_POP_PASSWORD` 가 없으면 폼에 "발신 설정이 없어 보낼 수
> 없습니다" 가 뜨고 보내기 버튼이 막힙니다(운영 Vercel 에만 등록돼 있음).
> 그러므로 실제 발송 검증은 둘 중 하나로 합니다.
>   1) `.env.local` 에 두 값을 넣고 위 명령을 실행
>   2) 배포한 뒤 `/mail` 화면에서 직접 한 통 전달해 보기
>
> 확인할 것: 받은 메일의 첨부 파일명이 `1-26105.hwp` 가 아니라
> `수정 26년 10월 5학년 … 양식.hwp` 처럼 원본 그대로인지.

## /hr 접근 게이트 검증 (hr-access.spec.ts)

`/hr` 은 2026-09 부터 직급이 아니라 **직무·권한등급**으로 엽니다. 문을 넓히는
변경이라 "누가 들어오는가" 를 화면에서 직접 확인합니다. 대상은 운영 DB 의 실제
직원이라 이름을 저장소에 박지 않고 환경변수로 받습니다(없으면 skip).

| 변수 | 넣을 사람 | 기대 동작 |
|------|-----------|-----------|
| `E2E_HR_M0` | 관장·부장 등 M0 | 인사·채용 탭 모두 |
| `E2E_HR_RECORDS` | `hr` 직무만 가진 직원 | 인사만, 채용 라우트는 "/" 로 차단 |
| `E2E_HR_NONE` | 직무가 없는 일반 직원 | 전부 차단 |

```bash
E2E_HR_M0=홍길동 E2E_HR_RECORDS=김아무 E2E_HR_NONE=이아무 \
  npx playwright test e2e/hr-access.spec.ts
```

## PC 좌측 사이드바 검증 (sidebar.spec.ts)

`/hr` 접근 게이트와 같은 환경변수를 씁니다(없으면 skip). 사이드바 항목은
`lib/menu.ts` 의 권한 조건으로 걸러지므로, 권한별로 무엇이 보이는지가 곧
"어디에 들어갈 수 있는지" 입니다.

```bash
E2E_HR_M0=홍길동 E2E_HR_RECORDS=김아무 E2E_HR_NONE=이아무 \
  npx playwright test e2e/sidebar.spec.ts
```

확인하는 것: 1280px 노출 + 14개 화면의 현재 위치 하이라이트(쿼리가 갈리는
`/hr?tab=…` 포함), 클릭 시 전체 새로고침 없이 본문만 교체, md 경계(767/768)
전환과 되돌리기, 폰에서 햄버거 유지, 비로그인 랜딩에 껍데기 없음, 권한별 항목.

> 5단계부터 이 스펙은 폰 드로어까지 함께 봅니다. 핵심 단언은 **"권한별로 PC
> 사이드바와 폰 드로어의 항목이 완전히 같은가"** 입니다 — 하나라도 어긋나면
> 메뉴가 다시 두 곳에서 따로 사는 것입니다.

## 동아리 계획서 검증 (club-plan.spec.ts)

라이브 DB 에 실제로 쓰고, 끝에서 스스로 지웁니다(테스트가 남긴 회차·예산이
운영 화면에 쌓이면 안 됩니다). 대상 동아리는 환경변수로 받습니다.

| 변수 | 넣을 것 |
|------|---------|
| `E2E_CLUB` | 계획서를 넣어볼 동아리 이름. 데이터가 없는 곳이 안전합니다. |
| `E2E_CLUB_WITH_SESSIONS` | 회차가 이미 있는 동아리. "덮어쓰지 않고 이어서 편집되는가" 확인용. |

```bash
E2E_HR_NAME=홍길동 E2E_CLUB=뚜미즈 E2E_CLUB_WITH_SESSIONS=화양연화 \
  npx playwright test e2e/club-plan.spec.ts
```

## 강사·프로그램 관리 개방 검증 (saem-access.spec.ts)

`/hr/saems/*` 는 2026-09 부터 **로그인한 직원 전원**에게 열려 있습니다(동아리
관리와 같은 정책). 다만 계좌·주민번호·정산 금액·수강생 연락처는 기존 권한
(M0 또는 `saem` 직무)에만 남겼습니다. 여기서도 대상은 운영 DB 의 실제 직원이라
환경변수로 받습니다(없으면 skip).

| 변수 | 넣을 사람 | 기대 동작 |
|------|-----------|-----------|
| `E2E_SAEM_MANAGE` | M0 또는 `saem` 직무 | 지금까지처럼 전부 |
| `E2E_SAEM_VIEW` | `saem` 직무가 없는 직원 | 열람만 — 정산 탭·등록·엑셀 없음 |

```bash
E2E_SAEM_MANAGE=홍길동 E2E_SAEM_VIEW=이아무 \
  npx playwright test e2e/saem-access.spec.ts
```

확인하는 것: 열람자의 진입 성공과 정산 탭 부재, **응답 본문(RSC 페이로드)에
계좌번호·주민번호 앞자리가 실리지 않는지**, 강사 상세·정산에 주소를 직접 쳐도
목록으로 되돌려지는지, 프로그램·수강생·근무일지의 편집 버튼과 수강료·정산 방식
열이 없는지, 관리 권한자에게는 전부 그대로인지.

## 강사비 지출표 검증 (payouts.spec.ts)

`/hr/payouts` 는 회계 전용입니다(M0 또는 `accounting` 직무 — `/hr/salary` 와
같은 `resolveSalaryAccess` 게이트). 계좌번호와 지급 금액이 나오는 화면이라
"누가 못 들어오는가" 를 먼저 봅니다.

| 변수 | 넣을 사람 | 기대 동작 |
|------|-----------|-----------|
| `E2E_ACCT` | `accounting` 직무 또는 M0 | 화면·엑셀 모두 통과 |
| `E2E_ACCT_DENY` | 회계가 아닌 직원 | 화면은 "/" 로, 엑셀 라우트는 403 |

```bash
E2E_ACCT=홍길동 E2E_ACCT_DENY=김아무 \
  npx playwright test e2e/payouts.spec.ts
```

확인하는 것: 재원별↔사람별 전환, 여러 재원에 걸친 사람의 배지, 지급 전 확인
필요 목록이 결과 표보다 **위**에 오는지(이체하다 막히기 전에 보게), 엑셀
다운로드와 파일명, 그리고 회계가 아닌 직원의 차단(페이지 + 라우트 자체가드).

## 거래처 거래이력 검증 (partner-logs.spec.ts)

거래이력은 **등록은 거래처를 볼 수 있는 직원 누구나, 수정·삭제는 등록자 본인
또는 M0** 입니다(관장 결정 2026-08-25). 두 사람 모두 **M0 가 아니어야** 합니다 —
M0 는 남의 기록도 고칠 수 있어 차단 테스트가 성립하지 않습니다.

| 변수 | 넣을 사람 | 기대 동작 |
|------|-----------|-----------|
| `E2E_PARTNER_A` | 일반 직원 | 기록 등록·수정·삭제 가능 |
| `E2E_PARTNER_B` | 다른 일반 직원 | A 의 기록에는 버튼도 권한도 없음 |

```bash
E2E_PARTNER_A=홍길동 E2E_PARTNER_B=김아무 \
  npx playwright test e2e/partner-logs.spec.ts
```

⚠️ 이 스펙은 **라이브 DB 에 실제로 행을 만듭니다.** 내용 앞에 `[e2e]` 표식을
붙이고 `afterAll` 에서 그 표식이 붙은 행만 지웁니다. 비공개 테스트는 거래처
하나를 잠시 `is_private=true` 로 바꿨다가 `finally` 에서 원래대로 되돌립니다.

확인하는 것: 등록 시 날짜·내용·작성자·작성시각이 모두 채워지는지(작성자는
**서버가 세션 이름으로** 채우는지 DB 로 확인), 빈 내용 거부, 본인 기록의
수정·삭제가 DB 까지 반영되는지, 남의 기록에 버튼이 오지 않는지, 비공개 거래처의
이력이 일반 직원의 **응답 본문(RSC 페이로드)** 에 실리지 않는지, 그리고
**화면을 우회해도 서버가 거절하는지**(화면을 연 채 DB 에서 작성자를 남으로
바꾼 뒤 저장 → 거절 + DB 값 불변).
