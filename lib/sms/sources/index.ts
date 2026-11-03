// =====================================================================
// 문자 받는 사람 출처 등록표 — 여기 배열에 한 줄 넣으면 /sms 화면에 카드가 생깁니다.
//   * 순서 = 화면 카드 순서. 숨기려면 hidden 에 key 를 넣거나 줄을 주석 처리.
//   * 사람마다 보이는 카드는 각 출처의 canUse 로 걸러집니다.
//   * 새 출처 만드는 법: docs/SMS_SOURCES.md
//   * 서버 전용 — 화면에는 smsSourceMetas() 가 만든 메타(이름·아이콘·선택기 종류)만 갑니다.
// =====================================================================

import type { SmsUser } from "@/lib/sms/access";
import type { SmsSourceMeta } from "@/lib/sms/text";
import type { SmsSource } from "./types";
import { bkGuardiansSource } from "./bk-guardians";
import { saemAcademySource } from "./saem-academy";
import { instructorsSource } from "./instructors";
import { employeesSource } from "./employees";
import { partnersSource } from "./partners";
import { reportersSource } from "./reporters";
import { groupsSource } from "./groups";
import { manualSource } from "./manual";

export const SMS_SOURCES: SmsSource[] = [
  bkGuardiansSource, // ① 방과후아카데미 보호자
  saemAcademySource, // ② 동래미래아카데미
  instructorsSource, // ③ 강사
  employeesSource, // ④ 직원
  partnersSource, // ⑤ 거래처
  reportersSource, // ⑥ 기자
  groupsSource, // ⑦ 주소록
  manualSource, // ⑧ 직접·붙여넣기
];

// 잠시 숨길 출처 key — 파일·등록 줄은 그대로 두고 화면에서만 뺍니다.
const HIDDEN: string[] = [];

export function findSmsSource(key: string): SmsSource | undefined {
  return SMS_SOURCES.find((s) => s.key === key);
}

// 이 사람이 쓸 수 있는 출처(숨김 제외).
export function usableSmsSources(user: SmsUser): SmsSource[] {
  return SMS_SOURCES.filter((s) => !HIDDEN.includes(s.key) && s.canUse(user));
}

export function smsSourceMetas(user: SmsUser): SmsSourceMeta[] {
  return usableSmsSources(user).map((s) => ({
    key: s.key,
    label: s.label,
    icon: s.icon,
    description: s.description,
    pickerType: s.pickerType,
    color: s.color,
  }));
}
