// =====================================================================
// (app) 껍데기가 쓰는 공용 서버 데이터 — 메뉴 권한 + 배지 숫자.
//
//   왜 따로 두는가:
//     같은 값을 레이아웃(좌측 사이드바)과 대시보드(카드) 두 곳이 씁니다.
//     각자 계산하면 한 요청에 DB 를 두 번 훑고, 나중에 한쪽만 고쳐 숫자가
//     어긋납니다. React 의 cache() 로 감싸 '요청 하나당 한 번' 만 돕니다.
//     레이아웃은 페이지에 props 를 내려줄 수 없으므로(App Router), 양쪽이
//     같은 캐시된 함수를 부르는 것이 유일하게 깨끗한 방법입니다.
//
//   ★ 메뉴 '정의'(라벨·경로·아이콘·권한조건)는 여기 없습니다 — lib/menu.ts 가
//     단일 출처입니다. 여기는 '데이터'(누구인가 · 숫자 몇 건)만 담습니다.
//
//   서버 전용 모듈("use server" 아님) — 레이아웃·서버 컴포넌트가 import 합니다.
// =====================================================================

import { cache } from "react";
import { getGoogleSession, isManagerAdmin } from "@/app/actions";
import { getMyProfile, getMyEmployeeRoles } from "@/app/(app)/profile/hr/actions";
import { getUnreadMailCount } from "@/app/(app)/mail/actions";
import { getTrainingsAdminSummary } from "@/app/(app)/hr/trainings/actions";
import { getPendingCertRequestCount } from "@/app/(app)/hr/certificates/actions";
import { isM0Grant } from "@/lib/authLevels";
import type { MenuContext } from "@/lib/menu";

export type ShellData = {
  ctx: MenuContext;
  // 경로별 배지 숫자. undefined = "아직 못 셌다"(0건과 다릅니다 — 의무교육
  //   문구가 둘을 다르게 씁니다).
  badges: Record<string, number | undefined>;
  // 대시보드가 이어서 쓰는 값들(다시 조회하지 않게 함께 돌려줍니다).
  rank: string | null;
  authLevel: string | null;
};

export const getShellData = cache(async (): Promise<ShellData> => {
  const [my, roles, g, managerAdmin] = await Promise.all([
    getMyProfile(),
    getMyEmployeeRoles(),
    getGoogleSession(),
    // /admin 진입 기준 — isM0 보다 좁습니다(구글 세션 + master/관장).
    //   사이드바의 '관리자 대시보드' 를 가드와 같은 조건으로 걸기 위해 함께 봅니다.
    isManagerAdmin(),
  ]);

  const rank = my?.driver?.rank ?? null;
  const authLevel = my?.profile?.auth_level ?? null;
  const isM0 = isM0Grant({ rank, email: g?.email, authLevel });

  // 증명서 승인 대기는 M0 배지라 M0 일 때만 셉니다(기존 대시보드와 동일).
  const [unreadMailCount, trainingAdminSummary, pendingCertCount] =
    await Promise.all([
      getUnreadMailCount(),
      getTrainingsAdminSummary(),
      isM0 ? getPendingCertRequestCount() : Promise.resolve(0),
    ]);

  return {
    ctx: { isM0, roles, isManagerAdmin: managerAdmin },
    badges: {
      "/mail": unreadMailCount,
      "/hr/trainings": trainingAdminSummary?.totalNotMet,
      "/hr/certificates": pendingCertCount,
    },
    rank,
    authLevel,
  };
});
