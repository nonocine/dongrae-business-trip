"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { MENU_HOME, type MenuNavItem, type MenuTree } from "@/lib/menuTree";
import { findActive } from "@/lib/menuActive";

// =====================================================================
// PC 좌측 고정 사이드바 — (app) 껍데기의 왼쪽 열.
//
//   ★ 메뉴를 여기에 다시 적지 않습니다.
//     항목은 서버(레이아웃)가 lib/menu.ts → lib/menuTree.ts 를 거쳐 내려줍니다.
//     폰 드로어도 같은 트리를 받아 그리므로, 권한별로 보이는 항목이 PC 와
//     폰에서 어긋날 수 없습니다. 이 파일은 '그리기'만 합니다.
//
//   ★ md(768px) 미만에서는 통째로 숨깁니다 — 기기 판별이 아니라 화면 폭
//     기준이라 PC 에서 창을 좁혀도 폰 배치가 됩니다.
// =====================================================================

export default function Sidebar({ tree }: { tree: MenuTree }) {
  const pathname = usePathname() ?? "/";
  const search = useSearchParams();
  // 사용자가 직접 접고 편 그룹만 기억합니다. 나머지는 '현재 위치가 속한
  //   그룹은 펼침' 규칙으로 렌더 중에 계산합니다 — effect 로 맞추면 첫 프레임에
  //   접힌 채로 보였다가 펼쳐집니다.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const active = findActive(tree.groups, tree.legacy, pathname, search);
  // '메인' 은 트리 밖 항목이라 따로 판정합니다(경로가 정확히 "/" 일 때만).
  const homeActive = pathname === "/" && active.key === "";

  return (
    <aside
      aria-label="업무 메뉴"
      className="hidden w-60 shrink-0 border-r border-line bg-card md:block"
    >
      {/* 헤더가 스크롤로 올라가면 화면 위에 붙습니다. */}
      <nav className="sticky top-0 flex max-h-[100dvh] flex-col overflow-y-auto px-2 py-3">
        {/* 메인 — 상단 고정.
            lib/menu.ts 배열에는 일부러 없습니다(대시보드에 '메인' 카드가
            생기지 않게). 네비게이션에만 필요한 항목이라 여기서 그립니다. */}
        <Link
          href={MENU_HOME.href}
          aria-current={homeActive ? "page" : undefined}
          className={`mb-2 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy ${
            homeActive
              ? "bg-navy-soft font-bold text-navy"
              : "font-semibold text-ink-body hover:bg-surface"
          }`}
        >
          <span aria-hidden className="shrink-0 text-base">
            {MENU_HOME.icon}
          </span>
          <span className="min-w-0 flex-1 truncate">{MENU_HOME.label}</span>
        </Link>

        {tree.groups.map((g) => {
          const open = toggled[g.group] ?? g.group === active.group;
          return (
            <div key={g.group} className="mb-1">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setToggled((p) => ({ ...p, [g.group]: !open }))}
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
                  {g.items.map((it) => (
                    <li key={it.key}>
                      <NavRow item={it} active={it.key === active.key} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}

        {/* 이전 기능 — 레거시(활동일지 계열)를 맨 아래로 내립니다.
            지우는 것이 아니라 자리만 옮긴 것이라 눌러서 그대로 들어갑니다. */}
        {tree.legacy.length > 0 && (
          <div className="mt-2 border-t border-line pt-2">
            <p className="px-2.5 pb-1 text-[11px] font-semibold text-ink-hint">
              이전 기능
            </p>
            <ul className="space-y-0.5">
              {tree.legacy.map((it) => (
                <li key={it.key}>
                  <NavRow item={it} active={it.key === active.key} muted />
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>
    </aside>
  );
}

// 항목 한 줄 — 일반/레거시/준비중을 같은 모양으로 그립니다.
function NavRow({
  item,
  active,
  muted,
}: {
  item: MenuNavItem;
  active: boolean;
  muted?: boolean;
}) {
  const body = (
    <>
      <span aria-hidden className="shrink-0 text-base">
        {item.icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {!!item.badge && item.badge > 0 && (
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
            active ? "bg-navy text-white" : "bg-stamp-soft text-stamp"
          }`}
        >
          {item.badge > 999 ? "999+" : item.badge}
        </span>
      )}
    </>
  );

  // 아직 만들지 않은 기능 — 링크가 아니라 흐린 줄로.
  if (item.pending) {
    return (
      <span className="flex cursor-not-allowed items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-ink-hint">
        {body}
      </span>
    );
  }
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy ${
        active
          ? "bg-navy-soft font-bold text-navy"
          : muted
            ? "text-ink-muted hover:bg-surface"
            : "text-ink-body hover:bg-surface"
      }`}
    >
      {body}
    </Link>
  );
}
