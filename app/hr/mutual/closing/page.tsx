import { cardCls } from "@/lib/ui";

export const dynamic = "force-dynamic";

// 연마감 탭 — 엑셀 출력·과거 장부 이관(MU-4)에서 채운다.
export default function MutualClosingPage() {
  return (
    <section className={cardCls}>
      <h3 className="text-sm font-bold text-ink">연마감</h3>
      <p className="mt-1 text-xs text-ink-muted">
        연도 엑셀 다운로드와 과거 장부 이관은 MU-4 에서 붙습니다.
      </p>
    </section>
  );
}
