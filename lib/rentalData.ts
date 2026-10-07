import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  RENTAL_TABLE,
  rentalMonthRange,
  isConfirmed,
  isCancelled,
  type RentalRow,
  type RentalSummary,
  type RentalTypeFilter,
} from "@/lib/rental";

// =====================================================================
// 대관예약 조회 — 화면(hr/facility/rentals/actions.loadRentalPage)과 MCP 가
//   같은 쿼리·같은 집계 규칙을 씁니다. 권한 확인은 호출부 책임입니다.
//   ⚠️ 행에는 신청자명(applicant, 개인정보)이 있습니다. MCP 는 summarizeRentals
//     결과(건수·인원)만 내보냅니다.
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
export async function fetchAllRentalsInMonth(
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
export function summarizeRentals(rows: RentalRow[]): RentalSummary {
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
