"use server";

import { revalidatePath } from "next/cache";
import { requireFacilityAccess } from "@/lib/facilityAccess";
import { runRentalSync, readRentalLastSyncAt } from "@/lib/rentalSync";
import {
  isConfirmed,
  rentalFacility,
  RENTAL_PAGE_SIZE,
  type RentalPageData,
  type RentalRow,
  type RentalSummaryBreakdown,
  type RentalTypeFilter,
  type RentalStatusFilter,
  type RentalFacilityFilter,
} from "@/lib/rental";
import { fetchAllRentalsInMonth, summarizeRentals } from "@/lib/rentalData";

// =====================================================================
// 시설관리 > 대관예약 — /hr/facility/rentals
//   * rental_reservations 는 홈페이지(onnainna.kr)가 원본입니다.
//     ⚠️ 이 모듈은 SELECT 전용입니다. INSERT/UPDATE/DELETE 를 추가하지
//       마세요 — 예약 작성·수정·취소는 홈페이지에서만 합니다. 유일한 쓰기는
//       lib/rentalSync.ts 의 동기화(복제)이고, 아래 [지금 동기화] 버튼은
//       그 복제를 수동 실행할 뿐 예약 자체를 건드리지 않습니다.
//   * RLS on · anon 차단 → 전부 service_role(supabaseAdmin) 경유.
//     이 게이트가 유일한 방어선이라 export 된 모든 액션이 진입 시
//     requireFacilityAccess() 로 권한을 재검증합니다(운행기록과 동일).
//   * applicant(신청자명)는 개인정보입니다. 화면 표시까지만 하고, 엑셀
//     내보내기 등 반출 경로는 이번에 만들지 않았습니다 — 필요해지면 별건으로
//     검토하세요(반출은 표시와 위험도가 다릅니다).
// =====================================================================

// 월 단위 전량 조회(1,000행 페이지 루프)와 확정 기준 요약은 lib/rentalData
//   단일 출처입니다(MCP 와 공유).

// 화면 한 번에 필요한 것(요약·목록·마지막 동기화 시각)을 함께 냅니다.
//   ★ 요약은 상태 필터와 무관하게 "그 달 전체" 로 계산합니다. '확정만' 을
//     보고 있어도 신청 중·취소가 몇 건인지는 알아야 하고, 필터를 바꿀 때마다
//     합계가 흔들리면 숫자를 믿을 수 없게 됩니다.
//   ★ 시설(센터/온나)은 space_name 에서 파생되는 값이라 DB 조건으로 걸 수
//     없습니다 — 월+구분으로 받아온 뒤 JS 에서 나눕니다. 요약은 선택한 시설
//     기준(selected)이고, 센터/온나 소계도 함께 내어 '전체' 탭에서 병기합니다.
export async function loadRentalPage(params: {
  month: string;
  facility: RentalFacilityFilter;
  type: RentalTypeFilter;
  status: RentalStatusFilter;
  page: number;
}): Promise<RentalPageData> {
  await requireFacilityAccess();

  const all = await fetchAllRentalsInMonth(params.month, params.type);

  // 시설별로 한 번 갈라 요약 세 개를 만듭니다(행을 이미 다 받아놨으므로 추가
  //   조회 없음). '전체' 탭의 selected 는 센터+온나 합이라 all 로 계산합니다.
  const centerRows: RentalRow[] = [];
  const onnaRows: RentalRow[] = [];
  for (const r of all) {
    (rentalFacility(r) === "onna" ? onnaRows : centerRows).push(r);
  }
  const inFacility =
    params.facility === "center"
      ? centerRows
      : params.facility === "onna"
        ? onnaRows
        : all;

  const summary: RentalSummaryBreakdown = {
    selected: summarizeRentals(inFacility),
    center: summarizeRentals(centerRows),
    onna: summarizeRentals(onnaRows),
  };

  const visible =
    params.status === "confirmed"
      ? inFacility.filter((r) => isConfirmed(r))
      : inFacility;

  const totalPages = Math.max(1, Math.ceil(visible.length / RENTAL_PAGE_SIZE));
  const page = Math.min(Math.max(1, params.page), totalPages);
  const rows = visible.slice(
    (page - 1) * RENTAL_PAGE_SIZE,
    page * RENTAL_PAGE_SIZE
  );

  return {
    rows,
    summary,
    filtered: visible.length,
    page,
    totalPages,
    lastSyncAt: await readRentalLastSyncAt(),
  };
}

// [지금 동기화] — Cron 과 같은 동기화 코어를 수동 실행합니다.
//   읽기 전용 데이터의 재복제라 M0 전용으로 두지 않았습니다(시설 담당도 실행
//   가능). 예약을 바꾸는 동작이 아니므로 되돌릴 것도 없습니다.
//   중복 클릭은 화면 버튼의 pending 비활성으로 막고, 겹쳐 실행돼도 upsert 라
//   결과는 같습니다(멱등).
export async function syncRentalsNow(): Promise<
  | {
      ok: true;
      upserted: number;
      byType: Record<string, number>;
      incomplete: string[];
      message?: string;
    }
  | { ok: false; message: string }
> {
  try {
    await requireFacilityAccess();
    const summary = await runRentalSync();
    if (!summary.ok) {
      return {
        ok: false,
        message: summary.message ?? "대관예약을 가져오지 못했습니다.",
      };
    }
    revalidatePath("/hr/facility/rentals");
    return {
      ok: true,
      upserted: summary.upserted,
      byType: summary.byType,
      incomplete: summary.incomplete,
      message: summary.message,
    };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error ? e.message : "동기화 중 오류가 발생했습니다.",
    };
  }
}
