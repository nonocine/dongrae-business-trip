"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireFacilityAccess } from "@/lib/facilityAccess";
import { runRentalSync, readRentalLastSyncAt } from "@/lib/rentalSync";
import {
  RENTAL_TABLE,
  rentalMonthRange,
  isConfirmed,
  isCancelled,
  RENTAL_PAGE_SIZE,
  type RentalPageData,
  type RentalRow,
  type RentalSummary,
  type RentalTypeFilter,
  type RentalStatusFilter,
} from "@/lib/rental";

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

// PostgREST 한 번 응답의 행 상한. ★ 이 프로젝트 Supabase 는 1,000 행에서
//   자릅니다(실측). .range(0, 9999) 로도 안 늘어납니다 — 서버쪽 max-rows 라
//   클라이언트에서 못 올립니다.
//   ★ 그냥 select 하면 8월(2,511건)이 1,000건으로 조용히 잘려, 화면 건수가
//     홈페이지와 다른데 아무 오류도 안 납니다. 반드시 아래처럼 페이지를
//     돌며 다 받아야 합니다(lib/backupEngine.ts 와 같은 방식).
const FETCH_PAGE = 1000;

const COLUMNS =
  "reservation_no, reservation_type, reservation_date, start_time, end_time, space_name, room_name, purpose, program_name, applicant, team_name, person_total, person_disabled, status, status_name, reg_date, synced_at";

// 월(+구분) 조건의 행을 1,000건씩 나눠 전부 받습니다.
//   정렬을 고정하지 않으면 페이지 경계에서 행이 새거나 겹치므로
//   (날짜 → 시작시각 → 예약번호)로 완전 결정적 순서를 만듭니다.
async function fetchAllInMonth(
  month: string,
  type: RentalTypeFilter
): Promise<RentalRow[]> {
  const range = rentalMonthRange(month);
  const out: RentalRow[] = [];

  for (let from = 0; ; from += FETCH_PAGE) {
    let q = supabaseAdmin
      .from(RENTAL_TABLE)
      .select(COLUMNS)
      .order("reservation_date", { ascending: true })
      .order("start_time", { ascending: true, nullsFirst: true })
      .order("reservation_no", { ascending: true })
      .range(from, from + FETCH_PAGE - 1);

    if (range) {
      q = q
        .gte("reservation_date", range.start)
        .lt("reservation_date", range.end);
    }
    if (type !== "all") q = q.eq("reservation_type", type);

    const { data, error } = await q;
    // 조회 실패는 삼키지 않고 그대로 올립니다 — 빈 화면 대신 오류를 보여야
    //   "예약이 없는 것" 과 "못 불러온 것" 을 구분할 수 있습니다.
    if (error) throw new Error(error.message);

    const page = (data ?? []) as unknown as RentalRow[];
    out.push(...page);
    if (page.length < FETCH_PAGE) break;
  }

  return out;
}

// 요약은 "확정(Y)" 기준입니다 — 신청 중·취소는 실제 이용이 아니므로 건수·
//   인원 합계에 넣지 않고, 몇 건인지만 따로 보여줍니다.
function summarize(rows: RentalRow[]): RentalSummary {
  let confirmed = 0;
  let personTotal = 0;
  let personDisabled = 0;
  let pending = 0;
  let cancelled = 0;

  for (const r of rows) {
    if (isConfirmed(r)) {
      confirmed += 1;
      personTotal += Number(r.person_total) || 0;
      personDisabled += Number(r.person_disabled) || 0;
    } else if (isCancelled(r)) {
      cancelled += 1;
    } else {
      pending += 1;
    }
  }

  return { confirmed, personTotal, personDisabled, pending, cancelled };
}

// 화면 한 번에 필요한 것(요약·목록·마지막 동기화 시각)을 함께 냅니다.
//   ★ 요약은 상태 필터와 무관하게 "그 달 전체" 로 계산합니다. '확정만' 을
//     보고 있어도 신청 중·취소가 몇 건인지는 알아야 하고, 필터를 바꿀 때마다
//     합계가 흔들리면 숫자를 믿을 수 없게 됩니다.
export async function loadRentalPage(params: {
  month: string;
  type: RentalTypeFilter;
  status: RentalStatusFilter;
  page: number;
}): Promise<RentalPageData> {
  await requireFacilityAccess();

  const all = await fetchAllInMonth(params.month, params.type);
  const summary = summarize(all);

  const visible =
    params.status === "confirmed" ? all.filter((r) => isConfirmed(r)) : all;

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
