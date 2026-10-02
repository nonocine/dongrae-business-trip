import Link from "next/link";

// =====================================================================
// 면접 채점 화면의 "나가는 길" — 공개 경로(app/recruitment)라 사이드바·헤더
//   네비가 없어서, 폰으로 채점하던 직원이 갇혔습니다(뒤로가기 외 방법 없음).
//
//   * 내부 직원(직원 세션 있음) → 실제 이동 버튼(홈 / 채용 관리).
//   * 외부 심사위원(외부위원 쿠키만) → 내부 화면 링크를 절대 노출하지 않고
//     "창을 닫으셔도 됩니다" 안내만. 어느 쪽인지는 서버(page.tsx)가 세션으로
//     판정해 내려 줍니다 — 클라이언트에 내부 경로가 실리지 않습니다.
//   * 이동 수단만 추가합니다. 채점·저장·인증 로직과 무관합니다.
// =====================================================================

export type JudgeExitLink = { href: string; label: string; primary?: boolean };
export type JudgeExit =
  | { kind: "internal"; links: JudgeExitLink[] }
  | { kind: "external" };

// 폰에서도 엄지로 누를 수 있게 최소 44px 높이.
const btnBase =
  "inline-flex min-h-[44px] items-center justify-center gap-1 rounded-lg px-4 text-sm font-semibold shadow-sm transition active:scale-[0.98]";
const btnPrimary = `${btnBase} bg-navy text-white hover:bg-navy-strong`;
const btnSecondary = `${btnBase} border border-line bg-card text-ink-body hover:bg-surface`;

// 상단 — 헤더 옆/위에 항상 보이는 버튼.
export function JudgeExitTop({ exit }: { exit: JudgeExit }) {
  if (exit.kind === "external") return null;
  return (
    <nav aria-label="채점 화면 나가기" className="flex flex-wrap gap-2">
      {exit.links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={l.primary ? btnPrimary : btnSecondary}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

// 채점 완료 영역 — 전체 채점이 끝났을 때 목록 아래에 표시.
export function JudgeExitDone({ exit }: { exit: JudgeExit }) {
  return (
    <div className="mt-6 rounded-xl border-2 border-success bg-success-soft p-4 text-center sm:p-5">
      <p className="text-base font-bold text-success md:text-lg">
        채점이 완료되었습니다.
      </p>
      {exit.kind === "external" ? (
        <p className="mt-1 text-sm text-ink-body md:text-base">
          수고하셨습니다. 이 창을 닫으셔도 됩니다.
          <span className="mt-0.5 block text-xs text-ink-muted md:text-sm">
            채점은 저장되어 있으며, 다시 열면 점수를 수정할 수 있습니다.
          </span>
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-ink-body md:text-base">
            점수는 저장되었습니다. 아래 버튼으로 돌아가세요.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-center">
            {exit.links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={l.primary ? btnPrimary : btnSecondary}
              >
                {l.label}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
