"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  badgeNavy,
  badgeNeutral,
  badgeSuccess,
  badgeWarning,
  btnDanger,
  btnPrimary,
  btnSecondary,
  cardCls,
  inputCls,
  labelCls,
  linkCls,
  noticeError,
  noticeSuccess,
  rowLinkCls,
  tableHeadCls,
  tableRowCls,
} from "@/lib/ui";
import {
  articleCountsForYear,
  pressReleaseEmails,
  type PressArticle,
  type PressReporter,
} from "@/lib/press";
import {
  applyPendingEmail,
  approveArticle,
  collectPressNow,
  createManualReporter,
  deleteReporter,
  dismissPendingEmail,
  fixArticleUrl,
  rejectArticle,
  restoreRejectedArticle,
  updateReporterManual,
  type ManualFieldsInput,
  type PressActionResult,
  type PressCollectRun,
} from "./actions";
import Tabs from "@/app/components/Tabs";

type Tab = "reporters" | "articles";

type Notice = { kind: "ok" | "error"; text: string } | null;

// 서버 액션 호출 공통 — 가드 거부(throw)도 화면 문구로 바꿉니다.
function useAction(setNotice: (n: Notice) => void) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<PressActionResult>, okText: string, after?: () => void) =>
    start(async () => {
      try {
        const r = await fn();
        if (r.ok) {
          setNotice({ kind: "ok", text: okText });
          after?.();
          router.refresh();
        } else {
          setNotice({ kind: "error", text: r.error });
        }
      } catch (e) {
        setNotice({ kind: "error", text: e instanceof Error ? e.message : "처리하지 못했습니다." });
      }
    });
  return { pending, run };
}

function NoticeLine({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <p className={notice.kind === "ok" ? noticeSuccess : noticeError}>{notice.text}</p>
  );
}

function SourceBadge({ source }: { source: PressReporter["source"] }) {
  return source === "manual" ? (
    <span className={badgeNavy}>수동</span>
  ) : (
    <span className={badgeNeutral}>자동</span>
  );
}

