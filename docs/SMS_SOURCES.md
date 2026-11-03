# 문자 발송 — 받는 사람 출처 · 발송 수단 추가 방법

`/sms` 화면은 **등록표**만 보고 카드를 그립니다. 출처(받는 사람 명단)나 발송 수단을 더할 때 화면 코드는 고치지 않습니다.

```
lib/sms/
  sources/            받는 사람 출처 — 1개 = 파일 1개
    types.ts          출처 인터페이스(SmsSource)
    index.ts          ★ 출처 등록표 (여기에 한 줄)
    bk-guardians.ts   ① 방과후아카데미 보호자
    saem-academy.ts   ② 동래미래아카데미
    instructors.ts    ③ 강사
    employees.ts      ④ 직원
    partners.ts       ⑤ 거래처
    reporters.ts      ⑥ 기자
    groups.ts         ⑦ 주소록(공유 그룹)
    manual.ts         ⑧ 직접·붙여넣기
  channels/           발송 수단 — 1개 = 파일 1개
    types.ts          발송 수단 인터페이스(SmsChannel)
    index.ts          ★ 발송 수단 등록표 (여기에 한 줄)
    sms.ts            문자(SMS/LMS)
  recipients.ts       담긴 명단 → 번호 계산(중복·번호 없음·개별 빼기)
  relay.ts            문자 중계 서버(sms-relay) 호출
  text.ts             화면·서버 공용 상수·타입(수신거부 번호 SMS_OPTOUT_NUMBER 등)
app/(app)/sms/pickers/ 선택기 종류(pickerType)별 공용 화면
```

## 보안 원칙 (꼭 지키기)

- `loadOptions` 는 **화면으로 나갑니다** → 이름·소속·`hasPhone`(번호 있음 여부)만. **전화번호를 넣지 마세요.**
- 번호는 `resolvePhones` / `resolveRefs` 에서만 꺼냅니다. 이 둘은 서버(미리보기·발송·주소록 저장)에서만 불립니다.
- `canUse(user)` 는 그 명단을 원래 볼 수 있는 사람 기준과 같게 맞춥니다(예: 강사 연락처 → M0 또는 saem 직무).
- 번호를 로그·콘솔·DB 에 남기지 않습니다(발송 이력엔 인원 수와 출처 요약만).

---

## 1. 새 출처 추가하기

"○○ 출처 추가해줘" 라고 하면 아래 3단계를 합니다.

### ① 파일 만들기 — `lib/sms/sources/○○.ts`

예: 오케스트라 단원 보호자(가상의 `orchestra_members` 표).

```ts
// 출처 — 오케스트라 단원 보호자. 사용: M0 또는 saem 직무.
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isValidSmsPhone, normalizeSmsPhone } from "@/lib/sms/text";
import { idsOf, inChunks, str, type SmsSource } from "./types";

type Row = { id: string; name: string; part: string | null; guardian_phone: string | null };

export const orchestraSource: SmsSource = {
  key: "orchestra",              // 고유값 — 주소록 참조에 저장되니 나중에 바꾸지 않기
  label: "오케스트라",            // 카드 이름
  icon: "🎻",
  description: "단원 보호자",     // 카드 보조설명
  pickerType: "list",            // 기존 선택기를 쓰면 화면 수정 0
  color: "green",                // 담긴 명단 칩 색: blue | green | amber | violet
  canUse: (u) => u.isM0 || u.roles.includes("saem"),

  // 화면 목록 — 번호 없이 hasPhone 만
  async loadOptions(_u, { filter }) {
    const { data } = await supabaseAdmin.from("orchestra_members").select("id, name, part, guardian_phone");
    const rows = (data ?? []) as Row[];
    const part = filter.part ?? "all";
    return {
      filters: [{
        key: "part", label: "파트", kind: "select", value: part,
        options: [{ value: "all", label: "전체" }, { value: "현악", label: "현악" }, { value: "관악", label: "관악" }],
      }],
      bulkLabel: "보이는 단원 전체 담기",
      items: rows
        .filter((r) => part === "all" || r.part === part)
        .map((r) => ({
          id: r.id,
          name: r.name,
          sub: r.part ?? undefined,
          hasPhone: isValidSmsPhone(normalizeSmsPhone(r.guardian_phone ?? "")),
        })),
    };
  },

  // 선택값 → 사람(번호 포함). 서버에서만 불림
  async resolvePhones(_u, sel) {
    const rows = await inChunks(idsOf(sel), async (chunk) => {
      const { data } = await supabaseAdmin.from("orchestra_members").select("id, name, guardian_phone").in("id", chunk);
      return (data ?? []) as Row[];
    });
    return {
      label: `오케스트라 ${rows.length}명`,   // 칩 문구
      short: "오케스트라",                    // 이력 요약("오케스트라 12 + 강사 3")
      people: rows.map((r) => ({
        key: `orchestra:${r.id}`,             // 개별 빼기용 — 출처 안에서 고유
        name: `${r.name} 보호자`,
        phone: r.guardian_phone,              // 숫자만 아니어도 됨(공용 코드가 정규화)
        ref: { source: "orchestra", ref_id: r.id, phone: null },  // 주소록엔 참조만 저장
      })),
    };
  },

  // 주소록에 저장된 참조 → 최신 이름·번호(주소록 발송 때). DB 출처면 꼭 구현
  async resolveRefs(ids) {
    const rows = await inChunks(ids, async (chunk) => {
      const { data } = await supabaseAdmin.from("orchestra_members").select("id, name, guardian_phone").in("id", chunk);
      return (data ?? []) as Row[];
    });
    return new Map(rows.map((r) => [r.id, { name: str(r.name), phone: r.guardian_phone }]));
  },
};
```

