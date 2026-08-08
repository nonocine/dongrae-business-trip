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

// --- Google 서비스 계정 키 정규화 --------------------------------------
// GDRIVE_SA_KEY 에 들어올 수 있는 형태가 여러 가지라 방어적으로 처리합니다.
//   (a) 서비스 계정 JSON 전문(콘솔에서 받은 파일 내용 그대로)
//   (b) private_key 값만 (PEM)
// 어느 쪽이든 환경변수에 한 줄로 들어가면서 개행이 리터럴 "\n" 으로
// 이스케이프되는 경우가 많고, 그대로 두면 PEM 파싱이
// `error:1E08010C:DECODER routines::unsupported` 로 실패합니다.
//
// ⚠️ 이 모듈의 어떤 로그·반환값에도 키 내용 자체는 절대 담지 않습니다.
//    (길이·마커 유무 같은 메타정보만 진단에 사용)

const PEM_BEGIN = "-----BEGIN PRIVATE KEY-----";
const PEM_END = "-----END PRIVATE KEY-----";

export type KeyDiagnostics = {
  // 환경변수 원본 길이(문자 수). 값 자체는 포함하지 않습니다.
  rawLength: number;
  // JSON 전문으로 파싱됐는지. false 면 PEM 단독으로 간주.
  jsonParsed: boolean;
  // 정규화 후 PEM 이 BEGIN 마커로 시작하는지.
  hasBeginMarker: boolean;
  // JSON 의 client_email 과 GDRIVE_SA_EMAIL 일치 여부. JSON 이 아니면 null.
  clientEmailMatches: boolean | null;
};

