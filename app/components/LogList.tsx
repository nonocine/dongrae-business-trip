import type { DrivingLog } from "@/lib/supabase";
import DeleteButton from "@/app/components/DeleteButton";

function formatDate(d: string) {
  const [y, m, day] = d.split("-");
  return `${y}.${m}.${day}`;
}

function formatNumber(n: number) {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 }).format(n);
}

export default function LogList({
  logs,
  isAdmin,
}: {
  logs: DrivingLog[];
  isAdmin: boolean;
}) {
  if (logs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        해당 기간에 등록된 운행일지가 없습니다.
      </div>
    );
  }

  return (
    <ul className="space-y-2.5">
      {logs.map((log) => (
        <li
          key={log.id}
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-[color:var(--brand)]">
                {formatDate(log.driven_at)}
              </p>
              <p className="mt-0.5 text-base font-semibold text-slate-900">
                {log.purpose}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-500">운행거리</p>
              <p className="text-base font-bold text-slate-900">
                {formatNumber(log.distance)} km
              </p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
            <div className="flex gap-2">
              <span className="w-14 shrink-0 text-slate-500">운전자</span>
              <span className="font-medium text-slate-800">{log.driver}</span>
            </div>
            <div className="flex gap-2">
              <span className="w-14 shrink-0 text-slate-500">확인</span>
              <span className="font-medium text-slate-800">{log.confirmed_by}</span>
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <span className="w-14 shrink-0 text-slate-500">출발</span>
              <span className="text-slate-800">{log.departure}</span>
            </div>
            {log.waypoint && (
              <div className="flex gap-2 sm:col-span-2">
                <span className="w-14 shrink-0 text-slate-500">목적</span>
                <span className="text-slate-800">{log.waypoint}</span>
              </div>
            )}
            <div className="flex gap-2 sm:col-span-2">
              <span className="w-14 shrink-0 text-slate-500">도착</span>
              <span className="text-slate-800">{log.destination}</span>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2">
            <p className="text-xs text-slate-500">
              누적{" "}
              <span className="font-semibold text-slate-700">
                {formatNumber(log.total_distance)} km
              </span>
            </p>
            {isAdmin && <DeleteButton id={log.id} />}
          </div>
        </li>
      ))}
    </ul>
  );
}
