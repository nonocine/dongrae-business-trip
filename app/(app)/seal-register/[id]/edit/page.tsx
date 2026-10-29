import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { enforcePasswordChange } from "@/app/actions";
import { getSealRequestDetail, resolveSealRegisterAccess } from "@/lib/sealRegisterServer";
import { recipientValuesFrom } from "@/lib/sealRegister";
import { kstTodayYmd } from "@/lib/trainings";
import SealRequestForm from "@/app/(app)/seal-register/SealRequestForm";

export const dynamic = "force-dynamic";

// 고치기 — 본인 신청이고 작성 중·반려·회수 상태일 때만. 결재 대기 중이면 먼저 회수.
export default async function EditSealRequestPage({ params }: { params: Promise<{ id: string }> }) {
  await enforcePasswordChange();
  const a = await resolveSealRegisterAccess();
  if (!a) redirect("/");
  const { id } = await params;
  const d = await getSealRequestDetail(a, id);
  if (!d || d.requesterDriverId !== a.driverId) notFound();
  if (!["draft", "rejected", "withdrawn"].includes(d.status)) redirect(`/seal-register/${id}`);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <div className="mb-5 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-navy">직인사용대장</p>
          <h2 className="mt-0.5 text-2xl font-bold text-ink">신청 고치기</h2>
        </div>
        <Link href={`/seal-register/${id}`} className="inline-flex min-h-11 shrink-0 items-center text-sm text-ink-muted hover:underline sm:min-h-0">
          ← 신청으로
        </Link>
      </div>
      <SealRequestForm
        today={kstTodayYmd()}
        initial={{
          id: d.id,
          docType: d.docType,
          title: d.title,
          certDate: d.certDate,
          purpose: d.purpose ?? "",
          itemTemplate: d.itemTemplate,
          bodyTemplate: d.bodyTemplate,
          recipients: d.recipients.map((r) => ({ name: r.name, values: recipientValuesFrom(d.itemTemplate, r.items), body: r.body })),
          lastRejectReason: d.lastRejectReason,
        }}
      />
    </div>
  );
}
