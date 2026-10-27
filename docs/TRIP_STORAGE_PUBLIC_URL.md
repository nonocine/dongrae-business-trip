# 첨부 버킷 4개 공개 URL → 비공개 전환

> 2026-10-27 조사 시작, 같은 날 코드 준비 완료(0단계). 버킷 설정(비공개 전환)은 배포 뒤 따로 진행.

## 문제

아래 4개 버킷은 **공개(public) 버킷**이고, DB 에 `getPublicUrl` 로 만든 **영구 공개 URL** 이 저장돼
있었습니다. URL 만 알면 로그인 없이 누구나 열 수 있고, 메신저·메일로 한 번 퍼지면 회수할 수 없습니다.

## 대상 버킷 (같은 Supabase 프로젝트)

| 버킷 | 앱 | 넣는 것 | DB 칸 | 운영 값(2026-10-27) |
|---|---|---|---|---|
| `trip-photos` | 동업자씨 | 활동 사진 | `activities.photos` | 1개(활동 1건) |
| `trip-receipts` | 동업자씨 | 영수증·수료증·교육자료 | `activities.receipts`·`certificate` | 0개 |
| `report-photos` | byct-stamp-tour | 기관 현장 사진(기관별 결과보고) | `center_reports.photo_urls` | 28장(기관 6곳) |
| `program-plans` | byct-stamp-tour | 프로그램 계획서 PDF·전체 계획서 PDF | `programs.plan_pdf_url`·`global_plans.pdf_url` | DB 22건 / 저장소 파일 26개(4개는 DB 에서 안 가리킴) |

운영 DB 의 위 값은 전부 공개 URL 문자열이었고(경로로 저장된 값 0건), 51개 모두 경로로 변환해
서명 URL 로 실제 파일이 열리는 것을 확인했습니다(읽기 전용 점검).

**바꾸지 않는 버킷**: `program-images`(byct 프로그램 대표 이미지) — 참가자용 프로그램 목록 `/programs`
(관리자 로그인 없이 보는 화면)에 나오므로 공개 유지. `org-logos`(byct 기관 로고)도 이번 범위 밖.

## 바뀐 방식

1. **저장**: 새로 올리는 파일은 공개 URL 대신 **버킷 안 경로**만 DB 에 저장.
   예전에 저장된 공개 URL 은 읽을 때 경로로 바꿔 씀 — DB 를 고쳐 쓰지 않음.
   - 동업자씨 `lib/tripStorage.ts` `tripRefPath` / byct `lib/storageRef.ts` `storageRefPath`
2. **보기**: 화면은 공개 URL 대신 앱의 열람 경로로 엶. 그 경로가 로그인·권한을 확인한 뒤
   **1시간 서명 URL** 로 넘겨 줌(링크를 누를 때마다 새로 발급).
   - 동업자씨 `GET /api/activity-file?id=&bucket=&ref=` — 활동 보기 권한(작성자 본인 + 관장·부장·master),
     그 활동에 실제로 붙은 파일만
   - byct `GET /api/admin/storage-file?bucket=&ref=` — 관리자 서명 쿠키 필수, 현장 사진은 기관 권한
     (슈퍼 전체 / 센터 본인 기관, 경로 첫 칸 = 기관 id)
3. **보고서 첨부**: PDF·Word 에 사진을 넣는 곳은 같은 경로에 `raw=1` — 서버가 직접 내려받은 바이트를
   돌려줌(같은 출처라 PDF 캡처에도 그대로 들어감).
   - 동업자씨 활동 보고서 PDF(`ActivityPdfReport`) 사진
   - byct 기관별 결과보고 Word(`downloadReportAsDocx`) 현장 사진
4. **지우기**: 저장된 값(경로·예전 URL) 모두 경로로 바꿔 지움.

남는 점: byct 통합 보고서 본문의 "전체 계획서 PDF 보기" 링크는 앱 열람 경로(절대 주소)라
Word 로 받은 문서를 연 사람도 관리자 로그인이 있어야 열림(예전엔 누구나 열리는 공개 링크).

## 관련 코드

- 동업자씨: `app/actions.ts` `uploadFiles`·`extractStorageKey`, `app/api/activity-file/route.ts`,
  `app/(app)/activities/[id]/ActivityDetail.tsx`(사진·영수증 갤러리), `app/(app)/new/[kind]/ActivityForm.tsx`
  (수정 시 기존 첨부), `app/components/ActivityPdfReport.tsx`
- byct: `app/api/admin/storage-file/route.ts`, `app/api/admin/report-photos/route.ts`,
  `app/api/admin/programs/plan/route.ts`, `app/api/admin/global-plans/route.ts`,
  `app/api/admin/center-report/route.ts`(본인 기관 폴더 사진만 저장), `components/CenterOpinionSection.tsx`,
  `components/ReportManager.tsx`, `app/admin/tabs/ProgramTab.tsx`·`ReportTab.tsx`, `lib/reportGenerator.ts`
- 출장일지(`business_trips`): 운영 DB 에 표가 없는 예전 기능 잔재 — `/trips/[id]`·`TripPdfReport` 는
  손대지 않음(공개 URL 그대로 표시하는 코드지만 실제 데이터 없음). 정리 여부는 따로 판단.

## 전환 순서

1. 두 앱 배포(동업자씨 main, byct master).
2. 4개 버킷을 private 로 전환(Supabase 설정 — 코드 작업 범위 밖, 배포 확인 뒤 따로 진행).
3. `npx tsx scripts/verify-storage-access.ts --private` — 4개 버킷 모두 "서명 URL 열림 / 공개 URL 막힘".
   (시험 파일 `__selftest_*.png` 를 올렸다가 바로 지움)
4. 아래 화면 확인.

## 전환 후 확인할 화면

동업자씨(로그인 상태)
- 사진이 있는 활동의 상세 `/activities/<id>` — 사진 썸네일 표시, 눌러서 원본 열림
- 같은 활동 [PDF 보고서] — 사진이 PDF 에 들어감
- 같은 활동 수정 `/activities/<id>/edit` — 기존 사진 미리보기, 영수증·수료증 링크 열림
- 새 활동 작성 `/new/<종류>` 에서 사진·영수증 올리기 → 상세에서 보임
- 관장·부장 계정으로 다른 사람 활동 상세(보기 전용) — 사진 보임 / 일반 직원은 남의 활동 첨부 403

byct-stamp-tour `/admin`(관리자 로그인 상태)
- 보고서 탭 → 기관 선택 → "담당지도자 종합의견"의 현장 사진 썸네일(센터 관리자·슈퍼 각각)
- 같은 화면 기관별 보고서 [Word 다운로드] — "현장 사진" 부분에 사진 들어감
- 센터 관리자로 현장 사진 추가·삭제
- 프로그램 탭 → 계획서 있는 프로그램 [PDF 보기] 열림, [PDF 변경]·삭제
- 보고서 탭 → 전체 계획서 [보기](슈퍼, 현재 0건) / 통합 보고서 본문 "PDF 보기" 링크
- 참가자 화면 `/programs` 대표 이미지(program-images, 공개 유지) 그대로 보이는지
