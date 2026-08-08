import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/app/components/Header";
import { enforcePasswordChange } from "@/app/actions";
import { resolveBackupAccess } from "@/lib/backupAccess";
import {
  BACKUP_TABLES,
  hasRunningBackup,
  listBackupLogs,
} from "@/lib/backupEngine";
import BackupManager from "@/app/hr/backup/BackupManager";

export const dynamic = "force-dynamic";

export default async function BackupPage() {
  await enforcePasswordChange();

  // 접근: M0(관장·부장·master) 전용 — 전 테이블 반출 기능이라 직무 위임 없음.
  const access = await resolveBackupAccess();
  if (!access) redirect("/");

  const [logs, running] = await Promise.all([
    listBackupLogs(50),
    hasRunningBackup(),
  ]);

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <div className="mb-5 flex items-end justify-between">
          <div>
            <p className="text-xs font-semibold tracking-wide text-navy">
              동래구청소년센터
            </p>
            <h2 className="mt-0.5 text-2xl font-bold tracking-[0.1em] text-ink">
              데이터 백업
            </h2>
            <p className="mt-1 text-xs text-ink-muted">
              센터 데이터 {BACKUP_TABLES.length}개 테이블을 JSON 으로 내보내
              ZIP 으로 묶은 뒤 구글 드라이브에 보관합니다. 매월 2일 새벽 3시에
              자동 실행되며, 필요할 때 아래 버튼으로 즉시 실행할 수 있습니다.
            </p>
          </div>
          <Link href="/" className="text-sm text-ink-muted hover:underline">
            ← 목록
          </Link>
        </div>
        <BackupManager
          initialLogs={logs}
          initialRunning={running}
          tableCount={BACKUP_TABLES.length}
        />
      </main>
    </>
  );
}
