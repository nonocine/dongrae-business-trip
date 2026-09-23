import { getSession, getGoogleSession, isManagerAdmin } from "@/app/actions";
import { canAccessHr, type EmployeeRank } from "@/lib/supabase";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import HeaderClient from "@/app/components/HeaderClient";
import { getShellData } from "@/app/(app)/shellData";
import { buildMenuTree, type MenuTree } from "@/lib/menuTree";

export default async function Header() {
  const session = await getSession();

  // 관리자(관장) 진입 권한 — /admin 게이트(isManagerAdmin)와 동일 기준.
  const canAccessAdmin = await isManagerAdmin();

  // HR 메뉴 노출 권한 — requireHrAdmin 과 동일 기준:
  //   Google(master·관장·부장) 또는 직원 비번 로그인(관장·부장).
  let hrAccess = canAccessAdmin; // 관장/master 는 HR 도 당연히 접근.
  if (!hrAccess) {
    const g = await getGoogleSession();
    if (g) {
      hrAccess = !!g.rank && canAccessHr(g.rank as EmployeeRank | null);
    } else if (session?.kind === "employee") {
      try {
        const { data } = await supabaseAdmin
          .from("drivers")
          .select("rank")
          .eq("name", session.name)
          .eq("is_active", true)
          .maybeSingle();
        const rank = (data?.rank as EmployeeRank | null) ?? null;
        hrAccess = canAccessHr(rank);
      } catch {
        hrAccess = false;
      }
    }
  }

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
      canAccessHr={hrAccess}
      canAccessAdmin={canAccessAdmin}
      tree={tree}
    />
  );
}
