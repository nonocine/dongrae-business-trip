import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/app/components/Header";
import { enforcePasswordChange } from "@/app/actions";
import { resolveCredentialAccess } from "@/lib/credentialAccess";
import { isCredentialKeyConfigured } from "@/lib/credentialCrypto";
import { listCredentials } from "@/app/hr/credentials/actions";
import CredentialsManager from "@/app/hr/credentials/CredentialsManager";

export const dynamic = "force-dynamic";

// 공용 비밀번호 관리 — 앱·메일·구매사이트·은행 계정을 한곳에 모읍니다.
//   * 접근: 로그인한 직원이면 페이지에 들어올 수 있고, 목록은 서버에서 걸러
//     "본인이 열람 가능한 항목"만 내려갑니다(지정 안 된 항목은 존재도 숨김).
//   * 등록은 로그인 직원 누구나(등록자는 자동으로 그 항목의 열람자가 됩니다).
//     수정은 M0 또는 등록자 본인, 삭제·열람자 지정은 M0 만 — 각 액션이 다시
//     확인합니다(2026-08-21 관장 결정).
//   * 비밀번호 평문은 이 페이지 응답에 담기지 않습니다. [보기] 를 눌러야 그 한
//     건만 서버에서 복호화해 옵니다.
export default async function CredentialsPage() {
  await enforcePasswordChange();

  const access = await resolveCredentialAccess();
  if (!access) redirect("/");

  const rows = await listCredentials();

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-wide text-navy">
              동래구청소년센터
            </p>
            <h2 className="mt-0.5 text-2xl font-bold tracking-[0.1em] text-ink">
              비밀번호 관리
            </h2>
            <p className="mt-1 text-xs text-ink-muted">
              비밀번호는 암호화해 보관하며, 항목마다 지정된 직원만 열람할 수
              있습니다.
              {access.isM0
                ? " 삭제·열람자 지정은 관장·부장만 가능합니다."
                : " 내가 등록한 항목은 내가 수정할 수 있습니다."}
            </p>
          </div>
          <Link
            href="/"
            className="shrink-0 text-sm text-ink-muted hover:underline"
          >
            ← 홈
          </Link>
        </div>

        <CredentialsManager
          initial={rows}
          canManage={access.isM0}
          // 등록 = 로그인 직원 누구나. 비M0 는 명부 연결(driver_id)이 있어야
          //   본인이 열람자로 들어갈 수 있어 그때만 등록을 엽니다.
          canCreate={access.isM0 || !!access.driverId}
          keyConfigured={isCredentialKeyConfigured()}
        />
      </main>
    </>
  );
}
