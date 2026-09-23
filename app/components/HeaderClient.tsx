"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { logoutCurrent } from "@/app/actions";
import { MENU_HOME, type MenuTree } from "@/lib/menuTree";
import { findActive } from "@/lib/menuActive";

type SessionKind = "employee" | null;

type NavChild = { href: string; label: string };
type NavItem = { href: string; label: string; children?: NavChild[] };

export default function HeaderClient({
  kind,
  name,
  canAccessHr,
  canAccessAdmin,
  tree,
}: {
  kind: SessionKind;
  name: string | null;
  canAccessHr: boolean;
  canAccessAdmin: boolean;
  // 폰 드로어가 그릴 메뉴 — PC 사이드바와 같은 트리(서버가 만들어 내려줍니다).
  //   비로그인이면 null.
  tree: MenuTree | null;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const pathname = usePathname() ?? "/";
  const search = useSearchParams();

  const loggedIn = kind !== null;
  // 관리자 표기/진입은 관장 권한(canAccessAdmin) 기준 — 구글 master/관장 포함.
  const isAdmin = canAccessAdmin;
  const displayName = isAdmin ? "관리자" : name ?? "";

  // 드로어의 현재 위치 — PC 사이드바와 같은 판정(lib/menuActive).
  const drawerActive = tree
    ? findActive(tree.groups, tree.legacy, pathname, search)
    : { key: "", group: "" };

  // 좌측 네비게이션 (권한별)
  const navItems: NavItem[] = [];
  if (loggedIn) {
    navItems.push({ href: "/", label: "메인" });
    navItems.push({ href: "/activities", label: "활동일지" });
    navItems.push({ href: "/new", label: "활동 작성" });
    if (canAccessHr)
      navItems.push({
        href: "/hr",
        label: "HR 관리",
        children: [
          { href: "/hr?tab=recruitment", label: "채용 관리" },
          { href: "/hr/external-judges", label: "외부 심사위원" },
          { href: "/hr?tab=records", label: "직원 관리" },
        ],
      });
    if (isAdmin) navItems.push({ href: "/admin", label: "관리자" });
  }

  return (
    <header className="border-b border-line bg-card">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 py-3 sm:gap-3 sm:py-4">
        {/* 모바일 햄버거 */}
        {loggedIn && (
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="메뉴 열기"
            className="-ml-1 rounded-md p-1.5 text-xl leading-none text-ink-muted hover:bg-surface md:hidden"
          >
            ☰
          </button>
        )}

        {/* 로고 + 브랜딩 */}
        <Link href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/dongrae-logo.png"
            alt="동래구청소년센터 로고"
            className="h-9 w-auto rounded-md bg-card object-contain sm:h-10"
          />
          <span className="flex flex-col leading-tight">
            <span className="text-base font-bold tracking-tight text-ink sm:text-lg">
              동업자씨
            </span>
            {/* 앱 이름의 유래를 부제목에서 바로 보이게 — 앞글자를 모으면
                "동업자씨"가 됩니다. 로고 4색으로 그 글자만 강조합니다.
                ⚠️ "씨스템"은 오타가 아니라 의도한 표기입니다 — 앱 이름이
                '동업자씨'라서 넷째 글자를 '씨'로 맞춥니다. 메타태그·PDF 등
                공식 문서 쪽은 '시스템'을 그대로 씁니다(여기 헤더만 예외).
                줄바꿈이 끼면 유래가 안 읽히므로 span 과 뒤 글자를 같은 줄에
                붙여 둡니다 — JSX 가 줄 사이에 공백을 넣지 않게. */}
            <span className="hidden text-xs text-ink-hint sm:block">
              <span className="font-semibold text-logo-red">동</span>래구청소년센터{" "}
              <span className="font-semibold text-logo-blue">업</span>무{" "}
              <span className="font-semibold text-logo-green">자</span>동화{" "}
              <span className="font-semibold text-logo-yellow">씨</span>스템
            </span>
          </span>
        </Link>

        {/* 데스크톱 가로 네비 */}
        {loggedIn && (
          <nav className="ml-3 hidden items-center gap-0.5 md:flex">
            {navItems.map((item) =>
              item.children ? (
                <DesktopNavMenu key={item.href} item={item} />
              ) : (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-3 py-1.5 text-sm font-medium text-ink-muted transition hover:bg-surface hover:text-ink"
                >
                  {item.label}
                </Link>
              )
            )}
          </nav>
        )}

        {/* 우측 사용자 영역 */}
        <div className="ml-auto flex items-center gap-2">
          {loggedIn && (
            <>
              {/* 모바일: 이름만 */}
              <span className="inline-flex items-center gap-1 rounded-full bg-surface px-3 py-1 text-xs font-medium text-ink-body md:hidden">
                {isAdmin ? "👑 관리자" : `👤 ${displayName}`}
              </span>

              {/* 데스크톱: 드롭다운 */}
              <div className="relative hidden md:block">
                <button
                  type="button"
                  onClick={() => setUserMenuOpen((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-full bg-surface px-3 py-1.5 text-xs font-medium text-ink-body transition hover:bg-navy-soft"
                >
                  {isAdmin ? "👑 관리자" : `👤 ${displayName}`}
                  <span aria-hidden className="text-[10px]">
                    ▾
                  </span>
                </button>
                {userMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-30"
                      onClick={() => setUserMenuOpen(false)}
                    />
                    <div className="absolute right-0 z-40 mt-1 w-44 overflow-hidden rounded-lg border border-line bg-card py-1 shadow-lg">
                      {isAdmin ? (
                        <Link
                          href="/admin"
                          onClick={() => setUserMenuOpen(false)}
                          className="block px-3 py-2 text-sm text-ink-body hover:bg-surface"
                        >
                          관리자 대시보드
                        </Link>
                      ) : (
                        <>
                          <Link
                            href="/profile/hr"
                            onClick={() => setUserMenuOpen(false)}
                            className="block px-3 py-2 text-sm text-ink-body hover:bg-surface"
                          >
                            내 인사기록카드
                          </Link>
                          <Link
                            href="/profile/password"
                            onClick={() => setUserMenuOpen(false)}
                            className="block px-3 py-2 text-sm text-ink-body hover:bg-surface"
                          >
                            비밀번호 변경
                          </Link>
                        </>
                      )}
                      <div className="my-1 border-t border-line" />
                      <form action={logoutCurrent}>
                        <button
                          type="submit"
                          className="block w-full px-3 py-2 text-left text-sm text-stamp hover:bg-stamp-soft"
                        >
                          로그아웃
                        </button>
                      </form>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 모바일 사이드 드로어 */}
      {loggedIn && mobileOpen && (
        <div
          className="fixed inset-0 z-50 md:hidden"
          onClick={() => setMobileOpen(false)}
        >
          <div className="absolute inset-0 bg-black/40" />
          <div
            data-drawer="menu"
            className="absolute inset-y-0 left-0 flex w-64 flex-col bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="text-base font-bold tracking-tight text-ink">
                동업자씨
              </span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="메뉴 닫기"
                className="rounded-md p-1 text-lg leading-none text-ink-muted hover:bg-surface"
              >
                ✕
              </button>
            </div>

            <div className="border-b border-line px-4 py-3">
              <span className="text-xs font-medium text-ink-muted">
                {isAdmin ? "👑 관리자" : `👤 ${displayName}`}
              </span>
            </div>

            {/* 업무 메뉴 — PC 사이드바와 같은 트리(lib/menu.ts → menuTree).
                예전에는 이 드로어가 자기 배열(메인·활동일지·활동 작성·HR 관리)
                을 갖고 있어, 권한 조건을 고쳐도 폰만 옛 항목을 보여줬습니다. */}
            <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
              {/* 메인 — 상단 고정. menu.ts 배열에는 없습니다(대시보드에 '메인'
                  카드가 생기지 않게). */}
              <DrawerRow
                item={MENU_HOME}
                active={pathname === "/" && drawerActive.key === ""}
                onGo={() => setMobileOpen(false)}
              />

              {tree?.groups.map((g) => (
                <div key={g.group} className="mt-1.5">
                  <p className="px-3 pb-0.5 text-[11px] font-bold tracking-wide text-navy">
                    {g.label}
                  </p>
                  {g.items.map((it) => (
                    <DrawerRow
                      key={it.key}
                      item={it}
                      active={it.key === drawerActive.key}
                      onGo={() => setMobileOpen(false)}
                    />
                  ))}
                </div>
              ))}

              {/* 이전 기능 — 레거시를 맨 아래 별도 구역으로. 지우는 것이 아니라
                  자리만 내린 것이라 눌러서 그대로 들어갑니다. */}
              {tree && tree.legacy.length > 0 && (
                <div className="mt-2 border-t border-line pt-2">
                  <p className="px-3 pb-0.5 text-[11px] font-semibold text-ink-hint">
                    이전 기능
                  </p>
                  {tree.legacy.map((it) => (
                    <DrawerRow
                      key={it.key}
                      item={it}
                      active={it.key === drawerActive.key}
                      muted
                      onGo={() => setMobileOpen(false)}
                    />
                  ))}
                </div>
              )}

              <div className="my-1 border-t border-line" />

              {isAdmin ? (
                <Link
                  href="/admin"
                  onClick={() => setMobileOpen(false)}
                  className="rounded-md px-3 py-2.5 text-sm font-medium text-ink-body hover:bg-surface"
                >
                  관리자 대시보드
                </Link>
              ) : (
                <>
                  <Link
                    href="/profile/hr"
                    onClick={() => setMobileOpen(false)}
                    className="rounded-md px-3 py-2.5 text-sm font-medium text-ink-body hover:bg-surface"
                  >
                    내 인사기록카드
                  </Link>
                  <Link
                    href="/profile/password"
                    onClick={() => setMobileOpen(false)}
                    className="rounded-md px-3 py-2.5 text-sm font-medium text-ink-body hover:bg-surface"
                  >
                    비밀번호 변경
                  </Link>
                </>
              )}

              <form action={logoutCurrent}>
                <button
                  type="submit"
                  className="w-full rounded-md px-3 py-2.5 text-left text-sm font-medium text-stamp hover:bg-stamp-soft"
                >
                  로그아웃
                </button>
              </form>
            </nav>
          </div>
        </div>
      )}
    </header>
  );
}

// 드로어 항목 한 줄 — 누르면 드로어가 닫힙니다(onGo).
//   겉모습은 기존 드로어 그대로 두고, 현재 위치 강조만 더했습니다.
function DrawerRow({
  item,
  active,
  muted,
  onGo,
}: {
  item: { label: string; href: string; icon: string; badge?: number; pending?: boolean };
  active: boolean;
  muted?: boolean;
  onGo: () => void;
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

  if (item.pending) {
    return (
      <span className="flex cursor-not-allowed items-center gap-2 rounded-md px-3 py-2.5 text-sm text-ink-hint">
        {body}
      </span>
    );
  }
  return (
    <Link
      href={item.href}
      onClick={onGo}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2 rounded-md px-3 py-2.5 text-sm transition ${
        active
          ? "bg-navy-soft font-bold text-navy"
          : muted
            ? "text-ink-muted hover:bg-surface"
            : "font-medium text-ink-body hover:bg-surface"
      }`}
    >
      {body}
    </Link>
  );
}

// 데스크톱 네비 드롭다운 — children 이 있는 상위 메뉴(HR 관리)용.
function DesktopNavMenu({ item }: { item: NavItem }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium text-ink-muted transition hover:bg-surface hover:text-ink"
      >
        {item.label}
        <span aria-hidden className="text-[10px]">
          ▾
        </span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-40 mt-1 w-44 overflow-hidden rounded-lg border border-line bg-card py-1 shadow-lg">
            {item.children?.map((c) => (
              <Link
                key={c.href}
                href={c.href}
                onClick={() => setOpen(false)}
                className="block px-3 py-2 text-sm text-ink-body hover:bg-surface"
              >
                {c.label}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
