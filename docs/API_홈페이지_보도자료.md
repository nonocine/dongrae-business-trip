# 동업자씨 → 동래구청소년센터 보도자료 API

운영 주소: `POST https://www.onnainna.kr/api/newsWrite`

기존 보도자료 게시판에 연결한다. 모든 작업은 POST이며 `action`으로 구분한다. UTF-8 JSON 또는 이미지 파일을 포함한 multipart/form-data를 받는다.

## 인증

`X-API-Key` 헤더에 별도로 전달받은 키를 넣는다. URL 파라미터로는 인증하지 않는다. 키는 동업자씨 **서버의 환경변수**에 보관한다. 브라우저 코드에 넣지 않는다.

- `live`: 이 키 범위에서 API로 만든 글의 등록·조회·수정·삭제, 공개 발행 가능.
- `test`: 별도 범위에서 비공개 글만 등록·수정 가능. `published` 요청은 403.
- 기존 관리자 수동 등록 글 및 상대 범위의 글에는 접근할 수 없다.
- 기존 대관 조회 API 키와 별개다.
- 사이트의 기존 User-Agent 차단 규칙 때문에 아래 예제처럼 `User-Agent: Mozilla/5.0`를 보낸다.

키 원문은 이 문서에 포함하지 않는다. 소유자에게 전달하는 별도 로컬 비밀 파일에 `live`, `test`로 발급했다.

## 등록: action=create

| 필드 | 필수 | 내용 |
| --- | --- | --- |
| action | O | `create` |
| external_id | O | 동업자씨의 고유 기사 ID. 영문·숫자·`_.:-`, 1~100자 |
| title | O | 제목 1~255자 |
| publisher | O | 언론사 1~100자 |
| reported_date | O | 실제 존재하는 날짜, `YYYY-MM-DD`, 연도 1900~9999 |
| source_url | O | `http://` 또는 `https://` 원문 주소, 1~2000자 |
| summary | O | 요약 1~4000자. 일반 텍스트이며 줄바꿈 가능 |
| status | 선택 | `draft` 기본값. 운영 키에 한해 `published` 가능 |
| image | 선택 | multipart 파일 하나. JPG/JPEG/PNG/GIF, 최대 2MiB(2,097,152바이트), 4천만 픽셀 |

JSON의 `no` 외에는 문자열을 사용한다. 길이는 UTF-16 단위이며 이모지는 보통 2자로 계산한다. 앞뒤 공백은 제거한다. HTML을 본문에 실행하지 않고 텍스트로 인코딩한다. 본문은 언론사·보도일·이미지·요약·원문 링크로 자동 구성한다.

등록 응답은 HTTP 201이며 실제 게시글 번호를 `no` 정수로 반환한다. `no=000`은 번호가 들어가는 URL 형태를 뜻하며 번호를 3자리로 제한하거나 0으로 채우지 않는다.

```json
{
  "ok": true,
  "no": 200,
  "external_id": "article-1234",
  "status": "draft",
  "title": "기사 제목",
  "publisher": "언론사명",
  "reported_date": "2026-11-02",
  "source_url": "https://example.com/news/1234",
  "summary": "기사 요약",
  "image_url": "/user_file/news/api/생성된파일명.jpg",
  "url": "https://www.onnainna.kr/community/news_board_view?no=200",
  "admin_url": "https://www.onnainna.kr/admin/news/edit?no=200"
}
```

위 번호와 경로는 설명용이다. 이미지가 없으면 `image_url`은 빈 문자열이며, 상대 경로에는 `https://www.onnainna.kr`를 붙인다.

비공개 글의 `url`은 404다. 관리자는 `admin_url`에서 확인하고 ‘공개 여부’를 변경할 수 있다. 비공개 글은 일반 목록·공지·검색·RSS에서 제외한다. 이미지 파일 주소 자체는 인증으로 보호하지 않으므로 비밀 자료 업로드 용도로 사용하지 않는다.

## 조회·수정·삭제

```json
{"action":"get","no":200}
```

조회는 HTTP 200과 등록 응답과 같은 필드를 반환한다.

```json
{"action":"update","no":200,"title":"수정 제목","summary":"수정 요약"}
```

수정은 보낸 필드만 바꾼다. `external_id`는 변경할 수 없다. 이미지를 보내지 않으면 기존 이미지를 유지하고, 새 파일을 보내면 교체한다. 빈 문자열로 필수 필드를 지우거나 이미지를 제거하는 동작은 지원하지 않는다. API 수정 시 본문은 저장된 구조화 정보로 다시 생성되므로 관리자에서 직접 바꾼 본문 HTML은 덮어쓸 수 있다.

운영 키로 공개 전환:

```json
{"action":"update","no":200,"status":"published"}
```

```json
{"action":"delete","no":200}
```

