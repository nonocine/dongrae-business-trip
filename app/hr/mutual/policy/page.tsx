import { getMutualPolicy } from "@/app/hr/mutual/policyActions";
import PolicyView from "@/app/hr/mutual/policy/PolicyView";

export const dynamic = "force-dynamic";

export default async function MutualPolicyPage() {
  const policy = await getMutualPolicy();
  return <PolicyView initial={policy} />;
}
