import { redirect } from "next/navigation";
import { resolveFacilityAccess } from "@/lib/facilityAccess";
import { kstTodayYmd } from "@/lib/trainings";
import {
  isRentalTypeFilter,
  isRentalStatusFilter,
  type RentalTypeFilter,
  type RentalStatusFilter,
} from "@/lib/rental";
import { loadRentalPage } from "@/app/hr/facility/rentals/actions";
import RentalReservationsView from "@/app/hr/facility/rentals/RentalReservationsView";

export const dynamic = "force-dynamic";

// 시설관리 > 대관예약 — 읽기 전용.
//   홈페이지(onnainna.kr) 대관·청소년 공간 예약을 하루 1회 동기화한 사본을
//   보여줍니다. 접근은 layout(resolveFacilityAccess)에서 가드하지만,
//   운행기록·비품관리와 같은 형태로 여기서도 방어적으로 다시 확인합니다.
export default async function FacilityRentalsPage({
  searchParams,
}: {
  searchParams: Promise<{
    month?: string;
    type?: string;
    status?: string;
    page?: string;
  }>;
}) {
  const access = await resolveFacilityAccess();
  if (!access) redirect("/");

  const sp = await searchParams;

  // month 가 아예 없으면 이번 달(기본), 빈 값(?month=)이면 전체 기간.
  //   운행기록과 같은 방식입니다.
  const month =
    sp.month === undefined
      ? kstTodayYmd().slice(0, 7)
      : /^\d{4}-\d{2}$/.test(sp.month)
        ? sp.month
        : "";

  const type: RentalTypeFilter = isRentalTypeFilter(sp.type) ? sp.type : "all";
  // 기본은 '확정만' — 취소된 건이 섞이면 대관 건수를 잘못 읽습니다.
  const status: RentalStatusFilter = isRentalStatusFilter(sp.status)
    ? sp.status
    : "confirmed";
  const page = Math.max(1, Number(sp.page) || 1);

  const data = await loadRentalPage({ month, type, status, page });

  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-muted">
        홈페이지 대관·청소년 공간 예약입니다. 하루 1회 자동으로 가져오며 조회만
        할 수 있습니다 —{" "}
        <span className="font-semibold">
          예약 작성·수정·취소는 홈페이지에서
        </span>{" "}
        하고, 여기는 조회 전용입니다.
      </p>
      <RentalReservationsView
        data={data}
        month={month}
        type={type}
        status={status}
      />
    </div>
  );
}