// 앞뒤 따옴표 제거 — 일부 CLI/대시보드가 값을 통째로 감싸 저장합니다.
function unquote(s: string): string {
  const t = s.trim();
  if (
    t.length >= 2 &&
    ((t.startsWith('"') && t.endsWith('"')) ||
      (t.startsWith("'") && t.endsWith("'")))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

// PEM 본문 정규화 — 리터럴 \n → 실제 개행, \r 제거, 앞뒤 공백 정리.
//   * 이미 실제 개행인 키는 그대로 보존됩니다(치환 대상이 없으므로).
function normalizePem(raw: string): string {
  return unquote(raw)
    .replace(/\\r\\n/g, "\n") // 리터럴 "\r\n"
    .replace(/\\n/g, "\n") // 리터럴 "\n"
    .replace(/\r/g, "") // 실제 CR(윈도우 줄바꿈 잔재)
    .trim();
}

export type ResolvedServiceAccount = {
  privateKey: string;
  // JSON 전문에서 읽은 client_email. PEM 단독이면 null.
  clientEmail: string | null;
  diag: KeyDiagnostics;
};

// GDRIVE_SA_KEY → 사용 가능한 PEM. 형식이 어긋나면 명확한 메시지로 throw.
export function resolveServiceAccountKey(
  raw: string,
  expectedEmail: string | null | undefined
): ResolvedServiceAccount {
  const rawLength = raw.length;
  const unquoted = unquote(raw);

  // (a) JSON 전문 시도 — 실패해도 throw 하지 않고 (b) 로 넘어갑니다.
  let jsonParsed = false;
  let pemSource = unquoted;
  let clientEmail: string | null = null;
  if (unquoted.startsWith("{")) {
    try {
      const o = JSON.parse(unquoted) as {
        private_key?: unknown;
        client_email?: unknown;
      };
      if (typeof o?.private_key === "string") {
        jsonParsed = true;
        pemSource = o.private_key;
        clientEmail =
          typeof o.client_email === "string" ? o.client_email : null;
      }
    } catch {
      // JSON 처럼 보였지만 파싱 실패 — PEM 단독으로 계속 시도합니다.
    }
  }

  const privateKey = normalizePem(pemSource);
  const hasBeginMarker = privateKey.startsWith(PEM_BEGIN);
  const clientEmailMatches = clientEmail
    ? clientEmail.trim().toLowerCase() ===
      (expectedEmail ?? "").trim().toLowerCase()
    : null;

  const diag: KeyDiagnostics = {
    rawLength,
    jsonParsed,
    hasBeginMarker,
    clientEmailMatches,
  };

  if (!hasBeginMarker || !privateKey.endsWith(PEM_END)) {
    throw new Error(
      `GDRIVE_SA_KEY 형식 오류 — private_key 가 "${PEM_BEGIN}" 로 시작하고 ` +
        `"${PEM_END}" 로 끝나야 합니다. 서비스 계정 JSON 전문 또는 private_key ` +
        `값을 그대로 붙여넣었는지 확인하세요.`
    );
  }

  return { privateKey, clientEmail, diag };
}

// --- 진단 힌트 --------------------------------------------------------
// 실패 원인을 화면·로그에서 좁힐 수 있도록 메타정보만 한 줄로 요약합니다.
//   * 키 값·client_email 주소 등 실제 내용은 절대 포함하지 않습니다.
//   * 어떤 상황에서도 throw 하지 않습니다(진단이 본 에러를 덮으면 안 됨).
export function describeKeyDiagnostics(): string {
  try {
    const email = process.env.GDRIVE_SA_EMAIL ?? "";
    const raw = process.env.GDRIVE_SA_KEY ?? "";
    const folder = process.env.GDRIVE_BACKUP_FOLDER_ID ?? "";

    const parts: string[] = [
      `SA_EMAIL ${email ? "설정됨" : "미설정"}`,
      `FOLDER_ID ${folder ? "설정됨" : "미설정"}`,
      `SA_KEY 길이 ${raw.length}자`,
    ];
    if (!raw) {
      return `진단: ${parts.join(" · ")}`;
    }

    let diag: KeyDiagnostics;
    try {
      diag = resolveServiceAccountKey(raw, email).diag;
    } catch {
      // 형식 오류로 throw 된 경우에도 메타정보는 다시 계산해 보여줍니다.
      const unquoted = unquote(raw);
      let jsonParsed = false;
      let pemSource = unquoted;
      let clientEmail: string | null = null;
      try {
        const o = JSON.parse(unquoted) as {
          private_key?: unknown;
          client_email?: unknown;
        };
        if (typeof o?.private_key === "string") {
          jsonParsed = true;
          pemSource = o.private_key;
          clientEmail =
            typeof o.client_email === "string" ? o.client_email : null;
        }
      } catch {
        /* PEM 단독 */
      }
      diag = {
        rawLength: raw.length,
        jsonParsed,
        hasBeginMarker: normalizePem(pemSource).startsWith(PEM_BEGIN),
        clientEmailMatches: clientEmail
          ? clientEmail.trim().toLowerCase() === email.trim().toLowerCase()
          : null,
      };
    }

    parts.push(`JSON 파싱 ${diag.jsonParsed ? "성공" : "아님(PEM 단독)"}`);
    parts.push(`PEM BEGIN 마커 ${diag.hasBeginMarker ? "있음" : "없음"}`);
    parts.push(
      `client_email ${
        diag.clientEmailMatches === null
          ? "비교불가(JSON 아님)"
          : diag.clientEmailMatches
            ? "GDRIVE_SA_EMAIL 과 일치"
            : "GDRIVE_SA_EMAIL 과 불일치"
      }`
    );
    return `진단: ${parts.join(" · ")}`;
  } catch {
    return "진단: 수집 실패";
  }
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

  // JSON 전문/PEM 단독 모두 허용. 형식이 어긋나면 여기서 명확히 실패합니다.
  const { privateKey } = resolveServiceAccountKey(rawKey, email);

  const jwt = new JWT({
    email,
    key: privateKey,
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
    const raw = e instanceof Error ? e.message : String(e);
    // 구글 인증 실패는 원인이 대부분 키 형식이라 진단 힌트를 함께 남깁니다.
    // (메타정보만 — 키 값은 포함되지 않습니다)
    const msg = `${raw}\n${describeKeyDiagnostics()}`;
    await finish({ status: "failed", error_message: msg });
    await sendSlack(
      "SLACK_WEBHOOK_ADMIN",
      `🚨 백업 실패 — ${raw}\n${describeKeyDiagnostics()}\n트리거: ${triggeredBy}`
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
