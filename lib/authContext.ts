import type { GoogleSession } from "@/lib/googleAuth";
import { isM0Grant } from "@/lib/authLevels";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// =====================================================================
// 현재 세션의 권한 컨텍스트 — M0 판정·작성자 식별에 사용.
//   * 구글 세션: email·rank·driverId. 비번 세션: name 으로 drivers 조회.
//   * 세션은 호출하는 쪽(app/actions 의 getGoogleSession·getSession)에서 읽어 넘깁니다.
//     이 모듈이 app/actions 를 import 하면 app/actions ↔ 공지 actions 가 서로 물려
//     순환이 생기므로, 세션 읽기는 밖에 두고 DB 조회·판정만 여기서 합니다.
// =====================================================================
export type AuthContext = {
  rank: string | null;
  email: string | null;
  authLevel: string | null;
  driverId: string | null;
  name: string;
};

async function readAuthLevel(driverId: string | null): Promise<string | null> {
  if (!driverId) return null;
  const { data } = await supabaseAdmin
    .from("employee_profiles")
    .select("auth_level")
    .eq("driver_id", driverId)
    .maybeSingle();
  return (
    ((data as { auth_level?: unknown } | null)?.auth_level as string | null) ??
    null
  );
}

export async function resolveAuthContext(
  google: GoogleSession | null,
  session: { name: string } | null
): Promise<AuthContext | null> {
  if (google) {
    const driverId = google.driverId ?? null;
    return {
      rank: google.rank ?? null,
      email: google.email,
      authLevel: await readAuthLevel(driverId),
      driverId,
      name: google.driverName ?? google.name,
    };
  }

  if (session) {
    const { data: drv } = await supabaseAdmin
      .from("drivers")
      .select("id, rank")
      .eq("name", session.name)
      .maybeSingle();
    const driverId =
      ((drv as { id?: unknown } | null)?.id as string | null) ?? null;
    const rank =
      ((drv as { rank?: unknown } | null)?.rank as string | null) ?? null;
    return {
      rank,
      email: null,
      authLevel: await readAuthLevel(driverId),
      driverId,
      name: session.name,
    };
  }

  // SEC-3b: 공유비번 admin 분기 제거. 구글 관장·master 는 위 구글 세션 경로에서
  //   rank/authLevel 로 M0 판정되므로 별도 분기가 필요 없습니다.
  return null;
}

// M0(관장·부장·master·auth_level M0) 여부.
export function ctxIsM0(ctx: AuthContext | null): boolean {
  if (!ctx) return false;
  return isM0Grant({
    rank: ctx.rank,
    email: ctx.email,
    authLevel: ctx.authLevel,
  });
}
