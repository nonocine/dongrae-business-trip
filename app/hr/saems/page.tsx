import { redirect } from "next/navigation";

// /hr/saems → 강사 관리 탭으로.
export default function SaemsIndex() {
  redirect("/hr/saems/instructors");
}
