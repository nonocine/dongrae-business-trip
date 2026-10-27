// =====================================================================
// 방과후아카데미(동래방카) 콘텐츠 — 공지·알림장 / 급식 / 연간일정 (순수 모듈)
//
//   보호자 앱 동래방카가 같은 Supabase 의 bk_posts·bk_post_files·bk_meals·
//   bk_events 를 읽습니다. 작성·수정·삭제는 동업자씨(직원)에서만.
//   파일은 비공개 버킷 bangka-media — 보호자에게는 동래방카 서버가 서명 URL 로만.
//   클라이언트에서도 쓰는 순수 모듈입니다(서버 전용 import·환경변수 금지).
// =====================================================================

export const BANGKA_MEDIA_BUCKET = "bangka-media";

// --- 게시물 ------------------------------------------------------------
export const BK_POST_TYPES = ["notice", "class_note", "monthly_plan"] as const;
export type BkPostType = (typeof BK_POST_TYPES)[number];
export const BK_POST_TYPE_LABEL: Record<BkPostType, string> = {
  notice: "공지",
  class_note: "알림장",
  monthly_plan: "월간 수업안",
};
export const isBkPostType = (v: unknown): v is BkPostType => (BK_POST_TYPES as readonly unknown[]).includes(v);

// 대상(게시물·일정 공용). 반 코드는 lib/bangka 의 ieum/jieum 과 같습니다.
export const BK_SCOPES = ["all", "ieum", "jieum"] as const;
export type BkScope = (typeof BK_SCOPES)[number];
export const BK_SCOPE_LABEL: Record<BkScope, string> = { all: "전체", ieum: "이음반", jieum: "지음반" };
export const isBkScope = (v: unknown): v is BkScope => (BK_SCOPES as readonly unknown[]).includes(v);

// --- 첨부 ----------------------------------------------------------------
export type BkFileKind = "image" | "video" | "doc";
export const BK_FILE_KIND_LABEL: Record<BkFileKind, string> = { image: "사진", video: "동영상", doc: "문서" };

// 이미지는 서버에서 긴 변 1600px 로 줄입니다(원본은 보관하지 않음).
export const BK_IMAGE_MAX_EDGE = 1600;

// 목록·홈용 축소본 — 원본 옆에 "<원본에서 확장자 뺀 것>.thumb.webp"(가로 400px).
//   보호자 앱(동래방카 lib/content.ts thumbPathOf)과 같은 규칙이어야 합니다.
export const BK_THUMB_WIDTH = 400;
export function thumbPathOf(path: string): string {
  return path.replace(/\.[a-z0-9]{1,6}$/i, "") + ".thumb.webp";
}
// 올리기 전 원본 상한 — 버킷 한도(100MB) 안에서 종류별로.
export const BK_MAX_BYTES: Record<BkFileKind, number> = {
  image: 30 * 1024 * 1024,
  video: 100 * 1024 * 1024,
  doc: 30 * 1024 * 1024,
};

const DOC_EXT = ["pdf", "hwp", "hwpx", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "zip"];
const IMAGE_EXT = ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"];
const VIDEO_EXT = ["mp4", "mov", "m4v", "webm", "3gp"];

export function extOf(name: string): string {
  const m = (name ?? "").toLowerCase().match(/\.([a-z0-9]{1,6})$/);
  return m ? m[1] : "";
}

// 파일 종류 판정 — mime 우선, 비면(일부 폰·한글 문서) 확장자로. 못 정하면 null.
export function bkFileKind(name: string, mime: string): BkFileKind | null {
  const m = (mime ?? "").toLowerCase();
  const ext = extOf(name);
  if (m.startsWith("image/") || IMAGE_EXT.includes(ext)) return "image";
  if (m.startsWith("video/") || VIDEO_EXT.includes(ext)) return "video";
  if (DOC_EXT.includes(ext) || m === "application/pdf") return "doc";
  return null;
}