삭제는 기존 게시판과 같은 논리 삭제다. HTTP 200, `status:"deleted"`를 반환하며 다시 삭제해도 200이다. 삭제된 글 조회·수정은 404다. 기존 이미지 파일을 물리적으로 지우지 않는다.

## 중복·재시도

동일 키 범위의 `external_id`는 유일하다. DB 비교 규칙상 영문 대소문자를 구분하지 않는다. 동시에 같은 ID를 등록해도 한 건만 생긴다. 중복은 HTTP 409와 기존 `no`를 반환한다.

```json
{"ok":false,"error":"duplicate_external_id","message":"external_id already exists in this key scope.","no":200}
```

응답 유실·타임아웃이면 **같은 external_id**로 등록을 재시도한다. 409이면 반환된 `no`를 조회하여 결과를 확인하고, 내용을 바꾸려면 update를 사용한다. 삭제된 글도 external_id를 계속 점유하므로 새 글은 새 ID를 사용한다. test와 live는 ID 범위가 분리되어 같은 ID를 쓸 수 있다.

## 호출 예제

이미지 없는 JSON: `post.json`에 위 등록 필드를 UTF-8로 저장하고 호출한다. 아래 `ONNA_NEWS_API_KEY`는 전달받은 테스트 키를 환경변수에 설정했다고 가정한다.

```sh
curl 'https://www.onnainna.kr/api/newsWrite' \
  -A 'Mozilla/5.0' \
  -H "X-API-Key: $ONNA_NEWS_API_KEY" \
  -H 'Content-Type: application/json; charset=utf-8' \
  --data-binary @post.json
```

Node.js 서버의 기본 fetch/FormData로 이미지까지 전송하는 예제(동일 방식 운영 검증 완료):

```js
import { readFile } from 'node:fs/promises';

const form = new FormData();
const article = {
  action: 'create',
  external_id: 'article-1234',
  title: '기사 제목',
  publisher: '언론사명',
  reported_date: '2026-11-02',
  source_url: 'https://example.com/news/1234',
  summary: '첫째 줄\n둘째 줄',
  status: 'draft'
};
for (const [name, value] of Object.entries(article)) form.set(name, value);
form.set('image', new Blob([await readFile('./article.jpg')], {
  type: 'image/jpeg'
}), 'article.jpg');

const response = await fetch('https://www.onnainna.kr/api/newsWrite', {
  method: 'POST',
  headers: {
    'X-API-Key': process.env.ONNA_NEWS_API_KEY,
    'User-Agent': 'Mozilla/5.0'
  },
  body: form
});
const result = await response.json();
if (response.status === 409) {
  // 기존 result.no를 조회해서 저장 결과를 확인한다.
} else if (!response.ok) {
  throw new Error(`${response.status}: ${result.error}`);
}
// 성공 시 result.no를 동업자씨의 해당 기사와 연결해 저장한다.
```

FormData 전송 시 Content-Type을 직접 지정하지 않는다. 기존 DEXT 업로드 컴포넌트는 **boundary에 따옴표가 없고, 각 Content-Disposition의 name에는 따옴표가 있는 형식**을 처리한다. 기본 Node FormData는 이 형식이다. 일부 .NET/PowerShell 기본 multipart 생성 방식은 `400 invalid_multipart`가 발생하므로 이 두 헤더 형식을 맞춘다. JSON 최대 128KiB, multipart 전체 최대 2,228,224바이트다.

## 오류 응답

오류에는 `ok:false`, `error`, `message`가 있고, 일부 서버/업로드 오류에는 진단용 `reference`가 추가된다. DB 오류 내용이나 인증 키 원문은 반환하지 않는다.

| HTTP | 의미 |
| --- | --- |
| 400 | 필드·날짜·URL·JSON·multipart 형식 오류 |
| 401 | API 키 없음 또는 불일치 |
| 403 | 테스트 키 공개 시도, HTTPS 미사용 |
| 404 | 없는 글·삭제된 글·해당 키 범위 밖의 글 |
| 405 | POST 외 메서드 |
| 409 | external_id 중복. 기존 no 포함 |
| 413 | JSON·multipart·이미지 크기 초과 |
| 415 | 지원하지 않는 Content-Type·이미지 확장자·실제 이미지가 아닌 파일 |
| 500 | 서버 처리 실패. 같은 external_id로 결과 확인/재시도 |

기존 웹서버 차단 규칙에서 거절되는 요청은 위 JSON 대신 서버 오류 화면을 받을 수 있다. 응답 상태와 Content-Type도 확인한다.

## 이번 범위 밖

기사 링크에서 제목·사진을 자동 추출하는 기능은 포함하지 않았다. 동업자씨에서 확보한 기사 정보와 이미지 파일을 위 API로 전송한다. 해당 기능이 추가로 필요하면 대상 언론사 사이트 및 가져오기 정책을 정한 뒤 별도 구현한다.
