"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BK_POST_TYPES,
  BK_POST_TYPE_LABEL,
  BK_SCOPES,
  BK_SCOPE_LABEL,
  fmtKstShort,
  type BkPostRow,
} from "@/lib/bangkaContent";
import {
  badgeNavy,
  badgeNeutral,
  badgeWarning,
  btnPrimary,
  inputCls,
  labelCls,
  linkCls,
  panelToneCls,
  tableHeadCls,
  tableRowCls,
} from "@/lib/ui";

// =====================================================================
// 공지·알림장 목록 — 종류·대상·게시일·첨부 수·읽음(읽은 보호자 / 대상 보호자).
//   대상 보호자 = 그 반(전체면 모든 반) 재원생에 연결된 '사용중' 보호자.
//   📌 고정 글이 위, 그다음 게시일 최신순. 게시일이 미래면 '예약'.
// =====================================================================

export default function PostsList({
  posts,
  typeFilter,
  scopeFilter,
}: {
  posts: BkPostRow[];
  typeFilter: string;
  scopeFilter: string;
}) {
  const router = useRouter();

  function setFilter(key: "type" | "scope", value: string) {
    const sp = new URLSearchParams();
    const t = key === "type" ? value : typeFilter;
    const s = key === "scope" ? value : scopeFilter;
    if (t !== "all") sp.set("type", t);
    if (s !== "all") sp.set("scope", s);
    const qs = sp.toString();
    router.push(`/bangka/posts${qs ? `?${qs}` : ""}`);
  }

  return (
    <div className="space-y-4">
      <div className={`${panelToneCls("blue")} flex flex-wrap items-end gap-3`}>
        <label className="min-w-[8rem]">
          <span className={labelCls}>종류</span>
          <select value={typeFilter} onChange={(e) => setFilter("type", e.target.value)} className={inputCls}>
            <option value="all">전체</option>
            {BK_POST_TYPES.map((t) => (
              <option key={t} value={t}>
                {BK_POST_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-[8rem]">
          <span className={labelCls}>대상</span>
          <select value={scopeFilter} onChange={(e) => setFilter("scope", e.target.value)} className={inputCls}>
            <option value="all">전체</option>
            {BK_SCOPES.filter((s) => s !== "all").map((s) => (
              <option key={s} value={s}>
                {BK_SCOPE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-ink-muted">{posts.length}건</p>
        <Link href="/bangka/posts/new" className={`ml-auto ${btnPrimary}`}>
          새 글 쓰기
        </Link>
      </div>

      <div className={`${panelToneCls("green")} overflow-x-auto`}>
        {posts.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-muted">글이 없습니다.</p>
        ) : (
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className={tableHeadCls}>
                <th className="px-2 py-2 text-left">제목</th>
                <th className="px-2 py-2 text-left">종류</th>
                <th className="px-2 py-2 text-left">대상</th>
                <th className="px-2 py-2 text-left">게시일</th>
                <th className="px-2 py-2 text-right">첨부</th>
                <th className="px-2 py-2 text-right">읽음</th>
              </tr>
            </thead>
            <tbody>
              {posts.map((p) => (
                <tr
                  key={p.id}
                  className={`${tableRowCls} cursor-pointer`}
                  onClick={() => router.push(`/bangka/posts/${p.id}`)}
                >
                  <td className="px-2 py-2 font-semibold text-ink">
                    {p.is_pinned && <span title="고정">📌 </span>}
                    <Link href={`/bangka/posts/${p.id}`} className={linkCls} onClick={(e) => e.stopPropagation()}>
                      {p.title}
                    </Link>
                    {p.author_name && <span className="ml-1 text-xs font-normal text-ink-hint">{p.author_name}</span>}
                  </td>
                  <td className="px-2 py-2">
                    <span className={badgeNavy}>{BK_POST_TYPE_LABEL[p.post_type]}</span>
                  </td>
                  <td className="px-2 py-2 text-ink-body">{BK_SCOPE_LABEL[p.scope]}</td>
                  <td className="px-2 py-2 whitespace-nowrap text-xs text-ink-body">
                    {fmtKstShort(p.published_at)}
                    {p.scheduled && <span className={`ml-1 ${badgeWarning}`}>예약</span>}
                  </td>
                  <td className="px-2 py-2 text-right text-ink-body">{p.file_count || "-"}</td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    {p.scheduled ? (
                      <span className={badgeNeutral}>게시 전</span>
                    ) : (
                      <span className="text-ink-body">
                        {p.read_count} / {p.target_count}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
