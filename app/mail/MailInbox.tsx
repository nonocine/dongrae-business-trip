"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  badgeNavy,
  badgeNeutral,
  badgeWarning,
  btnPrimary,
  btnSecondary,
  cardCls,
  inputCls,
  labelCls,
  noticeError,
  noticeSuccess,
  noticeWarning,
  tabBarCls,
  tabItemCls,
  tabNavCls,
} from "@/lib/ui";
import { fmtKstMonthDayTime } from "@/lib/datetime";
import {
  MAIL_STATUSES,
  MAIL_STATUS_BADGE,
  MAIL_STATUS_DOT,
  MAIL_STATUS_DOT_HINT,
  MAIL_STATUS_LABEL,
  MAIL_CATEGORY_BADGE,
  MAIL_CATEGORY_INDEX,
  MAIL_CATEGORY_INDEX_COLOR,
  MAIL_TRASH_FILTER,
  assigneeLabel,
  attachmentSkipNotice,
  formatBytes,
  hasPendingSuggestion,
  type MailDetail,
  type MailListView,
  type MailReply,
} from "@/lib/mail";
import {
  analyzeMailNow,
  applySuggestedAssignee,
  assignMail,
  bulkAssignMail,
  bulkPurgeMail,
  bulkRestoreMail,
  bulkSetMailStatus,
  bulkTrashMail,
  fetchMailNow,
  getMailDetail,
  getReplyDraft,
  listMailReplies,
  markMailOpened,
  restoreMail,
  saveMailMemo,
  sendMailReply,
  setMailStatus,
  signMailAttachment,
  trashMail,
} from "./actions";
import Button from "@/app/components/Button";