export function fmtBytes(n: number | null | undefined): string {
  if (n == null) return "-";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

// --- 날짜·시각 (KST) ------------------------------------------------------
// ISO → datetime-local 입력값("2026-10-21T14:05", KST).
export function isoToKstInput(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16);
}
// datetime-local(KST) → ISO. 형식이 틀리면 null.
export function kstInputToIso(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v ?? "")) return null;
  const t = Date.parse(`${v}:00+09:00`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
export function fmtKstShort(iso: string): string {
  return isoToKstInput(iso).replace("T", " ");
}

// "2026-11" 의 날짜 칸(일요일 시작 달력, 앞뒤 빈칸 null).
export function monthGrid(ym: string): (string | null)[] {
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = Array(first).fill(null);
  for (let d = 1; d <= days; d++) cells.push(`${ym}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function isYm(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

export function shiftYm(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

// --- 급식 일괄 입력 붙여넣기 -------------------------------------------------
//   위탁업체 월간 식단표(엑셀)에서 "날짜 [탭] 메뉴" 를 복사해 붙여 넣습니다.
//   · 날짜: 2026-11-03 / 2026.11.3 / 11/3 / 11.3 / 11월 3일 / 3일 / 3 — 연·월이 없으면
//     고른 달 기준. (요일 글자 "(화)" 는 무시)
//   · 메뉴: 날짜 다음 칸 모두를 줄바꿈으로 이어 붙입니다(칸마다 한 줄). 엑셀 셀 안
//     줄바꿈(따옴표로 감싸져 복사됨)도 그대로 살립니다.
//   · 같은 날짜가 두 번 나오면 뒤의 것이 아니라 오류로 알려 줍니다.
export type BkMealLine = { line: number; date: string | null; dateRaw: string; menu: string; errors: string[] };

// 엑셀 TSV — 따옴표로 감싼 셀 안의 탭·줄바꿈·"" 를 처리합니다.
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = (text ?? "").replace(/\r\n?/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === "\t") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function parseMealDate(raw: string, ym: string): string | null {
  const s = (raw ?? "").replace(/\(.*?\)/g, "").replace(/[요일월화수목금토일]$/u, "").trim();
  const [cy, cm] = ym.split("-").map(Number);
  let y = cy;
  let m = cm;
  let d: number;
  let mm: RegExpMatchArray | null;
  if ((mm = s.match(/^(\d{4})[-./\s]+(\d{1,2})[-./\s]+(\d{1,2})\.?$/))) [y, m, d] = [+mm[1], +mm[2], +mm[3]];
  else if ((mm = s.match(/^(\d{1,2})\s*월\s*(\d{1,2})\s*일?$/))) [m, d] = [+mm[1], +mm[2]];
  else if ((mm = s.match(/^(\d{1,2})[./-](\d{1,2})\.?$/))) [m, d] = [+mm[1], +mm[2]];
  else if ((mm = s.match(/^(\d{1,2})\s*일?$/))) d = +mm[1];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseMealPaste(text: string, ym: string): BkMealLine[] {
  const out: BkMealLine[] = [];
  const seen = new Map<string, number>();
  parseTsv(text).forEach((cells, i) => {
    if (cells.every((c) => c.trim() === "")) return;
    const dateRaw = (cells[0] ?? "").trim();
    if (i === 0 && /날짜|일자/.test(dateRaw)) return; // 머리글
    const menu = cells
      .slice(1)
      .flatMap((c) => c.split("\n"))
      .map((l) => l.trim())
      .filter(Boolean)
      .join("\n");
    const date = parseMealDate(dateRaw, ym);
    const errors: string[] = [];
    if (!date) errors.push(`날짜를 읽지 못했습니다("${dateRaw}")`);
    if (!menu) errors.push("메뉴가 비었습니다");
    if (date && seen.has(date)) errors.push(`${seen.get(date)}번째 줄과 날짜가 같습니다`);
    if (date && !seen.has(date)) seen.set(date, i + 1);
    out.push({ line: i + 1, date, dateRaw, menu, errors });
  });
  return out;
}

// --- 화면 행 타입 ---------------------------------------------------------
export type BkPostRow = {
  id: string;
  post_type: BkPostType;
  scope: BkScope;
  title: string;
  is_pinned: boolean;
  published_at: string;
  author_name: string | null;
  file_count: number;
  read_count: number;
  target_count: number; // 대상 반 재원생에 연결된 '사용중' 보호자 수
  scheduled: boolean; // 게시일이 미래(예약)
};

export type BkPostFile = {
  id: string;
  kind: BkFileKind;
  name: string | null;
  mime: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  url: string | null; // 1시간 서명 URL(미리보기용)
};

export type BkPostDetail = {
  id: string;
  post_type: BkPostType;
  scope: BkScope;
  title: string;
  body: string | null;
  is_pinned: boolean;
  published_at: string;
  author_name: string | null;
  files: BkPostFile[];
};

export type BkMealRow = {
  meal_date: string;
  menu_text: string;
  allergy_note: string | null;
  photo_url: string | null; // 1시간 서명 URL
};

export type BkEventRow = {
  id: string;
  title: string;
  start_date: string;
  end_date: string | null;
  scope: BkScope;
  memo: string | null;
};
