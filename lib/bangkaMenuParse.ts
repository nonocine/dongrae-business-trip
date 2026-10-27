// =====================================================================
// 위탁업체 주간 식단표(엑셀) 해석 — 순수 함수(서버·브라우저 공용, 서버 전용 import 금지).
//   · 엑셀 파일 → 칸 격자는 lib/bangkaMenuXlsx(서버)가 만들고, 여기서는 격자만 봅니다.
//   · 행·열 위치를 고정하지 않습니다. 업체가 행을 늘려도 되도록 글자로 찾습니다.
//       제목  "2026년 10월 다섯째주 …"  → 연·월
//       날짜행 "26(월)" "27(화)" …       → 날짜 열(3칸 이상 나오는 첫 행)
//       구분열 날짜 열 바로 왼쪽 열        → 밥·국·주찬… (날짜행 ~ "영양표시" 행 사이)
//       "영양표시" 행  "676/16/255/4"     → kcal / 단백질% / 칼슘mg / 철분mg
//       "알레르기"·"원산지표시" 글자        → 번호표·원산지 원문
//   · 메뉴 끝 숫자 = 알레르기 번호(쉼표 구분). 숫자 뒤에 단위(개·장·g·ml…)가 붙으면
//     수량이라 알레르기가 아닙니다("도시락김1개"). "/" 는 메뉴의 일부입니다.
//   · 사람이 확인할 칸(번호가 1~19 밖, 이름에 숫자가 남음 등)은 warn 으로 표시만 하고
//     저장은 막지 않습니다(미리보기에서 노란 칸 → 직원이 고침).
// =====================================================================

export const BK_ALLERGENS: Record<number, string> = {
  1: "난류",
  2: "우유",
  3: "메밀",
  4: "땅콩",
  5: "대두",
  6: "밀",
  7: "고등어",
  8: "게",
  9: "새우",
  10: "돼지고기",
  11: "복숭아",
  12: "토마토",
  13: "아황산류",
  14: "호두",
  15: "닭고기",
  16: "쇠고기",
  17: "오징어",
  18: "조개류(굴·전복·홍합 포함)",
  19: "잣",
};
export const BK_ALLERGEN_MAX = 19;

export type BkMenuItem = { slot: string; name: string; allergens: number[]; raw: string };
export type BkParsedCell = BkMenuItem & { warn: string | null };

export type BkNutrition = { kcal: number | null; protein_pct: number | null; calcium_mg: number | null; iron_mg: number | null };

export type BkParsedDay = {
  col: number; // 원본 열(0부터) — 미리보기 표시용
  label: string; // 날짜 칸 원문 "26(월)"
  date: string | null; // YYYY-MM-DD, 날짜 칸이 비면 null
  items: BkParsedCell[]; // 구분 행 순서. 빈 칸은 빼지 않고 name "" 로 둡니다(표 모양 유지).
  nutritionRaw: string;
  nutrition: BkNutrition;
  nutritionWarn: string | null;
  hasMeal: boolean; // 날짜가 있고 메뉴가 하나라도 있으면 true
};

export type BkParsedWeek = {
  title: string;
  year: number | null;
  month: number | null;
  dietitian: string | null;
  vendor: string | null;
  nutritionBasis: string | null;
  allergenLegend: string | null;
  originText: string | null;
  slots: string[];
  slotRows: number[]; // 구분 행의 격자 행 번호(0부터) — 미리보기에서 칸 고치기용
  nutritionRow: number; // 없으면 -1
  days: BkParsedDay[];
  errors: string[]; // 저장을 막는 문제(제목·날짜행 못 찾음 등)
  warnings: string[]; // 알려만 주는 문제(요일 불일치 등)
};

const norm = (s: string) => s.replace(/\s+/g, "");
const clean = (s: string) => s.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();

// 수량 단위 — 숫자 바로 뒤에 오면 알레르기 번호가 아니라 이름의 일부입니다.
const UNIT_TAIL = /^(개|장|g|kg|ml|mL|l|L|인|조각|봉|팩|줄|알|입|컵|cc|%)/;

