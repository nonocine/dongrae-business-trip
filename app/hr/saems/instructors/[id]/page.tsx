import Link from "next/link";
import { notFound } from "next/navigation";
import { getInstructorDetail } from "@/app/hr/saems/instructorActions";
import InstructorDetail from "@/app/hr/saems/instructors/[id]/InstructorDetail";

export const dynamic = "force-dynamic";

export default async function InstructorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getInstructorDetail(id);
  if (!detail) notFound();

  return (
    <div className="space-y-4">
      <Link
        href="/hr/saems/instructors"
        className="text-sm text-ink-muted hover:underline"
      >
        ← 강사 목록
      </Link>
      <InstructorDetail
        instructor={detail.instructor}
        programs={detail.programs}
        docs={detail.docs}
      />
    </div>
  );
}
