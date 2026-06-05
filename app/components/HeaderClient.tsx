"use client";

import Link from "next/link";
import { useState } from "react";
import { logoutCurrent } from "@/app/actions";

type SessionKind = "admin" | "employee" | null;

type NavChild = { href: string; label: string };
type NavItem = { href: string; label: string; children?: NavChild[] };

export default function HeaderClient({
  kind,
  name,
  canAccessHr,
}: {
  kind: SessionKind;
  name: string | null;
  canAccessHr: boolean;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const loggedIn = kind !== null;
  const isAdmin = kind === "admin";
  const displayName = isAdmin ? "관리자" : name ?? "";

  // 좌측 네비게이션 (권한별)
  const navItems: NavItem[] = [];
  if (loggedIn) {
    navItems.push({ href: "/", label: "메인" });
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
            <span className="hidden text-xs text-ink-hint sm:block">
              동래구청소년센터 업무 자동화 시스템
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

            <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
              {navItems.map((item) =>
                item.children ? (
                  <div key={item.href} className="flex flex-col gap-0.5">
                    <Link
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className="rounded-md px-3 py-2.5 text-sm font-semibold text-ink hover:bg-surface"
                    >
                      {item.label}
                    </Link>
                    <div className="ml-3 flex flex-col gap-0.5 border-l border-line pl-2">
                      {item.children.map((c) => (
                        <Link
                          key={c.href}
                          href={c.href}
                          onClick={() => setMobileOpen(false)}
                          className="rounded-md px-3 py-2 text-sm text-ink-body hover:bg-surface"
                        >
                          {c.label}
                        </Link>
                      ))}
                    </div>
                  </div>
                ) : (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className="rounded-md px-3 py-2.5 text-sm font-medium text-ink-body hover:bg-surface"
                  >
                    {item.label}
                  </Link>
                )
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
