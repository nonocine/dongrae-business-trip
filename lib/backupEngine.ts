import JSZip from "jszip";
import { JWT } from "google-auth-library";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendSlack } from "@/lib/slack";

// =====================================================================
// 데이터 백업 엔진 — 화이트리스트 테이블 → JSON → ZIP → Google Drive
//   * 읽기 전용: backup_logs 를 제외한 어떤 테이블에도 절대 쓰지 않습니다.
//     (select 만 사용. insert/update/delete 는 backup_logs 한 곳뿐)
//   * service_role(supabaseAdmin) 사용 → 서버 전용 모듈. 클라이언트에서
//     import 하면 supabaseAdmin 의 window 가드가 즉시 throw 합니다.
//   * 공유 Supabase 인스턴스이므로 "화이트리스트" 방식입니다. 테이블 목록을
//     자동 탐색하지 않습니다 — 타 앱(스탬프투어 등)·소유 불명 테이블을
//     실수로 반출하지 않기 위함.
//   * 슬랙 알림은 부가기능 — 실패해도 백업 결과에 영향을 주지 않습니다.
// =====================================================================

// --- 화이트리스트 -----------------------------------------------------
// ① 이 저장소 코드가 실제로 참조하는 테이블 (grep 기준 50개)
// ② 코드 참조는 없지만 이 앱 소유가 확실한 테이블 (6개)
// 제외: backup_logs(자기 자신) / recruitment_scores_backup_v1(임시 백업본)
//       yangjeong_* · global_plans · reports · center_reports (소유 불명)
//       profiles · admins · stamp_records · centers · reviews · applications
//       programs · organization_logos · push_subscriptions (타 앱)
export const BACKUP_TABLES: readonly string[] = [
  // --- 활동/차량 ---
  "activities",
  "business_trips",
  "drivers",
  "driving_logs",
  "settings",
  // --- 인사 ---
  "employee_profiles",
  "employee_roles",
  "announcements",
  "leave_plan_requests",
  "certificate_issues",
  "certificate_requests",
  "employment_contracts", // ②
  "salary_contracts", // ②
  "certificates_issued", // ②
  // --- 급여 ---
  "salary_config",
  "salary_grade_table",
  "employee_salary_profiles",
  "payroll_records",
  // --- 교육 ---
  "mandatory_trainings",
  "training_completions",
  "staff_training_results",
  // --- 채용 ---
  "recruitment_postings",
  "recruitment_applicants",
  "recruitment_applications",
  "recruitment_scores",
  "recruitment_judges",
  "external_judges_pool",
  "recruitment_document_scores", // ②
  "recruitment_interview_scores", // ②
  "recruitment_interview_schedule", // ②
  // --- 시설/안전 ---
  "facility_assets",
  "facility_locations",
  "safety_checks",
  "safety_check_items",
  "safety_check_results",
  // --- 강사(동래샘들) ---
  "saem_instructors",
  "saem_instructor_documents",
  "saem_projects",
  "saem_terms",
  "saem_programs",
  "saem_sessions",
  "saem_enrollments",
  "saem_attendance",
  "saem_settlements",
  "saem_settlement_items",
  // --- 상조회 ---
  "mutual_members",
  "mutual_ledger",
  // --- 사업실적 ---
  "business_results",
  "business_result_rooms",
  "business_result_details",
  "business_categories",
  "business_programs",
  "business_promotions",
  "report_rooms",
  "coin_pay_results",
  // --- 공용 메일함 ---
  "mail_messages",
];

// backup_logs 는 이 엔진이 유일하게 쓰는 테이블입니다.
const LOG_TABLE = "backup_logs";

// Supabase 는 1회 응답 행 수에 상한이 있어 페이지네이션으로 전량을 읽습니다.
const PAGE_SIZE = 1000;

export type TableDump = {
  table: string;
  rows: number;
  // 읽기 실패(테이블 없음 등) 시 사유. 있으면 rows 는 0이고 JSON 도 만들지 않습니다.
  error?: string;
};

export type BackupSummary = {
  ok: boolean;
  logId: string | null;
  tableCount: number;
  totalRows: number;
  fileName: string | null;
  fileSizeBytes: number | null;
  driveFileId: string | null;
  // 읽지 못한 테이블(있어도 백업 자체는 성공 처리 — 나머지는 정상 보관됨)
  skipped: TableDump[];
  errorMessage: string | null;
  elapsedMs: number;
};

