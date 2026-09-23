// =====================================================================
// 메뉴 → 화면에 그릴 모양 (순수 변환)
//
//   왜 따로 두는가:
//     같은 메뉴를 PC 좌측 사이드바와 폰 드로어 두 곳이 그립니다. 각자
//     lib/menu.ts 를 읽어 그룹을 만들면 '거르고 묶는 규칙' 이 두 벌이 되어,
//     한쪽만 고치면 폰과 PC 에 다른 항목이 보이게 됩니다. 그 변환을 여기
//     한 곳에 둡니다.
//
//   ★ 순수 함수만 둡니다(DB·세션 접근 없음). 서버가 이 결과를 만들어 클라이언트
//     컴포넌트에 props 로 내려줍니다 — MenuItem.badgeDesc 는 함수라 직렬화가
//     안 되므로, 여기서 숫자만 뽑아 badge 로 바꿉니다.
//
//   ★ 레거시(legacy:true — 활동일지·활동 작성)는 일반 그룹에서 빼 따로 돌려줍니다.
//     제거가 아니라 위치만 내리는 것이라, 화면은 이걸 맨 아래 별도 구역으로
//     그립니다. 지금 쓰는 사람이 있으므로 접근은 그대로입니다.
// =====================================================================

import {
  MENU_GROUPS,
  MENU_GROUP_LABEL,
  menuItemsFor,
  type MenuContext,
  type MenuGroup,
} from "@/lib/menu";

export type MenuNavItem = {
  key: string;
  label: string;
  href: string;
  icon: string;
  // 0 이거나 없으면 배지를 그리지 않습니다.
  badge?: number;
  pending?: boolean;
};

export type MenuNavGroup = {
  group: string;
  label: string;
  items: MenuNavItem[];
};

export type MenuTree = {
  groups: MenuNavGroup[];
  // 맨 아래 별도 구역에 그릴 항목들.
  legacy: MenuNavItem[];
};

// 사이드바·드로어가 쓰는 '메인' 링크.
//   ★ lib/menu.ts 배열에는 일부러 넣지 않습니다. 그 배열은 대시보드 카드도
//     함께 만들기 때문에, 넣는 순간 대시보드에 '메인' 카드가 생깁니다
//     (자기 화면으로 가는 카드라 이상합니다). 네비게이션에만 필요한 항목이라
//     여기 상수로 두고 화면이 맨 위에 따로 그립니다.
export const MENU_HOME = {
  key: "__home__",
  label: "메인",
  href: "/",
  icon: "🏠",
} as const;

export function buildMenuTree(
  ctx: MenuContext,
  badges: Record<string, number | undefined>,
): MenuTree {
  const toNav = (i: {
    key: string;
    label: string;
    href: string;
    icon: string;
    pending?: true;
    badgeDesc?: unknown;
  }): MenuNavItem => ({
    key: i.key,
    label: i.label,
    href: i.href,
    icon: i.icon,
    // 배지를 쓰겠다고 선언한 항목(badgeDesc 보유)만 숫자를 답니다.
    badge: i.badgeDesc ? badges[i.href] : undefined,
    pending: i.pending,
  });

  const legacy: MenuNavItem[] = [];
  const groups: MenuNavGroup[] = [];

  for (const group of MENU_GROUPS as readonly MenuGroup[]) {
    const visible = menuItemsFor(group, ctx);
    const normal = [];
    for (const item of visible) {
      if (item.legacy) legacy.push(toNav(item));
      else normal.push(toNav(item));
    }
    if (normal.length > 0) {
      groups.push({ group, label: MENU_GROUP_LABEL[group], items: normal });
    }
  }

  return { groups, legacy };
}