// 메뉴 칸 하나 → 이름 + 알레르기 번호.
export function parseMenuCell(slot: string, rawIn: string): BkParsedCell {
  const raw = clean(rawIn).replace(/\n+/g, " ");
  if (!raw) return { slot, name: "", allergens: [], raw: "", warn: null };
  // 끝의 "숫자(,숫자)*" — 숫자 사이 구분은 쉼표(전각·마침표 섞인 경우도 받아서 경고).
  const m = raw.match(/^(.*?[^\d\s,.，])\s*(\d{1,3}(?:\s*[,.，]\s*\d{1,3})*)\s*$/);
  if (!m) {
    const warn = /\d/.test(raw) && !hasUnitNumber(raw) ? "이름에 숫자가 있습니다 — 알레르기 번호인지 확인" : null;
    return { slot, name: raw, allergens: [], raw, warn };
  }
  const name = m[1].trim();
  const sepOdd = /[.，]/.test(m[2]);
  const nums = m[2].split(/[,.，]/).map((x) => Number(x.trim()));
  const bad = nums.filter((n) => !Number.isInteger(n) || n < 1 || n > BK_ALLERGEN_MAX);
  const allergens = [...new Set(nums.filter((n) => n >= 1 && n <= BK_ALLERGEN_MAX))];
  let warn: string | null = null;
  if (bad.length) warn = `알레르기 번호 ${bad.join(",")} 는 1~${BK_ALLERGEN_MAX} 밖입니다`;
  else if (sepOdd) warn = "번호 구분이 쉼표가 아닙니다 — 확인";
  else if (/\d/.test(name) && !hasUnitNumber(name)) warn = "이름에 숫자가 남아 있습니다 — 확인";
  return { slot, name, allergens, raw, warn };
}

function hasUnitNumber(s: string): boolean {
  const re = /\d+/g;
  let x: RegExpExecArray | null;
  let any = false;
  while ((x = re.exec(s))) {
    any = true;
    if (!UNIT_TAIL.test(s.slice(x.index + x[0].length))) return false;
  }
  return any;
}

// "676/16/255/4" → 숫자 넷. 빈 칸은 모두 null(경고 없음).
export function parseNutrition(rawIn: string): { nutrition: BkNutrition; warn: string | null } {
  const raw = clean(rawIn);
  const empty = { kcal: null, protein_pct: null, calcium_mg: null, iron_mg: null };
  if (!raw) return { nutrition: empty, warn: null };
  const parts = raw.split("/").map((x) => x.trim());
  const nums = parts.map((x) => (/^\d+(\.\d+)?$/.test(x) ? Number(x) : null));
  if (parts.length !== 4 || nums.some((n) => n === null)) {
    const k = nums[0];
    return {
      nutrition: { ...empty, kcal: k != null ? Math.round(k) : null },
      warn: "영양표시가 'kcal/단백질/칼슘/철분' 형식이 아닙니다",
    };
  }
  return {
    nutrition: { kcal: Math.round(nums[0]!), protein_pct: nums[1], calcium_mg: nums[2], iron_mg: nums[3] },
    warn: null,
  };
}

const DAY_RE = /^(\d{1,2})\s*[(（]\s*([월화수목금토일])\s*[)）]/;
const WD = ["일", "월", "화", "수", "목", "금", "토"];
const p2 = (n: number) => String(n).padStart(2, "0");

function weekdayOf(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null; // 2월 30일 같은 없는 날
  return WD[dt.getUTCDay()];
}
function shiftMonth(y: number, m: number, delta: number): [number, number] {
  const i = y * 12 + (m - 1) + delta;
  return [Math.floor(i / 12), (i % 12) + 1];
}

