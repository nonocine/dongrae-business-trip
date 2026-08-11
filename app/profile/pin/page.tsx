import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/app/components/Header";
import { enforcePasswordChange, getSession } from "@/app/actions";
import { getPinStatus } from "@/app/auth/pinActions";
import PinManageForm from "@/app/profile/pin/PinManageForm";
import { cardCls, noticeWarning } from "@/lib/ui";

export const dynamic = "force-dynamic";

// PIN 간편입력 설정 화면 — 로그인 필수. 선택 기능이므로 진입도 자유롭습니다.
export default async function PinSettingsPage() {
  await enforcePasswordChange();
  const session = await getSession();
  if (!session) redirect("/");

  const status = await getPinStatus();

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-6 sm:py-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold tracking-tight text-ink">
            간편 PIN
          </h2>
          <Link href="/" className="text-sm text-ink-muted hover:underline">
            ← 메인
          </Link>
        </div>

        <section className={`mb-4 ${cardCls}`}>
          <p className="text-sm text-ink-body">
            PIN 을 설정하면 <b>이 기기</b>에서 구글 로그인 없이 숫자 6자리로
            바로 들어올 수 있습니다.
          </p>
          <ul className="mt-3 space-y-1.5 text-xs text-ink-muted">
            <li>· 선택 기능입니다. 설정하지 않아도 구글 로그인은 그대로 됩니다.</li>
            <li>· 구글 로그인을 한 기기에서만 PIN 입력이 나타납니다.</li>
            <li>· 로그아웃하면 그 기기의 등록이 풀립니다(PIN 자체는 유지).</li>
            <li>· 5회 틀리면 잠기고, 구글 로그인으로 들어오면 풀립니다.</li>
          </ul>
          <p className="mt-3 text-xs font-medium text-ink-body">
            현재 상태:{" "}
            {!status.eligible
              ? "사용 불가"
              : status.isSet
                ? status.locked
                  ? "설정됨 (잠김)"
                  : "설정됨"
                : "설정 안 됨"}
          </p>
        </section>

        {status.eligible ? (
          <PinManageForm isSet={status.isSet} />
        ) : (
          <section className={cardCls}>
            <p className={noticeWarning}>
              {status.reason ?? "이 계정은 PIN 을 사용할 수 없습니다."}
            </p>
          </section>
        )}
      </main>
    </>
  );
}
