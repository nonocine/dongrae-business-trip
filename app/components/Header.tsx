import { getSession, isManagerAdmin } from "@/app/actions";
import HeaderClient from "@/app/components/HeaderClient";
import { getShellData } from "@/app/(app)/shellData";
import { buildMenuTree, type MenuTree } from "@/lib/menuTree";

export default async function Header() {
  const session = await getSession();

  // 관리자(관장) 표기 — /admin 게이트(isManagerAdmin)와 동일 기준.
  //   헤더에서는 이름 자리에 "관리자" 로 보여줄지와 계정 메뉴에 관리자
  //   대시보드를 띄울지에만 씁니다.
  const canAccessAdmin = await isManagerAdmin();

  // ★ 예전에는 여기서 HR 접근 권한(canAccessHr)도 계산해 헤더 가로 네비의
  //   'HR 관리' 를 켜고 껐습니다. 그 네비를 걷어내면서(2026-09) 함께 지웠습니다.
  //   직급 기반이라 직무·권한등급으로 연 /hr 가드와 어긋나 있었고, 좌측
  //   사이드바가 lib/menu.ts 조건으로 같은 일을 정확히 하고 있습니다.

  // 폰 드로어가 쓸 메뉴 트리 — PC 사이드바와 '같은' 트리입니다.
  //   ★ 드로어가 자기 메뉴 배열을 갖고 있으면 lib/menu.ts 와 별개로 살아서,
  //     권한 조건이 바뀌어도 폰만 옛 항목을 보여줍니다. 그래서 여기서 만들어
  //     넘깁니다. getShellData 는 cache() 라 레이아웃이 이미 불렀으면 다시
  //     돌지 않습니다(한 요청에 한 번).
  let tree: MenuTree | null = null;
  if (session) {
    const { ctx, badges } = await getShellData();
    tree = buildMenuTree(ctx, badges);
  }

  return (
    <HeaderClient
      kind={session?.kind ?? null}
      name={session?.name ?? null}
      canAccessAdmin={canAccessAdmin}
      tree={tree}
    />
  );
}
