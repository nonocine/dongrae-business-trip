import Link from "next/link";
import RowChevron from "@/app/components/RowChevron";
import {
  SEAL_STATUS_LABEL,
  certDateLabel,
  sealDocTypeLabel,
  type SealRequestSummary,
  type SealStatus,
} from "@/lib/sealRegister";
import { badgeDanger, badgeNeutral, badgeSuccess, badgeWarning, rowLinkCls } from "@/lib/ui";

// 직인사용대장 화면 공용 부품(서버·클라이언트 어디서나 — 훅 없음).

const STATUS_CLS: Record<SealStatus, string> = {
  draft: badgeNeutral,
  pending: badgeWarning,
  rejected: badgeDanger,
  withdrawn: badgeNeutral,
  issued: badgeSuccess,
};

export function SealStatusBadge({ status }: { status: SealStatus }) {
  return <span className={`${STATUS_CLS[status]} shrink-0 text-xs`}>{SEAL_STATUS_LABEL[status]}</span>;
}

// 폰에서 손가락으로 누르기 좋게(44px) — PC 는 원래 높이
export const tap = "min-h-11 sm:min-h-0";

export function SealRequestList({
  items,
  showRequester,
  empty,
}: {
  items: SealRequestSummary[];
  showRequester?: boolean;
  empty: string;
}) {
  if (!items.length) return <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-rule overflow-hidden rounded-lg border border-rule bg-card">
      {items.map((r) => (
        <li key={r.id}>
          <Link href={`/seal-register/${r.id}`} className={`${rowLinkCls} flex min-h-11 items-center gap-3 px-4 py-3`}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <SealStatusBadge status={r.status} />
                <span className="min-w-0 break-keep font-semibold text-ink">{r.title || sealDocTypeLabel(r.docType)}</span>
                <span className="text-xs text-ink-muted">{sealDocTypeLabel(r.docType)}</span>
              </div>
              <p className="mt-1 break-keep text-sm text-ink-body">
                {r.firstName ? (
                  <>
                    <span className="break-all">{r.firstName}</span>
                    {r.recipientCount > 1 ? ` 외 ${r.recipientCount - 1}명` : ""}
                  </>
                ) : (
                  "대상자 없음"
                )}
                {" · "}증서 날짜 {certDateLabel(r.certDate)}
              </p>
              <p className="mt-0.5 break-keep text-xs text-ink-muted">
                {showRequester && <>신청 {r.requesterName} · </>}
                {r.issueRange ?? `작성 ${r.createdAt.slice(0, 10)}`}
              </p>
            </div>
            <RowChevron />
          </Link>
        </li>
      ))}
    </ul>
  );
}
