import Link from "next/link";
import { promotionAlerts, type PromotionAlert } from "@/lib/leavePromotionServer";
import { kstTodayYmd } from "@/lib/erp/duty";

// 관리자 대시보드 — 연차 사용촉진 기한 알림 카드(D-14 · D-3 · 기한 경과). 서버 컴포넌트.
//   페이지(/admin)가 이미 관장·master 만 통과시킵니다.
function Card({ title, tone, items }: { title: string; tone: "warn" | "urgent" | "over"; items: PromotionAlert[] }) {
  // 0건이면 회색으로 작게(관리자 대시보드 공통 규칙).
  const empty = items.length === 0;
  const cls = empty
    ? "border-line bg-surface/60"
    : tone === "over"
      ? "border-stamp/50 bg-stamp-soft/60"
      : tone === "urgent"
        ? "border-warning/60 bg-warning-soft/70"
        : "border-line bg-card";
  return (
    <Link href="/hr/leave-plans" className={`block rounded-xl border p-4 shadow-sm transition hover:border-navy ${cls}`}>
      <p className="text-xs font-semibold text-ink-muted">{title}</p>
      <p
        className={`mt-0.5 font-mono font-bold ${
          empty ? "text-base text-ink-hint" : `text-2xl ${tone === "over" ? "text-stamp" : tone === "urgent" ? "text-warning" : "text-navy"}`
        }`}
      >
        {items.length}건
      </p>
      {items.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-[11px] text-ink-body">
          {items.slice(0, 4).map((a, i) => (
            <li key={i}>
              {a.name} · {a.step} · {a.due.slice(5).replace("-", "/")}
              {a.left < 0 ? ` (+${-a.left}일)` : ` (D-${a.left})`}
            </li>
          ))}
          {items.length > 4 && <li className="text-ink-hint">외 {items.length - 4}건</li>}
        </ul>
      )}
    </Link>
  );
}

export default async function PromotionAlerts() {
  const year = Number(kstTodayYmd().slice(0, 4));
  const a = await promotionAlerts(year).catch(() => null);
  if (!a) return null;
  return (
    <section>
      <p className="mb-1.5 text-xs font-semibold text-ink-muted">연차 사용촉진 기한 ({year}년)</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card title="기한 D-14 이내" tone="warn" items={a.soon14} />
        <Card title="기한 D-3 이내" tone="urgent" items={a.soon3} />
        <Card title="기한 경과" tone="over" items={a.overdue} />
      </div>
    </section>
  );
}
