"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

// =====================================================================
// PC 좌측 고정 사이드바 — (app) 껍데기의 왼쪽 열.
//
//   ★ 메뉴를 여기에 다시 적지 않습니다.
//     항목은 서버(레이아웃)가 lib/menu.ts 에서 골라 내려줍니다. 여기에 배열을
//     하나 더 두면 이번 개편이 없애려던 "같은 메뉴가 두 곳에 있는" 상태가
//     그대로 되살아납니다. 이 파일은 '그리기'만 합니다.
//     (메뉴 항목의 badgeDesc 는 함수라 클라이언트로 못 넘깁니다. 서버가
//      숫자만 뽑아 badge 로 내려줍니다.)
//
//   ★ md(768px) 미만에서는 통째로 숨깁니다 — 기기 판별이 아니라 화면 폭
//     기준이라, PC 에서 창을 좁혀도 폰 배치가 됩니다. 폰은 기존 헤더 햄버거를
//     그대로 씁니다(모바일 드로어 교체는 5단계).
// =====================================================================

export type SidebarItem = {
  key: string;
  label: string;
  href: string;
  icon: string;
  // 0 이거나 없으면 배지를 그리지 않습니다.
  badge?: number;
  pending?: boolean;
};

export type SidebarGroup = {
  group: string;
  label: string;
  items: SidebarItem[];
};

// --- 현재 위치 판정 ---------------------------------------------------
//   기존 탭(FacilityTabs·MutualTabs·SaemTabs)의 usePathname + startsWith 를
//   따르되, 두 가지를 더 봅니다.
//     · 쿼리 — /hr?tab=records 와 /hr?tab=recruitment 는 경로가 같습니다.
//     · 구체성 — /hr 로 시작하는 경로가 많아(/hr/facility/...) 그냥 startsWith
//       로 잡으면 여러 항목이 동시에 켜집니다. 가장 구체적인 항목 하나만
//       켭니다(아래 점수 계산).
function matchScore(
  href: string,
  pathname: string,
  search: URLSearchParams,
): number {
  // 앵커(/profile/hr#my-certificates)는 서버가 구분해 주지 않으므로 떼고 봅니다.
  const [rawPath, rawQuery] = href.split("#")[0].split("?");
  const path = rawPath || "/";
  if (rawQuery) {
    // 쿼리까지 일치해야 하는 항목.
    if (pathname !== path) return 0;
    const want = new URLSearchParams(rawQuery);
    for (const [k, v] of want.entries()) {
      // /hr 은 tab 이 없으면 records 로 엽니다(app/(app)/hr/page.tsx).
      //   그래서 tab 이 비어 있을 때도 records 항목이 켜져야 합니다.
      const got = search.get(k) ?? (k === "tab" ? "records" : null);
      if (got !== v) return 0;
    }
    return path.length + 1000;
  }
  if (pathname === path) return path.length + 500;
  // "/" 는 모든 경로의 접두사라 정확히 일치할 때만 잡습니다.
  if (path !== "/" && pathname.startsWith(path + "/")) return path.length;
  return 0;
}

export default function Sidebar({ groups }: { groups: SidebarGroup[] }) {
  const pathname = usePathname() ?? "/";
  const search = useSearchParams();
  // 사용자가 직접 접고 편 그룹만 기억합니다. 나머지는 '현재 위치가 속한
  //   그룹은 펼침' 규칙으로 렌더 중에 계산합니다 — effect 로 맞추면 첫 프레임에
  //   접힌 채로 보였다가 펼쳐집니다.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  // 가장 잘 맞는 항목 하나만 현재 위치로 봅니다.
  let activeKey = "";
  let activeGroup = "";
  let best = 0;
  for (const g of groups) {
    for (const it of g.items) {
      if (it.pending) continue;
      const s = matchScore(it.href, pathname, search);
      if (s > best) {
        best = s;
        activeKey = it.key;
        activeGroup = g.group;
      }
    }
  }

  return (
    <aside
      aria-label="업무 메뉴"
      className="hidden w-60 shrink-0 border-r border-line bg-card md:block"
    >
      {/* 헤더가 스크롤로 올라가면 화면 위에 붙습니다. */}
      <nav className="sticky top-0 max-h-[100dvh] overflow-y-auto px-2 py-3">
        {groups.map((g) => {
          const open = toggled[g.group] ?? g.group === activeGroup;
          return (
            <div key={g.group} className="mb-1">
              <button
                type="button"
                aria-expanded={open}
                onClick={() =>
                  setToggled((p) => ({ ...p, [g.group]: !open }))
                }
                className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs font-bold tracking-wide text-navy transition hover:bg-navy-soft/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy"
              >
                {g.label}
                <span
                  aria-hidden
                  className={`text-[10px] text-ink-hint transition-transform ${
                    open ? "rotate-90" : ""
                  }`}
                >
                  ▶
                </span>
              </button>

              {open && (
                <ul className="mt-0.5 space-y-0.5">
                  {g.items.map((it) => {
                    const active = it.key === activeKey;
                    const body = (
                      <>
                        <span aria-hidden className="shrink-0 text-base">
                          {it.icon}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {it.label}
                        </span>
                        {!!it.badge && it.badge > 0 && (
                          <span
                            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                              active
                                ? "bg-navy text-white"
                                : "bg-stamp-soft text-stamp"
                            }`}
                          >
                            {it.badge > 999 ? "999+" : it.badge}
                          </span>
                        )}
                      </>
                    );

                    // 아직 만들지 않은 기능 — 링크가 아니라 흐린 줄로.
                    if (it.pending) {
                      return (
                        <li key={it.key}>
                          <span className="flex cursor-not-allowed items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-ink-hint">
                            {body}
                          </span>
                        </li>
                      );
                    }
                    return (
                      <li key={it.key}>
                        <Link
                          href={it.href}
                          aria-current={active ? "page" : undefined}
                          className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy ${
                            active
                              ? "bg-navy-soft font-bold text-navy"
                              : "text-ink-body hover:bg-surface"
                          }`}
                        >
                          {body}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
