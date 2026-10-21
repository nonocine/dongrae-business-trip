// =====================================================================
// 파일 백업 — Storage(FILE_BACKUP_SOURCES) → Google Drive, 증분 (2026-10 관장 지시)
//   * 대상: hr-documents 전체, bangka-media(동래방카 사진·첨부 — tmp/ 업로드 중간 파일 제외).
//     shared-mail(메일 첨부)은 아직 넣지 않았습니다.
//   * 위치: ZIP 백업과 같은 공유 드라이브(GDRIVE_BACKUP_FOLDER_ID) 아래
//     "동업자씨 파일 백업/{버킷}/{원래 경로}". 버킷들이 한 실행·한 시간 예산을 나눠 씁니다.
//   * 원본 목록은 file_backup_list(bucket) RPC 1회(service_role 전용 함수).
//     진행 기록(file_backup_items)과 비교해 새 파일·바뀐 파일(eTag·크기)만 올립니다.
//     할 일이 없으면 드라이브에 접속하지 않고 바로 끝납니다.
//   * 바뀐 파일은 같은 드라이브 파일에 새 버전으로 올리고 그 버전을 영구 보관
//     (keepRevisionForever) — 덮어쓰기 전 내용도 '버전 관리'에서 되살릴 수 있습니다.
//   * 원본에서 지워진 파일은 드라이브에서 지우지 않습니다(실수로 지운 파일을 되살리는
//     게 목적). source_missing_at 만 남기고, 다시 나타나면 비웁니다.
//   * Vercel 300초 제한: 240초가 지나면 새 파일은 시작하지 않고 멈춥니다. 남은 건
//     다음 실행이 이어갑니다. 동시 3개.
//   * 동시 실행 방지: running 기록이 있으면 끝냄. 30분 넘게 멈춘 running 은 실패로 정리.
//   * 실패: file_backup_runs 기록 + 관리자 채널 + 관장 DM. 파일 하나 실패는 건너뛰고
//     다음 실행에서 다시 시도합니다(기록이 안 생기므로 자연히 재시도 대상).
//   * Storage 원본은 읽기만 합니다. 서버 전용 모듈.
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendSlack, sendSlackDMDetailed } from "@/lib/slack";
import { driveAuth } from "@/lib/backupEngine";
import { directorEmail } from "@/lib/backupCoverage";

export const FILE_BACKUP_ROOT = "동업자씨 파일 백업";
// 백업할 버킷. exclude 에 맞는 경로는 원본 목록에서 뺍니다(백업도, '원본에서 사라짐' 표시도 안 함).
export const FILE_BACKUP_SOURCES: readonly { bucket: string; exclude: RegExp | null }[] = [
  { bucket: "hr-documents", exclude: null },
  // tmp/ = 동래방카 사진을 서버가 줄이기 전에 잠깐 두는 곳(lib/bangkaMedia) — 곧 지워짐.
  { bucket: "bangka-media", exclude: /^tmp\// },
];
const BUDGET_MS = 240_000;
const CONCURRENCY = 3;
const STALE_MS = 30 * 60_000;
const FOLDER_MIME = "application/vnd.google-apps.folder";
const PAGE = 1000;

type SourceFile = { name: string; size: number; etag: string | null; updated_at: string };
type ItemRow = {
  object_path: string;
  size_bytes: number;
  etag: string | null;
  drive_file_id: string;
  revision_count: number;
  source_missing_at: string | null;
};

export type FileBackupSummary = {
  ok: boolean;
  skipped?: string; // 실행하지 않은 이유(이미 실행 중)
  runId: string | null;
  scanned: number;
  uploaded: number; // 새로 올림
  updated: number; // 새 버전
  bytesUploaded: number;
  remaining: number; // 시간 제한으로 다음 실행에 넘김
  failed: { path: string; message: string }[];
  missingMarked: number;
  errorMessage: string | null;
  elapsedMs: number;
};

// --- 드라이브 ----------------------------------------------------------
const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const ALL = "supportsAllDrives=true";

const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function driveJson<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw Object.assign(new Error(`드라이브 ${res.status} ${body.slice(0, 200)}`.trim()), { status: res.status });
  }
  return (await res.json()) as T;
}