// 격자(행 × 열 문자열) → 한 주 식단.
export function parseVendorWeek(grid: string[][]): BkParsedWeek {
  const cell = (r: number, c: number) => clean(grid[r]?.[c] ?? "");
  const errors: string[] = [];
  const warnings: string[] = [];
  const all: { r: number; c: number; t: string }[] = [];
  grid.forEach((row, r) => row.forEach((_, c) => cell(r, c) && all.push({ r, c, t: cell(r, c) })));

  // 제목 — "YYYY년 M월" 이 있는 첫 칸.
  const titleHit = all.find((x) => /(\d{4})\s*년\s*(\d{1,2})\s*월/.test(x.t));
  const tm = titleHit?.t.match(/(\d{4})\s*년\s*(\d{1,2})\s*월/);
  const year = tm ? Number(tm[1]) : null;
  const month = tm ? Number(tm[2]) : null;
  if (!tm) errors.push("제목에서 'YYYY년 M월' 을 찾지 못했습니다.");

  const dietHit = all.find((x) => /영양사\s*[:：]/.test(x.t));
  const dietitian = dietHit ? dietHit.t.replace(/^.*영양사\s*[:：]\s*/, "").trim() || null : null;

  // 날짜행 — "26(월)" 꼴 칸이 3개 이상인 첫 행.
  let headerRow = -1;
  for (let r = 0; r < grid.length && headerRow < 0; r++) {
    if ((grid[r] ?? []).filter((_, c) => DAY_RE.test(cell(r, c))).length >= 3) headerRow = r;
  }
  if (headerRow < 0) {
    errors.push("날짜 행('26(월)' 같은 칸)을 찾지 못했습니다.");
    return { title: titleHit?.t ?? "", year, month, dietitian, vendor: null, nutritionBasis: null, allergenLegend: null, originText: null, slots: [], slotRows: [], nutritionRow: -1, days: [], errors, warnings };
  }
  const hdr = grid[headerRow] ?? [];
  // 날짜 열 — 첫 날짜 칸부터 "비고" 앞까지. 중간의 빈 날짜 칸도 열로 둡니다(급식 없음).
  const dateCols: number[] = [];
  const firstDateCol = hdr.findIndex((_, c) => DAY_RE.test(cell(headerRow, c)));
  for (let c = firstDateCol; c < hdr.length; c++) {
    const t = cell(headerRow, c);
    if (norm(t) === "비고") break;
    if (!t && !DAY_RE.test(cell(headerRow, c + 1)) && c > firstDateCol) {
      // 뒤에 날짜 칸이 더 없으면 끝.
      if (!hdr.slice(c + 1).some((_, k) => DAY_RE.test(cell(headerRow, c + 1 + k)))) break;
    }
    dateCols.push(c);
  }
  const labelCol = firstDateCol - 1;

  // 영양표시 행 — 구분열(또는 그 왼쪽)에 "영양표시" 라고 쓴 날짜행 아래 첫 행.
  let nutRow = -1;
  for (let r = headerRow + 1; r < grid.length && nutRow < 0; r++) {
    for (let c = 0; c <= Math.max(labelCol, 0); c++) if (norm(cell(r, c)) === "영양표시") nutRow = r;
  }
  if (nutRow < 0) warnings.push("'영양표시' 행을 찾지 못했습니다 — 열량 없이 저장됩니다.");
  const menuEnd = nutRow < 0 ? findMenuEnd(grid, headerRow, labelCol) : nutRow;

  const slotRows: number[] = [];
  for (let r = headerRow + 1; r < menuEnd; r++) if (labelCol >= 0 && cell(r, labelCol)) slotRows.push(r);
  if (!slotRows.length) errors.push("밥·국 같은 구분 행을 찾지 못했습니다.");
  const slots = slotRows.map((r) => cell(r, labelCol));

  // 날짜 — 첫 날짜 칸의 요일이 맞는 달(제목 달, 앞 달, 다음 달 순)을 고르고,
  //   일이 앞 칸보다 작아지면 다음 달로 넘깁니다(월말을 넘는 주).
  let cy = year ?? 0;
  let cm = month ?? 0;
  if (year && month) {
    const first = dateCols.map((c) => cell(headerRow, c).match(DAY_RE)).find(Boolean);
    if (first) {
      const d = Number(first[1]);
      const fit = [0, -1, 1].map((k) => shiftMonth(year, month, k)).find(([yy, mm]) => weekdayOf(yy, mm, d) === first[2]);
      if (fit) [cy, cm] = fit;
      else warnings.push(`${first[0]} 의 요일이 ${year}년 ${month}월 달력과 맞지 않습니다 — 날짜를 확인하세요.`);
    }
  }
  let prevDay = 0;
  const days: BkParsedDay[] = dateCols.map((c) => {
    const label = cell(headerRow, c);
    const dm = label.match(DAY_RE);
    let date: string | null = null;
    if (dm && year && month) {
      const d = Number(dm[1]);
      if (prevDay && d < prevDay) [cy, cm] = shiftMonth(cy, cm, 1);
      prevDay = d;
      const wd = weekdayOf(cy, cm, d);
      if (!wd) warnings.push(`${label}: ${cy}년 ${cm}월에 없는 날짜입니다.`);
      else {
        date = `${cy}-${p2(cm)}-${p2(d)}`;
        if (wd !== dm[2]) warnings.push(`${label}: 달력상 ${wd}요일입니다 — 날짜를 확인하세요.`);
      }
    } else if (label) warnings.push(`날짜 칸 '${label}' 을 읽지 못했습니다.`);
    const items = slotRows.map((r, i) => parseMenuCell(slots[i], cell(r, c)));
    const nutritionRaw = nutRow >= 0 ? cell(nutRow, c) : "";
    const { nutrition, warn } = parseNutrition(nutritionRaw);
    const hasMeal = !!date && items.some((it) => it.name);
    return { col: c, label, date, items, nutritionRaw, nutrition, nutritionWarn: warn, hasMeal };
  });
  const dates = days.map((d) => d.date).filter(Boolean);
  if (new Set(dates).size !== dates.length) errors.push("같은 날짜가 두 번 나옵니다.");
  if (!days.some((d) => d.hasMeal)) errors.push("메뉴가 있는 날이 없습니다.");

  // 아래쪽 안내 — 원문을 그대로 보관(학부모 화면 하단·출력용).
  //   영양표시 기준·알레르기 번호표는 여러 행에 걸쳐 쓰여 있으므로 "원산지표시" 앞까지의
  //   본문 칸(구분열 오른쪽)을 줄로 모은 뒤 "알레르기" 줄을 경계로 나눕니다.
  const below = all.filter((x) => x.r > menuEnd);
  const originStart = below.find((x) => norm(x.t) === "원산지표시")?.r ?? Infinity;
  const infoLines = below
    .filter((x) => x.r < originStart && x.c > labelCol && !/㈜|\(주\)|tel/i.test(x.t))
    .map((x) => x.t);
  const allergyAt = infoLines.findIndex((t) => /알레르기/.test(t));
  const heading = (t: string) => /^\*.*\*$/.test(t.trim());
  const joinBody = (ls: string[]) => ls.filter((t) => !heading(t)).join("\n").trim() || null;
  const basisLines = allergyAt < 0 ? infoLines : infoLines.slice(0, allergyAt);
  const legendLines = allergyAt < 0 ? [] : infoLines.slice(allergyAt);
  const originRows = new Set<number>();
  for (const x of below) if (norm(x.t) === "원산지표시") {
    // 세로 병합 칸: 같은 열 아래로 이어지는 행들(라벨이 비어 있는 동안)도 원산지입니다.
    originRows.add(x.r);
    for (let r = x.r + 1; r < grid.length && !cell(r, x.c) && !/㈜|\(주\)|tel/i.test(grid[r]?.join(" ") ?? ""); r++) originRows.add(r);
  }
  const originText =
    [...originRows]
      .sort((a, b) => a - b)
      .flatMap((r) => (grid[r] ?? []).map((_, c) => cell(r, c)).filter((t) => t && norm(t) !== "원산지표시" && t.length > 4))
      .join("\n") || null;
  const vendorHit = [...all].reverse().find((x) => /㈜|\(주\)|tel/i.test(x.t));

  return {
    title: titleHit?.t ?? "",
    year,
    month,
    dietitian,
    vendor: vendorHit?.t ?? null,
    nutritionBasis: joinBody(basisLines),
    allergenLegend: joinBody(legendLines),
    originText,
    slots,
    slotRows,
    nutritionRow: nutRow,
    days,
    errors,
    warnings,
  };
}

