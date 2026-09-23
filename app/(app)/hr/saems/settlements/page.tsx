import { redirect } from "next/navigation";
import {
  listSettlements,
  listSettlementProjects,
} from "@/app/(app)/hr/saems/settlementActions";
import { resolveSaemAccess } from "@/lib/saemAccess";
import SettlementsManager from "@/app/(app)/hr/saems/settlements/SettlementsManager";

export const dynamic = "force-dynamic";

// 정산은 강사 보수 금액을 다룬다 — 탭이 전 직원에게 열린 뒤에도 기존 권한
//   (M0 또는 saem 직무)을 유지한다. 탭 자체가 안 보이므로 여기 오는 건
//   주소를 직접 친 경우다. 오류 화면 대신 강사 목록으로 돌려보낸다.
export default async function SettlementsPage() {
  if (!(await resolveSaemAccess())) redirect("/hr/saems/instructors");
  const [rows, projects] = await Promise.all([

    listSettlements(),
    listSettlementProjects(),
  ]);
  return <SettlementsManager rows={rows} projects={projects} />;
}
