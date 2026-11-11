import Link from "next/link";
import { redirect } from "next/navigation";
import { isManagerAdmin } from "@/app/actions";
import { compareErpRentals, getErpStatus } from "@/app/(app)/admin/erp/actions";
import ErpStatusBoard from "@/app/(app)/admin/erp/ErpStatusBoard";
import RentalDiffView from "@/app/(app)/admin/erp/RentalDiffView";
import { kstTodayYmd, monthRange } from "@/lib/erp/duty";

export const dynamic = "force-dynamic";
// [지금 동기화] 서버 액션이 이 페이지 설정을 따릅니다 — 9개 API 를 다 받는 데 수십 초 걸릴 수 있습니다.
export const maxDuration = 300;

const isYmd = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async function ErpAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; from?: string; to?: string }>;
}) {
  // 관장·master 만(관리자 대시보드와 같은 기준).
  if (!(await isManagerAdmin())) redirect("/");
  const sp = await searchParams;
  const tab = sp.tab === "rentals" ? "rentals" : "status";

  const month = monthRange(kstTodayYmd());
  const from = isYmd(sp.from) ? sp.from : month.start;
  const to = isYmd(sp.to) && sp.to >= from ? sp.to : isYmd(sp.to) ? from : month.end;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-ink">ERP 동기화</h2>
        <Link href="/admin" className="text-sm text-ink-muted hover:underline">
          ← 관리자 대시보드
        </Link>
      </div>
      <div className="mb-4 flex gap-1" role="tablist">
        {[
          { key: "status", label: "동기화 상태", href: "/admin/erp" },
          { key: "rentals", label: "대관 차이 대조", href: "/admin/erp?tab=rentals" },
        ].map((t) => (
          <Link
            key={t.key}
            href={t.href}
            role="tab"
            aria-selected={tab === t.key}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
              tab === t.key ? "bg-navy text-white" : "border border-line bg-card text-ink-muted hover:bg-surface"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>
      {tab === "rentals" ? (
        <RentalDiffView result={await compareErpRentals(from, to)} />
      ) : (
        <ErpStatusBoard data={await getErpStatus()} />
      )}
    </div>
  );
}
