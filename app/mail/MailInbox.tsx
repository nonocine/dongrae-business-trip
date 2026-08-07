"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  badgeNeutral,
  btnPrimary,
  btnSecondary,
  cardCls,
  inputCls,
  labelCls,
  noticeError,
  noticeSuccess,
} from "@/lib/ui";
import {
  MAIL_STATUSES,
  MAIL_STATUS_BADGE,
  MAIL_STATUS_DOT,
  MAIL_STATUS_LABEL,
  formatBytes,
  type MailDetail,
  type MailListItem,
  type MailListView,
} from "@/lib/mail";
import {
  assignMail,
  fetchMailNow,
  getMailDetail,
  saveMailMemo,
  setMailStatus,
  signMailAttachment,
} from "./actions";

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

export default function MailInbox({
  view,
  filters,
}: {
  view: MailListView;
  filters: { status: string; assignee: string; q: string };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [detail, setDetail] = useState<MailDetail | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [memo, setMemo] = useState("");
  const [search, setSearch] = useState(filters.q);

  function pushFilters(next: Partial<typeof filters>) {
    const merged = { ...filters, ...next };
    const params = new URLSearchParams();
    if (merged.status) params.set("status", merged.status);
    if (merged.assignee) params.set("assignee", merged.assignee);
    if (merged.q) params.set("q", merged.q);
    const qs = params.toString();
    router.push(qs ? `/mail?${qs}` : "/mail");
  }

  function openDetail(item: MailListItem) {
    setMsg(null);
    setLoadingId(item.id);
    start(async () => {
      const found = await getMailDetail(item.id);
      setLoadingId(null);
      if (!found) {
        setMsg({ ok: false, text: "메일을 불러오지 못했습니다." });
        return;
      }
      setDetail(found);
      setMemo(found.memo);
    });
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

  function openAttachment(path: string | null, name: string) {
    if (!path) {
      setMsg({
        ok: false,
        text: `${name} 은(는) 용량이 커서 사본을 저장하지 않았습니다. 네이버 메일에서 확인하세요.`,
      });
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
      const tail = res.remaining > 0 ? ` (남은 ${res.remaining}통은 다음 주기에)` : "";
      const failed = res.failed > 0 ? ` · 실패 ${res.failed}건` : "";
      setMsg({
        ok: true,
        text:
          res.saved > 0
            ? `새 메일 ${res.saved}통을 가져왔습니다.${tail}${failed}`
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
          <div className="flex shrink-0 items-center gap-2">
            <span className={badgeNeutral}>
              미처리 {view.unreadCount}건
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
      </section>

      {msg && <p className={msg.ok ? noticeSuccess : noticeError}>{msg.text}</p>}

      <section className={cardCls}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-bold text-ink">받은 메일</h2>
          <span className="text-xs text-ink-muted">
            최근 {view.items.length}건
          </span>
        </div>
        <div className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line">
          {view.items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => openDetail(item)}
              className={`flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-surface ${
                detail?.id === item.id ? "bg-navy-soft/40" : ""
              }`}
            >
              <span
                aria-hidden
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${MAIL_STATUS_DOT[item.status]}`}
              />
              <span className="w-28 shrink-0 truncate text-sm font-semibold text-ink">
                {item.from_name || item.from_email || "(보낸사람 없음)"}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink-body">
                {item.subject || "(제목 없음)"}
                {item.has_attachments && (
                  <span className="ml-1.5 text-ink-hint">📎</span>
                )}
              </span>
              <span className="hidden w-32 shrink-0 text-right text-xs text-ink-muted sm:block">
                {formatReceived(item.received_at)}
              </span>
              <span className="w-16 shrink-0 truncate text-right text-xs text-ink-muted">
                {item.assignee_name || "미지정"}
              </span>
              {loadingId === item.id && (
                <span className="shrink-0 text-xs text-ink-hint">여는 중…</span>
              )}
            </button>
          ))}
          {view.items.length === 0 && (
            <p className="px-4 py-12 text-center text-sm text-ink-muted">
              조건에 맞는 메일이 없습니다.
            </p>
          )}
        </div>
      </section>

      {detail && (
        <section className={cardCls}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-ink">
                {detail.subject || "(제목 없음)"}
              </h2>
              <p className="mt-1 text-sm text-ink-muted">
                {detail.from_name || "(보낸사람 없음)"}
                {detail.from_email ? ` <${detail.from_email}>` : ""} ·{" "}
                {formatReceived(detail.received_at)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-bold ${MAIL_STATUS_BADGE[detail.status]}`}
              >
                {MAIL_STATUS_LABEL[detail.status]}
              </span>
              <button
                type="button"
                className="text-sm font-semibold text-ink-muted hover:underline"
                onClick={() => setDetail(null)}
              >
                닫기
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
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
                <option value="">미지정</option>
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

          {detail.attachments.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold text-navy">첨부파일</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {detail.attachments.map((att, i) => (
                  <li key={`${att.name}-${i}`}>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => openAttachment(att.storage_path, att.name)}
                      className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-body hover:bg-surface disabled:opacity-50"
                    >
                      📎 {att.name}{" "}
                      <span className="text-ink-hint">
                        ({formatBytes(att.size)})
                      </span>
                      {!att.storage_path && (
                        <span className="ml-1 text-stamp">· 원본은 네이버 확인</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4">
            <p className="text-xs font-semibold text-navy">본문</p>
            {detail.body_html ? (
              // 스크립트·동일출처 모두 차단한 iframe 에서만 렌더합니다.
              <iframe
                title="메일 본문"
                sandbox=""
                srcDoc={detail.body_html}
                className="mt-2 h-[480px] w-full rounded-xl border border-line bg-white"
              />
            ) : (
              <pre className="mt-2 max-h-[480px] overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-surface p-4 text-sm leading-6 text-ink-body">
                {detail.body_text || "(본문 없음)"}
              </pre>
            )}
          </div>

          <div className="mt-4">
            <label className={labelCls}>
              메모
              <textarea
                rows={3}
                className={inputCls}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
              />
            </label>
            <button
              type="button"
              className={`${btnPrimary} mt-2`}
              disabled={pending}
              onClick={() =>
                runAction(
                  () => saveMailMemo(detail.id, memo),
                  "메모를 저장했습니다.",
                )
              }
            >
              메모 저장
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
