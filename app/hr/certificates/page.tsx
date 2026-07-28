import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/app/components/Header";
import { enforcePasswordChange } from "@/app/actions";
import { resolveCertificateAccess } from "@/lib/certificateAccess";
import {
  listCertificates,
  listCertificateEmployees,
  listPendingRequests,
} from "@/app/hr/certificates/actions";
import CertificateLedger from "@/app/hr/certificates/CertificateLedger";

export const dynamic = "force-dynamic";

export default async function CertificatesPage() {
  await enforcePasswordChange();

  // 접근: M0(관장·부장) 또는 hr(인사) 직무만.
  const access = await resolveCertificateAccess();
  if (!access) redirect("/");

  const [issues, employees, pending] = await Promise.all([
    listCertificates(),
    listCertificateEmployees(),
    listPendingRequests(),
  ]);

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <div className="mb-5 flex items-end justify-between">
          <div>
            <p className="text-xs font-semibold tracking-wide text-navy">
              동래구청소년센터
            </p>
            <h2 className="mt-0.5 text-2xl font-bold tracking-[0.1em] text-ink">
              증명서 발급대장
            </h2>
            <p className="mt-1 text-xs text-ink-muted">
              재직·경력증명서 발급 기록입니다. 경력증명서는 퇴사자 포함 발급할 수
              있고, 모든 발급 PDF는 저장된 내용으로 다시 받을 수 있습니다.
            </p>
          </div>
          <Link href="/" className="text-sm text-ink-muted hover:underline">
            ← 목록
          </Link>
        </div>

        <CertificateLedger
          issues={issues}
          employees={employees}
          pending={pending}
          isM0={access.isM0}
        />
      </main>
    </>
  );
}
