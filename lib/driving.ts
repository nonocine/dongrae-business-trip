// =====================================================================
// 차량 운행일지 (driving_logs) — 동래카(dongrae-car)와 공유하는 테이블.
//
// ⚠️ 이 앱에서 driving_logs 는 읽기 전용입니다(SELECT 만).
//    작성·수정·삭제는 동래카에서만 합니다. INSERT/UPDATE/DELETE 를 추가하면
//    누적거리 기준점이 두 앱에서 각각 움직여 대장이 어긋납니다.
//    (예외: app/actions.ts 의 활동 등록이 기관차량 사용 시 로그를 만드는
//     기존 경로 — 그 경로는 이 모듈과 무관하며 이번 범위에서 건드리지 않습니다.)
//
// 표기 규칙은 동래카 app/components/LogList.tsx 와 동일하게 맞춰,
// 같은 운행을 두 앱에서 봤을 때 다르게 읽히지 않도록 합니다.
// =====================================================================

import { toStringArray } from "@/lib/supabase";

// driving_logs 의 현재 컬럼 구성.
//   * lib/supabase.ts 의 DrivingLog 타입은 기간(start_date/end_date/
//     is_multi_day)·동승자(passenger_*) 컬럼이 추가되기 전에 만들어져 그
//     컬럼들이 빠져 있습니다. 활동 상세 화면이 그 타입을 쓰고 있어 건드리지
//     않고, 운행기록 화면용으로 현재 스키마 전체를 여기 둡니다.
//   * 컬럼 출처: 동래카 supabase/migration_trip_period.sql,
//     migration_passenger_others.sql
export type DrivingLogRow = {
  id: string;
  // 운행 기준일. 동래카는 insert 시 start_date 와 같은 값을 넣습니다.
  driven_at: string;
  start_date: string | null;
  end_date: string | null;
  is_multi_day: boolean;
  driver: string;
  purpose: string;
  departure: string | null;
  waypoint: string | null;
  destination: string | null;
  // 동승 직원(drivers.name 기준) / 직원 명단에 없는 외부인
  passenger_names: string[];
  passenger_others: string[];
  distance: number;
  total_distance: number;
  confirmed_by: string | null;
  created_at: string;
};

// 운행기록 화면 상단 요약.
export type DrivingSummary = {
  // 조회 기간의 운행 건수
  count: number;
  // 조회 기간의 운행거리 합계(km)
  distance: number;
  // 차량의 현재 누적거리(km). 운행 기록이 없으면 null.
  cumulative: number | null;
};

export function toDrivingLogRow(raw: Record<string, unknown>): DrivingLogRow {
  return {
    id: String(raw.id ?? ""),
    driven_at: String(raw.driven_at ?? ""),
    start_date: (raw.start_date as string | null) ?? null,
    end_date: (raw.end_date as string | null) ?? null,
    is_multi_day: raw.is_multi_day === true,
    driver: String(raw.driver ?? ""),
    purpose: String(raw.purpose ?? ""),
    departure: (raw.departure as string | null) ?? null,
    waypoint: (raw.waypoint as string | null) ?? null,
    destination: (raw.destination as string | null) ?? null,
    passenger_names: toStringArray(raw.passenger_names),
    passenger_others: toStringArray(raw.passenger_others),
    distance: Number(raw.distance) || 0,
    total_distance: Number(raw.total_distance) || 0,
    confirmed_by: (raw.confirmed_by as string | null) ?? null,
    created_at: String(raw.created_at ?? ""),
  };
}

// YYYY-MM-DD → YYYY.MM.DD (동래카 엑셀·목록과 동일 표기)
export function formatYmdDot(d: string | null | undefined): string {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  if (!y || !m || !day) return d;
  return `${y}.${m}.${day}`;
}

export function formatKm(n: number): string {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 }).format(n);
}

// 단일 운행은 날짜 하나, 다일 운행은 "시작 ~ 종료 (N박 N일)".
//   동래카 LogList.tsx formatPeriod 와 동일한 계산식입니다.
export function formatPeriod(log: {
  driven_at: string;
  start_date?: string | null;
  end_date?: string | null;
  is_multi_day?: boolean;
}): string {
  const start = log.start_date || log.driven_at;
  const end = log.end_date || log.driven_at;
  if (!log.is_multi_day || end === start) return formatYmdDot(start);

  const s = Date.parse(`${start}T00:00:00Z`);
  const e = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e)) {
    return `${formatYmdDot(start)} ~ ${formatYmdDot(end)}`;
  }
  const days = Math.round((e - s) / 86_400_000) + 1;
  const nights = Math.max(0, days - 1);
  return `${formatYmdDot(start)} ~ ${formatYmdDot(end)} (${nights}박 ${days}일)`;
}

// 동승자 표기 — 외부인은 이름 뒤에 "(외부)". 아무도 없으면 "단독 운행".
//   동래카와 동일 규칙입니다.
export function formatPassengers(log: {
  passenger_names?: string[] | null;
  passenger_others?: string[] | null;
}): string {
  const staff = log.passenger_names ?? [];
  const others = log.passenger_others ?? [];
  if (staff.length === 0 && others.length === 0) return "단독 운행";
  return [...staff, ...others.map((n) => `${n}(외부)`)].join(", ");
}

// 경로 표기 — 출발 › 경유 › 도착. 경유가 없으면 두 칸만.
export function formatRoute(log: {
  departure?: string | null;
  waypoint?: string | null;
  destination?: string | null;
}): string {
  return [log.departure, log.waypoint, log.destination]
    .map((s) => (s ?? "").trim())
    .filter((s) => s.length > 0)
    .join(" › ");
}

// month(YYYY-MM) → [시작일, 다음달 1일). 형식이 아니면 null(= 전체 기간).
//   동래카 listDrivingLogs 의 기간 계산과 동일합니다.
export function monthRange(
  month: string | null | undefined
): { start: string; end: string } | null {
  const m = (month ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(m)) return null;
  const [y, mm] = m.split("-").map(Number);
  return {
    start: `${m}-01`,
    end: new Date(Date.UTC(y, mm, 1)).toISOString().slice(0, 10),
  };
}

// "2025-03" → "2025년 3월" (엑셀 머리글·화면 공용)
export function monthLabel(month: string | null | undefined): string {
  const m = (month ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(m)) return "전체";
  return `${m.slice(0, 4)}년 ${Number(m.slice(5, 7))}월`;
}
