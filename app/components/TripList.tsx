import Link from "next/link";
import {
  TRANSPORT_ICON,
  TRANSPORT_LABEL,
  type BusinessTrip,
} from "@/lib/supabase";
import DeleteTripButton from "@/app/components/DeleteTripButton";

function formatDate(d: string) {
  const [y, m, day] = d.split("-");
  return `${y}.${m}.${day}`;
}

function groupByMonth(trips: BusinessTrip[]): { month: string; trips: BusinessTrip[] }[] {
  const map = new Map<string, BusinessTrip[]>();
  for (const t of trips) {
    const month = t.trip_date.slice(0, 7);
    const arr = map.get(month) ?? [];
    arr.push(t);
    map.set(month, arr);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([month, trips]) => ({ month, trips }));
}

export default function TripList({
  trips,
  isAdmin,
}: {
  trips: BusinessTrip[];
  isAdmin: boolean;
}) {
  if (trips.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        해당 기간에 등록된 출장일지가 없습니다.
      </div>
    );
  }

  const groups = groupByMonth(trips);

  return (
    <div className="space-y-5">
      {groups.map(({ month, trips }) => (
        <section key={month} className="space-y-2.5">
          <h2 className="text-sm font-bold text-slate-700">
            {month.replace("-", "년 ")}월
            <span className="ml-2 text-xs font-medium text-slate-400">
              {trips.length}건
            </span>
          </h2>
          <ul className="space-y-2.5">
            {trips.map((t) => (
              <TripItem key={t.id} trip={t} isAdmin={isAdmin} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function TripItem({ trip, isAdmin }: { trip: BusinessTrip; isAdmin: boolean }) {
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-[color:var(--brand)]/40 hover:shadow-md">
      <Link href={`/trips/${trip.id}`} className="block">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-[color:var(--brand)]">
              {formatDate(trip.trip_date)}
            </p>
            <p className="mt-0.5 truncate text-base font-semibold text-slate-900">
              {trip.destination}
            </p>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {trip.purpose}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
            {TRANSPORT_ICON[trip.transport_type]}{" "}
            {TRANSPORT_LABEL[trip.transport_type]}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500">출장자</span>
            <span className="font-medium text-slate-800">{trip.traveler}</span>
          </span>
          {trip.companion.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500">동행</span>
              <span className="text-slate-700">
                {trip.companion.join(", ")}
              </span>
            </span>
          )}
          {trip.photos.length > 0 && (
            <span className="text-xs text-slate-500">
              📷 {trip.photos.length}
            </span>
          )}
        </div>
      </Link>

      {isAdmin && (
        <div className="mt-3 flex justify-end border-t border-slate-100 pt-2">
          <DeleteTripButton id={trip.id} />
        </div>
      )}
    </li>
  );
}
