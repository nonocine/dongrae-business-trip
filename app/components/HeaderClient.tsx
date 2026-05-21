"use client";

import Link from "next/link";
import { useState } from "react";
import { logoutCurrent } from "@/app/actions";

type SessionKind = "admin" | "employee" | null;

type NavLink = { href: string; label: string };

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
  const navLinks: NavLink[] = [];
  if (loggedIn) {
    navLinks.push({ href: "/", label: "메인" });
    navLinks.push({ href: "/new", label: "활동 작성" });
    if (canAccessHr) navLinks.push({ href: "/hr", label: "인사 모듈" });
    if (isAdmin) navLinks.push({ href: "/admin", label: "관리자" });
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 py-3 sm:gap-3 sm:py-4">
        {/* 모바일 햄버거 */}
        {loggedIn && (
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="메뉴 열기"
            className="-ml-1 rounded-md p-1.5 text-xl leading-none text-slate-600 hover:bg-slate-100 md:hidden"
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
            className="h-9 w-auto rounded-md bg-white object-contain sm:h-10"
          />
          <span className="flex flex-col leading-tight">
            <span className="text-base font-bold tracking-tight text-slate-900 sm:text-lg">
              동업자씨
            </span>
            <span className="hidden text-xs text-slate-500 sm:block">
              동래구청소년센터 업무 자동화 시스템
            </span>
          </span>
        </Link>

        {/* 데스크톱 가로 네비 */}
        {loggedIn && (
          <nav className="ml-3 hidden items-center gap-0.5 md:flex">
            {navLinks.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        )}

        {/* 우측 사용자 영역 */}
        <div className="ml-auto flex items-center gap-2">
          {loggedIn && (
            <>
              {/* 모바일: 이름만 */}
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 md:hidden">
                {isAdmin ? "👑 관리자" : `👤 ${displayName}`}
              </span>

              {/* 데스크톱: 드롭다운 */}
              <div className="relative hidden md:block">
                <button
                  type="button"
                  onClick={() => setUserMenuOpen((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
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
                    <div className="absolute right-0 z-40 mt-1 w-44 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                      {isAdmin ? (
                        <Link
                          href="/admin"
                          onClick={() => setUserMenuOpen(false)}
                          className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                        >
                          관리자 대시보드
                        </Link>
                      ) : (
                        <Link
                          href="/profile/password"
                          onClick={() => setUserMenuOpen(false)}
                          className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                        >
                          비밀번호 변경
                        </Link>
                      )}
                      <div className="my-1 border-t border-slate-100" />
                      <form action={logoutCurrent}>
                        <button
                          type="submit"
                          className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
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
          <div className="absolute inset-0 bg-slate-900/50" />
          <div
            className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <span className="text-base font-bold tracking-tight text-slate-900">
                동업자씨
              </span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="메뉴 닫기"
                className="rounded-md p-1 text-lg leading-none text-slate-500 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            <div className="border-b border-slate-200 px-4 py-3">
              <span className="text-xs font-medium text-slate-500">
                {isAdmin ? "👑 관리자" : `👤 ${displayName}`}
              </span>
            </div>

            <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
              {navLinks.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setMobileOpen(false)}
                  className="rounded-md px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  {l.label}
                </Link>
              ))}

              <div className="my-1 border-t border-slate-100" />

              {isAdmin ? (
                <Link
                  href="/admin"
                  onClick={() => setMobileOpen(false)}
                  className="rounded-md px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  관리자 대시보드
                </Link>
              ) : (
                <Link
                  href="/profile/password"
                  onClick={() => setMobileOpen(false)}
                  className="rounded-md px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  비밀번호 변경
                </Link>
              )}

              <form action={logoutCurrent}>
                <button
                  type="submit"
                  className="w-full rounded-md px-3 py-2.5 text-left text-sm font-medium text-red-600 hover:bg-red-50"
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
