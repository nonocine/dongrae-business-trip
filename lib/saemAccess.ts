// =====================================================================
// 강사·프로그램 관리(동래샘들 연동) 접근 게이트 — /hr/saems
//   * 접근: M0(관장·부장·master) 또는 saem(강사관리) 직무.
//     (강사관리는 인사가 아닌 각 사업 담당이 쓰므로 hr 와 분리한 전용 직무)
//   * saem_* 테이블은 RLS 0개 → service_role 경유. 이 게이트가 유일 방어선.
//   * M0 전용 동작을 위해 isM0 반환. onlyM0 옵션 지원.
//     SA-17 기준 M0 전용은 둘뿐 — 정산(confirmed) 확정취소·강사 완전삭제.
//     일지 확정취소·초기화, 정산 draft 생성/재계산/삭제는 saem 도 가능.
//   * 서버 전용 모듈 — 액션/페이지가 import.
// =====================================================================

import { getSession, getGoogleSession } from "@/app/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isM0Grant } from "@/lib/authLevels";
import { listRolesForDriver } from "@/lib/employeeRolesServer";

export type SaemAccess = {
  name: string;
  driverId: string | null;
  isM0: boolean;
  // 강사관리 '관리' 권한 — M0 또는 saem 직무. 열람만 하는 사람은 false.
  canManage: boolean;
};

// =====================================================================
// 열람 게이트 (2026-09) — 로그인한 직원이면 누구나.
//
//   관장 지시: "강사관리는 직원 누구나 접근". 동아리관리(lib/clubAccess.ts)와
//   같은 정책입니다.
//
//   ★ 하지만 이 구역에는 열어서는 안 되는 것이 섞여 있습니다.
//       · 강사 계좌(bank_name/bank_account/account_holder)
//       · 주민번호 앞 7자리(rrnMask) — 암호문(rrn_enc)은 원래 화면에 안 갑니다
//       · 초대 토큰(invite_token) — 유출되면 남의 계정을 가져갈 수 있습니다
//       · 정산 금액(saem_settlements / saem_settlement_items)
//       · 강사 첨부서류(이력서·성범죄경력조회 등)
//     그래서 '열람' 과 '관리' 를 나눴습니다. 위 항목은 canManage(=예전 기준,
//     M0 또는 saem 직무)에게만 갑니다. 목록·프로그램·근무일지처럼 업무상
//     같이 봐야 하는 것만 전 직원에게 엽니다.
//
//   ★ 쓰기 동작은 전부 그대로 requireSaemAccess(=관리) 를 씁니다. 이름을
//     바꾸지 않은 이유가 그것입니다 — 55곳을 건드리지 않아야 실수로 열리는
//     쓰기가 생기지 않습니다.
// =====================================================================
export async function resolveSaemView(): Promise<SaemAccess | null> {
  const me = await getSession();
  if (!me || me.kind !== "employee" || !me.name.trim()) return null;
  const g = await getGoogleSession();

  const { data: driver } = await supabaseAdmin
    .from("drivers")
    .select("id, rank")
    .eq("name", me.name.trim())
    .maybeSingle();
  const driverId =
    driver && typeof (driver as { id?: unknown }).id === "string"
      ? String((driver as { id: string }).id)
      : null;
  const rank = (driver as { rank?: string | null } | null)?.rank ?? null;

  let authLevel: string | null = null;
  if (driverId) {
    const { data: prof } = await supabaseAdmin
      .from("employee_profiles")
      .select("auth_level")
      .eq("driver_id", driverId)
      .maybeSingle();
    authLevel =
      (prof as { auth_level?: string | null } | null)?.auth_level ?? null;
  }

  const isM0 = isM0Grant({ rank, email: g?.email, authLevel });
  const roles = driverId ? await listRolesForDriver(driverId) : [];
  return {
    name: me.name.trim(),
    driverId,
    isM0,
    canManage: isM0 || roles.includes("saem"),
  };
}

// 열람 액션용 — 로그인 직원이면 통과. 미로그인만 throw.
export async function requireSaemView(): Promise<SaemAccess> {
  const ctx = await resolveSaemView();
  if (!ctx) throw new Error("직원 로그인이 필요합니다.");
  return ctx;
}

export async function resolveSaemAccess(): Promise<SaemAccess | null> {
  const me = await getSession();
  if (!me || me.kind !== "employee" || !me.name.trim()) return null;
  const g = await getGoogleSession();

  const { data: driver } = await supabaseAdmin
    .from("drivers")
    .select("id, rank")
    .eq("name", me.name.trim())
    .maybeSingle();
  const driverId =
    driver && typeof (driver as { id?: unknown }).id === "string"
      ? String((driver as { id: string }).id)
      : null;
  const rank = (driver as { rank?: string | null } | null)?.rank ?? null;

  let authLevel: string | null = null;
  if (driverId) {
    const { data: prof } = await supabaseAdmin
      .from("employee_profiles")
      .select("auth_level")
      .eq("driver_id", driverId)
      .maybeSingle();
    authLevel =
      (prof as { auth_level?: string | null } | null)?.auth_level ?? null;
  }

  const isM0 = isM0Grant({ rank, email: g?.email, authLevel });
  const roles = driverId ? await listRolesForDriver(driverId) : [];
  const canAccess = isM0 || roles.includes("saem");
  if (!canAccess) return null;
  return { name: me.name.trim(), driverId, isM0, canManage: true };
}

export async function requireSaemAccess(opts?: {
  onlyM0?: boolean;
}): Promise<SaemAccess> {
  const ctx = await resolveSaemAccess();
  if (!ctx) {
    throw new Error("강사·프로그램 관리 권한이 없습니다. (관장·부장 또는 강사관리 담당자)");
  }
  if (opts?.onlyM0 && !ctx.isM0) {
    throw new Error("이 작업은 관장·부장만 할 수 있습니다.");
  }
  return ctx;
}
