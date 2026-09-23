import { redirect } from "next/navigation";

// /hr/mutual 진입 → 기본 탭(장부).
export default function MutualIndexPage() {
  redirect("/hr/mutual/ledger");
}
