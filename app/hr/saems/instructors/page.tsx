import { listInstructors } from "@/app/hr/saems/instructorActions";
import { resolveSaemAccess } from "@/lib/saemAccess";
import InstructorsManager from "@/app/hr/saems/instructors/InstructorsManager";

export const dynamic = "force-dynamic";

export default async function InstructorsPage() {
  const access = await resolveSaemAccess();
  const instructors = await listInstructors();
  return (
    <InstructorsManager instructors={instructors} isM0={access?.isM0 ?? false} />
  );
}
