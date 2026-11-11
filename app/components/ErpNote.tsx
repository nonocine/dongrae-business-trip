import { ERP_NOTE } from "@/lib/erp/duty";

// ERP 복제 데이터 화면 공통 안내 — "ERP에서 가져온 정보…" + 마지막 동기화 시각(작게).
export function fmtErpSyncedAt(iso: string | null): string {
  if (!iso) return "동기화 기록 없음";
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ErpNote({ syncedAt, className = "" }: { syncedAt: string | null; className?: string }) {
  return (
    <p className={`text-[11px] text-ink-hint ${className}`}>
      {ERP_NOTE} · 마지막 동기화 {fmtErpSyncedAt(syncedAt)}
    </p>
  );
}
