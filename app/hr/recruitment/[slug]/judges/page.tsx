import Link from "next/link";
import { notFound } from "next/navigation";
import Header from "@/app/components/Header";
import { enforcePasswordChange } from "@/app/actions";
import { requireHrAdmin } from "@/app/hr/actions";
import { splitRecruitmentFields, fieldBadgeCls } from "@/lib/ui";
import { getPostingForAdmin, listJudges, listExternalJudges } from "../actions";
import JudgesAssignManager from "./JudgesAssignManager";

export const dynamic = "force-dynamic";

export default async function JudgesAssignPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await enforcePasswordChange();
  await requireHrAdmin();

  const { slug } = await params;
  const adm = await getPostingForAdmin(slug);
  if (!adm) notFound();

  // 활성 외부위원 풀 + 본 공고의 현재 위원 배정 상태.
  const [pool, judges] = await Promise.all([
    listExternalJudges(),
    listJudges(adm.posting.id),
  ]);

  const fields = splitRecruitmentFields(adm.posting.field);

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wide text-navy">
              동래구청소년센터
            </p>
            <h2 className="mt-0.5 truncate text-2xl font-bold tracking-[0.06em] text-ink">
              {adm.posting.title}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {fields.length > 0 ? (
                fields.map((f, i) => (
                  <span key={`${f}-${i}`} className={fieldBadgeCls(i)}>
                    {f}
                  </span>
                ))
              ) : (
                <span className="text-xs text-ink-muted">모집분야 미지정</span>
              )}
              <span className="text-xs text-ink-hint">· 외부위원 배정</span>
            </div>
          </div>
          <Link
            href={`/hr/recruitment/${slug}`}
            className="shrink-0 text-sm text-ink-muted hover:underline"
          >
            ← 채용 관리
          </Link>
        </div>

        <JudgesAssignManager slug={slug} pool={pool} judges={judges} />
      </main>
    </>
  );
}
