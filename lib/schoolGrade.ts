// =====================================================================
// 생년월일 → 초등학교 학년 계산. 순수 함수(외부 의존 없음).
//
//   * 학년도는 3월 시작 — 1~2월은 아직 전년도 학년도다.
//       예) 2026-01-15 는 "2025학년도", 2026-03-02 는 "2026학년도".
//   * 초등 1학년 = 만 6세가 되는 해에 입학.
//       학년 = 현재학년도 - 출생연도 - 6
//       예) 2017년생 → 2024학년도 1학년 → 2026학년도 3학년.
//     빠른년생(1~2월생 조기입학) 폐지 후 세대라 출생 "연도"만으로 계산해도
//     어긋나지 않는다. 그래서 월·일은 보지 않는다.
//   * KST(UTC+9, DST 없음) 고정 — 서버가 UTC 로 돌아도 3/1 학년도 경계가
//     밀리지 않게 UTC ms 에 +9h 후 getUTC* 로 읽는다(lib/datetime.ts 와 동일 기법).
//
//   * saem_enrollments.grade 는 ERP 의 "교급"(초등학생/영·유아 등 대상구분)이라
//     학년이 아니다. 이 함수가 내는 값과 별개이며 서로 덮어쓰지 않는다.
// =====================================================================

export type GradeResult = {
  // 화면 표시용. "3학년" | "미취학" | "중등이상" | "-"(생년월일 없음/이상값)
  label: string;
  // 계산된 학년. 초등 범위(1~6) 밖이면 그 값 그대로(0·-1·7…), 계산 불가면 null.
  grade: number | null;
};

const NONE: GradeResult = { label: "-", grade: null };

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const ENTRY_AGE = 6; // 초등 입학 나이(만)
const LAST_GRADE = 6; // 초등 최고 학년
const TERM_START_MONTH = 3; // 학년도 시작 월
// 오타·잘못된 입력을 걸러내는 상식 범위.
const MIN_YEAR = 1900;
const MAX_YEAR = 2200;

// 출생 "연도"만 뽑는다.
//   문자열은 Date 로 만들지 않는다 — "2017-05-01" 은 UTC 자정으로 파싱돼
//   런타임 타임존에 따라 연도가 밀릴 수 있다. 앞 4자리를 그대로 읽는 게 안전.
function birthYear(v: string | Date): number | null {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return new Date(v.getTime() + KST_OFFSET_MS).getUTCFullYear();
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
  return m ? Number(m[1]) : null;
}

// refDate 시점의 학년도. 1~2월이면 아직 전년도 학년도다.
export function schoolYearOf(refDate: Date): number {
  const kst = new Date(refDate.getTime() + KST_OFFSET_MS);
  const year = kst.getUTCFullYear();
  return kst.getUTCMonth() + 1 < TERM_START_MONTH ? year - 1 : year;
}

export function calcGrade(
  birthDate: string | Date | null | undefined,
  refDate: Date = new Date()
): GradeResult {
  if (birthDate == null || birthDate === "") return NONE;
  const year = birthYear(birthDate);
  if (year == null || year < MIN_YEAR || year > MAX_YEAR) return NONE;

  const grade = schoolYearOf(refDate) - year - ENTRY_AGE;
  if (grade < 1) return { label: "미취학", grade };
  if (grade > LAST_GRADE) return { label: "중등이상", grade };
  return { label: `${grade}학년`, grade };
}
