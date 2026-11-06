"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  badgeNeutral,
  badgeSuccess,
  badgeWarning,
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
import type { PressNewsArticle } from "./data";
// 관장 전용 액션 — 버튼은 canManage 일 때만 그리고, 액션 자체도 isManagerAdmin 으로 다시 막습니다.
import { restoreRejectedArticle } from "@/app/(app)/press/actions";

// 예전 /press 의 '기사' 탭을 옮긴 화면입니다(2026-11).
//   직원: 조회만. 관장(canManage): 제외한 기사 보기·되돌리기가 더 있습니다.

type Notice = { kind: "ok" | "error"; text: string } | null;

const STATUS_LABEL: Record<PressNewsArticle["reporter_status"], string> = {
  found: "",
  name_only: "이름만",
  not_found: "못 찾음",
};

const SOURCE_LABEL: Record<PressNewsArticle["source"], string> = {
  hermes: "헤르메스",
  manual: "직접 입력",
  "collector:naver": "자동 수집(네이버)",
  "collector:google": "자동 수집(구글)",
};

const REVIEW_LABEL: Record<PressNewsArticle["review_status"], string> = {
  auto: "자동 확정",
  approved: "확인 후 승인",
  needs_review: "확인 대기",
  rejected: "제외됨",
};

export default function PressNewsList({
  articles,
  reporterNames,
  canManage,
  today,
}: {
  articles: PressNewsArticle[];
  reporterNames: Record<string, string>;
  canManage: boolean;
  today: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const [search, setSearch] = useState("");
  const [grouped, setGrouped] = useState(false);
  const [showRejected, setShowRejected] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const rejectedCount = articles.filter((a) => a.review_status === "rejected").length;

  const restore = (id: string) =>
    start(async () => {
      try {
        const r = await restoreRejectedArticle(id);
        if (r.ok) {
          setNotice({ kind: "ok", text: "확인 필요로 되돌렸습니다. 보도자료 기자 화면에서 승인·제외하세요." });
          router.refresh();
        } else setNotice({ kind: "error", text: r.error });
      } catch (e) {
        setNotice({ kind: "error", text: e instanceof Error ? e.message : "처리하지 못했습니다." });
      }
    });

  const inRange = useMemo(() => {
    const s = search.trim().toLowerCase();
    return articles.filter(
      (a) =>
        (showRejected || a.review_status !== "rejected") &&
        (!from || a.published_at >= from) &&
        (!to || a.published_at <= to) &&
        (!s || a.title.toLowerCase().includes(s) || a.outlet.toLowerCase().includes(s)),
    );
  }, [articles, from, to, search, showRejected]);

  // event_group 별 묶음 — 키 없는 기사는 맨 뒤 한 묶음.
  const groups = useMemo(() => {
    const m = new Map<string, PressNewsArticle[]>();
    for (const a of inRange) {
      const k = a.event_group ?? "";
      m.set(k, [...(m.get(k) ?? []), a]);
    }
    return [...m.entries()].sort(([ka, va], [kb, vb]) =>
      ka === "" ? 1 : kb === "" ? -1 : vb[0].published_at.localeCompare(va[0].published_at),
    );
  }, [inRange]);

  const linkedCount = inRange.filter((a) => a.promotion_id).length;

  const detail = (a: PressNewsArticle) => {
    const name = a.reporter_id ? reporterNames[a.reporter_id] : null;
    return (
      <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 rounded-lg bg-surface p-3 text-xs">
        <dt className="text-ink-muted">보도일</dt>
        <dd className="text-ink-body">{a.published_at}</dd>
        <dt className="text-ink-muted">언론사</dt>
        <dd className="text-ink-body">{a.outlet}</dd>
        <dt className="text-ink-muted">원문</dt>
        <dd className="break-all">
          <a href={a.url} target="_blank" rel="noreferrer" className={linkCls}>
            {a.url}
          </a>
        </dd>
        <dt className="text-ink-muted">기자</dt>
        <dd className="text-ink-body">{name ?? (STATUS_LABEL[a.reporter_status] || "삭제됨")}</dd>
        <dt className="text-ink-muted">같은 내용 묶음</dt>
        <dd className="text-ink-body">{a.event_group ?? "—"}{a.is_roundup ? " · 묶음기사" : ""}</dd>
        <dt className="text-ink-muted">수집 경로</dt>
        <dd className="text-ink-body">{SOURCE_LABEL[a.source] ?? a.source}</dd>
        <dt className="text-ink-muted">확인 상태</dt>
        <dd className="text-ink-body">
          {REVIEW_LABEL[a.review_status]}
          {a.url_status === "needs_check" ? " · 주소 확인 필요" : ""}
        </dd>
        <dt className="text-ink-muted">홍보 실적</dt>
        <dd className="text-ink-body">
          {a.promotion_id
            ? "사업실적 › 홍보내용에 ‘언론보도’로 연결됨"
            : a.review_status === "needs_review" || a.review_status === "rejected"
              ? "보류 — 관장 확인 전에는 넣지 않습니다"
              : "연결 안 됨"}
        </dd>
      </dl>
    );
  };

  const table = (list: PressNewsArticle[]) => (
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
            const name = a.reporter_id ? reporterNames[a.reporter_id] : null;
            const open = openId === a.id;
            const toggle = () => setOpenId(open ? null : a.id);
            return (
              <Fragment key={a.id}>
                <tr
                  tabIndex={0}
                  className={`${tableRowCls} ${rowLinkCls} ${open ? "bg-surface" : ""}`}
                  onClick={toggle}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") toggle();
                  }}
                >
                  <td className="whitespace-nowrap py-2 pr-2 text-ink-body">{a.published_at}</td>
                  <td className="py-2 pr-2 text-ink-body">{a.outlet}</td>
                  <td className="py-2 pr-2">
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noreferrer"
                      className={linkCls}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {a.title}
                    </a>
                    {a.is_roundup && <span className={`ml-1 ${badgeWarning}`}>묶음기사</span>}
                    {a.review_status === "needs_review" && <span className={`ml-1 ${badgeWarning}`}>확인 대기</span>}
                    {a.url_status === "needs_check" && <span className={`ml-1 ${badgeWarning}`}>주소 확인 필요</span>}
                    {a.review_status === "rejected" && (
                      <>
                        <span className={`ml-1 ${badgeNeutral}`}>제외함</span>{" "}
                        {canManage && (
                          <button
                            type="button"
                            className="text-xs text-ink-muted underline"
                            disabled={pending}
                            onClick={(e) => {
                              e.stopPropagation();
                              restore(a.id);
                            }}
                          >
                            되돌리기
                          </button>
                        )}
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
                    ) : (
                      <span className="text-ink-hint">—</span>
                    )}
                  </td>
                </tr>
                {open && (
                  <tr>
                    <td colSpan={5} className="pb-3 pt-1">
                      {detail(a)}
                    </td>
                  </tr>
                )}
              </Fragment>
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
        <label className={`${labelCls} min-w-[12rem] flex-1`}>
          검색
          <input
            type="text"
            className={inputCls}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="제목·언론사"
          />
        </label>
        <label className="inline-flex h-[38px] cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm">
          <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} className="h-4 w-4 rounded border-line" />
          <span className="text-ink-body">같은 내용끼리 묶어 보기</span>
        </label>
        {canManage && rejectedCount > 0 && (
          <label className="inline-flex h-[38px] cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm">
            <input type="checkbox" checked={showRejected} onChange={(e) => setShowRejected(e.target.checked)} className="h-4 w-4 rounded border-line" />
            <span className="text-ink-body">제외한 기사도 보기 ({rejectedCount})</span>
          </label>
        )}
      </div>
      <p className="mt-3 text-xs text-ink-muted">
        {inRange.length}건 · 홍보 실적(언론보도) 연결 {linkedCount}건. 묶음기사도 실적에 넣고 ‘[묶음기사]’로 구분합니다. 확인 대기 기사는 승인 전까지 넣지 않습니다. 줄을 누르면 상세가 열립니다.
      </p>
      {notice && (
        <p className={`mt-2 ${notice.kind === "ok" ? noticeSuccess : noticeError}`}>{notice.text}</p>
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
