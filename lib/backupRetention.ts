// =====================================================================
// 백업 ZIP 보관 규칙 (2026-10 관장 승인) — 테이블 백업이 성공한 뒤에만 정리합니다.
//   남기는 것: 최근 8주(56일) 안의 모든 백업
//            + 최근 12개월(이번 달 포함) 각 달의 첫 백업
//            + 매년 첫 백업(영구)
//   그 밖의 "동업자씨_백업_*.zip" 은 휴지통으로 보냅니다(공유 드라이브 휴지통 30일 —
//   영구 삭제가 아니라 그 안에는 되살릴 수 있음).
//   * 이름이 규칙(backupFileName)과 다른 파일, 방금 올린 파일은 절대 건드리지 않습니다.
//   * RETENTION_LIVE_FROM(KST) 전에는 지울 대상만 계산해 보고(dry-run)합니다 —
//     처음 적용은 보고만, 실제 정리는 그다음 주 백업부터(관장 지시).
//   * 드라이브 인증은 호출부(lib/backupEngine.driveAuth)가 넘깁니다(순환 import 방지).
// =====================================================================

export const RETENTION_LIVE_FROM = "2026-10-25"; // 이 날(KST) 이후 백업부터 실제 정리
const RECENT_DAYS = 56;
const MONTHS_KEPT = 12;
const NAME_RE = /^동업자씨_백업_(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})\.zip$/;

export type ZipFile = { id: string; name: string; size?: number };
export type RetentionPlan = {
  keep: { file: ZipFile; reasons: string[] }[];
  remove: ZipFile[];
  ignored: ZipFile[]; // 이름 규칙 밖 — 건드리지 않음
};

// "동업자씨_백업_2026-10-02_0300.zip" → KST 시각을 UTC ms 로. 규칙 밖이면 null.
function kstMs(name: string): number | null {
  const m = name.match(NAME_RE);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - 9 * 3600 * 1000;
}

const kstParts = (ms: number) => {
  const d = new Date(ms + 9 * 3600 * 1000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
};

export function planRetention(files: ZipFile[], now: Date, protectIds: string[] = []): RetentionPlan {
  const dated = files
    .map((f) => ({ f, at: kstMs(f.name) }))
    .filter((x): x is { f: ZipFile; at: number } => x.at !== null)
    .sort((a, b) => a.at - b.at || a.f.name.localeCompare(b.f.name));
  const ignored = files.filter((f) => kstMs(f.name) === null);

  const reasons = new Map<string, string[]>();
  const add = (id: string, r: string) => reasons.set(id, [...(reasons.get(id) ?? []), r]);

  const nowMs = now.getTime();
  const { y: ny, m: nm } = kstParts(nowMs);
  const recentMonths = new Set<string>();
  for (let i = 0; i < MONTHS_KEPT; i++) {
    const idx = ny * 12 + (nm - 1) - i;
    recentMonths.add(`${Math.floor(idx / 12)}-${(idx % 12) + 1}`);
  }
  const firstOfMonth = new Set<string>();
  const firstOfYear = new Set<number>();
  for (const { f, at } of dated) {
    if (nowMs - at <= RECENT_DAYS * 86400000) add(f.id, "최근 8주");
    const { y, m } = kstParts(at);
    const mk = `${y}-${m}`;
    if (recentMonths.has(mk) && !firstOfMonth.has(mk)) {
      firstOfMonth.add(mk);
      add(f.id, `${y}년 ${m}월 첫 백업`);
    }
    if (!firstOfYear.has(y)) {
      firstOfYear.add(y);
      add(f.id, `${y}년 첫 백업`);
    }
    if (protectIds.includes(f.id)) add(f.id, "방금 올린 백업");
  }
  return {
    keep: dated.filter(({ f }) => reasons.has(f.id)).map(({ f }) => ({ file: f, reasons: reasons.get(f.id)! })),
    remove: dated.filter(({ f }) => !reasons.has(f.id)).map(({ f }) => f),
    ignored,
  };
}

// 백업 위치(공유 드라이브/폴더) 바로 아래의 백업 ZIP 목록.
export async function listBackupZips(token: string, folderId: string): Promise<ZipFile[]> {
  const out: ZipFile[] = [];
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false and name contains '동업자씨_백업_'`);
  let pageToken = "";
  for (;;) {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&corpora=allDrives&supportsAllDrives=true&includeItemsFromAllDrives=true` +
        `&pageSize=1000&fields=nextPageToken,files(id,name,size)${pageToken ? `&pageToken=${pageToken}` : ""}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`백업 목록 조회 실패(${res.status})`);
    const j = (await res.json()) as { nextPageToken?: string; files?: { id: string; name: string; size?: string }[] };
    for (const f of j.files ?? []) out.push({ id: f.id, name: f.name, size: f.size ? Number(f.size) : undefined });
    if (!j.nextPageToken) break;
    pageToken = encodeURIComponent(j.nextPageToken);
  }
  return out;
}

export function retentionIsLive(now: Date): boolean {
  const kstDay = new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  return kstDay >= RETENTION_LIVE_FROM;
}

export type RetentionResult = { live: boolean; plan: RetentionPlan; trashed: string[]; failed: string[] };

// 정리 실행. live=false 면 계획만 돌려줍니다(드라이브에 쓰지 않음).
export async function applyRetention(input: {
  token: string;
  folderId: string;
  now: Date;
  protectIds: string[];
  live: boolean;
}): Promise<RetentionResult> {
  const plan = planRetention(await listBackupZips(input.token, input.folderId), input.now, input.protectIds);
  const trashed: string[] = [];
  const failed: string[] = [];
  if (input.live) {
    for (const f of plan.remove) {
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?supportsAllDrives=true`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${input.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ trashed: true }),
      });
      (res.ok ? trashed : failed).push(f.name);
    }
  }
  return { live: input.live, plan, trashed, failed };
}

// backup_logs 한 줄 — 정상이면 notes, 휴지통 보내기 실패가 있으면 error_message(lib/backupEngine).
export function retentionNote(r: RetentionResult): string {
  const names = (list: string[]) => (list.length ? `: ${list.join(", ")}` : "");
  if (!r.live) {
    return `보관 정리(미리보기 — ${RETENTION_LIVE_FROM} 부터 실제 정리) 지울 대상 ${r.plan.remove.length}개${names(r.plan.remove.map((f) => f.name))}`;
  }
  const head = `보관 정리 — 휴지통으로 보냄 ${r.trashed.length}개${names(r.trashed)}`;
  return r.failed.length ? `${head} / 실패 ${r.failed.length}개${names(r.failed)}` : head;
}
