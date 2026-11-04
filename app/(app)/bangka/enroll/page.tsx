import { listRecruitments } from "@/app/(app)/bangka/enroll/actions";
import RecruitmentsManager from "@/app/(app)/bangka/enroll/RecruitmentsManager";

export const dynamic = "force-dynamic";

// 모집 회차 목록 + 만들기·고치기. 회차를 누르면 그 회차의 접수 목록.
export default async function BangkaEnrollPage() {
  const rows = await listRecruitments();
  return <RecruitmentsManager rows={rows} />;
}
