import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/app/components/Header";
import { enforcePasswordChange } from "@/app/actions";
import { resolveTrainingAccess } from "@/lib/trainingAccess";
import {
  listTrainingYears,
  listTrainings,
  getTrainingMatrix,
} from "@/app/hr/trainings/actions";
import { kstTodayYmd } from "@/lib/trainings";
import TrainingsManager from "@/app/hr/trainings/TrainingsManager";

export const dynamic = "force-dynamic";

export default async function TrainingsPage() {
  await enforcePasswordChange();

  // 접근: M0(관장·부장·master) 또는 hr(인사) 직무만. 그 외 / 로.
  const access = await resolveTrainingAccess();
  if (!access) redirect("/");

  const thisYear = Number(kstTodayYmd().slice(0, 4));
  const years = await listTrainingYears();
  const initialYear = years[0] ?? thisYear;

  const [trainings, matrix] = await Promise.all([
    listTrainings(initialYear),
    getTrainingMatrix(initialYear),
  ]);

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <div className="mb-5 flex items-end justify-between">
          <div>
            <p className="text-xs font-semibold tracking-wide text-navy">
              동래구청소년센터
            </p>
            <h2 className="mt-0.5 text-2xl font-bold tracking-[0.1em] text-ink">
              법정의무교육 관리
            </h2>
            <p className="mt-1 text-xs text-ink-muted">
              교육 목록을 등록하면 직원이 각자 마이페이지에서 수료증을 올려
              이수합니다. 현황은 아래 현황판에 자동 집계됩니다.
            </p>
          </div>
          <Link href="/" className="text-sm text-ink-muted hover:underline">
            ← 목록
          </Link>
        </div>

        <TrainingsManager
          initialYear={initialYear}
          thisYear={thisYear}
          years={years}
          trainings={trainings}
          matrix={matrix}
          isM0={access.isM0}
        />
      </main>
    </>
  );
}
