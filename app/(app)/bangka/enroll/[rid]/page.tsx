import Link from "next/link";
import { notFound } from "next/navigation";
import Tabs from "@/app/components/Tabs";
import { getRecruitment, listApplications } from "@/app/(app)/bangka/enroll/actions";
import { APP_STATUS_BADGE, RECRUIT_STATUS_BADGE } from "@/app/(app)/bangka/enroll/badges";
import ApplyLinkPanel from "@/app/(app)/bangka/enroll/[rid]/ApplyLinkPanel";
import { APP_STATUS_LABEL, RECRUITMENT_STATUS_LABEL, fmtKst, priorityLabel, type AppStatus } from "@/lib/bangkaEnroll";
import { bangkaBaseUrl } from "@/lib/bangkaEnrollServer";
import { fmtKstDateTime } from "@/lib/datetime";
import { btnSecondary, linkCls, panelToneCls, rowLinkCls, sectionTitleCls, tableHeadCls, tableRowCls } from "@/lib/ui";

export const dynamic = "force-dynamic";

const ORDER: AppStatus[] = ["submitted", "needs_fix", "docs_ok", "accepted", "waitlisted", "rejected", "draft"];

// 접수 목록 — ?status=submitted|…|all &drafts=1(작성중도 보기)
export default async function EnrollApplicationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ rid: string }>;
  searchParams: Promise<{ status?: string; drafts?: string }>;
}) {
  const { rid } = await params;
  const sp = await searchParams;
  const [rec, apps] = await Promise.all([getRecruitment(rid), listApplications(rid)]);
  if (!rec) notFound();

  const showDrafts = sp.drafts === "1";
  const status = (ORDER as string[]).includes(sp.status ?? "") ? (sp.status as AppStatus) : "all";
  const counts: Record<string, number> = {};
  for (const a of apps) counts[a.status] = (counts[a.status] ?? 0) + 1;
  const visible = apps.filter((a) =>
    status === "all" ? showDrafts || a.status !== "draft" : a.status === status,
  );
  const qs = (s: string, d = showDrafts) => {
    const p = new URLSearchParams();
    if (s !== "all") p.set("status", s);
    if (d) p.set("drafts", "1");
    const q = p.toString();
    return `/bangka/enroll/${rid}${q ? `?${q}` : ""}`;
  };
  const accepted = counts.accepted ?? 0;

  // 링크 발행 — 정식 신청 주소 + 문자 본문(머리말 [동래구청소년센터]는 문자 화면이 붙임)
  const applyUrl = `${bangkaBaseUrl() ?? "https://dongrae-bangka.vercel.app"}/apply`;
  const smsBody = [
    `방과후아카데미 ${rec.title} 안내`,
    `접수 기간: ${fmtKst(rec.apply_start_at)} ~ ${fmtKst(rec.apply_end_at)}`,
    rec.target_grades.length > 0 ? `대상: ${rec.target_grades.join("·")}` : null,
    `신청: ${applyUrl}`,
    "문의: 051-988-0924",
  ]
    .filter(Boolean)
    .join("\n");
  const tabs = [
    { key: "all", label: "전체", href: qs("all"), count: apps.filter((a) => showDrafts || a.status !== "draft").length },
    ...ORDER.filter((s) => s !== "draft" || showDrafts).map((s) => ({
      key: s,
      label: APP_STATUS_LABEL[s],
      href: qs(s),
      count: counts[s] ?? 0,
    })),
  ];

  return (
    <div className="space-y-4">
      <Link href="/bangka/enroll" className={`text-sm ${linkCls}`}>
        ← 모집 회차
      </Link>
      <section className={panelToneCls("blue")}>
        <div className="mb-3">
          <ApplyLinkPanel url={applyUrl} title={rec.title} smsBody={smsBody} />
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-bold text-ink">
              {rec.title}{" "}
              <span className={RECRUIT_STATUS_BADGE[rec.status]}>{RECRUITMENT_STATUS_LABEL[rec.status]}</span>
            </h3>
            <p className="mt-0.5 text-sm text-ink-body">
              {fmtKstDateTime(rec.apply_start_at)} ~ {fmtKstDateTime(rec.apply_end_at)} · 대상 {rec.target_grades.join("·") || "제한 없음"}
            </p>
            <p className="mt-1 text-sm">
              합격 <b>{accepted}</b>
              {rec.capacity != null ? (
                <>
                  {" "}
                  / 정원 <b>{rec.capacity}</b>
                  {accepted > rec.capacity && <span className="ml-1 text-stamp">(정원 초과)</span>}
                </>
              ) : (
                " (정원 미정)"
              )}
              {" · "}대기 {counts.waitlisted ?? 0} · 작성중 {counts.draft ?? 0}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={`/bangka/enroll/${rid}/export`} className={btnSecondary}>
              엑셀(민감정보 제외)
            </a>
            <a href={`/bangka/enroll/${rid}/export?sensitive=1`} className={btnSecondary}>
              엑셀(민감정보 포함)
            </a>
          </div>
        </div>
      </section>

      <section className={panelToneCls("green")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className={sectionTitleCls("green")}>접수 목록</h3>
          <Link href={qs(status === "draft" ? "all" : status, !showDrafts)} className={`text-sm ${linkCls}`}>
            {showDrafts ? "작성중 숨기기" : "작성중도 보기"}
          </Link>
        </div>
        <div className="mt-3">
          <Tabs variant="segment" ariaLabel="상태" value={status} items={tabs} />
        </div>
        {visible.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">해당하는 신청서가 없습니다.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className={tableHeadCls}>
                  <th className="py-2 pr-2">접수번호</th>
                  <th className="py-2 pr-2">이름</th>
                  <th className="py-2 pr-2">학교·학년</th>
                  <th className="py-2 pr-2">우선지원 유형</th>
                  <th className="py-2 pr-2">상태</th>
                  <th className="py-2">제출일</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((a) => (
                  <tr key={a.id} className={`${tableRowCls} ${rowLinkCls}`}>
                    <td className="py-2 pr-2">
                      <Link href={`/bangka/enroll/${rid}/${a.id}`} className={linkCls}>
                        {a.app_no ?? "(번호 없음)"}
                      </Link>
                    </td>
                    <td className="py-2 pr-2">
                      <Link href={`/bangka/enroll/${rid}/${a.id}`}>{a.youth_name ?? "(이름 없음)"}</Link>
                    </td>
                    <td className="py-2 pr-2 text-xs">{[a.school, a.grade].filter(Boolean).join(" ")}</td>
                    <td className="py-2 pr-2 text-xs">{a.priority_types.map(priorityLabel).join(", ")}</td>
                    <td className="py-2 pr-2">
                      <span className={APP_STATUS_BADGE[a.status]}>{APP_STATUS_LABEL[a.status]}</span>
                    </td>
                    <td className="py-2 text-xs">
                      {a.submitted_at ? fmtKstDateTime(a.submitted_at) : "-"}
                      {a.resubmitted_at && <span className="block text-ink-hint">다시 제출 {fmtKstDateTime(a.resubmitted_at)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
