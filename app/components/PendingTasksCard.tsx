import Link from "next/link";
import { pendingTaskTotal, type PendingTask } from "@/lib/pendingTasks";

// 메인 화면 맨 위 "확인할 일 n건" — 대상자(M0·hr 직무)에게만, 0건이면 그리지 않습니다.
//   목록 계산은 lib/pendingTasks(헤더 배지·관리자 대시보드·아침 슬랙 DM 과 같은 함수).
export default function PendingTasksCard({ tasks }: { tasks: PendingTask[] }) {
  const total = pendingTaskTotal(tasks);
  if (total === 0) return null;
  return (
    <section className="rounded-xl border border-stamp/40 bg-stamp-soft/40 p-4 shadow-sm">
      <h3 className="flex items-center gap-2 text-sm font-bold text-stamp">
        <span aria-hidden>🔔</span>
        확인할 일 {total}건
      </h3>
      <ul className="mt-2 divide-y divide-line/70">
        {tasks.map((t, i) => (
          <li key={`${t.kind}-${i}`} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">
                {t.label} <span className="font-mono text-stamp">{t.count}건</span>
              </p>
              {t.names.length > 0 && (
                <p className="truncate text-xs text-ink-muted">
                  {t.names.slice(0, 5).join(", ")}
                  {t.names.length > 5 && ` 외 ${t.names.length - 5}`}
                </p>
              )}
            </div>
            <Link
              href={t.href}
              className="shrink-0 rounded-md border border-line bg-card px-2.5 py-1 text-xs font-semibold text-navy hover:bg-surface"
            >
              바로가기
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
