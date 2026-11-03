// =====================================================================
// 문자 받는 사람 "출처" 인터페이스 — 출처 1개 = 파일 1개(lib/sms/sources/*.ts).
//   새 출처를 추가하는 법은 docs/SMS_SOURCES.md 참고.
//   ⚠️ loadOptions 는 화면으로 나가므로 전화번호를 담지 않습니다(번호 있음 여부만).
//      resolvePhones·resolveRefs 는 서버(미리보기·발송·주소록 저장)에서만 부릅니다.
//   * 서버 전용 모듈.
// =====================================================================

import type { SmsUser } from "@/lib/sms/access";
import type {
  SmsChipColor,
  SmsOptionsResult,
  SmsPickerType,
  SmsSelection,
} from "@/lib/sms/text";

// 주소록에 저장할 때의 참조 — DB 출처 사람은 번호를 복사하지 않고 {source, ref_id} 로.
//   직접 입력(manual)만 phone 을 저장합니다.
export type SmsPersonRef = {
  source: string;
  ref_id: string | null;
  phone: string | null; // manual 일 때만
};

export type ResolvedPerson = {
  // 화면에서 개별로 뺄 때 쓰는 키 — 같은 출처 안에서 고유. 예: "employees:<driver id>".
  key: string;
  name: string;
  // 정규화 전 번호도 괜찮습니다(공용 코드가 숫자만 남기고 검사). 없으면 null.
  phone: string | null;
  ref: SmsPersonRef;
};

export type ResolvedBundle = {
  // 담긴 명단 칩 문구 — 예: "동래미래 4차시".
  label: string;
  // 이력 요약에 쓰는 짧은 이름 — 없으면 label.
  short?: string;
  people: ResolvedPerson[];
};

export type SmsSource = {
  key: string; // 고유값 — 화면·주소록 참조(source)에 저장됩니다. 바꾸지 마세요.
  label: string; // 카드 이름
  icon: string;
  description: string; // 카드 보조설명
  pickerType: SmsPickerType;
  color: SmsChipColor; // 담긴 명단 칩 색
  canUse(user: SmsUser): boolean;
  // 화면 목록 — 이름·소속·번호 있음 여부만.
  loadOptions(
    user: SmsUser,
    req: { filter: Record<string, string>; query: string },
  ): Promise<SmsOptionsResult>;
  // 선택값 → 사람(번호 포함). 서버에서만.
  resolvePhones(user: SmsUser, sel: SmsSelection): Promise<ResolvedBundle>;
  // 주소록에 {source, ref_id} 로 저장된 사람 → 최신 이름·번호. DB 출처만 구현합니다.
  resolveRefs?(ids: string[]): Promise<Map<string, { name: string; phone: string | null }>>;
};

// --- 출처 파일들이 같이 쓰는 작은 도우미 ---------------------------------

export function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

export function idsOf(sel: SmsSelection): string[] {
  return Array.isArray(sel.ids)
    ? [...new Set(sel.ids.filter((x): x is string => typeof x === "string" && !!x))].slice(0, 5000)
    : [];
}

// .in() 을 200개씩 나눠 부릅니다(URL 길이).
export async function inChunks<T>(
  ids: string[],
  run: (chunk: string[]) => Promise<T[]>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 200) out.push(...(await run(ids.slice(i, i + 200))));
  return out;
}