// --- KST 파일명 -------------------------------------------------------
// "동업자씨_백업_YYYY-MM-DD_HHmm.zip". KST 는 UTC+9 고정(DST 없음)이라
// UTC ms 에 +9h 후 getUTC* 로 읽으면 서버 로케일과 무관하게 동일합니다.
export function backupFileName(now: Date): string {
  const k = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const p2 = (n: number) => String(n).padStart(2, "0");
  const d = `${k.getUTCFullYear()}-${p2(k.getUTCMonth() + 1)}-${p2(k.getUTCDate())}`;
  const t = `${p2(k.getUTCHours())}${p2(k.getUTCMinutes())}`;
  return `동업자씨_백업_${d}_${t}.zip`;
}

// --- 테이블 덤프 ------------------------------------------------------
// 정렬 컬럼이 테이블마다 달라(id / created_at / 없음) OFFSET 페이지네이션이
// 불안정해지지 않도록 사용 가능한 컬럼을 순서대로 시도합니다.
const ORDER_CANDIDATES = ["id", "created_at", null] as const;

async function fetchAll(table: string): Promise<Record<string, unknown>[]> {
  let orderBy: string | null | undefined;
  const out: Record<string, unknown>[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    let page: Record<string, unknown>[] | null = null;
    let lastError: string | null = null;

    // 첫 페이지에서 유효한 정렬 컬럼을 확정하고, 이후 페이지는 그대로 재사용.
    const candidates =
      orderBy === undefined ? ORDER_CANDIDATES : ([orderBy] as const);

    for (const col of candidates) {
      let q = supabaseAdmin
        .from(table)
        .select("*")
        .range(from, from + PAGE_SIZE - 1);
      if (col) q = q.order(col, { ascending: true });
      const { data, error } = await q;
      if (error) {
        lastError = error.message;
        continue; // 다음 정렬 후보로 폴백
      }
      orderBy = col;
      page = (data ?? []) as Record<string, unknown>[];
      break;
    }

    if (page === null) {
      throw new Error(lastError ?? "알 수 없는 조회 오류");
    }
    out.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  return out;
}

// --- Google Drive -----------------------------------------------------
// 서비스 계정 private_key 는 환경변수에 한 줄로 들어가면서 개행이 "\n"
// 문자열로 이스케이프됩니다. 실제 개행으로 되돌리지 않으면 서명이 실패합니다.
// 값 전체가 따옴표로 감싸진 경우(일부 CLI)도 함께 벗겨냅니다.
export function normalizePrivateKey(raw: string): string {
  let k = raw.trim();
  if (
    (k.startsWith('"') && k.endsWith('"')) ||
    (k.startsWith("'") && k.endsWith("'"))
  ) {
    k = k.slice(1, -1);
  }
  return k.replace(/\\n/g, "\n");
}

async function uploadToDrive(
  fileName: string,
  zip: Buffer
): Promise<{ id: string }> {
  const email = process.env.GDRIVE_SA_EMAIL;
  const rawKey = process.env.GDRIVE_SA_KEY;
  const folderId = process.env.GDRIVE_BACKUP_FOLDER_ID;
  if (!email || !rawKey || !folderId) {
    throw new Error(
      "구글 드라이브 환경변수 미설정 — GDRIVE_SA_EMAIL / GDRIVE_SA_KEY / GDRIVE_BACKUP_FOLDER_ID 를 등록하세요."
    );
  }

  const jwt = new JWT({
    email,
    key: normalizePrivateKey(rawKey),
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  const { token } = await jwt.getAccessToken();
  if (!token) throw new Error("구글 인증 토큰 발급에 실패했습니다.");

  // files.create — multipart(메타데이터 + 본문 1회 전송).
  // supportsAllDrives: 공유 드라이브 폴더에도 업로드 가능하도록.
  const boundary = `dongrae-backup-${Date.now().toString(36)}`;
  const meta = {
    name: fileName,
    parents: [folderId],
    mimeType: "application/zip",
  };
  const head = Buffer.from(
    `--${boundary}\r\n` +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      `${JSON.stringify(meta)}\r\n` +
      `--${boundary}\r\n` +
      "Content-Type: application/zip\r\n\r\n",
    "utf8"
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: new Uint8Array(Buffer.concat([head, zip, tail])),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `드라이브 업로드 실패(${res.status}) ${body.slice(0, 300)}`.trim()
    );
  }
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error("드라이브 업로드 응답에 파일 ID가 없습니다.");
  return { id: json.id };
}

// --- 크기 표기 --------------------------------------------------------
export function fmtBytes(n: number | null | undefined): string {
  if (n == null) return "-";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

// --- 진행 중 백업 여부 -------------------------------------------------
// 중복 실행 방지용. running 로그가 하나라도 있으면 true.
export async function hasRunningBackup(): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from(LOG_TABLE)
    .select("id")
    .eq("status", "running")
    .limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

// --- 메인 -------------------------------------------------------------
// triggeredBy: "cron" | "manual" | "수동(홍길동)" 등 자유 문자열.
export async function runBackup(triggeredBy: string): Promise<BackupSummary> {
  const startedAt = Date.now();
  const now = new Date();
  const fileName = backupFileName(now);

  // 1) running 로그 선행 기록 — 실패해도 백업은 진행(로그는 부가정보).
  let logId: string | null = null;
  {
    const { data, error } = await supabaseAdmin
      .from(LOG_TABLE)
      .insert({ status: "running", triggered_by: triggeredBy })
      .select("id")
      .single();
    if (error) {
      console.warn("[backup] running 로그 기록 실패:", error.message);
    } else {
      logId = String((data as { id: string }).id);
    }
  }

  const finish = async (
    patch: Record<string, unknown>
  ): Promise<void> => {
    if (!logId) return;
    const { error } = await supabaseAdmin
      .from(LOG_TABLE)
      .update({ ...patch, finished_at: new Date().toISOString() })
      .eq("id", logId);
    if (error) console.warn("[backup] 완료 로그 기록 실패:", error.message);
  };

  try {
    // 2) 테이블별 덤프 → ZIP
    const zip = new JSZip();
    const dumps: TableDump[] = [];
    let totalRows = 0;

    for (const table of BACKUP_TABLES) {
      try {
        const rows = await fetchAll(table);
        zip.file(`tables/${table}.json`, JSON.stringify(rows, null, 2));
        dumps.push({ table, rows: rows.length });
        totalRows += rows.length;
      } catch (e) {
        // 개별 테이블 실패는 격리 — 나머지는 정상 보관하고 manifest 에 기록.
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[backup] ${table} 읽기 실패:`, msg);
        dumps.push({ table, rows: 0, error: msg });
      }
    }

    const okDumps = dumps.filter((d) => !d.error);
    const manifest = {
      generated_at: now.toISOString(),
      triggered_by: triggeredBy,
      table_count: okDumps.length,
      total_rows: totalRows,
      tables: dumps,
    };
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));

    const buf = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    // 3) 드라이브 업로드
    const { id: driveFileId } = await uploadToDrive(fileName, buf);

    const skipped = dumps.filter((d) => d.error);
    await finish({
      status: "success",
      table_count: okDumps.length,
      total_rows: totalRows,
      file_name: fileName,
      file_size_bytes: buf.length,
      drive_file_id: driveFileId,
      error_message:
        skipped.length > 0
          ? `일부 테이블 제외: ${skipped.map((s) => s.table).join(", ")}`
          : null,
    });

    // 4) 슬랙 — 완전 격리(sendSlack 은 throw 하지 않음).
    await sendSlack(
      "SLACK_WEBHOOK_ADMIN",
      `✅ 백업 완료 (${okDumps.length}테이블 · ${totalRows.toLocaleString("ko-KR")}행 · ${fmtBytes(buf.length)})\n` +
        `파일: ${fileName}\n트리거: ${triggeredBy}` +
        (skipped.length > 0
          ? `\n⚠️ 제외된 테이블: ${skipped.map((s) => s.table).join(", ")}`
          : "")
    );

    return {
      ok: true,
      logId,
      tableCount: okDumps.length,
      totalRows,
      fileName,
      fileSizeBytes: buf.length,
      driveFileId,
      skipped,
      errorMessage: null,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await finish({ status: "failed", error_message: msg });
    await sendSlack(
      "SLACK_WEBHOOK_ADMIN",
      `🚨 백업 실패 — ${msg}\n트리거: ${triggeredBy}`
    );
    return {
      ok: false,
      logId,
      tableCount: 0,
      totalRows: 0,
      fileName: null,
      fileSizeBytes: null,
      driveFileId: null,
      skipped: [],
      errorMessage: msg,
      elapsedMs: Date.now() - startedAt,
    };
  }
}

// --- 이력 조회 --------------------------------------------------------
export type BackupLog = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  table_count: number | null;
  total_rows: number | null;
  file_name: string | null;
  file_size_bytes: number | null;
  drive_file_id: string | null;
  error_message: string | null;
  triggered_by: string;
};

export async function listBackupLogs(limit = 50): Promise<BackupLog[]> {
  const { data, error } = await supabaseAdmin
    .from(LOG_TABLE)
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as BackupLog[];
}
