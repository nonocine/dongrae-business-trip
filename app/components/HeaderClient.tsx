"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { logoutCurrent } from "@/app/actions";
import { MENU_HOME, type MenuTree } from "@/lib/menuTree";
import { findActive } from "@/lib/menuActive";

type SessionKind = "employee" | null;


export default function HeaderClient({
  kind,
  name,
  canAccessAdmin,
  tree,
}: {
  kind: SessionKind;
  name: string | null;
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

  // ★ 데스크톱 가로 네비(메인·활동일지·활동 작성·HR 관리·관리자)는 제거했습니다.
  //   좌측 사이드바가 그 역할을 전부 하므로 중복이었고, 무엇보다 게이트가
  //   달랐습니다 — 헤더는 직급(canAccessHr = 관장·부장)으로 걸고 사이드바는
  //   직무·권한등급으로 걸어서, hr 직무를 가진 팀장은 사이드바에 '인사' 가
  //   있는데 헤더에는 'HR 관리' 가 없었습니다. 메뉴가 두 곳에서 따로 살면
  //   반드시 이렇게 어긋납니다.
  //   여기서만 갈 수 있던 /admin 은 lib/menu.ts 의 '관리자 영역' 으로 옮겼습니다.
  //   폰은 그대로입니다 — 햄버거 드로어가 메뉴 역할을 합니다(md 미만).

  return (
    <header className="border-b border-line bg-card">
      {/* 로고를 화면 왼쪽 끝에 붙입니다(가운데 정렬 컨테이너를 쓰지 않음).
          좌측 패딩을 사이드바 폭(w-60=240px)에 맞춰, PC 에서 로고가 사이드바
          열 위에 얹혀 좌측 열이 하나로 이어져 보이게 했습니다.
          폰에서는 사이드바가 없으므로 기존처럼 px-4 만 줍니다. */}
      <div className="flex w-full items-center gap-2 px-4 py-3 sm:gap-3 sm:py-4 md:pl-5">
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

        {/* 우측 사용자 영역 — 계정 메뉴만 남습니다. */}
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
