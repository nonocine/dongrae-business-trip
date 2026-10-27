import Link from "next/link";
import { redirect } from "next/navigation";
import ActivityForm from "@/app/(app)/new/[kind]/ActivityForm";
import {
  enforcePasswordChange,
  getActivity,
  getSession,
  getSettings,
  listDriverNames,
} from "@/app/actions";
import { ACTIVITY_ICON, ACTIVITY_LABEL } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// 활동 수정 — '활동 작성' 폼(ActivityForm)을 그대로 재사용하고 기존 값만 프리필합니다.
//   * 권한: 작성자 본인만(관장·부장도 다른 직원 활동은 보기만 — 상세로 돌려보냄).
//     화면 진입 단계에서 한 번, 저장 시 updateActivity 에서 다시 검증합니다.
export default async function EditActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await enforcePasswordChange();

  const [activity, session] = await Promise.all([getActivity(id), getSession()]);
  if (!activity || !session) redirect("/");

  const canEdit = session.name === activity.author;
  if (!canEdit) redirect(`/activities/${id}`);

  const [employees, settings] = await Promise.all([
    listDriverNames().catch(() => [] as string[]),
    getSettings().catch(() => null),
  ]);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-5 sm:py-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">
          <span aria-hidden className="mr-1.5">
            {ACTIVITY_ICON[activity.kind]}
          </span>
          {ACTIVITY_LABEL[activity.kind]} 수정
        </h2>
        <Link
          href={`/activities/${id}`}
          className="text-sm text-slate-500 hover:underline"
        >
          ← 상세
        </Link>
      </div>
      <ActivityForm
        kind={activity.kind}
        defaultDate={activity.start_date ?? ""}
        employees={employees}
        // 작성자는 수정 대상이 아닙니다 — 원 작성자로 고정 표시.
        lockedTraveler={activity.author}
        settings={settings}
        activity={activity}
      />
    </div>
  );
}
