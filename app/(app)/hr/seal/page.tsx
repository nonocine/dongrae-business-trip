import Link from "next/link";
import { redirect } from "next/navigation";
import { enforcePasswordChange } from "@/app/actions";
import { resolveSealAccess } from "@/lib/orgSeal";
import { getOrgSealPreview } from "@/app/(app)/hr/seal/actions";
import SealManager from "@/app/(app)/hr/seal/SealManager";

export const dynamic = "force-dynamic";

export default async function SealPage() {
  await enforcePasswordChange();

  // 접근: M0(관장·부장·master) 전용 — 기관 인장이라 직무 위임 없음.
  const access = await resolveSealAccess();
  if (!access) redirect("/");

  const preview = await getOrgSealPreview();

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold tracking-wide text-navy">동래구청소년센터</p>
          <h2 className="mt-0.5 text-2xl font-bold tracking-[0.1em] text-ink">기관 직인</h2>
          <p className="mt-1 text-xs text-ink-muted">
            &lsquo;동래구청소년센터장&rsquo; 명의로 나가는 문서에 찍히는 직인입니다 — 재직·경력증명서,
            강의확인증, 근로·연봉계약서(센터장 서명). 관장 개인 도장은 마이페이지 인사기록에서 따로 관리합니다.
          </p>
        </div>
        <Link href="/" className="shrink-0 text-sm text-ink-muted hover:underline">
          ← 목록
        </Link>
      </div>
      <SealManager initialUrl={preview} />
      <p className="mt-3 text-xs text-ink-hint">
        직인 이미지는 비공개 저장소에 보관되며 관장·부장만 이 화면에서 볼 수 있습니다. 공개 링크는 만들어지지 않습니다.
        교체하면 이후 발급·서명부터 새 직인이 쓰이고, 이미 확정된 PDF 는 바뀌지 않습니다.
      </p>
    </div>
  );
}
