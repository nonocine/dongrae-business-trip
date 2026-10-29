import Link from "next/link";
import { redirect } from "next/navigation";
import { enforcePasswordChange } from "@/app/actions";
import { getSealCounter, resolveSealRegisterAccess } from "@/lib/sealRegisterServer";
import { sealIssueLabel } from "@/lib/sealRegister";
import { kstTodayYmd } from "@/lib/trainings";
import { noticeWarning, panelToneCls, sectionTitleCls } from "@/lib/ui";
import StartNoForm from "@/app/(app)/seal-register/settings/StartNoForm";

export const dynamic = "force-dynamic";

// 발급번호 설정 — 관장만(drivers.rank). 올해·내년 시작 번호를 한 번 넣음(종이 발급분 이어받기).
export default async function SealSettingsPage() {
  await enforcePasswordChange();
  const a = await resolveSealRegisterAccess();
  if (!a) redirect("/");
  if (!a.isBoss) redirect("/seal-register");

  const thisYear = Number(kstTodayYmd().slice(0, 4));
  const counters = await Promise.all([getSealCounter(thisYear), getSealCounter(thisYear + 1)]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-navy">직인사용대장</p>
          <h2 className="mt-0.5 text-2xl font-bold text-ink">발급번호 설정</h2>
          <p className="mt-1 break-keep text-xs text-ink-muted">
            올해 종이로 낸 증서 번호를 이어받으려면 다음 번호를 넣으세요. 예) 종이로 제{thisYear}-14호까지 냈으면 15. 그해 첫 발급 뒤에는 바꿀 수 없습니다.
          </p>
        </div>
        <Link href="/seal-register" className="inline-flex min-h-11 shrink-0 items-center text-sm text-ink-muted hover:underline sm:min-h-0">
          ← 목록
        </Link>
      </div>

      {counters.map((c) => {
        const locked = c.issuedCount > 0;
        return (
          <section key={c.year} className={`${panelToneCls(locked ? "yellow" : "blue")} space-y-3`}>
            <h3 className={sectionTitleCls(locked ? "yellow" : "blue")}>{c.year}년</h3>
            <p className="break-keep text-sm text-ink">
              다음에 붙을 번호: <b>{sealIssueLabel(c.year, c.nextSeq)}</b>
              {c.startSeq ? ` · 시작 번호 ${c.startSeq}(${c.startSetBy ?? ""} 입력)` : " · 시작 번호 미입력(1부터)"}
            </p>
            {locked && (
              <p className={noticeWarning}>
                {c.year}년에는 이미 {c.issuedCount}건을 발급해서 시작 번호를 바꿀 수 없습니다(번호가 꼬이지 않게 잠금).
              </p>
            )}
            <StartNoForm year={c.year} nextSeq={c.nextSeq} locked={locked} />
          </section>
        );
      })}
    </div>
  );
}
