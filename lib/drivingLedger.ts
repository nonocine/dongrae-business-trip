import * as XLSX from "xlsx";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { DEFAULT_DEPARTURE } from "@/lib/supabase";
import { formatYmdDot, type DrivingLogRow } from "@/lib/driving";

// =====================================================================
// 월별 운행대장 XLSX — 동래카(dongrae-car) app/api/export/route.ts 의
// 양식을 그대로 옮긴 것입니다.
//
// ■ 왜 동래카 라우트를 링크하지 않고 여기서 다시 만드는가
//   동래카의 export 는 `isAdmin()` = 동래카 도메인의 dongrae_admin 쿠키가
//   공유 ADMIN_PASSWORD 와 같은지 보는 게이트입니다. 동업자씨에서 링크를
//   띄워도 그 쿠키가 없으니 403 이고, 관장·시설담당이 쓰려면 동래카 공유
//   비밀번호로 따로 로그인해야 합니다. 환경변수로 도메인을 빼도 이 인증
//   문제는 그대로여서, 링크 방식은 이 화면을 쓰는 사람에게 동작하지 않습니다.
//   → 같은 xlsx 버전(^0.18.5)으로 같은 aoa 를 만들어 동일한 파일을 냅니다.
//
// ⚠️ 열 구성을 바꿀 때는 동래카 app/api/export/route.ts 도 함께 바꿔야
//   합니다. 두 앱이 같은 대장을 내는 것이 이 모듈의 존재 이유입니다.
// =====================================================================

// 동래카가 머리글에 찍는 차량·보험 값. settings 테이블의 dongrae_ 접두사
// 키에서 읽습니다(동래카 lib/settings.ts 와 같은 키).
//   * 접두사 없는 키(initial_mileage 등)는 다른 앱 소유이므로 읽지 않습니다.
const SETTINGS_KEYS = {
  vehicleModel: "dongrae_vehicle_model",
  vehiclePlate: "dongrae_vehicle_plate",
  insuranceCompany: "dongrae_insurance_company",
  insurancePhone: "dongrae_insurance_phone",
} as const;

// 값이 없을 때 동래카가 찍는 문자열(lib/settings.ts EMPTY_DISPLAY).
const EMPTY_DISPLAY = "-";

type LedgerHeaderInfo = {
  vehicleModel: string;
  vehiclePlate: string;
  insuranceCompany: string;
  insurancePhone: string;
};

// 대장 머리글용 차량·보험 정보(읽기 전용).
export async function getLedgerHeaderInfo(): Promise<LedgerHeaderInfo> {
  const keys = Object.values(SETTINGS_KEYS);
  const { data, error } = await supabaseAdmin
    .from("settings")
    .select("key, value")
    .in("key", keys);

  const byKey = new Map<string, string>();
  if (!error) {
    for (const row of data ?? []) {
      const r = row as { key?: unknown; value?: unknown };
      byKey.set(String(r.key ?? ""), r.value == null ? "" : String(r.value));
    }
  }
  const read = (key: string) => {
    const v = (byKey.get(key) ?? "").trim();
    return v.length > 0 ? v : EMPTY_DISPLAY;
  };

  return {
    vehicleModel: read(SETTINGS_KEYS.vehicleModel),
    vehiclePlate: read(SETTINGS_KEYS.vehiclePlate),
    insuranceCompany: read(SETTINGS_KEYS.insuranceCompany),
    insurancePhone: read(SETTINGS_KEYS.insurancePhone),
  };
}

// 데이터 열 9개 — 동래카와 동일한 순서·머리글.
const HEADERS = [
  "운행일자",
  "운전자",
  "용무",
  "출발지",
  "목적지",
  "도착지",
  "운행거리(km)",
  "누적거리(km)",
  "확인/결재",
] as const;

const COL_WIDTHS = [12, 10, 24, 18, 18, 18, 12, 12, 10];

export function buildDrivingLedgerWorkbook(opts: {
  // driven_at 내림차순으로 받은 목록(화면과 같은 순서)
  logs: DrivingLogRow[];
  // 조회한 월(YYYY-MM). 빈 문자열이면 전체 기간.
  month: string;
  header: LedgerHeaderInfo;
}): Buffer {
  const { logs, month, header } = opts;

  // 양식과 동일하도록 일자 오름차순으로 정렬해 출력(동래카와 같은 방식).
  const rows = [...logs].reverse();
  const totalDistance = rows.reduce((s, r) => s + Number(r.distance), 0);

  const headerRows: (string | number)[][] = [
    [`${DEFAULT_DEPARTURE} 차량 운행일지`],
    [
      `차종: ${header.vehicleModel}`,
      `차량번호: ${header.vehiclePlate}`,
      `보험사: ${header.insuranceCompany} (${header.insurancePhone})`,
    ],
    [
      // 동래카와 글자까지 같게 하려고 그쪽 표현을 그대로 씁니다
      // ("2025-03" → "2025년 03월"). lib/driving.ts 의 monthLabel 은 화면용
      // ("2025년 3월")이라 여기서는 쓰지 않습니다.
      `조회 기간: ${month ? `${month.replace("-", "년 ")}월` : "전체"}`,
      `총 건수: ${rows.length}`,
      `총 운행거리: ${totalDistance.toFixed(1)} km`,
    ],
    [],
    [...HEADERS],
  ];

  const dataRows = rows.map((r) => [
    formatYmdDot(r.driven_at),
    r.driver,
    r.purpose,
    // 출발지·도착지는 기록된 값을 쓰고, 비어 있을 때만 센터명으로 채웁니다.
    //   동래카는 이 두 칸에 센터명을 무조건 찍는데, 운행일지 폼의 기본값이
    //   센터명이라 실제로는 거의 항상 같은 값이 나옵니다. 다만 운전자가 다른
    //   출발지를 적은 행에서는 그 값이 사실과 달라지므로, 기록이 있으면
    //   기록을 우선합니다(열 구성은 동일).
    (r.departure ?? "").trim() || DEFAULT_DEPARTURE,
    r.waypoint ?? "",
    (r.destination ?? "").trim() || DEFAULT_DEPARTURE,
    Number(r.distance),
    Number(r.total_distance),
    r.confirmed_by ?? "",
  ]);

  const ws = XLSX.utils.aoa_to_sheet([...headerRows, ...dataRows]);
  ws["!cols"] = COL_WIDTHS.map((wch) => ({ wch }));

  // 상단 타이틀 셀 병합(동래카와 동일)
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 8 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 2 } },
    { s: { r: 1, c: 3 }, e: { r: 1, c: 5 } },
    { s: { r: 1, c: 6 }, e: { r: 1, c: 8 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 2 } },
    { s: { r: 2, c: 3 }, e: { r: 2, c: 5 } },
    { s: { r: 2, c: 6 }, e: { r: 2, c: 8 } },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "운행일지");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// 동래카와 같은 파일명 규칙.
export function drivingLedgerFilename(month: string): string {
  return `${DEFAULT_DEPARTURE}_운행일지_${month || "전체"}.xlsx`;
}
