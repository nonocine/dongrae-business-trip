// =====================================================================
// 인사 파일 열람 판정 — 서버 전용("use server" 아님). 규칙은 lib/personnel.ts.
//   * canViewPersonnelFileOf(viewer, targetDriverId) — 인사 파일 하나를 볼 수 있는가:
//     personnel 보유(관장·부장·master 자동 포함)이거나 본인일 때만 true.
//   * 전 직원 목록·남의 파일을 고치는 관리 동작은 requirePersonnel()(보유자만).
//     본인 것은 마이페이지(app/(app)/profile/**) 의 본인 전용 액션이 따로 있습니다 —
//     관리 화면 액션에 '본인' 예외를 두면 잠금·인사발령 같은 관리자 전용 편집이
//     본인에게 열리므로 관리 동작에는 쓰지 않습니다.
//   * 세션 → drivers 는 DB 에서 다시 읽습니다(구글 쿠키의 rank 는 로그인 시점 값).
// =====================================================================

import { getSession, getGoogleSession } from "@/app/actions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { listRolesForDriver } from "@/lib/employeeRolesServer";
import { canGrantPersonnel, isPersonnelHolder } from "@/lib/personnel";

export type PersonnelViewer = {
  driverId: string | null;
  name: string;
  rank: string | null;
  isMaster: boolean;
  roles: string[];
  isPersonnel: boolean; // 다른 직원 인사 파일 열람·관리
  canGrantPersonnel: boolean; // personnel 부여·회수(관장·master)
};

// 로그인한 직원(또는 master) — 없거나 퇴사자면 null.
export async function resolvePersonnelViewer(): Promise<PersonnelViewer | null> {
  const s = await getSession();
  if (!s || s.kind !== "employee" || !s.name.trim()) return null;
  const g = await getGoogleSession();
  const isMaster = !!g?.isMaster;

  const base = supabaseAdmin.from("drivers").select("id, name, rank, is_active");
  const { data } = await (g?.driverId ? base.eq("id", g.driverId) : base.eq("name", s.name.trim())).maybeSingle();
  const d = data as { id?: unknown; name?: unknown; rank?: unknown; is_active?: unknown } | null;
  const driverId = d && typeof d.id === "string" && d.id ? d.id : null;
  if (!driverId && !isMaster) return null;
  if (d?.is_active === false && !isMaster) return null;

  const rank = typeof d?.rank === "string" ? d.rank : null;
  const roles = driverId ? await listRolesForDriver(driverId) : [];
  return {
    driverId,
    name: typeof d?.name === "string" && d.name ? d.name : s.name.trim(),
    rank,
    isMaster,
    roles,
    isPersonnel: isPersonnelHolder({ rank, isMaster, roles }),
    canGrantPersonnel: canGrantPersonnel({ rank, isMaster }),
  };
}

export function canViewPersonnelFileOf(
  viewer: PersonnelViewer | null,
  targetDriverId: string | null | undefined
): boolean {
  if (!viewer) return false;
  if (viewer.isPersonnel) return true;
  return !!viewer.driverId && !!targetDriverId && viewer.driverId === targetDriverId;
}

export const PERSONNEL_DENIED =
  "다른 직원의 인사 파일은 관장·부장과 관장이 지정한 사람만 볼 수 있습니다.";

// 화면 분기용 — 보유 여부만(throw 없음).
export async function hasPersonnelAccess(): Promise<boolean> {
  return !!(await resolvePersonnelViewer())?.isPersonnel;
}

// 관리 동작(전 직원 목록·남의 파일 열람·수정) — 보유자만, 아니면 throw.
export async function requirePersonnel(): Promise<PersonnelViewer> {
  const v = await resolvePersonnelViewer();
  if (!v?.isPersonnel) throw new Error(PERSONNEL_DENIED);
  return v;
}

// 인사 파일 하나 열람 — 보유자 또는 본인, 아니면 throw.
export async function requirePersonnelFileOf(targetDriverId: string | null | undefined): Promise<PersonnelViewer> {
  const v = await resolvePersonnelViewer();
  if (!canViewPersonnelFileOf(v, targetDriverId)) throw new Error(PERSONNEL_DENIED);
  return v as PersonnelViewer;
}