// 영양표시 행이 없을 때 — 구분열이 비는 첫 행에서 메뉴가 끝난다고 봅니다.
function findMenuEnd(grid: string[][], headerRow: number, labelCol: number): number {
  for (let r = headerRow + 1; r < grid.length; r++) if (!clean(grid[r]?.[labelCol] ?? "")) return r;
  return grid.length;
}

// 그날 알레르기 이름 모음(번호순, 중복 없음) — bk_meals.allergy_note.
export function allergyNoteOf(items: BkMenuItem[]): string | null {
  const nums = [...new Set(items.flatMap((i) => i.allergens))].sort((a, b) => a - b);
  return nums.length ? nums.map((n) => BK_ALLERGENS[n] ?? String(n)).join(", ") : null;
}

// 저장용 메뉴 목록 — 빈 칸은 뺍니다(업체 표 행 순서 유지).
export function menuItemsOf(day: BkParsedDay): BkMenuItem[] {
  return day.items.filter((i) => i.name).map(({ slot, name, allergens, raw }) => ({ slot, name, allergens, raw }));
}

// 월요일 "YYYY-MM-DD"(그 주 첫 날짜 기준).
export function mondayOfYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  return `${dt.getUTCFullYear()}-${p2(dt.getUTCMonth() + 1)}-${p2(dt.getUTCDate())}`;
}
