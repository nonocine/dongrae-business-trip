// =====================================================================
// 현재 위치 판정 — 사이드바(PC)와 드로어(폰)가 같은 규칙을 씁니다.
//
//   기존 탭(FacilityTabs·MutualTabs·SaemTabs)의 usePathname + startsWith 를
//   따르되 두 가지를 더 봅니다.
//     · 쿼리 — /hr?tab=records 와 /hr?tab=recruitment 는 경로가 같습니다.
//     · 구체성 — /hr 로 시작하는 경로가 많아(/hr/facility/...) 그냥 startsWith
//       로 잡으면 여러 항목이 동시에 켜집니다. 점수를 매겨 가장 구체적인
//       항목 하나만 켭니다.
//
//   순수 함수라 클라이언트 컴포넌트가 그대로 가져다 씁니다.
// =====================================================================

import type { MenuNavGroup, MenuNavItem } from "@/lib/menuTree";
import { HASH_TO_TAB } from "@/lib/profileHrTabs";

// 해시 비교용 — 같은 탭을 가리키는 별칭(#certs·#my-certificates)은 같은 값으로.
function normHash(h: string): string {
  const k = h.replace(/^#/, "").trim().toLowerCase();
  return HASH_TO_TAB[k] ?? k;
}

export function matchScore(
  href: string,
  pathname: string,
  search: URLSearchParams,
  hash = "",
): number {
  // 해시 링크(/profile/hr#my-certificates) — 같은 경로이고 지금 해시가 같은 탭을 가리킬 때만.
  //   맞으면 해시 없는 같은 경로 항목(내 인사기록카드 = /profile/hr)보다 앞섭니다.
  //   해시가 다르면 이 항목은 켜지지 않고, 해시 없는 항목이 경로 일치로 켜집니다.
  //   (2026-11 — 예전에는 해시를 떼고 비교해 '내 정보' 항목 중 첫 줄만 늘 켜졌습니다.)
  const hashIdx = href.indexOf("#");
  if (hashIdx >= 0) {
    const want = href.slice(hashIdx + 1);
    const p = href.slice(0, hashIdx).split("?")[0] || "/";
    if (pathname !== p) return 0;
    return normHash(want) === normHash(hash) ? p.length + 1500 : 0;
  }
  const [rawPath, rawQuery] = href.split("?");
  const path = rawPath || "/";
  if (rawQuery) {
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

// 지금 위치에 해당하는 항목 하나(key)와 그 항목이 속한 그룹.
//   같은 경로를 가리키는 항목이 여럿이면(/mail 은 공통·관리자 양쪽) 먼저
//   나온 하나만 켜서 목록이 어지럽지 않게 합니다.
export function findActive(
  groups: MenuNavGroup[],
  extra: MenuNavItem[],
  pathname: string,
  search: URLSearchParams,
  hash = "",
): { key: string; group: string } {
  let key = "";
  let group = "";
  let best = 0;
  const scan = (items: MenuNavItem[], g: string) => {
    for (const it of items) {
      if (it.pending) continue;
      const s = matchScore(it.href, pathname, search, hash);
      if (s > best) {
        best = s;
        key = it.key;
        group = g;
      }
    }
  };
  for (const gr of groups) scan(gr.items, gr.group);
  scan(extra, "__extra__");
  return { key, group };
}
