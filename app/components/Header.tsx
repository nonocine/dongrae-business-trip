import { getSession, getGoogleSession, isManagerAdmin } from "@/app/actions";
import { supabase, canAccessHr, type EmployeeRank } from "@/lib/supabase";
import HeaderClient from "@/app/components/HeaderClient";

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
        const { data } = await supabase
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

  return (
    <HeaderClient
      kind={session?.kind ?? null}
      name={session?.name ?? null}
      canAccessHr={hrAccess}
      canAccessAdmin={canAccessAdmin}
    />
  );
}
