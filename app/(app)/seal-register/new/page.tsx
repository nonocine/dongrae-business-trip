import Link from "next/link";
import { redirect } from "next/navigation";
import { enforcePasswordChange } from "@/app/actions";
import { resolveSealRegisterAccess } from "@/lib/sealRegisterServer";
import { kstTodayYmd } from "@/lib/trainings";
import { normalizeDocType } from "@/lib/sealRegister";
import SealRequestForm from "@/app/(app)/seal-register/SealRequestForm";

export const dynamic = "force-dynamic";

export default async function NewSealRequestPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  await enforcePasswordChange();
  const a = await resolveSealRegisterAccess();
  if (!a) redirect("/");
  const { type } = await searchParams;
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <div className="mb-5 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-navy">직인사용대장</p>
          <h2 className="mt-0.5 text-2xl font-bold text-ink">새 신청</h2>
        </div>
        <Link href="/seal-register" className="inline-flex min-h-11 shrink-0 items-center text-sm text-ink-muted hover:underline sm:min-h-0">
          ← 목록
        </Link>
      </div>
      <SealRequestForm today={kstTodayYmd()} initialType={normalizeDocType(type)} />
    </div>
  );
}