### ② 인터페이스 요약 (`lib/sms/sources/types.ts`)

| 항목 | 뜻 |
|---|---|
| `key` | 고유값. 주소록 참조(`source`)에 저장되므로 바꾸지 않기 |
| `label` · `icon` · `description` | 카드 이름·아이콘·보조설명 |
| `pickerType` | 화면 선택기 종류 — 아래 표 |
| `color` | 담긴 명단 칩 색(blue·green·amber·violet) |
| `canUse(user)` | 이 출처 카드를 볼 수 있는지. `user.isM0`, `user.roles`, `user.isPressAdmin` |
| `loadOptions(user, {filter, query})` | 화면 목록. `{ filters, items, bulkLabel?, note?, grouped? }` — **번호 금지** |
| `resolvePhones(user, selection)` | 선택값 → `{ label, short?, people: [{key, name, phone, ref}] }` |
| `resolveRefs?(ids)` | 주소록 참조 → 최신 `{name, phone}`. DB 출처면 구현 |

선택값(`selection`)은 선택기가 만듭니다: `list`·`term-program` → `{ filter, ids }`, `search` → `{ ids }`, `paste` → `{ text }`.

### ③ 등록표에 한 줄 — `lib/sms/sources/index.ts`

```ts
import { orchestraSource } from "./orchestra";

export const SMS_SOURCES: SmsSource[] = [
  bkGuardiansSource,
  saemAcademySource,
  orchestraSource,   // ← 이 줄. 배열 순서 = 카드 순서
  ...
];
```

- 카드 순서: 배열 순서. 잠시 숨기기: 같은 파일의 `HIDDEN` 에 key 추가.
- 끝. 화면(`app/(app)/sms/*`)은 고치지 않습니다.

### 선택기 종류(pickerType)

| 종류 | 화면 | 쓰는 출처 |
|---|---|---|
| `list` | 필터(select·radio) + 체크 목록 + [전체 담기] | 방과후 보호자, 강사, 직원, 기자, 주소록 |
| `term-program` | `list` 와 같은 선택기, 묶음(프로그램) 인원 표시 | 동래미래아카데미 |
| `search` | 검색어 → 묶음(`group`)별 사람 체크 | 거래처 |
| `paste` | 붙여넣기(“이름, 번호” · 엑셀 두 열), 잘못된 줄 빨간 표시 | 직접 입력 |

목록 항목을 묶음 단위(프로그램·그룹)로 고르게 하려면 `grouped: true` 와 항목별 `count`(사람 수)를 주면 됩니다.

**새 선택기 종류가 꼭 필요할 때만** `app/(app)/sms/pickers/` 에 컴포넌트를 만들고 `pickers/index.tsx` 의 `PICKERS` 와 `lib/sms/text.ts` 의 `SmsPickerType` 에 한 줄씩 더합니다.

---

## 2. 발송 수단 추가하기 (카카오 알림톡·브랜드 메시지 등)

지금은 문자(`sms`) 하나라 4단계의 "보내는 방법" 선택 영역은 숨겨져 있습니다. 수단이 2개가 되면 자동으로 나타납니다.

