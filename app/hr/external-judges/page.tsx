import Link from "next/link";
import Header from "@/app/components/Header";
import { enforcePasswordChange } from "@/app/actions";
import { requireHrAdmin } from "@/app/hr/actions";
import { listExternalJudges } from "@/app/hr/recruitment/[slug]/actions";
import ExternalJudgesManager from "./ExternalJudgesManager";

export const dynamic = "force-dynamic";

export default async function ExternalJudgesPage() {
  await enforcePasswordChange();
  await requireHrAdmin();

  const judges = await listExternalJudges();

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <div className="mb-5 flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-wide text-navy">
              동래구청소년센터
            </p>
            <h2 className="mt-0.5 text-2xl font-bold tracking-[0.1em] text-ink">
              외부 심사위원 명단
            </h2>
            <p className="mt-1 text-xs text-ink-muted">
              한 번 등록하면 여러 채용에 재사용할 수 있습니다.
            </p>
          </div>
          <Link href="/hr" className="text-sm text-ink-muted hover:underline">
            ← 인사 관리
          </Link>
        </div>
        <ExternalJudgesManager initialJudges={judges} />
      </main>
    </>
  );
}
