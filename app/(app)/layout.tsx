import { Suspense } from "react";
import Header from "@/app/components/Header";
import { getSession } from "@/app/actions";
import { getShellData } from "@/app/(app)/shellData";
import Sidebar from "@/app/(app)/Sidebar";
import { buildMenuTree } from "@/lib/menuTree";

// =====================================================================
// 로그인 후 화면의 공통 껍데기 — 헤더 + 본문 영역.
//
//   왜 라우트 그룹인가:
//     예전에는 27개 페이지가 각자 <Header/> 를 렌더했습니다. 좌측 사이드바를
//     붙이려면 껍데기가 한 곳에 있어야 하는데, 27곳에 흩어져 있으면 한 곳만
//     고쳐도 조용히 어긋납니다. (app) 그룹으로 묶어 여기서만 그립니다.
//     그룹 이름의 괄호는 URL 에 나타나지 않습니다 — 경로는 그대로입니다.
//
//   ★ 공개 페이지는 이 그룹에 넣지 않습니다.
//     app/recruitment/* (채용 공고·지원·면접·심사위원 로그인)는 로그인 없이
//     보는 화면이라 헤더·사이드바가 붙으면 안 됩니다. app/ 바로 아래에 그대로
//     두었습니다.
//
//   ★ 비로그인일 때는 껍데기를 씌우지 않습니다.
//     이 그룹에는 '/'(app/(app)/page.tsx)도 들어 있는데, 그 페이지는 로그인
//     전에는 헤더 없는 전면 랜딩을 그립니다. 레이아웃이 무조건 헤더를 붙이면
//     랜딩 위에 헤더가 얹혀 화면이 달라집니다. 그래서 세션이 없으면 children
//     만 그대로 통과시킵니다.
//     나머지 페이지들은 각자 미로그인 시 "/" 로 redirect 하므로, 이 분기로
//     새로 열리는 화면은 없습니다.
//
//   ★ 본문 폭은 여기서 강제하지 않습니다.
//     페이지마다 max-w-2xl ~ max-w-6xl, max-w-md 가 섞여 있어 레이아웃이
//     한 값으로 고정하면 화면이 바뀝니다. 여기서는 세로로 늘어나는 <main>
//     껍데기만 주고, 폭·여백은 각 페이지가 안쪽 컨테이너로 정합니다.
//
//   ★ 좌측 사이드바(4단계)
//     · 항목은 lib/menu.ts 에서만 옵니다. 여기서 메뉴를 다시 적지 않습니다.
//     · 권한 필터도 menu.ts 의 조건(canSeeMenuItem)을 그대로 씁니다 —
//       사이드바에 보이는 항목은 반드시 실제로 들어가지는 항목입니다.
//     · md(768px) 미만에서는 사이드바가 숨고 폰 배치가 됩니다. 기기 판별이
//       아니라 CSS 미디어쿼리라, PC 에서 창을 좁혀도 같습니다.
//     · 배지 숫자는 대시보드와 같은 계산(getShellData)을 씁니다. 한 요청에
//       한 번만 돌아 두 곳의 숫자가 어긋나지 않습니다.
// =====================================================================

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  // 비로그인 — 껍데기 없이(랜딩이 자기 <main> 을 직접 그립니다).
  //   사이드바도 당연히 붙지 않습니다.
  if (!session) return <>{children}</>;

  const { ctx, badges } = await getShellData();
  // 사이드바와 폰 드로어(Header 안)가 같은 트리를 씁니다 — 권한별로 보이는
  //   항목이 PC 와 폰에서 어긋날 수 없습니다.
  const tree = buildMenuTree(ctx, badges);

  return (
    <>
      <Header />
      <div className="flex w-full flex-1">
        {/* useSearchParams 를 쓰는 클라이언트 컴포넌트라 경계가 필요합니다. */}
        <Suspense fallback={<div className="hidden w-60 shrink-0 border-r border-line bg-card md:block" />}>
          <Sidebar tree={tree} />
        </Suspense>
        {/* min-w-0 필수 — 안 주면 넓은 표가 있는 페이지에서 본문이 사이드바를
            밀어냅니다(flex 항목의 기본 min-width:auto). */}
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </>
  );
}