async function findFolder(token: string, parentId: string, name: string): Promise<string | null> {
  const query = encodeURIComponent(
    `'${parentId}' in parents and name = '${q(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`
  );
  const j = await driveJson<{ files?: { id: string }[] }>(
    token,
    `${API}?q=${query}&corpora=allDrives&includeItemsFromAllDrives=true&${ALL}&fields=files(id)&pageSize=1`
  );
  return j.files?.[0]?.id ?? null;
}

async function createFolder(token: string, parentId: string, name: string): Promise<string> {
  const j = await driveJson<{ id: string }>(token, `${API}?${ALL}&fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  return j.id;
}

async function folderParentOk(token: string, folderId: string, parentId: string): Promise<boolean> {
  try {
    const j = await driveJson<{ parents?: string[]; trashed?: boolean }>(
      token,
      `${API}/${folderId}?${ALL}&fields=parents,trashed`
    );
    return !j.trashed && (j.parents ?? []).includes(parentId);
  } catch {
    return false;
  }
}

async function uploadNew(token: string, parentId: string, name: string, mime: string, bytes: Buffer): Promise<string> {
  const boundary = `dongrae-file-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify({ name, parents: [parentId] })}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
    "utf8"
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  const j = await driveJson<{ id: string }>(token, `${UPLOAD}?uploadType=multipart&keepRevisionForever=true&${ALL}&fields=id`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body: new Uint8Array(Buffer.concat([head, bytes, tail])),
  });
  return j.id;
}

async function uploadRevision(token: string, fileId: string, mime: string, bytes: Buffer): Promise<void> {
  await driveJson(token, `${UPLOAD}/${fileId}?uploadType=media&keepRevisionForever=true&${ALL}&fields=id`, {
    method: "PATCH",
    headers: { "Content-Type": mime },
    body: new Uint8Array(bytes),
  });
}

// --- 원본·기록 읽기 ------------------------------------------------------
async function listSource(bucket: string): Promise<SourceFile[]> {
  const out: SourceFile[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .rpc("file_backup_list", { p_bucket: bucket })
      .order("name")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`원본 목록 조회 실패: ${error.message}`);
    const rows = (data ?? []) as { name: string; size: number | string | null; etag: string | null; updated_at: string }[];
    for (const r of rows) {
      // 폴더 표식(.emptyFolderPlaceholder)은 파일이 아니므로 건너뜁니다.
      if (r.name.endsWith("/.emptyFolderPlaceholder")) continue;
      out.push({ name: r.name, size: Number(r.size ?? 0), etag: r.etag, updated_at: r.updated_at });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

async function listItems(bucket: string): Promise<Map<string, ItemRow>> {
  const map = new Map<string, ItemRow>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("file_backup_items")
      .select("object_path, size_bytes, etag, drive_file_id, revision_count, source_missing_at")
      .eq("bucket", bucket)
      .order("object_path")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as ItemRow[]) map.set(r.object_path, { ...r, size_bytes: Number(r.size_bytes) });
    if ((data ?? []).length < PAGE) break;
  }
  return map;
}

// --- 폴더 ----------------------------------------------------------------
// folder_path: 버킷 기준 상대 경로. '' = 버킷 폴더("동업자씨 파일 백업/hr-documents").
class FolderCache {
  private ids = new Map<string, string>();
  private pending = new Map<string, Promise<string>>();
  constructor(
    private token: string,
    private bucket: string,
    private rootId: string
  ) {}

  async load(): Promise<void> {
    const { data, error } = await supabaseAdmin
      .from("file_backup_folders")
      .select("folder_path, drive_folder_id")
      .eq("bucket", this.bucket);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { folder_path: string; drive_folder_id: string }[];
    const top = rows.find((r) => r.folder_path === "");
    // 버킷 폴더가 지금 루트 아래에 없으면(누가 지웠거나 위치가 바뀜) 저장된 폴더 ID 를 버립니다.
    if (top && !(await folderParentOk(this.token, top.drive_folder_id, this.rootId))) {
      await supabaseAdmin.from("file_backup_folders").delete().eq("bucket", this.bucket);
      return;
    }
    for (const r of rows) this.ids.set(r.folder_path, r.drive_folder_id);
  }

  get(path: string): Promise<string> {
    const hit = this.ids.get(path);
    if (hit) return Promise.resolve(hit);
    let p = this.pending.get(path);
    if (!p) {
      p = this.make(path);
      this.pending.set(path, p);
    }
    return p;
  }