// 수신일 표기 — "2026-08-07 14:03". 값이 없으면 "-".
function formatReceived(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${kst.getUTCFullYear()}-${p2(kst.getUTCMonth() + 1)}-${p2(
    kst.getUTCDate(),
  )} ${p2(kst.getUTCHours())}:${p2(kst.getUTCMinutes())}`;
}

// 페이지당 건수 — 비품관리(app/hr/facility/assets)와 같은 20건/페이지 방식입니다.
const PAGE_SIZE = 20;

const navBtn =
  "rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-ink-body hover:bg-surface disabled:opacity-40";

// 일괄 액션 바 버튼
const bulkBtn =
  "rounded-md border border-line bg-card px-2.5 py-1 text-xs font-semibold text-ink-body hover:bg-surface disabled:opacity-50";
const bulkBtnDanger =
  "rounded-md border border-stamp bg-card px-2.5 py-1 text-xs font-semibold text-stamp hover:bg-stamp-soft disabled:opacity-50";

export default function MailInbox({
  view,
  filters,
}: {
  view: MailListView;
  filters: {
    status: string;
    assignee: string;
    q: string;
    unreadOnly: boolean;
    category: string; // "" = 전체(분류 필터 해제)
  };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [detail, setDetail] = useState<MailDetail | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [memo, setMemo] = useState("");
  const [search, setSearch] = useState(filters.q);

  // --- 답장(ML-7) ---
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyTo, setReplyTo] = useState("");
  const [replySubjectText, setReplySubjectText] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [replyMarkDone, setReplyMarkDone] = useState(true); // 기본 켬
  const [replyConfigured, setReplyConfigured] = useState(true);
  const [replies, setReplies] = useState<MailReply[]>([]);
  // 원문 인용은 본문과 분리해 보관하고, 보낼 때만 이어 붙입니다.
  const [replyQuote, setReplyQuote] = useState("");
  const [quoteOpen, setQuoteOpen] = useState(false);

  // --- 일괄 선택(ML-10) ---
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState<
    null | "trash" | "purge"
  >(null);

  // --- 페이지네이션(20건/페이지) — 비품관리와 같은 방식 ---
  //   목록은 서버(getMailList)에서 이미 필터·검색·안읽음이 적용된 채 내려옵니다.
  //   그 결과를 20건씩 잘라 보여주므로 페이지 계산은 항상 "필터된 전체 건수" 기준입니다.
  const [page, setPage] = useState(1);
  // 필터·검색·안읽음이 바뀌면(=URL 이 바뀌면) 1페이지로 되돌립니다.
  //   props 가 바뀌는 렌더에서 곧바로 보정합니다 — effect 로 맞추면 한 프레임 동안
  //   옛 페이지가 보이고 렌더가 한 번 더 돕니다.
  const filterKey = `${filters.status}|${filters.assignee}|${filters.q}|${
    filters.unreadOnly ? 1 : 0
  }|${filters.category}`;
  const [seenFilterKey, setSeenFilterKey] = useState(filterKey);
  if (filterKey !== seenFilterKey) {
    setSeenFilterKey(filterKey);
    setPage(1);
  }
  const totalPages = Math.max(1, Math.ceil(view.items.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageOffset = (safePage - 1) * PAGE_SIZE;
  // 이 페이지에 보이는 메일 — 선택·일괄 처리는 모두 이 목록을 기준으로 합니다.
  const pageItems = view.items.slice(pageOffset, pageOffset + PAGE_SIZE);

  const open = detail !== null;
  const trashView = filters.status === MAIL_TRASH_FILTER;

  // ★ 선택 목록은 "현재 화면에 보이는 것" 과 교집합으로 렌더 중에 계산합니다.
  //   필터가 바뀌어 사라진 메일의 id 가 state 에 남아 있어도 일괄 처리 대상이
  //   되지 않습니다 — 보이지 않는 메일이 삭제되는 사고를 막는 핵심 장치입니다.
  //   (effect 로 state 를 동기화하면 렌더가 연쇄로 돌고, 동기화 직전 클릭에
  //    안 보이는 id 가 섞일 수 있어 파생값으로 둡니다.)
  //   ⚠️ 페이지네이션 이후 "보이는 것" 은 현재 페이지의 20건입니다 — 다른 페이지의
  //   메일은 선택도 일괄 처리도 되지 않습니다(페이지를 넘기면 선택을 비웁니다).
  const selectedIds = pageItems
    .filter((i) => selected.has(i.id))
    .map((i) => i.id);
  const allVisibleSelected =
    pageItems.length > 0 && pageItems.every((i) => selected.has(i.id));

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // 전체 선택 = 이 페이지의 20건. 보이지 않는 페이지는 건드리지 않습니다.
  function toggleAll() {
    setSelected((prev) =>
      pageItems.length > 0 && pageItems.every((i) => prev.has(i.id))
        ? new Set()
        : new Set(pageItems.map((i) => i.id)),
    );
  }

  // 페이지 이동 — 선택은 비웁니다(안 보이는 건이 선택된 채 남지 않게).
  function goPage(p: number) {
    setPage(p);
    setSelected(new Set());
  }

  // 일괄 액션 공통 — 성공하면 선택을 비우고 목록을 새로고침합니다.
  function runBulk(
    task: () => Promise<{ ok: boolean; count?: number; message?: string }>,
    okText: (n: number) => string,
  ) {
    setMsg(null);
    start(async () => {
      const res = await task();
      if (!res.ok) {
        setMsg({ ok: false, text: res.message ?? "처리하지 못했습니다." });
        return;
      }
      setMsg({ ok: true, text: okText(res.count ?? 0) });
      setSelected(new Set());
      setConfirmBulk(null);
      router.refresh();
    });
  }

  // 모달이 열려 있는 동안 배경(목록) 스크롤을 잠그고, 닫을 때 원래 위치로 되돌립니다.
  //   body 를 position:fixed 로 고정하는 방식이라 iOS 사파리에서도 위치가 튀지 않습니다.
  //   의존성은 open(boolean) — 이전/다음 이동으로 detail 만 바뀔 때는 재실행되지 않습니다.
  useEffect(() => {
    if (!open) return;
    const y = window.scrollY;
    const body = document.body;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = `-${y}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      window.scrollTo(0, y);
    };
  }, [open]);

  const closeDetail = useCallback(() => {
    setDetail(null);
    setActiveIndex(null);
    setReplyOpen(false);
    setReplies([]);
  }, []);

  // ESC 로 닫기.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDetail();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeDetail]);

  function pushFilters(next: Partial<typeof filters>) {
    const merged = { ...filters, ...next };
    const params = new URLSearchParams();
    if (merged.status) params.set("status", merged.status);
    if (merged.assignee) params.set("assignee", merged.assignee);
    if (merged.q) params.set("q", merged.q);
    if (merged.unreadOnly) params.set("unread", "1");
    if (merged.category) params.set("category", merged.category);
    const qs = params.toString();
    router.push(qs ? `/mail?${qs}` : "/mail");
  }

  function openIndex(index: number) {
    const item = view.items[index];
    if (!item) return;
    // 이전/다음으로 페이지 경계를 넘었으면 뒤의 목록도 그 페이지로 따라갑니다.
    setPage(Math.floor(index / PAGE_SIZE) + 1);
    setMsg(null);
    setLoadingId(item.id);
    setReplyOpen(false);
    start(async () => {
      // 상세를 여는 순간 열람으로 기록합니다(최초 1회만 저장됨).
      const [found, replyList] = await Promise.all([
        getMailDetail(item.id),
        listMailReplies(item.id),
        markMailOpened(item.id),
      ]);
      setLoadingId(null);
      if (!found) {
        setMsg({ ok: false, text: "메일을 불러오지 못했습니다." });
        return;
      }
      setDetail(found);
      setActiveIndex(index);
      setMemo(found.memo);
      setReplies(replyList);
      // 목록의 '안읽음' 표시를 즉시 반영합니다.
      if (!item.opened) router.refresh();
    });
  }

  // [추천 적용] — 저장된 AI 추천을 담당자로 확정합니다(슬랙 DM 포함).
  //   목록·상세 양쪽에서 쓰므로 열려 있는 상세도 함께 갱신합니다.
  function applySuggestion(id: string) {
    setMsg(null);
    start(async () => {
      const res = await applySuggestedAssignee(id);
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      setMsg({
        ok: true,
        text: `${res.assignee} 담당으로 지정했습니다. (슬랙 DM 발송)`,
      });
      if (detail && detail.id === id) {
        const refreshed = await getMailDetail(id);
        if (refreshed) setDetail(refreshed);
      }
      router.refresh();
    });
  }

  // [AI 분석] — 수집 당시 분석되지 않은 메일을 사람이 직접 요청합니다.
  function analyzeNow(id: string) {
    setMsg(null);
    start(async () => {
      const res = await analyzeMailNow(id);
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      setMsg({
        ok: true,
        text: res.assigned
          ? `AI 분석 완료 — ${res.assigned} 담당으로 지정했습니다.`
          : "AI 분석을 완료했습니다.",
      });
      if (detail && detail.id === id) {
        const refreshed = await getMailDetail(id);
        if (refreshed) setDetail(refreshed);
      }
      router.refresh();
    });
  }

  // [답장] — 받는사람/제목/원문 인용을 서버에서 받아 폼을 채웁니다.
  function openReply(id: string) {
    setMsg(null);
    start(async () => {
      const draft = await getReplyDraft(id);
      if (!draft) {
        setMsg({ ok: false, text: "답장 정보를 불러오지 못했습니다." });
        return;
      }
      setReplyConfigured(draft.configured);
      setReplyTo(draft.to);
      setReplySubjectText(draft.subject);
      // 본문은 빈 칸에서 시작하고, 원문 인용은 접어 둡니다(보낼 때 이어 붙임).
      setReplyBody("");
      setReplyQuote(draft.quoted);
      setQuoteOpen(false);
      setReplyMarkDone(true);
      setReplyOpen(true);
    });
  }

  function submitReply() {
    if (!detail) return;
    setMsg(null);
    start(async () => {
      const res = await sendMailReply({
        id: detail.id,
        to: replyTo,
        subject: replySubjectText,
        // 접어 둔 원문 인용은 발송 시점에 본문 뒤로 붙입니다.
        body: `${replyBody.trim()}\n${replyQuote}`,
        markDone: replyMarkDone,
      });
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        // 실패 이력도 남으므로 목록을 새로고침합니다.
        setReplies(await listMailReplies(detail.id));
        return;
      }
      setMsg({ ok: true, text: "답장을 보냈습니다." });
      setReplyOpen(false);
      const [refreshed, replyList] = await Promise.all([
        getMailDetail(detail.id),
        listMailReplies(detail.id),
      ]);
      if (refreshed) setDetail(refreshed);
      setReplies(replyList);
      router.refresh();
    });
  }

  // 이전/다음 메일 — 목록 순서(최신순) 기준. 연속 확인용.
  function move(delta: number) {
    if (activeIndex == null) return;
    const next = activeIndex + delta;
    if (next < 0 || next >= view.items.length) return;
    openIndex(next);
  }

  function runAction(
    task: () => Promise<{ ok: boolean; message?: string }>,
    okText: string,
  ) {
    setMsg(null);
    start(async () => {
      const res = await task();
      if (!res.ok) {
        setMsg({ ok: false, text: res.message ?? "처리하지 못했습니다." });
        return;
      }
      setMsg({ ok: true, text: okText });
      if (detail) {
        const refreshed = await getMailDetail(detail.id);
        if (refreshed) setDetail(refreshed);
      }
      router.refresh();
    });
  }

  function openAttachment(
    path: string | null,
    name: string,
    reason: "too_large" | "failed" | null | undefined,
  ) {
    if (!path) {
      // 사본이 없는 이유를 구분해 안내합니다(예전에는 전부 "용량 초과" 였음).
      setMsg({ ok: false, text: attachmentSkipNotice(name, reason) });
      return;
    }
    setMsg(null);
    start(async () => {
      const url = await signMailAttachment(path);
      if (!url) {
        setMsg({ ok: false, text: "첨부 링크를 만들지 못했습니다." });
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    });
  }

  function collectNow() {
    setMsg(null);
    start(async () => {
      const res = await fetchMailNow();
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      // 최신 메일부터 가져오므로, 남은 건 "아직 못 본 최신" 이 아니라 과거 메일입니다.
      //   그 점이 드러나지 않으면 "왜 아직 최신이 없지" 로 읽힙니다.
      const tail =
        res.remaining > 0
          ? ` 최신 메일부터 가져왔고, 과거 메일 ${res.remaining}통은 이후 자동으로 수집됩니다.`
          : "";
      const failed = res.failed > 0 ? ` · 실패 ${res.failed}건` : "";
      // AI 분류는 부가기능이라 0건이어도 수집 자체는 성공입니다.
      const ai =
        res.classified > 0
          ? ` · AI 분류 ${res.classified}건(자동배정 ${res.autoAssigned}건)`
          : "";
      const dm = res.dmSent > 0 ? ` · 담당자 DM ${res.dmSent}건` : "";
      // DM 실패는 사유까지 그대로 보여줍니다(원인을 화면에서 바로 알 수 있게).
      const dmFail =
        res.dmFailures.length > 0
          ? `\n⚠️ 슬랙 DM 실패 — ${res.dmFailures
              .map((f) => `${f.name}: ${f.reason}`)
              .join(" / ")}`
          : "";
      setMsg({
        ok: res.dmFailures.length === 0,
        text:
          res.saved > 0
            ? `새 메일 ${res.saved}통을 가져왔습니다.${tail}${failed}${ai}${dm}${dmFail}`
            : `새 메일이 없습니다.${failed}`,
      });
      router.refresh();
    });
  }

  if (!view.configured)
    return (
      <section className={cardCls}>
        <h2 className="font-bold text-ink">메일 저장 준비가 필요합니다</h2>
        <p className="mt-2 text-sm leading-6 text-ink-muted">
          화면과 수집 기능은 준비됐습니다. 운영 Supabase에{" "}
          <code>mail_messages</code> 테이블을 적용하면 바로 사용할 수 있습니다.
        </p>
      </section>
    );

  // 분류 인덱스 항목 — 맨 앞이 "전체"(key "" = 필터 해제), 그다음 표시 순서대로.
  //   배지 숫자는 "안읽음" 건수이며 서버에서 다른 필터와 무관하게 세어 옵니다.
  const categoryTabs = [
    { key: "", label: "전체", count: view.unopenedCount },
    ...MAIL_CATEGORY_INDEX.map((c) => ({
      key: c as string,
      label: c as string,
      count: view.categoryUnopened[c] ?? 0,
    })),
  ];

  return (
    <div className="space-y-4">
      <section className={cardCls}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="grid flex-1 gap-2 sm:grid-cols-3">
            <label className={labelCls}>
              상태
              <select
                className={inputCls}
                value={filters.status}
                onChange={(e) => pushFilters({ status: e.target.value })}
              >
                <option value="">전체</option>
                {MAIL_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {MAIL_STATUS_LABEL[s]}
                  </option>
                ))}
                <option value={MAIL_TRASH_FILTER}>🗑 휴지통</option>
              </select>
            </label>
            <label className={labelCls}>
              담당자
              <select
                className={inputCls}
                value={filters.assignee}
                onChange={(e) => pushFilters({ assignee: e.target.value })}
              >
                <option value="">전체</option>
                <option value="__none__">미지정</option>
                {view.usedAssignees.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              검색 (제목·보낸사람)
              <input
                className={inputCls}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") pushFilters({ q: search });
                }}
                placeholder="Enter 로 검색"
              />
            </label>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <span className={badgeNeutral}>미처리 {view.unreadCount}건</span>
            {/* 수집이 멈춰도 아무도 모르던 문제 — 마지막 수집 시각을 항상 보입니다.
                두 배지를 나란히 두는 이유: "수집은 도는데 새 메일이 없는 밤" 과
                "수집이 멈춘 것" 을 한눈에 구분하기 위해서입니다. 왼쪽만 흐르고
                오른쪽이 멈춰 있으면 정상입니다. */}
            <span className={view.fetchStale ? badgeWarning : badgeNeutral}>
              마지막 수집:{" "}
              {view.lastFetchedAt
                ? fmtKstMonthDayTime(view.lastFetchedAt)
                : "기록 없음"}
            </span>
            <span className={badgeNeutral}>
              새 메일:{" "}
              {view.lastMailAt
                ? fmtKstMonthDayTime(view.lastMailAt)
                : "기록 없음"}
            </span>
            <button
              type="button"
              className={btnSecondary}
              disabled={pending}
              onClick={collectNow}
            >
              지금 가져오기
            </button>
          </div>
        </div>

        {/* ★ "가져온 메일이 없다" 가 아니라 "수집이 돌지 않았다" 입니다.
            인증 실패는 슬랙이 즉시 알리므로, 여기서 원인을 단정하지 않습니다. */}
        {view.fetchStale && (
          <p className={`mt-3 ${noticeWarning}`}>
            ⚠️ 1시간 넘게 메일 수집이 돌지 않았습니다
            {view.lastFetchedAt
              ? ` (마지막 수집 ${fmtKstMonthDayTime(view.lastFetchedAt)})`
              : ""}
            . 네이버 계정 설정이나 자동 수집 상태를 확인해주세요. 원본은
            네이버에 그대로 남아 있으므로, 복구되면 밀린 메일을 이어서
            가져옵니다.
          </p>
        )}

        {/* 안읽음만 토글 + 점 색 범례 (색 의미를 화면에 명시) */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-body">
            <input
              type="checkbox"
              checked={filters.unreadOnly}
              onChange={(e) => pushFilters({ unreadOnly: e.target.checked })}
            />
            안읽음만 보기
          </label>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink-muted">
            {MAIL_STATUSES.map((s) => (
              <span key={s} className="flex items-center gap-1">
                <span
                  aria-hidden
                  className={`h-2 w-2 rounded-full ${MAIL_STATUS_DOT[s]}`}
                />
                {MAIL_STATUS_DOT_HINT[s]}
              </span>
            ))}
            <span className="text-ink-hint">· 굵은 글씨 = 안읽음</span>
          </div>
        </div>
      </section>

      {/* 분류 인덱스 — ai_category 로 목록을 좁힙니다(1000건이 한 목록에 몰려
          팀별로 자기 것을 찾기 어려웠던 문제).
            · 필터는 서버(getMailList)에서 걸리며 상태·담당자·검색과 AND 로 겹칩니다.
            · 배지는 "안읽음(opened_at IS NULL)" 건수. 다른 필터를 걸어도 바뀌지
              않습니다 — 그래야 "그 분류에 몇 건 남았나" 로 읽힙니다. 0이면 숨깁니다.
            · 좁은 화면에서는 tabBarCls 의 overflow-x-auto 로 가로 스크롤됩니다. */}
      <div className={tabBarCls}>
        <nav className={tabNavCls} aria-label="분류">
          {categoryTabs.map((t) => {
            const active = filters.category === t.key;
            // 분류별 로고색 — 기타·전체는 색이 없어(undefined) 기존 무채색 그대로.
            const color = MAIL_CATEGORY_INDEX_COLOR[t.key];
            return (
              <button
                key={t.key || "__all__"}
                type="button"
                aria-current={active ? "page" : undefined}
                className={tabItemCls(active)}
                // 선택 칸의 밑줄만 그 분류 색으로 바꿉니다(굵기·글자 강조는 그대로).
                //   tabItemCls 가 이미 border-navy 를 갖고 있어 클래스로 덮으면
                //   생성 순서에 따라 이길지가 갈립니다 — 인라인이라야 확실합니다.
                style={active && color ? { borderColor: color } : undefined}
                onClick={() => pushFilters({ category: t.key })}
              >
                {t.label}
                {t.count > 0 && (
                  <span
                    className={`ml-1.5 ${active ? badgeNavy : badgeNeutral}`}
                    // 배지는 배경을 채우지 않고 숫자(글자)색만 입힙니다.
                    style={color ? { color } : undefined}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* 모달이 열려 있을 때는 모달 안에서 같은 메시지를 보여줍니다(중복 방지). */}
      {msg && !open && (
        // DM 실패 사유는 줄바꿈으로 붙으므로 pre-line 으로 보존합니다.
        <p
          className={`whitespace-pre-line ${msg.ok ? noticeSuccess : noticeError}`}
        >
          {msg.text}
        </p>
      )}

      <section className={cardCls}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-bold text-ink">
            {trashView ? "휴지통" : "받은 메일"}
          </h2>
          <span className="text-xs text-ink-muted">
            최근 {view.items.length}건
            {view.items.length > PAGE_SIZE &&
              ` · ${safePage}/${totalPages}페이지`}
          </span>
        </div>
        {trashView && (
          <p className="mt-2 text-xs text-ink-muted">
            삭제한 메일은 30일 뒤 자동으로 완전히 지워집니다. 네이버 메일의 원본은
            그대로 남아 있습니다.
          </p>
        )}

        {/* 일괄 액션 바 — 1건 이상 선택했을 때만 */}
        {selectedIds.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-navy bg-navy-soft/50 px-3 py-2">
            <span className="text-sm font-bold text-navy">
              선택 {selectedIds.length}건
            </span>
            <span aria-hidden className="text-ink-hint">
              ·
            </span>
            {trashView ? (
              <>
                <button
                  type="button"
                  className={bulkBtn}
                  disabled={pending}
                  onClick={() =>
                    runBulk(
                      () => bulkRestoreMail(selectedIds),
                      (n) => `${n}건을 복구했습니다.`,
                    )
                  }
                >
                  복구
                </button>
                <button
                  type="button"
                  className={bulkBtnDanger}
                  disabled={pending}
                  onClick={() => setConfirmBulk("purge")}
                >
                  영구삭제
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={bulkBtnDanger}
                  disabled={pending}
                  onClick={() => setConfirmBulk("trash")}
                >
                  삭제
                </button>
                <button
                  type="button"
                  className={bulkBtn}
                  disabled={pending}
                  onClick={() =>
                    runBulk(
                      () => bulkSetMailStatus(selectedIds, "done"),
                      (n) => `${n}건을 완료 처리했습니다.`,
                    )
                  }
                >
                  완료 처리
                </button>
                <select
                  className="h-[30px] rounded-md border border-line bg-card px-2 text-xs text-ink-body"
                  disabled={pending}
                  value=""
                  onChange={(e) => {
                    const name = e.target.value;
                    if (!name) return;
                    e.target.value = "";
                    runBulk(
                      () => bulkAssignMail(selectedIds, name),
                      (n) => `${n}건을 ${name} 담당으로 지정했습니다.`,
                    );
                  }}
                >
                  <option value="">담당자 지정…</option>
                  {view.assignees.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </>
            )}
            <button
              type="button"
              className="ml-auto text-xs text-ink-muted underline-offset-2 hover:underline"
              onClick={() => setSelected(new Set())}
            >
              선택 해제
            </button>
          </div>
        )}

        {/* 헤더 — 전체선택 */}
        <div className="mt-3 flex items-center gap-3 rounded-t-xl border border-b-0 border-line bg-surface px-3 py-2">
          <input
            type="checkbox"
            aria-label="전체 선택"
            checked={allVisibleSelected}
            onChange={toggleAll}
            disabled={pageItems.length === 0}
          />
          <span className="text-xs text-ink-muted">
            {allVisibleSelected && pageItems.length > 0
              ? "전체 선택됨"
              : "전체 선택"}
          </span>
        </div>

        <div className="divide-y divide-line overflow-hidden rounded-b-xl border border-line">
          {pageItems.map((item, pageIndex) => {
            // openIndex 에 넘기는 index 는 전체 목록 기준입니다 — 상세의 이전/다음이
            // 페이지 경계에서 끊기지 않게 하려면 페이지 안 순번이면 안 됩니다.
            const index = pageOffset + pageIndex;
            // ★ 굵기·배경은 '읽음 여부'(opened), 왼쪽 점 색은 '처리 상태'(status).
            //   서로 다른 축이라 절대 섞지 않습니다.
            const unopened = !item.opened;
            const suggestion = hasPendingSuggestion(item);
            const checked = selected.has(item.id);
            return (
              // 행 전체가 버튼이면 안쪽에 체크박스·[적용] 버튼을 넣을 수 없어
              // (중첩 불가) 여는 영역만 버튼으로 두고 나머지는 형제로 뺐습니다.
              //
              // 반응형: 기본(폰)은 쌓고, sm 이상에서 원래의 가로 3단으로 되돌립니다.
              //   폰에서는 flex-wrap 으로 [체크박스+본문] / [담당자] 두 줄이 되고,
              //   sm:flex-nowrap 이 한 줄 배치를 복원합니다.
              <div
                key={item.id}
                className={`flex w-full flex-wrap items-start gap-x-3 gap-y-1.5 px-3 py-3 transition-colors hover:bg-navy-soft/40 sm:flex-nowrap sm:gap-3 ${
                  checked
                    ? "bg-navy-soft/30"
                    : unopened
                      ? "bg-surface/60"
                      : ""
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-1.5 shrink-0"
                  aria-label={`${item.subject || "(제목 없음)"} 선택`}
                  checked={checked}
                  onChange={() => toggleOne(item.id)}
                />
                <button
                  type="button"
                  onClick={() => openIndex(index)}
                  aria-haspopup="dialog"
                  className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1 text-left focus-visible:outline-none sm:flex-row sm:items-start sm:gap-3"
                >
                  {/* 상태점 + 보낸사람 — 폰에선 한 줄로 묶고, sm 이상에선 sm:contents
                      로 이 래퍼를 없애 둘이 다시 버튼의 직접 자식(가로 3단)이 됩니다. */}
                  <span className="flex min-w-0 items-center gap-2 sm:contents">
                    <span
                      aria-hidden
                      title={MAIL_STATUS_DOT_HINT[item.status]}
                      className={`h-2.5 w-2.5 shrink-0 rounded-full sm:mt-1.5 ${MAIL_STATUS_DOT[item.status]}`}
                    />
                    <span
                      className={`min-w-0 flex-1 truncate text-sm sm:mt-0.5 sm:w-28 sm:flex-none sm:shrink-0 ${
                        unopened
                          ? "font-bold text-ink"
                          : "font-medium text-ink-body"
                      }`}
                    >
                      {item.from_name || item.from_email || "(보낸사람 없음)"}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`flex items-center gap-1.5 truncate text-sm ${
                        unopened ? "font-bold text-ink" : "text-ink-body"
                      }`}
                    >
                      {item.ai_category && (
                        <span
                          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                            MAIL_CATEGORY_BADGE[item.ai_category] ??
                            MAIL_CATEGORY_BADGE["기타"]
                          }`}
                        >
                          {item.ai_category}
                        </span>
                      )}
                      {/* min-w-0 필수 — flex 항목의 기본 min-width:auto 는 글자
                          수만큼 최소폭을 잡아, 칸이 좁아지면 말줄임 대신 글자가
                          접히거나 잘립니다. 폰에서 제목이 세로로 뭉개지던 원인. */}
                      <span className="min-w-0 truncate">
                        {item.subject || "(제목 없음)"}
                      </span>
                      {item.has_attachments && (
                        <span className="shrink-0 text-ink-hint">📎</span>
                      )}
                    </span>
                    {/* AI 한 줄 요약 — 분석을 마친 메일만. 분석 전에는 비워 둡니다. */}
                    {item.ai_processed && item.ai_summary && (
                      <span className="mt-0.5 block truncate text-xs font-normal text-ink-muted">
                        {item.ai_summary}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 hidden w-32 shrink-0 text-right text-xs text-ink-muted sm:block">
                    {formatReceived(item.received_at)}
                  </span>
                </button>

                {/* 담당자 — 미지정이고 추천이 있으면 추천과 [적용] 을 함께.
                    폰에선 제목 아래 한 줄(가로)로 내려오고, sm 이상에선 오른쪽
                    고정폭 세로 칸으로 돌아갑니다. */}
                <span className="flex w-full flex-row items-center justify-end gap-2 sm:mt-0.5 sm:w-36 sm:shrink-0 sm:flex-col sm:items-end sm:gap-1">
                  <span className="min-w-0 truncate text-right text-xs text-ink-muted sm:w-full">
                    {assigneeLabel(item)}
                  </span>
                  {suggestion && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => applySuggestion(item.id)}
                      className="rounded-md border border-navy px-2 py-0.5 text-[11px] font-semibold text-navy hover:bg-navy-soft disabled:opacity-50"
                    >
                      추천 적용
                    </button>
                  )}
                </span>

                {loadingId === item.id && (
                  <span className="mt-0.5 shrink-0 text-xs text-ink-hint">
                    여는 중…
                  </span>
                )}
              </div>
            );
          })}
          {view.items.length === 0 && (
            <p className="px-4 py-12 text-center text-sm text-ink-muted">
              {trashView
                ? "휴지통이 비어 있습니다."
                : "조건에 맞는 메일이 없습니다."}
            </p>
          )}
        </div>

        {/* 20건 이하면 렌더되지 않습니다(1페이지). */}
        <Pagination page={safePage} totalPages={totalPages} onChange={goPage} />
      </section>

      {/* 일괄 삭제/영구삭제 확인 — 되돌리기 어려운 동작이라 1회 확인 */}
      {confirmBulk && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="일괄 처리 확인"
          onClick={() => setConfirmBulk(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-ink">
              {confirmBulk === "purge"
                ? `${selectedIds.length}건을 영구 삭제할까요?`
                : `${selectedIds.length}건을 삭제할까요?`}
            </h3>
            <p className="mt-2 text-sm leading-6 text-ink-muted">
              {confirmBulk === "purge" ? (
                <>
                  첨부 사본과 답장 이력까지 <b>완전히</b> 지워집니다. 되돌릴 수
                  없습니다.
                  <br />
                  네이버 메일의 원본은 그대로 남아 있습니다.
                </>
              ) : (
                <>
                  휴지통으로 옮깁니다. 30일 안에는 휴지통에서 복구할 수 있고,
                  네이버 메일의 원본은 그대로 남아 있습니다.
                </>
              )}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className={btnSecondary}
                disabled={pending}
                onClick={() => setConfirmBulk(null)}
              >
                취소
              </button>
              <Button
                variant="danger"
                loading={pending}
                onClick={() =>
                  confirmBulk === "purge"
                    ? runBulk(
                        () => bulkPurgeMail(selectedIds),
                        (n) => `${n}건을 영구 삭제했습니다.`,
                      )
                    : runBulk(
                        () => bulkTrashMail(selectedIds),
                        (n) => `${n}건을 휴지통으로 옮겼습니다.`,
                      )
                }
              >
                {confirmBulk === "purge" ? "영구 삭제" : "삭제"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 상세 — 데스크톱은 중앙 큰 모달, 모바일은 전체화면 시트. */}
      {detail && (
        <div
          className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/45 sm:items-center sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="메일 상세"
          onClick={closeDetail}
        >
          <div
            className="flex h-full w-full flex-col bg-card shadow-2xl sm:h-[min(88vh,880px)] sm:max-w-4xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 헤더 — 제목·보낸사람·수신일 + 이전/다음 + 닫기 */}
            <div className="shrink-0 border-b border-line px-4 py-3 sm:px-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-bold text-ink sm:text-lg">
                    {detail.subject || "(제목 없음)"}
                  </h2>
                  <p className="mt-1 truncate text-xs text-ink-muted sm:text-sm">
                    {detail.from_name || "(보낸사람 없음)"}
                    {detail.from_email ? ` <${detail.from_email}>` : ""} ·{" "}
                    {formatReceived(detail.received_at)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span
                    className={`hidden rounded-full px-2.5 py-1 text-xs font-bold sm:inline ${MAIL_STATUS_BADGE[detail.status]}`}
                  >
                    {MAIL_STATUS_LABEL[detail.status]}
                  </span>
                  <button
                    type="button"
                    className={navBtn}
                    disabled={pending || activeIndex == null || activeIndex <= 0}
                    onClick={() => move(-1)}
                    aria-label="이전 메일"
                  >
                    ↑ 이전
                  </button>
                  <button
                    type="button"
                    className={navBtn}
                    disabled={
                      pending ||
                      activeIndex == null ||
                      activeIndex >= view.items.length - 1
                    }
                    onClick={() => move(1)}
                    aria-label="다음 메일"
                  >
                    ↓ 다음
                  </button>
                  <button
                    type="button"
                    className={navBtn}
                    onClick={closeDetail}
                    aria-label="닫기"
                  >
                    ✕
                  </button>
                </div>
              </div>
              {activeIndex != null && (
                <p className="mt-1 text-[11px] text-ink-hint">
                  {activeIndex + 1} / {view.items.length}
                </p>
              )}
            </div>

            {/* 담당자·상태·첨부 — 본문에 자리를 내주기 위해 한 줄로 압축 */}
            <div className="shrink-0 border-b border-line px-4 py-3 sm:px-5">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className={labelCls}>
                  담당자
                  <select
                    className={inputCls}
                    value={detail.assignee_name}
                    disabled={pending}
                    onChange={(e) =>
                      runAction(
                        () => assignMail(detail.id, e.target.value),
                        e.target.value
                          ? `${e.target.value} 담당으로 지정했습니다. (슬랙 DM 발송)`
                          : "담당 지정을 해제했습니다.",
                      )
                    }
                  >
                    {/* '미지정' 항목에만 추천을 덧붙입니다(담당자가 이미
                        있으면 이 항목은 '해제' 를 뜻하므로 그대로 둡니다). */}
                    <option value="">
                      {hasPendingSuggestion(detail)
                        ? `미지정 (추천: ${detail.ai_suggested_assignee})`
                        : "미지정"}
                    </option>
                    {detail.assignee_name &&
                      !view.assignees.includes(detail.assignee_name) && (
                        <option value={detail.assignee_name}>
                          {detail.assignee_name}
                        </option>
                      )}
                    {view.assignees.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={labelCls}>
                  상태
                  <select
                    className={inputCls}
                    value={detail.status}
                    disabled={pending}
                    onChange={(e) =>
                      runAction(
                        () => setMailStatus(detail.id, e.target.value),
                        "상태를 변경했습니다.",
                      )
                    }
                  >
                    {MAIL_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {MAIL_STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* AI 요약 — 분석을 마친 메일만. 분석 전에는 자리를 비웁니다. */}
              {detail.ai_processed && detail.ai_summary && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-muted">
                  {detail.ai_category && (
                    <span
                      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                        MAIL_CATEGORY_BADGE[detail.ai_category] ??
                        MAIL_CATEGORY_BADGE["기타"]
                      }`}
                    >
                      {detail.ai_category}
                    </span>
                  )}
                  <span>{detail.ai_summary}</span>
                </p>
              )}

              {/* 추천 담당자 — 확신도가 낮아 자동 지정되지 않은 건을 한 번에 적용 */}
              {hasPendingSuggestion(detail) && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-ink-hint">
                    AI 추천 담당자: {detail.ai_suggested_assignee} (확신도가 낮아
                    자동 지정하지 않았습니다)
                  </span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => applySuggestion(detail.id)}
                    className="rounded-md border border-navy px-2 py-0.5 text-[11px] font-semibold text-navy hover:bg-navy-soft disabled:opacity-50"
                  >
                    추천 적용
                  </button>
                </div>
              )}

              {/* AI 분석 전 — 사람이 직접 요청할 수 있게 */}
              {!detail.ai_processed && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-ink-hint">
                    아직 AI 분석을 하지 않은 메일입니다.
                  </span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => analyzeNow(detail.id)}
                    className="rounded-md border border-navy px-2 py-0.5 text-[11px] font-semibold text-navy hover:bg-navy-soft disabled:opacity-50"
                  >
                    ✨ AI 분석
                  </button>
                </div>
              )}

              {detail.attachments.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {detail.attachments.map((att, i) => (
                    <li key={`${att.name}-${i}`}>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          openAttachment(
                            att.storage_path,
                            att.name,
                            att.skip_reason,
                          )
                        }
                        className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-body hover:bg-surface disabled:opacity-50"
                      >
                        📎 {att.name}{" "}
                        <span className="text-ink-hint">
                          ({formatBytes(att.size)})
                        </span>
                        {!att.storage_path && (
                          <span className="ml-1 text-stamp">
                            · 원본은 네이버 확인
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {msg && (
                <p
                  className={`mt-2 whitespace-pre-line ${msg.ok ? noticeSuccess : noticeError}`}
                >
                  {msg.text}
                </p>
              )}
            </div>

            {/* 본문 — 모달 높이의 대부분을 차지합니다. */}
            <div className="min-h-0 flex-1 px-4 py-3 sm:px-5">
              {detail.body_html ? (
                // 스크립트·동일출처 모두 차단한 iframe 에서만 렌더합니다.
                <iframe
                  title="메일 본문"
                  sandbox=""
                  srcDoc={detail.body_html}
                  className="h-full w-full rounded-xl border border-line bg-white"
                />
              ) : (
                <pre className="h-full overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-surface p-4 text-sm leading-6 text-ink-body">
                  {detail.body_text || "(본문 없음)"}
                </pre>
              )}
            </div>

            {/* 답장 이력 — 누가·언제 보냈는지 공유가 목적입니다. */}
            {replies.length > 0 && (
              <div className="max-h-40 shrink-0 overflow-auto border-t border-line px-4 py-3 sm:px-5">
                <h3 className="text-xs font-semibold text-ink">
                  답장 이력 {replies.length}건
                </h3>
                <ul className="mt-2 space-y-2">
                  {replies.map((r) => (
                    <li
                      key={r.id}
                      className="rounded-lg border border-line bg-surface px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                        <span className="font-semibold text-ink">
                          {r.sent_by}
                        </span>
                        <span className="text-ink-muted">
                          {formatReceived(r.sent_at)}
                        </span>
                        <span className="text-ink-muted">→ {r.to_email}</span>
                        {r.status === "failed" ? (
                          <span className="rounded-full bg-stamp-soft px-1.5 py-0.5 text-[10px] font-semibold text-stamp">
                            실패
                          </span>
                        ) : (
                          <span className="rounded-full bg-success-soft px-1.5 py-0.5 text-[10px] font-semibold text-success">
                            발송
                          </span>
                        )}
                      </div>
                      {r.error_message && (
                        <p className="mt-1 text-[11px] text-stamp">
                          {r.error_message}
                        </p>
                      )}
                      <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-ink-body">
                        {r.body}
                      </pre>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 답장 작성 — 본문과 확실히 구분되도록 카드로 펼칩니다.
                연한 배경 + 테두리 + 왼쪽 세로 강조선. */}
            {replyOpen && (
              <div className="max-h-[60%] shrink-0 overflow-auto border-t border-line px-4 py-3 sm:px-5">
                <div className="rounded-xl border border-navy/30 border-l-4 border-l-navy bg-navy-soft/25 p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-bold text-navy">답장 작성</h3>
                    <span className="text-xs text-ink-muted">
                      받는사람: {replyTo || "(주소 없음)"}
                    </span>
                  </div>

                  {!replyConfigured && (
                    <p className={`mt-2 ${noticeError}`}>
                      발신 설정이 없어 보낼 수 없습니다. (NAVER_POP_USER /
                      NAVER_POP_PASSWORD 환경변수)
                    </p>
                  )}

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <label className={labelCls}>
                      받는사람
                      <input
                        className={inputCls}
                        value={replyTo}
                        onChange={(e) => setReplyTo(e.target.value)}
                      />
                    </label>
                    <label className={labelCls}>
                      제목
                      <input
                        className={inputCls}
                        value={replySubjectText}
                        onChange={(e) => setReplySubjectText(e.target.value)}
                      />
                    </label>
                  </div>

                  <label className={`${labelCls} mt-3 block`}>
                    본문
                    <textarea
                      rows={8}
                      autoFocus
                      placeholder="내용을 입력하세요"
                      className="mt-1 block min-h-[11rem] w-full rounded-lg border border-line bg-card px-3 py-2 text-sm leading-6 text-ink-body shadow-sm placeholder:text-ink-hint focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/40"
                      value={replyBody}
                      onChange={(e) => setReplyBody(e.target.value)}
                    />
                  </label>

                  {/* 원문 인용 — 기본은 접힘. 보낼 때 본문 뒤에 자동으로 붙습니다. */}
                  {replyQuote && (
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => setQuoteOpen((v) => !v)}
                        className="text-xs font-semibold text-navy underline-offset-2 hover:underline"
                      >
                        {quoteOpen ? "▾ 원문 숨기기" : "▸ 원문 보기"}
                      </button>
                      <p className="mt-1 text-[11px] text-ink-hint">
                        원문 인용은 보낼 때 본문 아래에 자동으로 붙습니다.
                      </p>
                      {quoteOpen && (
                        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-card p-3 text-[11px] leading-5 text-ink-muted">
                          {replyQuote}
                        </pre>
                      )}
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-navy/20 pt-3">
                    <label className="flex items-center gap-2 text-xs text-ink-body">
                      <input
                        type="checkbox"
                        checked={replyMarkDone}
                        onChange={(e) => setReplyMarkDone(e.target.checked)}
                      />
                      보낸 뒤 이 메일을 완료 처리
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className={btnSecondary}
                        disabled={pending}
                        onClick={() => setReplyOpen(false)}
                      >
                        취소
                      </button>
                      <Button
                        loading={pending}
                        disabled={!replyConfigured}
                        onClick={submitReply}
                        className="px-6 font-bold"
                      >
                        {pending ? "보내는 중…" : "보내기"}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 메모 + 답장/삭제 */}
            <div className="shrink-0 border-t border-line px-4 py-3 sm:px-5">
              <div className="flex items-end gap-2">
                <label className={`${labelCls} flex-1`}>
                  메모
                  <textarea
                    rows={2}
                    className={inputCls}
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={pending}
                  onClick={() =>
                    runAction(
                      () => saveMailMemo(detail.id, memo),
                      "메모를 저장했습니다.",
                    )
                  }
                >
                  저장
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {!replyOpen && !detail.deleted_at && (
                  <button
                    type="button"
                    className={btnSecondary}
                    disabled={pending}
                    onClick={() => openReply(detail.id)}
                  >
                    ↩ 답장
                  </button>
                )}
                {detail.deleted_at ? (
                  <button
                    type="button"
                    className={btnSecondary}
                    disabled={pending}
                    onClick={() =>
                      runAction(
                        () => restoreMail(detail.id),
                        "휴지통에서 복구했습니다.",
                      )
                    }
                  >
                    복구
                  </button>
                ) : (
                  <button
                    type="button"
                    className="inline-flex h-[38px] items-center justify-center rounded-lg border border-stamp bg-card px-4 text-sm font-semibold text-stamp shadow-sm transition hover:bg-stamp-soft disabled:opacity-60"
                    disabled={pending}
                    onClick={() =>
                      runAction(
                        () => trashMail(detail.id),
                        "휴지통으로 옮겼습니다. (네이버 원본은 그대로)",
                      )
                    }
                  >
                    삭제
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// 페이지네이션 — 20건/페이지, 목록 하단 이동.
//   비품관리(app/hr/facility/assets/AssetManager.tsx)와 같은 방식·같은 모양입니다.
//   폰에서는 버튼이 많아질 수 있어 flex-wrap 으로 줄이 넘어가게 둡니다.
// =====================================================================
function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  const pages = pageList(page, totalPages);
  return (
    <div className="mt-4 flex flex-wrap items-center justify-center gap-1">
      <PBtn disabled={page <= 1} onClick={() => onChange(page - 1)}>
        ‹
      </PBtn>
      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`e${i}`} className="px-1 text-xs text-ink-hint">
            …
          </span>
        ) : (
          <PBtn key={p} active={p === page} onClick={() => onChange(p)}>
            {p}
          </PBtn>
        ),
      )}
      <PBtn disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        ›
      </PBtn>
    </div>
  );
}

function PBtn({
  children,
  active,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-w-[30px] rounded-md border px-2 py-1 text-xs ${
        active
          ? "border-navy bg-navy text-white"
          : "border-line text-ink-body hover:bg-surface"
      } disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

// 1 … 4 5 6 … 20 형태의 페이지 번호 목록(총 7페이지 이하면 전부 나열).
function pageList(page: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(total - 1, page + 1);
  if (start > 2) out.push("…");
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total - 1) out.push("…");
  out.push(total);
  return out;
}
