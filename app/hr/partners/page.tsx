import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/app/components/Header";
import { enforcePasswordChange } from "@/app/actions";
import { resolvePartnerAccess } from "@/lib/partnerAccess";
import { listPartners } from "@/app/hr/partners/actions";
import PartnersManager from "@/app/hr/partners/PartnersManager";

export const dynamic = "force-dynamic";

export default async function BusinessPartnersPage() {
  await enforcePasswordChange();

  // 접근: M0(관장·부장·master) 또는 hr(인사) 직무만. 그 외 / 로.
  const access = await resolvePartnerAccess();
  if (!access) redirect("/");

  const partners = await listPartners();

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-wide text-navy">
              동래구청소년센터
            </p>
            <h2 className="mt-0.5 text-2xl font-bold tracking-[0.1em] text-ink">
              거래처 관리
            </h2>
            <p className="mt-1 text-xs text-ink-muted">
              분야별로 정리된 주소록입니다. 명함이 없어도 등록할 수 있고, 한
              거래처에 담당자를 여러 명 둘 수 있습니다.
            </p>
          </div>
          <Link
            href="/"
            className="shrink-0 text-sm text-ink-muted hover:underline"
          >
            ← 홈
          </Link>
        </div>

        <PartnersManager initialPartners={partners} />
      </main>
    </>
  );
}