### ① 파일 만들기 — `lib/sms/channels/○○.ts`

```ts
// 발송 수단 — 카카오 알림톡(정보성만, 검수된 템플릿 필수).
import type { SmsChannel } from "./types";

export const kakaoAlimtalkChannel: SmsChannel = {
  key: "kakao-alimtalk",       // sms_send_logs.channel 에 저장 — 바꾸지 않기
  label: "알림톡",
  icon: "🟡",
  requiresTemplate: true,      // 검수된 템플릿(sms_templates.kakao_template_code) 필요
  allowsAd: false,             // 광고성 불가 → 화면이 광고성 체크와 함께 못 고르게 막음
  canUse: () => true,

  validate(text, count, opts) {
    const errors: string[] = [];
    if (!opts.templateCode) errors.push("알림톡은 검수된 템플릿을 골라야 합니다.");
    if (count === 0) errors.push("보낼 번호가 없습니다.");
    return { errors, warnings: [] };
  },

  async send(to, text, opts) {
    // 중계 서버(sms-relay)에 알림톡 엔드포인트가 생기면 여기서 호출
    // return { ok: true, sent, failed, msg_type: "ALIMTALK", provider_msg_id, sender: null };
    return { ok: false, status: 501, error: "아직 준비 중입니다." };
  },
};
```

### ② 인터페이스 요약 (`lib/sms/channels/types.ts`)

| 항목 | 뜻 |
|---|---|
| `key` · `label` · `icon` | 고유값(이력에 저장)·이름·아이콘 |
| `requiresTemplate` | 검수 템플릿이 있어야 보낼 수 있는지(알림톡 true) |
| `allowsAd` | 광고성 내용 허용(알림톡 false, 브랜드 메시지 true) |
| `canUse(user)` | 이 수단을 쓸 수 있는지 |
| `validate(본문, 수신자 수, 옵션)` | `{ errors, warnings }` — errors 가 있으면 서버가 보내지 않음 |
| `send(번호들, 본문, 옵션)` | 실제 발송 → `{ ok, sent, failed, msg_type, provider_msg_id, sender, partial? }` |

### ③ 등록표에 한 줄 — `lib/sms/channels/index.ts`

```ts
export const SMS_CHANNELS: SmsChannel[] = [
  smsChannel,
  kakaoAlimtalkChannel,   // ← 이 줄
];
```

### 알림톡을 실제로 붙일 때 더 할 일

- 문구함(`sms_templates`)의 `kakao_template_code`·`kakao_status` 칸은 이미 마련돼 있습니다(지금은 화면에 안 보임). 알림톡 수단을 고르면 검수 완료(`kakao_status`) 문구만 고르게 하는 화면이 필요합니다.
- 알림톡은 수신자마다 변수(이름 등)가 다를 수 있어 중계 서버(sms-relay) 쪽 수정이 함께 필요합니다.

---

## 3. 나중에 검토된 것

### '사업별 참가자' 출처 — 지금 인터페이스로 가능

`business_programs` 를 고르면 그 사업에 연결된 명단을 모아 보여 주는 출처. 새 파일 하나로 됩니다.

- `pickerType: "list"`, 필터 = 사업 선택(`business_programs`), 항목 = 그 사업에 연결된 명단 묶음
  (`saem_programs.business_program_id` 로 동래미래 프로그램, `sms_contact_groups.business_program_id` 로 공유 그룹), `grouped: true`.
- `resolvePhones` 는 다른 출처를 다시 씁니다: 프로그램 묶음 → `saemAcademySource.resolvePhones(user, { ids })`, 그룹 묶음 → `groupsSource.resolvePhones(user, { ids })`. 사람 `ref` 가 원래 출처를 가리키므로 주소록 저장도 그대로 됩니다.
- 주의: 묶음 id 가 두 표에서 오므로 `program:<id>` / `group:<id>` 처럼 접두어를 붙여 구분해야 합니다. `canUse` 는 동래미래 수강생이 섞이므로 `M0 또는 saem 직무` 가 맞습니다.

### 개인화({이름}) — 이번엔 제외

수신자마다 다른 본문이 필요해 중계 서버(sms-relay)의 `/send` 가 건별 본문을 받아야 합니다. 그때는 `ResolvedPerson.name` 을 이미 서버가 갖고 있으므로 `SmsChannel.send` 에 `(번호, 이름)[]` 을 넘기도록 넓히면 됩니다.