  private async make(path: string): Promise<string> {
    const slash = path.lastIndexOf("/");
    const parentId = path === "" ? this.rootId : await this.get(slash >= 0 ? path.slice(0, slash) : "");
    const name = path === "" ? this.bucket : path.slice(slash + 1);
    const id = (await findFolder(this.token, parentId, name)) ?? (await createFolder(this.token, parentId, name));
    const { error } = await supabaseAdmin
      .from("file_backup_folders")
      .upsert({ bucket: this.bucket, folder_path: path, drive_folder_id: id }, { onConflict: "bucket,folder_path" });
    if (error) throw new Error(error.message);
    this.ids.set(path, id);
    return id;
  }
}

// --- 알림 ----------------------------------------------------------------
async function notifyFailure(text: string): Promise<void> {
  await sendSlack("SLACK_WEBHOOK_ADMIN", text);
  try {
    await sendSlackDMDetailed(await directorEmail(), text);
  } catch {
    /* 알림 격리 */
  }
}

// --- 실행 ----------------------------------------------------------------
type Todo = { bucket: string; f: SourceFile };

export async function runFileBackup(input: {
  triggeredBy: string;
  rootName?: string; // 시험 때만 다른 이름
  maxFiles?: number; // 시험 때만 — 올릴 개수 상한
  notify?: boolean; // 기본 true
}): Promise<FileBackupSummary> {
  const started = Date.now();
  const notify = input.notify !== false;
  const base: FileBackupSummary = {
    ok: true,
    runId: null,
    scanned: 0,
    uploaded: 0,
    updated: 0,
    bytesUploaded: 0,
    remaining: 0,
    failed: [],
    missingMarked: 0,
    errorMessage: null,
    elapsedMs: 0,
  };

  // 1) 30분 넘게 멈춘 기록 정리 → 실행 중이면 끝냄
  await supabaseAdmin
    .from("file_backup_runs")
    .update({ status: "failed", finished_at: new Date().toISOString(), error_message: "30분 넘게 끝나지 않아 실패로 정리" })
    .eq("status", "running")
    .lt("started_at", new Date(started - STALE_MS).toISOString());
  const { data: running } = await supabaseAdmin.from("file_backup_runs").select("id").eq("status", "running").limit(1);
  if ((running ?? []).length > 0) return { ...base, skipped: "다른 파일 백업이 실행 중입니다." };

  const { data: run, error: runErr } = await supabaseAdmin
    .from("file_backup_runs")
    .insert({ status: "running", triggered_by: input.triggeredBy })
    .select("id")
    .single();
  if (runErr) throw new Error(runErr.message);
  const runId = String((run as { id: string }).id);
  const s: FileBackupSummary = { ...base, runId };

  const finish = async (status: "success" | "partial" | "failed") => {
    s.elapsedMs = Date.now() - started;
    await supabaseAdmin
      .from("file_backup_runs")
      .update({
        status,
        finished_at: new Date().toISOString(),
        scanned: s.scanned,
        uploaded: s.uploaded,
        updated: s.updated,
        bytes_uploaded: s.bytesUploaded,
        remaining: s.remaining,
        error_message: s.errorMessage,
      })
      .eq("id", runId);
  };

  try {
    // 2) 버킷마다 원본 목록 · 진행 기록 → 사라진/다시 나타난 표시 → 할 일
    const itemsBy = new Map<string, Map<string, ItemRow>>();
    const todoAll: Todo[] = [];
    for (const src of FILE_BACKUP_SOURCES) {
      const bucket = src.bucket;
      const source = (await listSource(bucket)).filter((f) => !src.exclude?.test(f.name));
      const items = await listItems(bucket);
      itemsBy.set(bucket, items);
      s.scanned += source.length;

      // 원본에서 사라진 파일 / 다시 나타난 파일 표시(드라이브는 그대로)
      const inSource = new Set(source.map((f) => f.name));
      const gone = [...items.values()].filter((i) => !inSource.has(i.object_path) && !i.source_missing_at);
      for (let k = 0; k < gone.length; k += 200) {
        await supabaseAdmin
          .from("file_backup_items")
          .update({ source_missing_at: new Date().toISOString() })
          .eq("bucket", bucket)
          .in("object_path", gone.slice(k, k + 200).map((i) => i.object_path));
      }
      s.missingMarked += gone.length;

      for (const f of source) {
        const it = items.get(f.name);
        if (!it || it.etag !== f.etag || it.size_bytes !== f.size) todoAll.push({ bucket, f });
        else if (it.source_missing_at) {
          await supabaseAdmin
            .from("file_backup_items")
            .update({ source_missing_at: null })
            .eq("bucket", bucket)
            .eq("object_path", f.name);
        }
      }
    }
    const todo = input.maxFiles != null ? todoAll.slice(0, input.maxFiles) : todoAll;
    if (todo.length === 0) {
      await finish("success");
      return s;
    }

    // 3) 드라이브 — 루트 폴더 · 버킷별 폴더 캐시(처음 쓸 때 불러옴)
    const { token, folderId } = await driveAuth();
    const rootName = input.rootName ?? FILE_BACKUP_ROOT;
    const rootId = (await findFolder(token, folderId, rootName)) ?? (await createFolder(token, folderId, rootName));
    const caches = new Map<string, Promise<FolderCache>>();
    const foldersFor = (bucket: string) => {
      let c = caches.get(bucket);
      if (!c) {
        const fc = new FolderCache(token, bucket, rootId);
        c = fc.load().then(() => fc);
        caches.set(bucket, c);
      }
      return c;
    };

    // 4) 동시 3개 — 240초가 지나면 새 파일은 시작하지 않음
    let next = 0;
    const one = async ({ bucket, f }: Todo) => {
      const prev = itemsBy.get(bucket)?.get(f.name);
      const dl = await supabaseAdmin.storage.from(bucket).download(f.name);
      if (dl.error || !dl.data) throw new Error(`원본 읽기 실패: ${dl.error?.message ?? "데이터 없음"}`);
      const bytes = Buffer.from(await dl.data.arrayBuffer());
      const mime = dl.data.type || "application/octet-stream";
      const slash = f.name.lastIndexOf("/");
      const parentId = await (await foldersFor(bucket)).get(slash >= 0 ? f.name.slice(0, slash) : "");
      const fileName = f.name.slice(slash + 1);

      let driveId = prev?.drive_file_id ?? null;
      if (driveId) {
        try {
          await uploadRevision(token, driveId, mime, bytes);
        } catch (e) {
          // 드라이브 쪽 파일이 지워졌으면 새로 만듭니다.
          if ((e as { status?: number }).status !== 404) throw e;
          driveId = null;
        }
      }
      const isNew = !driveId;
      if (!driveId) driveId = await uploadNew(token, parentId, fileName, mime, bytes);

      const { error } = await supabaseAdmin.from("file_backup_items").upsert(
        {
          bucket,
          object_path: f.name,
          size_bytes: f.size,
          etag: f.etag,
          object_updated_at: f.updated_at,
          drive_file_id: driveId,
          backed_up_at: new Date().toISOString(),
          revision_count: prev ? prev.revision_count + 1 : 1,
          source_missing_at: null,
        },
        { onConflict: "bucket,object_path" }
      );
      if (error) throw new Error(`기록 실패: ${error.message}`);
      if (prev && !isNew) s.updated++;
      else s.uploaded++;
      s.bytesUploaded += bytes.length;
    };
    const worker = async () => {
      while (next < todo.length && Date.now() - started < BUDGET_MS) {
        const t = todo[next++];
        try {
          await one(t);
        } catch (e) {
          s.failed.push({ path: `${t.bucket}/${t.f.name}`, message: e instanceof Error ? e.message : String(e) });
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    s.remaining = todoAll.length - s.uploaded - s.updated - s.failed.length;

    if (s.failed.length > 0) {
      s.ok = false;
      s.errorMessage = `파일 ${s.failed.length}개 실패(다음 실행에서 재시도): ${s.failed
        .slice(0, 10)
        .map((x) => `${x.path} — ${x.message}`)
        .join(" / ")}`;
    }
    await finish(s.failed.length > 0 || s.remaining > 0 ? "partial" : "success");
    if (s.failed.length > 0 && notify) {
      await notifyFailure(
        `🚨 파일 백업 일부 실패 — ${s.failed.length}개(다음 실행에서 재시도). 올림 ${s.uploaded} · 새 버전 ${s.updated} · 남음 ${s.remaining}\n` +
          `예: ${s.failed[0].path} — ${s.failed[0].message}`.slice(0, 600)
      );
    }
    return s;
  } catch (e) {
    s.ok = false;
    s.errorMessage = e instanceof Error ? e.message : String(e);
    await finish("failed");
    if (notify) await notifyFailure(`🚨 파일 백업 실패 — ${s.errorMessage}\n트리거: ${input.triggeredBy}`);
    return s;
  }
}
