// =====================================================================
// 성범죄경력조회 만료 규칙 공용 — 동업자씨/동래샘들 양쪽 저장소 동일 구현.
//   * 법정 서류로 1년마다 갱신 필수(미이행 시 과태료).
//   * 만료일 = issued_on + 1년. 오늘 기준 상태:
//       expired  만료일이 지남
//       warning  만료일까지 14일 이내(오늘 만료 포함)
//       ok       그 밖
//       missing  서류가 없거나 issued_on 이 없음 — expired 와 동급으로 취급
//   * 재업로드는 기존 대체 로직 그대로(같은 슬롯 새 행이 대표) → 새 issued_on
//     이 곧 상태 해소.
//   * 순수 계산(DB·타임존 의존 없음). 오늘 날짜는 호출자가 넘긴다.
// =====================================================================

export const CRIME_CHECK_SLOT = "crime_check";
export const CRIME_CHECK_WARN_DAYS = 14;

export type DocExpiryStatus = "ok" | "warning" | "expired" | "missing";

export type CrimeCheckState = {
  status: DocExpiryStatus;
  issuedOn: string | null;
  expiresOn: string | null;
  dday: number | null; // 만료일까지 남은 일수. 음수면 초과. missing 이면 null
};

// 만료·미제출 = 즉시 조치가 필요한 상태(집계·배지에서 같이 묶는다).
export function isCrimeCheckOverdue(status: DocExpiryStatus): boolean {
  return status === "expired" || status === "missing";
}

// 조치가 필요한 상태(만료·미제출·임박) — 요약 집계 대상.
export function needsCrimeCheckAction(status: DocExpiryStatus): boolean {
  return status !== "ok";
}

// YYYY-MM-DD 에 n년 더하기. 2/29 처럼 대응일이 없으면 그 달 말일로 맞춘다.
export function addYears(ymd: string | null, years: number): string | null {
  const m = (ymd ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]); // 1~12
  const d = Number(m[3]);
  const targetY = y + years;
  // 대상 연·월의 말일(윤년 보정).
  const lastDay = new Date(Date.UTC(targetY, mo, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${targetY}-${p2(mo)}-${p2(day)}`;
}

// 만료일 = 발급일 + 1년.
export function crimeCheckExpiry(issuedOn: string | null): string | null {
  return addYears(issuedOn, 1);
}

// 두 날짜 사이 일수(대상 − 기준). 양수=남음, 0=오늘, 음수=지남.
export function daysBetween(target: string, todayYmd: string): number | null {
  const a = Date.parse(`${target}T00:00:00Z`);
  const b = Date.parse(`${todayYmd}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86400000);
}

// 발급일 → 상태. issuedOn 이 없으면 missing.
export function crimeCheckState(
  issuedOn: string | null,
  todayYmd: string
): CrimeCheckState {
  const expiresOn = crimeCheckExpiry(issuedOn);
  if (!issuedOn || !expiresOn)
    return { status: "missing", issuedOn: null, expiresOn: null, dday: null };
  const dday = daysBetween(expiresOn, todayYmd);
  if (dday == null)
    return { status: "missing", issuedOn, expiresOn: null, dday: null };
  const status: DocExpiryStatus =
    dday < 0 ? "expired" : dday <= CRIME_CHECK_WARN_DAYS ? "warning" : "ok";
  return { status, issuedOn, expiresOn, dday };
}

// 화면·엑셀·슬랙 공용 라벨.
export function crimeCheckLabel(s: CrimeCheckState): string {
  switch (s.status) {
    case "missing":
      return "미제출";
    case "expired":
      return s.dday == null ? "만료됨" : `만료됨(${-s.dday}일 초과)`;
    case "warning":
      return s.dday === 0 ? "오늘 만료" : `D-${s.dday}`;
    default:
      return "정상";
  }
}

// 강사 목록 배지용 짧은 문구 — 만료·미제출은 한 덩어리로 표기.
export function crimeCheckBadgeText(s: CrimeCheckState): string {
  if (isCrimeCheckOverdue(s.status)) return "만료·미제출";
  if (s.status === "warning") return s.dday === 0 ? "오늘 만료" : `D-${s.dday}`;
  return s.expiresOn ?? "정상";
}
