import { cardCls } from "@/lib/ui";

export const dynamic = "force-dynamic";

// 장부 탭 — 세입/세출 2단 표·월 회비 기입·지출 추가는 MU-2 에서 채운다.
export default function MutualLedgerPage() {
  return (
    <section className={cardCls}>
      <h3 className="text-sm font-bold text-ink">장부</h3>
      <p className="mt-1 text-xs text-ink-muted">
        연도별 세입·세출 표와 회비 자동 기입은 MU-2 에서 붙습니다. 먼저 [회원]
        탭에서 회원을 등록하세요.
      </p>
    </section>
  );
}
