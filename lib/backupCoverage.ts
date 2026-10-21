// =====================================================================
// 백업 목록 점검 — 백업 목록(BACKUP_TABLES)에도 제외 목록(BACKUP_EXCLUDED)에도
//   없는 public 테이블이 생기면 관장에게 슬랙 DM (2026-10 관장 지시, 재발 방지).
//   * 백업 Cron(app/api/cron/backup) 이 백업 뒤에 한 번 부릅니다. 백업 자체와
//     격리돼 있어 여기서 실패해도 백업 결과에는 영향이 없습니다.
//   * 테이블 목록은 PostgREST OpenAPI(/rest/v1/)에서 읽습니다 — service_role 로만
//     열리고(anon 401) DB 함수·마이그레이션이 필요 없습니다. public 스키마의
//     노출 테이블 전부가 나옵니다.
//   * 백업 목록에 있는데 DB 에 없는 테이블(매번 skipped 되는 것)도 함께 알립니다.
//   * 서버 전용 모듈. 읽기만 하고 DB 에 쓰지 않습니다.
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendSlackDMDetailed } from "@/lib/slack";
import { BACKUP_EXCLUDED, BACKUP_TABLES } from "@/lib/backupEngine";

export type BackupCoverage = {
  tableCount: number;
  // 백업에도 제외 목록에도 없는 테이블 — 알림 대상
  unlisted: string[];
  // 백업 목록에 있는데 DB 에 없는 테이블 — 알림 대상
  missingInDb: string[];
  // 제외 목록에 있는데 DB 에 없는 테이블 — 참고(알림 안 함)
  staleExcluded: string[];
};

export async function listPublicTables(): Promise<string[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase 환경변수(URL·service_role)가 없습니다.");
  const res = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/openapi+json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`테이블 목록 조회 실패(HTTP ${res.status})`);
  const spec = (await res.json()) as { paths?: Record<string, unknown> };
  return Object.keys(spec.paths ?? {})
    .filter((p) => p !== "/" && !p.startsWith("/rpc/"))
    .map((p) => p.slice(1))
    .sort();
}

export async function checkBackupCoverage(): Promise<BackupCoverage> {
  const tables = await listPublicTables();
  const inDb = new Set(tables);
  const backed = new Set(BACKUP_TABLES);
  return {
    tableCount: tables.length,
    unlisted: tables.filter((t) => !backed.has(t) && !(t in BACKUP_EXCLUDED)),
    missingInDb: BACKUP_TABLES.filter((t) => !inDb.has(t)),
    staleExcluded: Object.keys(BACKUP_EXCLUDED).filter((t) => !inDb.has(t)),
  };
}

export function coverageMessage(c: BackupCoverage): string | null {
  if (c.unlisted.length === 0 && c.missingInDb.length === 0) return null;
  const lines = ["🗄️ 백업 목록 점검 — 확인이 필요한 테이블이 있습니다."];
  if (c.unlisted.length > 0) {
    lines.push(`• 백업에도 제외 목록에도 없는 테이블 ${c.unlisted.length}개: ${c.unlisted.join(", ")}`);
  }
  if (c.missingInDb.length > 0) {
    lines.push(`• 백업 목록에 있지만 DB 에 없는 테이블 ${c.missingInDb.length}개: ${c.missingInDb.join(", ")}`);
  }
  lines.push("lib/backupEngine.ts 의 BACKUP_TABLES(백업) 또는 BACKUP_EXCLUDED(제외·이유)에 적어 주세요.");
  return lines.join("\n");
}

// 관장(drivers.rank='관장', 재직) 의 인사기록카드 email. 파일 백업 실패 알림도 씁니다.
export async function directorEmail(): Promise<string | null> {
  const { data: drv } = await supabaseAdmin
    .from("drivers")
    .select("id")
    .eq("rank", "관장")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  const id = (drv as { id?: string } | null)?.id;
  if (!id) return null;
  const { data: prof } = await supabaseAdmin
    .from("employee_profiles")
    .select("email")
    .eq("driver_id", id)
    .maybeSingle();
  const email = (prof as { email?: string | null } | null)?.email ?? null;
  return email && email.trim() ? email.trim() : null;
}

export type CoverageRun = BackupCoverage & {
  message: string | null;
  dm: "sent" | "failed" | "skipped" | "dry-run";
  dmReason: string | null;
};

// dryRun=true 면 점검만 하고 DM 은 보내지 않습니다.
export async function runBackupCoverageCheck(opts: { dryRun: boolean }): Promise<CoverageRun> {
  const c = await checkBackupCoverage();
  const message = coverageMessage(c);
  if (!message) return { ...c, message, dm: "skipped", dmReason: null };
  if (opts.dryRun) return { ...c, message, dm: "dry-run", dmReason: null };
  const res = await sendSlackDMDetailed(await directorEmail(), message);
  return { ...c, message, dm: res.ok ? "sent" : "failed", dmReason: res.reason };
}
