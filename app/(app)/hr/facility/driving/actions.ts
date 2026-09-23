"use server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireFacilityAccess } from "@/lib/facilityAccess";
import {
  toDrivingLogRow,
  monthRange,
  type DrivingLogRow,
  type DrivingSummary,
} from "@/lib/driving";

// =====================================================================
// 시설관리 > 운행기록 — /hr/facility/driving
//   * driving_logs 는 동래카와 공유하는 테이블입니다.
//     ⚠️ 이 모듈은 SELECT 전용입니다. INSERT/UPDATE/DELETE 를 추가하지
//       마세요 — 운행일지 작성·수정은 동래카에서만 합니다.
//   * 전부 service_role(supabaseAdmin) 경유. RLS 를 우회하므로 모든 export
//     된 액션이 진입 시 requireFacilityAccess() 로 권한을 재검증합니다
//     (비품관리·안전점검과 동일 게이트: M0 또는 facility 직무).
// =====================================================================

const LOGS = "driving_logs";

// 화면·엑셀이 함께 쓰는 컬럼 목록. * 대신 명시해 스키마 변화에 덜 흔들리게 합니다.
const LOG_COLUMNS =
  "id, driven_at, start_date, end_date, is_multi_day, driver, purpose, departure, waypoint, destination, passenger_names, passenger_others, distance, total_distance, confirmed_by, created_at";

// 월(YYYY-MM) 운행일지. month 가 비었거나 형식이 아니면 전체 기간.
//   기간 필터는 driven_at 기준 — 동래카가 insert 시 driven_at = start_date 를
//   넣으므로 "시작월" 기준이 되고, 동래카 목록·엑셀과 같은 집합이 나옵니다.
export async function listDrivingLogs(
  month?: string
): Promise<DrivingLogRow[]> {
  await requireFacilityAccess();

  let query = supabaseAdmin
    .from(LOGS)
    .select(LOG_COLUMNS)
    .order("driven_at", { ascending: false })
    .order("created_at", { ascending: false });

  const range = monthRange(month);
  if (range) {
    query = query.gte("driven_at", range.start).lt("driven_at", range.end);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => toDrivingLogRow(r as Record<string, unknown>));
}

// 상단 요약. 건수·거리는 조회 기간 기준, 누적거리는 차량 전체 기준입니다.
//   현재 누적거리 = driving_logs.total_distance 의 최댓값.
//   ⚠️ 동래카는 이 값을 `settings.dongrae_initial_mileage + Σ distance` 로
//     계산하지만, 그 방식을 옮기면 (1) 키가 없을 때 쓰는 폴백 상수(4361)를
//     이 앱에도 복제해야 하고 (2) 그 상수가 어긋나면 두 앱의 누적거리가
//     달라집니다. total_distance 는 운전자가 입력한 실제 계기판 값이고
//     distance = 계기판 - 직전누적 으로 만들어져 단조증가하므로, 최댓값이
//     같은 수를 가리키면서 상수 복제를 피할 수 있습니다.
export async function getDrivingSummary(
  month?: string
): Promise<DrivingSummary> {
  await requireFacilityAccess();

  let periodQuery = supabaseAdmin.from(LOGS).select("distance");
  const range = monthRange(month);
  if (range) {
    periodQuery = periodQuery
      .gte("driven_at", range.start)
      .lt("driven_at", range.end);
  }

  const [period, latest] = await Promise.all([
    periodQuery,
    supabaseAdmin
      .from(LOGS)
      .select("total_distance")
      .order("total_distance", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (period.error) throw new Error(period.error.message);

  const rows = period.data ?? [];
  const distance = rows.reduce(
    (acc, r) => acc + (Number((r as { distance: unknown }).distance) || 0),
    0
  );

  // 누적거리 조회 실패는 요약 전체를 막지 않습니다(건수·거리는 이미 유효).
  const cumulativeRaw = latest.error
    ? null
    : (latest.data as { total_distance?: unknown } | null)?.total_distance;
  const cumulative =
    cumulativeRaw == null ? null : Number(cumulativeRaw) || 0;

  return {
    count: rows.length,
    distance: Math.round(distance * 10) / 10,
    cumulative,
  };
}
