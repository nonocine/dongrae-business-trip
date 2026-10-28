import Link from "next/link";
import Tabs from "@/app/components/Tabs";
import { canEditTalkSettings, countOpenTalks, getTalkHours, listTalkThreads } from "@/app/(app)/bangka/talk/actions";
import { BK_SCOPE_LABEL, fmtKstShort, type BkScope } from "@/lib/bangkaContent";
import { TALK_STATUS_LABEL, type TalkClassFilter, type TalkStatus, type TalkView } from "@/lib/bangkaTalk";
import { hoursSummary } from "@/lib/talkHours";
import { badgeDanger, badgeNeutral, badgeSuccess, badgeWarning, btnSecondary, panelToneCls, rowLinkCls, sectionTitleCls } from "@/lib/ui";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<TalkStatus, string> = { open: badgeWarning, answered: badgeSuccess, closed: badgeNeutral };
const VIEWS: { key: TalkView; label: string }[] = [
  { key: "open", label: "미답변" },
  { key: "all", label: "전체" },
  { key: "closed", label: "닫힘" },
];
const CLASSES: { key: TalkClassFilter; label: string }[] = [
  { key: "all", label: "모든 반" },
  { key: "ieum", label: "이음반" },
  { key: "jieum", label: "지음반" },
];

// 방카톡 — ?view=open(미답변, 기본·오래된 순)|all|closed &cls=all|ieum|jieum
//   미답변이 "다음 운영일 끝"까지 답이 없으면 빨갛게(결정 3).
export default async function BangkaTalkPage({ searchParams }: { searchParams: Promise<{ view?: string; cls?: string }> }) {
  const sp = await searchParams;
  const view: TalkView = VIEWS.some((v) => v.key === sp.view) ? (sp.view as TalkView) : "open";
  const cls: TalkClassFilter = CLASSES.some((c) => c.key === sp.cls) ? (sp.cls as TalkClassFilter) : "all";
  const [rows, hours, canEdit, openCount] = await Promise.all([
    listTalkThreads(view, cls),
    getTalkHours(),
    canEditTalkSettings(),
    countOpenTalks(),
  ]);
  const href = (v: TalkView, c: TalkClassFilter) => `/bangka/talk?view=${v}${c === "all" ? "" : `&cls=${c}`}`;
  const staleCount = rows.filter((r) => r.stale).length;

  return (
    <div className="space-y-4">
      <div className={`${panelToneCls("blue")} space-y-3`}>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs variant="segment" ariaLabel="보기" value={view} items={VIEWS.map((v) => ({ ...v, href: href(v.key, cls) }))} />
          <Tabs variant="segment" ariaLabel="반" value={cls} items={CLASSES.map((c) => ({ ...c, href: href(view, c.key) }))} />
          <Link href="/bangka/talk/settings" className={`ml-auto min-h-11 sm:min-h-0 ${btnSecondary}`}>
            운영시간{canEdit ? " 설정" : " 보기"}
          </Link>
        </div>
        <p className="text-xs text-ink-muted">
          보호자 작성 가능: {hoursSummary(hours)}
          {hours.block_holidays ? " · 공휴일 막음" : ""} · 직원 답글은 시간 제한 없음. 보호자 글은 그 보호자와 직원만 봅니다.
        </p>
      </div>

      <div className={panelToneCls("green")}>
        <h3 className={sectionTitleCls("green")}>
          {VIEWS.find((v) => v.key === view)?.label} {rows.length}건
          {view !== "open" && openCount > 0 ? ` · 미답변 ${openCount}건` : ""}
          {staleCount > 0 ? ` · 답이 늦은 문의 ${staleCount}건` : ""}
        </h3>
        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">{view === "open" ? "답을 기다리는 문의가 없습니다." : "문의가 없습니다."}</p>
        ) : (
          <ul className="mt-3 divide-y divide-rule">
            {rows.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/bangka/talk/${r.id}`}
                  className={`${rowLinkCls} -mx-2 flex flex-col gap-1 rounded-md px-2 py-2.5 text-sm ${r.stale ? "bg-stamp-soft/60" : ""}`}
                >
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={STATUS_BADGE[r.status]}>{TALK_STATUS_LABEL[r.status]}</span>
                    {r.stale && <span className={badgeDanger}>답이 늦음</span>}
                    <b className="text-ink">{r.guardianName} 보호자</b>
                    {r.studentName && <span className="text-ink">({r.studentName})</span>}
                    {r.classCodes.length > 0 && (
                      <span className="text-ink-muted">{r.classCodes.map((c) => BK_SCOPE_LABEL[c as BkScope] ?? c).join("·")}</span>
                    )}
                    <span className={`ml-auto text-xs ${r.stale ? "font-semibold text-stamp" : "text-ink-muted"}`}>
                      {r.waiting ? `기다린 지 ${r.waiting}` : fmtKstShort(r.lastMessageAt)}
                    </span>
                  </span>
                  <span className="break-words font-medium text-ink">{r.topicTitle}</span>
                  {r.preview && <span className="line-clamp-2 break-words text-ink-muted">{r.preview}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
