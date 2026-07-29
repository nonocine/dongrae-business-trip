import {
  listProjects,
  listInstructorOptions,
} from "@/app/hr/saems/programActions";
import ProgramsManager from "@/app/hr/saems/programs/ProgramsManager";

export const dynamic = "force-dynamic";

export default async function ProgramsPage() {
  const [projects, instructors] = await Promise.all([
    listProjects(),
    listInstructorOptions(),
  ]);
  return <ProgramsManager projects={projects} instructors={instructors} />;
}
