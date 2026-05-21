import { getSession } from "@/app/actions";
import { supabase, canAccessHr, type EmployeeRank } from "@/lib/supabase";
import HeaderClient from "@/app/components/HeaderClient";

export default async function Header() {
  const session = await getSession();

  // 인사 모듈 진입 권한(관장·부장) 판정 — 직원 세션일 때만 조회.
  let hrAccess = false;
  if (session?.kind === "employee") {
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
