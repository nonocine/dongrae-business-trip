import { listInstructors } from "@/app/hr/saems/instructorActions";
import InstructorsManager from "@/app/hr/saems/instructors/InstructorsManager";

export const dynamic = "force-dynamic";

export default async function InstructorsPage() {
  const instructors = await listInstructors();
  return <InstructorsManager instructors={instructors} />;
}
