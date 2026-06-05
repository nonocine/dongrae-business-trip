import { getSession, isAdmin, isGoogleAuth } from "@/app/actions";
import { supabase, canAccessHr, type EmployeeRank } from "@/lib/supabase";
import HeaderClient from "@/app/components/HeaderClient";

export default async function Header() {
  const session = await getSession();

  // HR 메뉴 노출 권한 — requireHrAdmin 과 동일 기준:
  //   ADMIN_PASSWORD · Google Workspace · 관장/부장 직원 중 하나.
  let hrAccess = (await isAdmin()) || (await isGoogleAuth());
  if (!hrAccess && session?.kind === "employee") {
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

  return (
    <HeaderClient
      kind={session?.kind ?? null}
      name={session?.kind === "employee" ? session.name : null}
      canAccessHr={hrAccess}
    />
  );
}
