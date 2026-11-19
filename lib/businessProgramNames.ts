// 사업(프로그램) 이름 비교 키 — 공백·따옴표 모양만 다른 이름을 같은 것으로 봅니다.
//   예) "사직동 자유공간 ‘온나’" = "사직동 자유공간 '온나'" = "사직동자유공간 온나"
//   대소문자도 무시합니다("On-나-Go" = "on-나-go").
//   ⚠️ supabase/migrations/business_program_admin.sql 의 name_key 와 같은 규칙입니다.
const IGNORED = /[\s'"‘’“”`´]/g;

export function programNameKey(name: string): string {
  return (name ?? "").replace(IGNORED, "").toLowerCase();
}

// 이름 목록에 키가 같은 이름이 이미 있는지.
export function hasSameNameKey(names: string[], name: string): boolean {
  const key = programNameKey(name);
  return !!key && names.some((n) => programNameKey(n) === key);
}

// 예전 이름을 다른 이름 목록에 더합니다 — 지금 이름·이미 있는 이름(키 기준)은 빼고.
export function appendAlias(
  aliases: string[],
  oldName: string,
  newName: string,
): string[] {
  const old = oldName.trim();
  if (!old || programNameKey(old) === programNameKey(newName)) return aliases;
  if (aliases.some((a) => a === old)) return aliases;
  return [...aliases, old];
}

// 연·월 범위 표기 — [2026,1]~[2026,5] → "2026년 1~5월", 해가 다르면 "2025.3~2026.5".
export function monthRangeLabel(
  from: { year: number; month: number },
  to: { year: number; month: number },
): string {
  if (from.year === to.year)
    return from.month === to.month
      ? `${from.year}년 ${from.month}월`
      : `${from.year}년 ${from.month}~${to.month}월`;
  return `${from.year}.${from.month}~${to.year}.${to.month}`;
}
