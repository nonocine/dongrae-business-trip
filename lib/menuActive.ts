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

export function matchScore(
  href: string,
  pathname: string,
  search: URLSearchParams,
): number {
  // 앵커(/profile/hr#my-certificates)는 브라우저가 서버로 보내지 않으므로 뗍니다.
  const [rawPath, rawQuery] = href.split("#")[0].split("?");
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
): { key: string; group: string } {
  let key = "";
  let group = "";
  let best = 0;
  const scan = (items: MenuNavItem[], g: string) => {
    for (const it of items) {
      if (it.pending) continue;
      const s = matchScore(it.href, pathname, search);
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
