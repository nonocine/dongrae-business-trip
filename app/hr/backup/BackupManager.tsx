"use client";

import { useState, useTransition } from "react";
import Button from "@/app/components/Button";
import { fmtKstDateTime } from "@/lib/datetime";
import {
  cardCls,
  badgeSuccess,
  badgeDanger,
  badgeWarning,
  noticeError,
  noticeSuccess,
} from "@/lib/ui";
import { fetchBackupState, startBackupNow } from "@/app/hr/backup/actions";
// 타입만 가져옵니다 — backupEngine 은 service_role 을 쓰는 서버 전용 모듈이라
// 런타임 import 가 되면 안 됩니다. import type 은 컴파일 시 완전히 지워집니다.
import type { BackupLog } from "@/lib/backupEngine";

// 클라이언트 전용 표기 헬퍼 — 서버 모듈을 끌어오지 않도록 여기서 정의합니다.
function fmtSize(n: number | null): string {
  if (n == null) return "-";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

// 소요시간 — 완료 전이면 "-".
function fmtElapsed(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return "-";
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "-";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}초`;
  return `${Math.floor(sec / 60)}분 ${sec % 60}초`;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "success") return <span className={badgeSuccess}>성공</span>;
  if (status === "failed") return <span className={badgeDanger}>실패</span>;
  return <span className={badgeWarning}>진행 중</span>;
}

export default function BackupManager({
  initialLogs,
  initialRunning,
  tableCount,
}: {
  initialLogs: BackupLog[];
  initialRunning: boolean;
  tableCount: number;
}) {
  const [logs, setLogs] = useState<BackupLog[]>(initialLogs);
  const [running, setRunning] = useState(initialRunning);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onRun = () => {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      try {
        const res = await startBackupNow();
        if (res.ok) setSuccess(res.message);
        else setError(res.message);
        const next = await fetchBackupState();
        setLogs(next.logs);
        setRunning(next.running);
      } catch (e) {
        setError(e instanceof Error ? e.message : "백업 실행에 실패했습니다.");
      }
    });
  };

  return (
    <div className="space-y-5">
      <section className={cardCls}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">수동 백업</h3>
            <p className="mt-1 text-xs text-ink-muted">
              대상 {tableCount}개 테이블 · 완료까지 최대 몇 분이 걸릴 수 있습니다.
              결과는 슬랙(관리자)으로도 전송됩니다.
            </p>
          </div>
          <Button onClick={onRun} loading={pending} disabled={running}>
            {running ? "백업 진행 중…" : "지금 백업 실행"}
          </Button>
        </div>
        {running && !pending && (
          <p className="mt-3 text-xs text-ink-hint">
            이미 진행 중인 백업이 있어 새로 시작할 수 없습니다.
          </p>
        )}
        {/* 실패 메시지에는 진단 힌트가 줄바꿈으로 붙습니다 — pre-line 으로 보존. */}
        {error && (
          <p className={`mt-3 whitespace-pre-line ${noticeError}`}>{error}</p>
        )}
        {success && <p className={`mt-3 ${noticeSuccess}`}>{success}</p>}
      </section>

      <section className={cardCls}>
        <h3 className="text-sm font-semibold text-ink">백업 이력</h3>
        {logs.length === 0 ? (
          <p className="mt-3 text-xs text-ink-muted">
            아직 백업 기록이 없습니다.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-muted">
                  <th className="py-2 pr-3 font-medium">시각</th>
                  <th className="py-2 pr-3 font-medium">상태</th>
                  <th className="py-2 pr-3 font-medium">테이블 / 행수</th>
                  <th className="py-2 pr-3 font-medium">크기</th>
                  <th className="py-2 pr-3 font-medium">소요시간</th>
                  <th className="py-2 pr-3 font-medium">트리거</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-b border-line align-top">
                    <td className="py-2 pr-3 whitespace-nowrap text-ink-body">
                      {fmtKstDateTime(l.started_at)}
                    </td>
                    <td className="py-2 pr-3">
                      <StatusBadge status={l.status} />
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap text-ink-body">
                      {l.table_count == null && l.total_rows == null
                        ? "-"
                        : `${l.table_count ?? 0}개 / ${(l.total_rows ?? 0).toLocaleString("ko-KR")}행`}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap text-ink-body">
                      {fmtSize(l.file_size_bytes)}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap text-ink-body">
                      {fmtElapsed(l.started_at, l.finished_at)}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap text-ink-muted">
                      {l.triggered_by}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* 실패·부분성공 사유는 표 아래에 따로 — 메시지가 길어 칸에 넣으면 표가 깨집니다. */}
            {logs.some((l) => l.error_message) && (
              <ul className="mt-3 space-y-1.5">
                {logs
                  .filter((l) => l.error_message)
                  .map((l) => (
                    <li
                      key={l.id}
                      className="whitespace-pre-line text-xs text-stamp"
                    >
                      <span className="font-semibold">
                        {fmtKstDateTime(l.started_at)}
                      </span>{" "}
                      — {l.error_message}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
