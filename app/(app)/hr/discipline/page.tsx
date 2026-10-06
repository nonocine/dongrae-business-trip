import Link from "next/link";
import { redirect } from "next/navigation";
import { enforcePasswordChange } from "@/app/actions";
import { resolveDisciplineAdmin } from "@/lib/hrDisciplineServer";
import { listDisciplineEmployees, getDisciplineBoard } from "@/app/(app)/hr/discipline/actions";
import DisciplineManager from "@/app/(app)/hr/discipline/DisciplineManager";

export const dynamic = "force-dynamic";

// 상벌·인사위원회 — 관장·부장(M0)만. hr 직무도 들어올 수 없습니다(관장 지시).
//   그 밖은 페이지 자체를 렌더하지 않으므로 RSC 페이로드에 아무것도 실리지 않습니다.
export default async function DisciplinePage({
  searchParams,
}: {
  searchParams: Promise<{ driver?: string; tab?: string }>;
}) {
  await enforcePasswordChange();
  const access = await resolveDisciplineAdmin();
  if (!access) redirect("/");
  const params = await searchParams;
  const [employees, board] = await Promise.all([listDisciplineEmployees(), getDisciplineBoard()]);
  const tab = params.tab === "incidents" || params.tab === "committees" ? params.tab : "records";

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold tracking-wide text-navy">동래구청소년센터</p>
          <h2 className="mt-0.5 text-2xl font-bold tracking-[0.1em] text-ink">상벌·인사위원회</h2>
          <p className="mt-1 text-xs text-ink-muted">
            취업규칙 53·55조, 운영규정 32·40·41조 기준. 승진제한 만료일과 재심청구 기한은 자동 계산됩니다.
          </p>
        </div>
        <Link href="/" className="text-sm text-ink-muted hover:underline">
          ← 목록
        </Link>
      </div>
      <DisciplineManager
        employees={employees}
        board={board}
        initialDriverId={employees.some((e) => e.driverId === params.driver) ? params.driver! : ""}
        initialTab={tab}
      />
    </div>
  );
}
