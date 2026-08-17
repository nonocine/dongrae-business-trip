import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/app/components/Header";
import { enforcePasswordChange } from "@/app/actions";
import { resolveCardAccess } from "@/lib/businessCardAccess";
import { isCardOcrConfigured } from "@/lib/businessCardOcr";
import { listBusinessCards } from "@/app/hr/cards/actions";
import CardsManager from "@/app/hr/cards/CardsManager";

export const dynamic = "force-dynamic";

export default async function BusinessCardsPage() {
  await enforcePasswordChange();

  // 접근: M0(관장·부장·master) 또는 hr(인사) 직무만. 그 외 / 로.
  const access = await resolveCardAccess();
  if (!access) redirect("/");

  const cards = await listBusinessCards();

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
              명함첩
            </h2>
            <p className="mt-1 text-xs text-ink-muted">
              명함을 찍거나 올리면 AI가 항목을 읽어 채웁니다. 확인·수정한 뒤
              저장하세요.
            </p>
          </div>
          <Link href="/" className="shrink-0 text-sm text-ink-muted hover:underline">
            ← 홈
          </Link>
        </div>

        <CardsManager
          initialCards={cards}
          scanAvailable={isCardOcrConfigured()}
        />
      </main>
    </>
  );
}
