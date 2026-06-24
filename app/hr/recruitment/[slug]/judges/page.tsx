import Link from "next/link";
import { notFound } from "next/navigation";
import Header from "@/app/components/Header";
import { enforcePasswordChange, listDrivers } from "@/app/actions";
import { requireHrAdmin } from "@/app/hr/actions";
import { splitRecruitmentFields, fieldBadgeCls } from "@/lib/ui";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeExternalJudge } from "@/lib/supabase";
import { getPostingForAdmin, listJudges } from "../actions";
import JudgesAssignManager from "./JudgesAssignManager";
import JudgeLoginShare from "./JudgeLoginShare";

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

  // 외부위원 풀은 service_role(supabaseAdmin)로 직접 조회합니다.
  //   * RLS 를 우회해야 하며 anon 으로는 빈 결과가 나옵니다.
  //   * 페이지 상단 requireHrAdmin 으로 이미 권한 게이트되어 있습니다.
  const [poolRes, judges, drivers] = await Promise.all([
    supabaseAdmin
      .from("external_judges_pool")
      .select("*")
      .order("created_at", { ascending: false }),
    listJudges(adm.posting.id),
    listDrivers(), // 활성 직원만 — 내부위원 배정 후보
  ]);
  if (poolRes.error) throw new Error(poolRes.error.message);
  const pool = (poolRes.data ?? []).map((r) =>
    normalizeExternalJudge(r as Record<string, unknown>)
  );

  const fields = splitRecruitmentFields(adm.posting.field);
  // 이 공고 로그인 QR 의 대상 — 배정된 활성 외부위원 명단.
  const judgeNames = judges
    .filter((j) => j.is_active && j.judge_type === "external")
    .map((j) => j.name)
    .filter((n) => n.trim().length > 0);

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
              <span className="text-xs text-ink-hint">· 심사위원 배정</span>
            </div>
          </div>
          <Link
            href={`/hr/recruitment/${slug}`}
            className="shrink-0 text-sm text-ink-muted hover:underline"
          >
            ← 채용 관리
          </Link>
        </div>

        <JudgeLoginShare slug={slug} judgeNames={judgeNames} />

        <JudgesAssignManager
          slug={slug}
          pool={pool}
          judges={judges}
          drivers={drivers.map((d) => ({
            id: d.id,
            name: d.name,
            rank: d.rank,
          }))}
        />
      </main>
    </>
  );
}
