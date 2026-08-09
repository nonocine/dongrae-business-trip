import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/app/components/Header";
import MyEmployeeProfileForm from "@/app/profile/hr/MyEmployeeProfileForm";
import MyTrainingsSection from "@/app/profile/hr/MyTrainingsSection";
import MyCertificatesSection from "@/app/profile/hr/MyCertificatesSection";
import MyHrTabs from "@/app/profile/hr/MyHrTabs";
import MyLeavePlanSection from "@/app/profile/hr/MyLeavePlanSection";
import { getMyProfile } from "@/app/profile/hr/actions";
import { getMyTrainings } from "@/app/profile/hr/trainingActions";
import { getMyLeavePlan } from "@/app/profile/hr/leavePlanActions";
import {
  listMyCertificates,
  listMyRequests,
  getMyCertificatePrefill,
} from "@/app/hr/certificates/actions";
import { enforcePasswordChange, getSession } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function MyHrPage() {
  // 임시 비밀번호 사용자는 비번 변경 페이지로 강제 이동
  await enforcePasswordChange();

  const session = await getSession();
  if (!session) redirect("/");

  const [my, myTrainings, myCerts, myCertRequests, certPrefill, myLeavePlan] =
    await Promise.all([
      getMyProfile(),
      getMyTrainings(),
      listMyCertificates(),
      listMyRequests(),
      getMyCertificatePrefill(),
      getMyLeavePlan(),
    ]);
  if (!my) redirect("/");

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div className="mb-5 flex items-end justify-between">
          <div>
            <p className="text-xs font-semibold tracking-wide text-navy">
              동래구청소년센터
            </p>
            <h2 className="mt-0.5 text-2xl font-bold tracking-[0.1em] text-ink">
              내 인사기록카드
            </h2>
          </div>
          <Link href="/" className="text-sm text-ink-muted hover:underline">
            ← 목록
          </Link>
        </div>
        {/* 한 페이지 세로 나열이 너무 길어 3개 탭으로 나눔(내용은 그대로 이동). */}
        <MyHrTabs
          info={
            <MyEmployeeProfileForm
              driverId={my.driver.id}
              driverName={my.driver.name}
              profile={my.profile}
            />
          }
          certs={
            <MyCertificatesSection
              history={myCerts}
              requests={myCertRequests}
              defaultDuty={certPrefill?.defaultDuty ?? ""}
              canIssue={certPrefill?.canIssue ?? false}
            />
          }
          trainings={
            myTrainings ? (
              <MyTrainingsSection initial={myTrainings} />
            ) : (
              <p className="py-6 text-center text-sm text-ink-hint">
                올해 등록된 의무교육이 없습니다.
              </p>
            )
          }
          leave={
            myLeavePlan ? (
              <MyLeavePlanSection initial={myLeavePlan} />
            ) : (
              <p className="py-6 text-center text-sm text-ink-hint">
                발부된 연차 사용계획서가 없습니다. (담당자가 발부하면 여기에
                표시됩니다)
              </p>
            )
          }
        />
      </main>
    </>
  );
}
