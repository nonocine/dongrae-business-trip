"use server";

import { revalidatePath } from "next/cache";
import { requireBackupAccess } from "@/lib/backupAccess";
import {
  hasRunningBackup,
  listBackupLogs,
  runBackup,
  type BackupLog,
} from "@/lib/backupEngine";

// =====================================================================
// 데이터 백업 서버 액션 — /hr/backup
//   * 전부 M0 전용(requireBackupAccess). 백업 엔진은 service_role 로 전
//     테이블을 읽으므로 액션 진입마다 권한을 재검증합니다.
//   * 읽기 전용 — 엔진이 쓰는 테이블은 backup_logs 하나뿐입니다.
// =====================================================================

export async function fetchBackupState(): Promise<{
  logs: BackupLog[];
  running: boolean;
}> {
  await requireBackupAccess();
  const [logs, running] = await Promise.all([
    listBackupLogs(50),
    hasRunningBackup(),
  ]);
  return { logs, running };
}

// [지금 백업 실행] — 실행자 이름을 triggered_by 에 남깁니다.
//   * 동시 실행 방지: running 로그가 있으면 시작하지 않습니다(버튼 비활성의
//     서버측 이중 방어). 300초 안에 끝나지 않으면 running 이 남을 수 있어
//     그 경우는 로그를 직접 확인해야 합니다.
export async function startBackupNow(): Promise<{
  ok: boolean;
  message: string;
}> {
  const ctx = await requireBackupAccess();

  if (await hasRunningBackup()) {
    return {
      ok: false,
      message: "이미 진행 중인 백업이 있습니다. 완료 후 다시 시도해주세요.",
    };
  }

  const summary = await runBackup(`수동(${ctx.name})`);
  revalidatePath("/hr/backup");

  if (!summary.ok) {
    return {
      ok: false,
      message: summary.errorMessage ?? "백업에 실패했습니다.",
    };
  }
  return {
    ok: true,
    message: `백업 완료 — ${summary.tableCount}개 테이블 · ${summary.totalRows.toLocaleString("ko-KR")}행`,
  };
}
