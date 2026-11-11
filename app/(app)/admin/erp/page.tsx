import Link from "next/link";
import { redirect } from "next/navigation";
import { isManagerAdmin } from "@/app/actions";
import { getErpStatus } from "@/app/(app)/admin/erp/actions";
import ErpStatusBoard from "@/app/(app)/admin/erp/ErpStatusBoard";

export const dynamic = "force-dynamic";
// [지금 동기화] 서버 액션이 이 페이지 설정을 따릅니다 — 9개 API 를 다 받는 데 수십 초 걸릴 수 있습니다.
export const maxDuration = 300;

export default async function ErpAdminPage() {
  // 관장·master 만(관리자 대시보드와 같은 기준).
  if (!(await isManagerAdmin())) redirect("/");
  const data = await getErpStatus();
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-ink">ERP 동기화</h2>
        <Link href="/admin" className="text-sm text-ink-muted hover:underline">
          ← 관리자 대시보드
        </Link>
      </div>
      <ErpStatusBoard data={data} />
    </div>
  );
}