export default function PressManager({
  reporters,
  articles,
  lastRun,
  today,
  initialTab,
}: {
  reporters: PressReporter[];
  articles: PressArticle[];
  lastRun: PressCollectRun | null;
  today: string;
  initialTab: Tab;
}) {
  const visibleCount = articles.filter((a) => a.review_status !== "rejected").length;
  const [tab, setTab] = useState<Tab>(initialTab);
  const switchTab = (t: Tab) => {
    setTab(t);
    window.history.replaceState(null, "", t === "articles" ? "?tab=articles" : "?");
  };

  return (
    <div className="space-y-4">
      <CollectBar lastRun={lastRun} />
      <ReviewQueue articles={articles} />
      <Tabs
        ariaLabel="보도자료"
        value={tab}
        onChange={switchTab}
        items={[
          { key: "reporters", label: "기자", icon: "contact", count: reporters.length },
          { key: "articles", label: "기사", icon: "newspaper", count: visibleCount },
        ]}
      />
      {tab === "reporters" ? (
        <ReportersTab reporters={reporters} articles={articles} today={today} />
      ) : (
        <ArticlesTab reporters={reporters} articles={articles} today={today} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// 자동 수집 — 마지막 수집 한 줄 + [지금 수집]
// ---------------------------------------------------------------------

function kstDateTime(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function CollectBar({ lastRun }: { lastRun: PressCollectRun | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<Notice>(null);

  const collect = () =>
    start(async () => {
      setNotice(null);
      try {
        const r = await collectPressNow();
        if (r.ok) {
          setNotice({ kind: "ok", text: r.summary ?? "수집했습니다." });
          router.refresh();
        } else setNotice({ kind: "error", text: r.error });
      } catch (e) {
        setNotice({ kind: "error", text: e instanceof Error ? e.message : "수집하지 못했습니다." });
      }
    });

  let line = "아직 자동 수집 기록이 없습니다.";
  let failed = false;
  if (lastRun) {
    const when = `${kstDateTime(lastRun.started_at)}${lastRun.trigger === "manual" ? " (수동)" : ""}`;
    if (!lastRun.finished_at) line = `수집 중… (${when} 시작)`;
    else if (lastRun.status === "failed") {
      failed = true;
      line = `마지막 수집: ${when} · 실패 — 관장 텔레그램 알림 확인`;
    } else {
      line =
        `마지막 수집: ${when} · 새 기사 ${lastRun.new_saved}건 · 확인 필요 ${lastRun.needs_review}건` +
        (lastRun.url_needs_check ? ` · 주소 확인 ${lastRun.url_needs_check}건` : "") +
        (lastRun.status === "partial" ? " · 일부 오류" : "");
    }
  }

  return (
    <section className={`${cardCls} flex flex-wrap items-center justify-between gap-2 py-3`}>
      <div className="min-w-0">
        <p className={`text-sm ${failed ? "font-semibold text-stamp" : "text-ink-body"}`}>📰 {line}</p>
        <p className="mt-0.5 text-xs text-ink-hint">평일 아침 8시 자동 수집(네이버·구글 뉴스, 최근 7일). 새 기사만 슬랙 #14_보도자료관련에 공유합니다.</p>
        {notice && (
          <div className="mt-2">
            <NoticeLine notice={notice} />
          </div>
        )}
      </div>
      <button type="button" className={btnSecondary} onClick={collect} disabled={pending}>
        {pending ? "수집 중… (1분 정도)" : "지금 수집"}
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------
// 확인할 기사 — 확인 필요(승인/제외) · 주소 확인 필요(주소 고치기)
// ---------------------------------------------------------------------

function ReviewQueue({ articles }: { articles: PressArticle[] }) {
  const list = articles.filter((a) => a.review_status === "needs_review" || a.url_status === "needs_check");
  const [notice, setNotice] = useState<Notice>(null);
  if (list.length === 0) return null;
  return (
    <section className={`${cardCls} border-warning`}>
      <h3 className="text-sm font-semibold text-ink">
        확인할 기사 <span className={`ml-1 ${badgeWarning}`}>{list.length}</span>
      </h3>
      <p className="mt-1 text-xs text-ink-muted">
        자동 수집이 판단하지 못한 기사입니다. <b>승인</b>하면 홍보 실적·기자에 반영되고(묶음기사는 실적 제외),{" "}
        <b>제외</b>하면 목록에서 숨깁니다(다시 수집되지 않음). 확인 필요 기사는 슬랙에 공유되지 않습니다.
      </p>
      <div className="mt-2">
        <NoticeLine notice={notice} />
      </div>
      <ul className="mt-2 divide-y divide-line">
        {list.map((a) => (
          <ReviewRow key={a.id} article={a} setNotice={setNotice} />
        ))}
      </ul>
    </section>
  );
}

function ReviewRow({ article: a, setNotice }: { article: PressArticle; setNotice: (n: Notice) => void }) {
  const { pending, run } = useAction(setNotice);
  const [url, setUrl] = useState("");
  return (
    <li className="py-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-ink-muted">{a.published_at}</span>
        <span className="text-ink-body">{a.outlet}</span>
        <a href={a.url} target="_blank" rel="noreferrer" className={linkCls}>
          {a.title}
        </a>
        {a.is_roundup && <span className={badgeWarning}>묶음기사</span>}
        {a.review_status === "needs_review" && <span className={badgeWarning}>확인 필요</span>}
        {a.url_status === "needs_check" && <span className={badgeWarning}>주소 확인 필요</span>}
      </div>
      {a.review_reason && <p className="mt-1 text-xs text-ink-muted">판정 사유: {a.review_reason}</p>}

      {a.url_status === "needs_check" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="url"
            className={`${inputCls} min-w-0 flex-1`}
            placeholder="언론사 기사 주소(https://…) — 위 링크를 열어 주소창의 주소를 붙여 넣으세요"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button
            type="button"
            className={btnSecondary}
            disabled={pending || !url.trim()}
            onClick={() => run(() => fixArticleUrl(a.id, url), "주소를 고쳤습니다.", () => setUrl(""))}
          >
            주소 고치기
          </button>
        </div>
      )}

      {a.review_status === "needs_review" && (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            className={btnPrimary}
            disabled={pending}
            onClick={() =>
              run(
                () => approveArticle(a.id),
                a.is_roundup ? "승인했습니다(묶음기사 — 실적 제외)." : "승인했습니다. 홍보 실적·기자에 반영했습니다.",
              )
            }
          >
            {pending ? "처리 중…" : "승인"}
          </button>
          <button
            type="button"
            className={btnSecondary}
            disabled={pending}
            onClick={() => run(() => rejectArticle(a.id), "제외했습니다.")}
          >
            제외
          </button>
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------
// 기자 탭
// ---------------------------------------------------------------------

function ReportersTab({
  reporters,
  articles,
  today,
}: {
  reporters: PressReporter[];
  articles: PressArticle[];
  today: string;
}) {
  const year = Number(today.slice(0, 4));
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const yearCounts = useMemo(() => articleCountsForYear(articles, year), [articles, year]);
  const emails = useMemo(() => pressReleaseEmails(reporters), [reporters]);

  // 기본 정렬: 올해 기사 수 많은 순 → 최근 기사일 최신 순 → 이름.
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return reporters
      .filter(
        (r) =>
          !s ||
          r.name.toLowerCase().includes(s) ||
          r.outlet.toLowerCase().includes(s) ||
          (r.email ?? "").toLowerCase().includes(s),
      )
      .sort(
        (a, b) =>
          (yearCounts.get(b.id) ?? 0) - (yearCounts.get(a.id) ?? 0) ||
          (b.last_article_at ?? "").localeCompare(a.last_article_at ?? "") ||
          a.name.localeCompare(b.name, "ko"),
      );
  }, [reporters, search, yearCounts]);

  const selected = reporters.find((r) => r.id === selectedId) ?? null;
  const pendingCount = reporters.filter((r) => r.pending_email).length;

  const copyEmails = async () => {
    if (emails.length === 0) {
      setNotice({ kind: "error", text: "보도자료 받기로 체크된 기자 중 이메일이 있는 사람이 없습니다." });
      return;
    }
    try {
      await navigator.clipboard.writeText(emails.join(", "));
      setNotice({ kind: "ok", text: `이메일 ${emails.length}개를 복사했습니다. 메일 받는 사람 칸에 붙여 넣으세요.` });
    } catch {
      setNotice({ kind: "error", text: "복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요." });
    }
  };

  return (
    <div className="space-y-4">
      <section className={cardCls}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">
            기자 명단{" "}
            <span className="ml-1 text-xs font-medium text-ink-hint">
              {rows.length} / {reporters.length}명 · 올해({year}) 기사 수 순
            </span>
            {pendingCount > 0 && (
              <span className={`ml-2 ${badgeWarning}`}>이메일 변경 확인 {pendingCount}</span>
            )}
          </h3>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnSecondary} onClick={copyEmails}>
              📋 보도자료 받기 이메일 복사 ({emails.length})
            </button>
            {!adding && (
              <button
                type="button"
                className={btnPrimary}
                onClick={() => {
                  setAdding(true);
                  setNotice(null);
                }}
              >
                ＋ 기자 직접 추가
              </button>
            )}
          </div>
        </div>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="이름·언론사·이메일로 검색"
          className={`${inputCls} mt-3`}
        />
        <div className="mt-3">
          <NoticeLine notice={notice} />
        </div>

        {adding && (
          <NewReporterForm
            onDone={() => setAdding(false)}
            setNotice={setNotice}
          />
        )}

        {reporters.length === 0 ? (
          <p className="mt-4 text-sm text-ink-muted">
            아직 기자가 없습니다. 헤르메스가 기사에서 기자를 찾으면 자동으로 추가되고, 직접 추가할 수도 있습니다.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className={tableHeadCls}>
                  <th className="py-2 pr-2">이름</th>
                  <th className="py-2 pr-2">언론사</th>
                  <th className="py-2 pr-2">이메일</th>
                  <th className="py-2 pr-2 text-right">올해 기사</th>
                  <th className="py-2 pr-2">최근 기사일</th>
                  <th className="py-2 text-center">보도자료 받기</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    tabIndex={0}
                    className={`${tableRowCls} ${rowLinkCls} ${r.id === selectedId ? "bg-surface" : ""}`}
                    onClick={() => {
                      setSelectedId(r.id === selectedId ? null : r.id);
                      setNotice(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setSelectedId(r.id === selectedId ? null : r.id);
                    }}
                  >
                    <td className="py-2 pr-2">
                      <span className="font-medium text-ink">{r.name}</span>{" "}
                      <SourceBadge source={r.source} />
                      {r.pending_email && <span className={`ml-1 ${badgeWarning}`}>이메일 변경 확인</span>}
                    </td>
                    <td className="py-2 pr-2 text-ink-body">{r.outlet}</td>
                    <td className="py-2 pr-2 text-ink-body">{r.email ?? <span className="text-ink-hint">없음</span>}</td>
                    <td className="py-2 pr-2 text-right font-semibold text-ink">{yearCounts.get(r.id) ?? 0}</td>
                    <td className="py-2 pr-2 text-ink-body">{r.last_article_at ?? "-"}</td>
                    <td className="py-2 text-center">{r.receive_press_release ? "✓" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected && (
        <ReporterDetail
          key={selected.id}
          reporter={selected}
          articles={articles.filter((a) => a.reporter_id === selected.id)}
          onClose={() => setSelectedId(null)}
          onDeleted={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

function ManualFields({
  value,
  onChange,
}: {
  value: ManualFieldsInput;
  onChange: (v: ManualFieldsInput) => void;
}) {
  const set = (k: keyof ManualFieldsInput, v: string | boolean) => onChange({ ...value, [k]: v });
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className={labelCls}>
        전화
        <input className={inputCls} value={value.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
      </label>
      <label className={labelCls}>
        담당 분야
        <input className={inputCls} value={value.beat ?? ""} onChange={(e) => set("beat", e.target.value)} placeholder="예: 교육·청소년" />
      </label>
      <label className={labelCls}>
        마지막 감사 메일
        <input type="date" className={inputCls} value={value.last_thanks_sent_at ?? ""} onChange={(e) => set("last_thanks_sent_at", e.target.value)} />
      </label>
      <label className="inline-flex cursor-pointer items-center gap-2 self-end pb-2 text-sm text-ink-body">
        <input
          type="checkbox"
          checked={value.receive_press_release !== false}
          onChange={(e) => set("receive_press_release", e.target.checked)}
          className="h-4 w-4 rounded border-line"
        />
        보도자료 받기
      </label>
      <label className={`${labelCls} sm:col-span-2`}>
        메모
        <textarea className={inputCls} rows={3} value={value.memo ?? ""} onChange={(e) => set("memo", e.target.value)} />
      </label>
    </div>
  );
}

function NewReporterForm({
  onDone,
  setNotice,
}: {
  onDone: () => void;
  setNotice: (n: Notice) => void;
}) {
  const [name, setName] = useState("");
  const [outlet, setOutlet] = useState("");
  const [email, setEmail] = useState("");
  const [manual, setManual] = useState<ManualFieldsInput>({ receive_press_release: true });
  const { pending, run } = useAction(setNotice);

  return (
    <div className="mt-4 rounded-lg border border-line bg-surface p-4">
      <h4 className="mb-3 text-sm font-semibold text-ink">기자 직접 추가</h4>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className={labelCls}>
          이름 *
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className={labelCls}>
          언론사 *
          <input className={inputCls} value={outlet} onChange={(e) => setOutlet(e.target.value)} />
        </label>
        <label className={labelCls}>
          이메일
          <input type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
      </div>
      <div className="mt-3">
        <ManualFields value={manual} onChange={setManual} />
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className={btnPrimary}
          disabled={pending}
          onClick={() =>
            run(() => createManualReporter({ ...manual, name, outlet, email }), `${name} 기자를 추가했습니다.`, onDone)
          }
        >
          {pending ? "저장 중…" : "추가"}
        </button>
        <button type="button" className={btnSecondary} onClick={onDone} disabled={pending}>
          취소
        </button>
      </div>
    </div>
  );
}

function ReporterDetail({
  reporter: r,
  articles,
  onClose,
  onDeleted,
}: {
  reporter: PressReporter;
  articles: PressArticle[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [notice, setNotice] = useState<Notice>(null);
  const [manual, setManual] = useState<ManualFieldsInput>({
    phone: r.phone ?? "",
    beat: r.beat ?? "",
    memo: r.memo ?? "",
    receive_press_release: r.receive_press_release,
    last_thanks_sent_at: r.last_thanks_sent_at ?? "",
  });
  const { pending, run } = useAction(setNotice);

  return (
    <section className={cardCls}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-ink">
            {r.name} <span className="text-sm font-medium text-ink-muted">· {r.outlet}</span>{" "}
            <SourceBadge source={r.source} />
          </h3>
          <p className="mt-1 text-xs text-ink-muted">
            이메일 {r.email ?? "없음"} · 처음 본 날 {r.first_seen_at ?? "-"} · 누적 기사 {r.article_count}건
          </p>
          {r.last_article_url && (
            <p className="mt-1 text-xs text-ink-muted">
              출처(최근 기사):{" "}
              <a href={r.last_article_url} target="_blank" rel="noreferrer" className={linkCls}>
                {r.last_article_title ?? r.last_article_url}
              </a>{" "}
              ({r.last_article_at})
            </p>
          )}
        </div>
        <button type="button" className={btnSecondary} onClick={onClose}>
          닫기
        </button>
      </div>

      {r.pending_email && (
        <div className="mt-3 rounded-lg border border-warning bg-warning-soft p-3 text-sm text-warning">
          <p className="font-semibold">이메일 변경 확인</p>
          <p className="mt-1">
            같은 이름·언론사로 다른 이메일이 들어왔습니다: <b>{r.pending_email}</b> (지금: {r.email ?? "없음"})
            {r.pending_email_url && (
              <>
                {" "}·{" "}
                <a href={r.pending_email_url} target="_blank" rel="noreferrer" className="underline">
                  근거 기사
                </a>
              </>
            )}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className={btnPrimary}
              disabled={pending}
              onClick={() => run(() => applyPendingEmail(r.id), "새 이메일로 바꿨습니다.")}
            >
              새 이메일로 바꾸기
            </button>
            <button
              type="button"
              className={btnSecondary}
              disabled={pending}
              onClick={() => run(() => dismissPendingEmail(r.id), "변경 요청을 무시했습니다.")}
            >
              무시
            </button>
          </div>
        </div>
      )}

      <div className="mt-4">
        <h4 className="mb-2 text-sm font-semibold text-ink">직접 관리하는 칸</h4>
        <ManualFields value={manual} onChange={setManual} />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={btnPrimary}
            disabled={pending}
            onClick={() => run(() => updateReporterManual(r.id, manual), "저장했습니다.")}
          >
            {pending ? "저장 중…" : "저장"}
          </button>
          <button
            type="button"
            className={btnDanger}
            disabled={pending}
            onClick={() => {
              if (!window.confirm(`${r.name} 기자를 명단에서 삭제할까요?\n기사 기록은 남고 기자 연결만 지워집니다.`)) return;
              run(() => deleteReporter(r.id), "삭제했습니다.", onDeleted);
            }}
          >
            삭제
          </button>
        </div>
        <div className="mt-2">
          <NoticeLine notice={notice} />
        </div>
      </div>

      <div className="mt-5">
        <h4 className="mb-2 text-sm font-semibold text-ink">우리 센터 기사 {articles.length}건</h4>
        {articles.length === 0 ? (
          <p className="text-sm text-ink-muted">연결된 기사가 없습니다.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {articles.map((a) => (
              <li key={a.id} className="flex gap-2">
                <span className="shrink-0 text-ink-muted">{a.published_at}</span>
                <a href={a.url} target="_blank" rel="noreferrer" className={linkCls}>
                  {a.title}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------
// 기사 탭
// ---------------------------------------------------------------------

const STATUS_LABEL: Record<PressArticle["reporter_status"], string> = {
  found: "",
  name_only: "이름만",
  not_found: "못 찾음",
};

function ArticlesTab({
  reporters,
  articles,
  today,
}: {
  reporters: PressReporter[];
  articles: PressArticle[];
  today: string;
}) {
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const [grouped, setGrouped] = useState(false);
  const [showRejected, setShowRejected] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const { pending, run } = useAction(setNotice);
  const names = useMemo(() => new Map(reporters.map((r) => [r.id, r.name])), [reporters]);
  const rejectedCount = articles.filter((a) => a.review_status === "rejected").length;

  const inRange = useMemo(
    () =>
      articles.filter(
        (a) =>
          (showRejected || a.review_status !== "rejected") &&
          (!from || a.published_at >= from) &&
          (!to || a.published_at <= to),
      ),
    [articles, from, to, showRejected],
  );

  // event_group 별 묶음 — 키 없는 기사는 맨 뒤 한 묶음.
  const groups = useMemo(() => {
    const m = new Map<string, PressArticle[]>();
    for (const a of inRange) {
      const k = a.event_group ?? "";
      m.set(k, [...(m.get(k) ?? []), a]);
    }
    return [...m.entries()].sort(([ka, va], [kb, vb]) =>
      ka === "" ? 1 : kb === "" ? -1 : vb[0].published_at.localeCompare(va[0].published_at),
    );
  }, [inRange]);

  const linkedCount = inRange.filter((a) => a.promotion_id).length;

  const table = (list: PressArticle[]) => (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className={tableHeadCls}>
            <th className="py-2 pr-2">날짜</th>
            <th className="py-2 pr-2">언론사</th>
            <th className="py-2 pr-2">제목</th>
            <th className="py-2 pr-2">기자</th>
            <th className="py-2">실적</th>
          </tr>
        </thead>
        <tbody>
          {list.map((a) => {
            const name = a.reporter_id ? names.get(a.reporter_id) : null;
            return (
              <tr key={a.id} className={tableRowCls}>
                <td className="whitespace-nowrap py-2 pr-2 text-ink-body">{a.published_at}</td>
                <td className="py-2 pr-2 text-ink-body">{a.outlet}</td>
                <td className="py-2 pr-2">
                  <a href={a.url} target="_blank" rel="noreferrer" className={linkCls}>
                    {a.title}
                  </a>
                  {a.is_roundup && <span className={`ml-1 ${badgeWarning}`}>묶음기사</span>}
                  {a.review_status === "needs_review" && <span className={`ml-1 ${badgeWarning}`}>확인 필요</span>}
                  {a.url_status === "needs_check" && <span className={`ml-1 ${badgeWarning}`}>주소 확인 필요</span>}
                  {a.review_status === "rejected" && (
                    <>
                      <span className={`ml-1 ${badgeNeutral}`}>제외함</span>{" "}
                      <button
                        type="button"
                        className="text-xs text-ink-muted underline"
                        disabled={pending}
                        onClick={() => run(() => restoreRejectedArticle(a.id), "확인 필요로 되돌렸습니다.")}
                      >
                        되돌리기
                      </button>
                    </>
                  )}
                </td>
                <td className="py-2 pr-2 text-ink-body">
                  {name ?? <span className="text-ink-hint">{STATUS_LABEL[a.reporter_status] || "삭제됨"}</span>}
                </td>
                <td className="py-2">
                  {a.promotion_id ? (
                    <span className={badgeSuccess}>연결됨</span>
                  ) : a.review_status === "needs_review" || a.review_status === "rejected" ? (
                    <span className="text-ink-hint">보류</span>
                  ) : a.is_roundup ? (
                    <span className={badgeNeutral}>제외</span>
                  ) : (
                    <span className="text-ink-hint">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <section className={cardCls}>
      <div className="flex flex-wrap items-end gap-3">
        <label className={labelCls}>
          시작
          <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className={labelCls}>
          끝
          <input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="inline-flex h-[38px] cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm">
          <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} className="h-4 w-4 rounded border-line" />
          <span className="text-ink-body">같은 내용끼리 묶어 보기</span>
        </label>
        {rejectedCount > 0 && (
          <label className="inline-flex h-[38px] cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm">
            <input type="checkbox" checked={showRejected} onChange={(e) => setShowRejected(e.target.checked)} className="h-4 w-4 rounded border-line" />
            <span className="text-ink-body">제외한 기사도 보기 ({rejectedCount})</span>
          </label>
        )}
      </div>
      <p className="mt-3 text-xs text-ink-muted">
        {inRange.length}건 · 홍보 실적(언론보도) 연결 {linkedCount}건. 묶음기사와 확인 필요 기사는 실적에 넣지 않습니다.
      </p>
      {notice && (
        <div className="mt-2">
          <NoticeLine notice={notice} />
        </div>
      )}

      <div className="mt-3">
        {inRange.length === 0 ? (
          <p className="text-sm text-ink-muted">이 기간에 기사가 없습니다.</p>
        ) : grouped ? (
          <div className="space-y-5">
            {groups.map(([key, list]) => (
              <div key={key || "__none__"}>
                <h4 className="mb-1 text-sm font-semibold text-ink">
                  {key || "묶음 없음"}{" "}
                  <span className="text-xs font-medium text-ink-hint">
                    언론사 {new Set(list.map((a) => a.outlet)).size}곳 · {list.length}건
                  </span>
                </h4>
                {table(list)}
              </div>
            ))}
          </div>
        ) : (
          table(inRange)
        )}
      </div>
    </section>
  );
}
