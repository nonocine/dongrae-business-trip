// 클릭 가능한 행/카드 우측에 놓는 옅은 → 아이콘. rowLinkCls 의 group hover 에 반응해
// 살짝 진해지고 오른쪽으로 움직여 "눌러서 이동"을 암시한다. 순수 표시용.
export default function RowChevron({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`shrink-0 text-ink-hint transition-transform transition-colors group-hover:translate-x-0.5 group-hover:text-navy ${className}`}
    >
      →
    </span>
  );
}
