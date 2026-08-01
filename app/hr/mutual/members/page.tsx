import { getMemberOverview } from "@/app/hr/mutual/memberActions";
import MembersManager from "@/app/hr/mutual/members/MembersManager";

export const dynamic = "force-dynamic";

export default async function MutualMembersPage() {
  const overview = await getMemberOverview();
  return <MembersManager initial={overview} />;
}
