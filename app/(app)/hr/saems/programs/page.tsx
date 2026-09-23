import {
  listProjects,
  listInstructorOptions,
} from "@/app/(app)/hr/saems/programActions";
import { resolveSaemView } from "@/lib/saemAccess";
import ProgramsManager from "@/app/(app)/hr/saems/programs/ProgramsManager";

export const dynamic = "force-dynamic";

export default async function ProgramsPage() {
  const [projects, instructors, view] = await Promise.all([
    listProjects(),
    listInstructorOptions(),
    resolveSaemView(),
  ]);
  return (
    <ProgramsManager
      projects={projects}
      instructors={instructors}
      canManage={view?.canManage ?? false}
    />
  );
}
