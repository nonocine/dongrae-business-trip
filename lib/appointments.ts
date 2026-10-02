// =====================================================================
// 현재 소속(부서·직위·담당업무) — 인사발령 이력에서 계산하는 단일 출처.
//   * 별도 컬럼을 두지 않습니다. 컬럼을 따로 두면 발령 이력과 어긋나는 사고가
//     나므로, 항상 employee_profiles.appointments 에서 계산해 보여 줍니다.
//   * 인사기록카드·직원 목록·연차계획·재직/경력증명서가 전부 이 파일의 함수만
//     씁니다. 화면마다 따로 정렬하면 규칙이 갈라집니다.
//   * 순수 함수(클라이언트 안전). "오늘"은 인자로 받습니다 — 하이드레이션
//     불일치를 막기 위해 서버에서 kstTodayYmd() 로 계산해 내려 주세요.
//
// ■ 규칙
//   1) effective_date 가 가장 늦은 항목이 현재 상태입니다. 배열 순서는 믿지
//      않습니다(정렬이 보장되지 않음). 같은 날짜면 배열 뒤쪽이 우선입니다.
//   2) 오늘 기준 이미 발효된 발령만 "현재"로 봅니다. 오늘보다 뒤 날짜는
//      "예정"(upcoming)으로 따로 돌려줍니다 — 예정 발령을 미리 입력해도 현재
//      소속이 앞당겨 바뀌지 않고, 화면은 "예정" 표시를 붙일 수 있습니다.
//   3) 발령일이 비었거나 형식이 틀린 항목은 시점을 알 수 없어 가장 오래된
//      것으로 취급합니다(발효된 것으로 보되, 날짜 있는 발령보다 뒤지지 않음).
//   4) 발령이 없으면 current = null. 호출부가 "발령기록 없음"으로 처리합니다.
//      ⚠️ drivers.rank(계정 직급)로 메꾸지 마세요 — 직급과 직위는 다른 축입니다
//      (예: 직급 팀원 · 발령 직위 팀장).
//   5) 최신 발령의 빈 칸을 이전 발령에서 끌어오지 않습니다. 관장·부장처럼
//      부서를 비워 둔 발령은 "부서 없음"이 그 사람의 현재 상태입니다.
// =====================================================================

import type { EmployeeAppointment } from "@/lib/supabase";

export type Assignment = {
  type: string;
  department: string | null;
  title: string | null;
  duty: string | null;
  effectiveDate: string | null; // "YYYY-MM-DD" (비었거나 형식 오류면 null)
};

export type AssignmentState = {
  current: Assignment | null; // 오늘 기준 발효된 발령 중 최신
  upcoming: Assignment | null; // 오늘 이후 발효 예정 중 가장 가까운 것
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function clean(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
}

function toAssignment(raw: unknown): Assignment {
  const o = (raw ?? {}) as Partial<Record<keyof EmployeeAppointment, unknown>>;
  const date = clean(o.effective_date);
  return {
    type: clean(o.type) ?? "",
    department: clean(o.department),
    title: clean(o.title),
    duty: clean(o.duty),
    effectiveDate: date && YMD.test(date) ? date : null,
  };
}

export function currentAssignment(
  appointments: unknown,
  todayYmd: string,
): AssignmentState {
  if (!Array.isArray(appointments) || appointments.length === 0)
    return { current: null, upcoming: null };

  // 날짜 오름차순, 같은 날짜는 배열 순서 유지(뒤쪽이 나중) — 안정 정렬을
  //   엔진에 맡기지 않고 원래 인덱스로 직접 비교합니다.
  const items = appointments
    .map((raw, idx) => ({ a: toAssignment(raw), idx }))
    .sort(
      (x, y) =>
        (x.a.effectiveDate ?? "").localeCompare(y.a.effectiveDate ?? "") ||
        x.idx - y.idx,
    );

  let current: Assignment | null = null;
  let upcoming: Assignment | null = null;
  for (const { a } of items) {
    if (a.effectiveDate && a.effectiveDate > todayYmd) {
      upcoming ??= a; // 오름차순이라 처음 만나는 게 가장 가까운 예정
    } else {
      current = a; // 오름차순이라 마지막에 남는 게 최신
    }
  }
  return { current, upcoming };
}

// 직위 및 담당업무 — title 기본, duty 가 있으면 "팀장(시설관리)".
//   증명서의 "직위 및 담당업무" 칸과 화면 표기가 같은 규칙을 씁니다.
export function positionWithDuty(a: Assignment | null): string | null {
  if (!a) return null;
  if (a.title && a.duty) return `${a.title}(${a.duty})`;
  return a.title ?? a.duty ?? null;
}

// 한 줄 표기 — "교육문화사업팀 · 팀장 · 시설관리". 빈 칸은 건너뜁니다.
//   모두 비어 있으면 발령 유형(예: "휴직")이라도 보여 줍니다.
export function formatAssignment(a: Assignment | null): string | null {
  if (!a) return null;
  const parts = [a.department, a.title, a.duty].filter(
    (v): v is string => !!v,
  );
  if (parts.length > 0) return parts.join(" · ");
  return a.type || null;
}

// "YYYY-MM-DD" → "YYYY.MM.DD" (예정 표시용).
export function fmtAssignmentDate(ymd: string | null): string {
  return ymd ? ymd.replaceAll("-", ".") : "";
}
