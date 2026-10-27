# 활동 사진·영수증 공개 URL 문제 — 영향 범위 메모

> 2026-10-27 조사. 이번 작업(모바일 점검)에서는 손대지 않음 — 다음 작업으로 진행 예정.

## 문제

활동에 올린 사진·영수증·수료증은 **공개(public) 버킷**에 올라가고, DB 에는
`getPublicUrl` 로 만든 **영구 공개 URL** 이 그대로 저장됩니다
(`app/actions.ts` `uploadFiles`). URL 만 알면 로그인 없이 누구나 열 수 있습니다.
파일 이름은 `시각_무작위8자.확장자` 라 추측은 어렵지만, URL 이 메신저·메일 등으로
한 번 퍼지면 회수할 방법이 없습니다.

HR 문서(`hr-documents`)는 이미 비공개 버킷 + 1시간 서명 URL(`signHrDocument`) 방식이라
같은 방식으로 맞추면 됩니다.

## 버킷

| 버킷 | 공개 여부 | 넣는 것 | 기존 파일 수(2026-10-27 운영) |
|---|---|---|---|
| `trip-photos` | public | 활동 사진 | 1개(약 3.3MB, 2026-09-18) |
| `trip-receipts` | public | 영수증·수료증 | 0개 |

운영 `activities` 2건 중 사진 있는 활동 1건, 영수증·수료증 있는 활동 0건.
(`business_trips` 표는 운영 DB 에 없음 — 아래 "출장일지" 참고)

## 관련 기능(코드 위치)

- 올리기: `uploadFiles(bucket, files)` — `app/actions.ts`
  - 출장일지 작성 `createBusinessTrip` (사진·영수증)
  - 활동 작성 `createActivity` (사진·영수증·수료증)
  - 활동 수정 `updateActivity` (새로 올린 사진·영수증·수료증)
- 지우기: `deleteActivity`, `updateActivity`(뺀 사진) — `extractStorageKey(url, bucket)` 로
  공개 URL 에서 경로를 뽑아 지움. 비공개로 바꾸면 DB 에 경로만 저장하도록 같이 바꿔야 함.
- 보여주기: `ActivityDetail`(사진·영수증 표시, 보고서 출력), `ActivityForm`(수정 시 기존 사진).
  엑셀보내기(`app/api/export/route.ts`)에는 사진·영수증 칸이 없음.
- 점검 스크립트: `scripts/verify-storage-access.ts` 가 두 버킷의 "업로드→공개 URL 열기"를 검사함
  — 비공개 전환 시 검사 내용도 바꿔야 함.

## 출장일지(business_trips)

`listBusinessTrips`·`getBusinessTrip`·`createBusinessTrip`·`/trips/[id]` 가 `business_trips` 표를
쓰지만 운영 DB 에 이 표가 없습니다. 예전 기능의 잔재로 보이며, 정리 여부를 함께 판단.

## 다음 작업 순서(안)

1. 저장 형식: 새로 올리는 파일은 URL 대신 버킷 안 경로만 저장(기존 공개 URL 은 읽을 때 경로로 변환).
2. 보여줄 때 서명 URL(예: 1시간) 발급 — 활동 상세 권한(작성자 본인 + 관장·부장·master)과 같은 기준.
3. 기존 파일 1개 경로 변환 후 두 버킷을 private 로 전환.
4. `scripts/verify-storage-access.ts -- --locked` 로 anon 접근이 막혔는지 확인.
