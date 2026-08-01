// =====================================================================
// SA-18. ERP 신청자 명단(xlsx) 파싱 + 프로그램 자동 매칭 (수강생 명단 업로드)
//   * 입력: ERP에서 내려받은 xlsx (1행 머리글, 신청 1건 = 1행).
//   * 출력: (프로그램명, 수업시간) 그룹별 수강생 목록 + saem_programs 매칭 후보.
//
//   ⚠ 개인정보 최소화(절대 준수) — 파서가 밖으로 내보내는 학생 필드는 7개뿐:
//       erp_no · student_name · school · grade · contact · emergency_contact
//       (+ seq_no 는 저장 직전 가나다순으로 부여)
//     생년월일·성별·장애여부·환불계좌·회원ID 는 읽더라도 결과에 담지 않는다.
//   ⚠ 상태가 "예약 확정" 인 행만 반영. 취소 건은 excluded 로만 집계한다.
//
//   * @/ 별칭·DB 의존 없음 → scripts/test-saem-enrollment.ts 로 단독 테스트 가능.
// =====================================================================

import * as XLSX from "xlsx";

// --- 학생(저장 대상 필드만) -------------------------------------------
export type ErpStudent = {
  erp_no: string;
  student_name: string;
  school: string | null;
  grade: string | null;
  contact: string | null;
  emergency_contact: string | null;
};

// 제외된 신청(취소 등) — 이름/상태만 보여주고 저장하지 않는다.
export type ErpExcluded = {
  erp_no: string;
  student_name: string;
  status: string;
};

// --- (프로그램명, 수업시간) 그룹 --------------------------------------
export type ErpGroup = {
  key: string; // 정규화된 그룹 키(화면·적용 요청의 식별자)
  rawProgramName: string; // 파일 원문 "두둠칫 댄스교실 (10:00~11:20)"
  baseName: string; // 시간 접미 제거 "두둠칫 댄스교실"
  classTime: string | null; // 파일 원문 "10:00~11:20"
  timeStart: string | null; // "10:00"
  timeEnd: string | null; // "11:20"
  category: string | null;
  fileCapacity: number | null; // "13(13/0)" → 13 (참고용, 저장 안 함)
  students: ErpStudent[]; // 예약 확정만
  excluded: ErpExcluded[];
};

export type ErpParseResult = {
  sheetName: string;
  headerRowIndex: number; // 0-based. -1 = 머리글 못 찾음
  totalRows: number; // 머리글 아래 데이터 행 수
  confirmedRows: number; // 예약 확정
  excludedRows: number; // 취소 등
  groups: ErpGroup[];
  warnings: string[];
};

// =====================================================================
// 문자열 정규화 헬퍼
// =====================================================================
const txt = (v: unknown): string => (v == null ? "" : String(v).trim());

function nullable(v: unknown): string | null {
  const s = txt(v);
  return s.length ? s : null;
}

// 머리글/이름 비교용 — 공백 제거.
function squash(v: unknown): string {
  return txt(v).replace(/\s+/g, "");
}

// 프로그램명 비교용 — 공백·구분점 제거 + 소문자.
export function normalizeProgramName(v: unknown): string {
  return squash(v)
    .replace(/[·・.]/g, "")
    .toLowerCase();
}

// "[자격증반:ITQ 한글]톡톡 컴퓨터 교실" → "톡톡 컴퓨터 교실"
//   반(class) 접두 대괄호는 ERP·프로그램 표기가 갈릴 수 있어 2차 비교에 쓴다.
//   벗기면 빈 문자열이 되는 경우(이름 전체가 괄호)는 원문을 유지한다.
export function stripBracketPrefix(name: string): string {
  const stripped = txt(name).replace(/^\s*[[(【][^\])】]*[\])】]\s*/, "").trim();
  return stripped.length ? stripped : txt(name);
}

// 프로그램명 끝의 "(10:00~11:20)" 접미 제거.
const TIME_SUFFIX_RE =
  /\s*[（(]\s*(\d{1,2}:\d{1,2})\s*[~\-–—]\s*(\d{1,2}:\d{1,2})\s*[）)]\s*$/;
export function stripTimeSuffix(name: string): string {
  return txt(name).replace(TIME_SUFFIX_RE, "").trim();
}

// "9:00" → "09:00", "10:00:00" → "10:00".
function padHm(h: string, m: string): string {
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
}
export function toHm(v: unknown): string | null {
  const m = txt(v).match(/^(\d{1,2}):(\d{1,2})/);
  return m ? padHm(m[1], m[2]) : null;
}

// "10:00~11:20" / "10:00 - 11:20" → { start, end }.
export function parseTimeRange(v: unknown): {
  start: string | null;
  end: string | null;
} {
  const m = txt(v).match(/(\d{1,2}):(\d{1,2})\s*[~\-–—]\s*(\d{1,2}):(\d{1,2})/);
  if (!m) return { start: toHm(v), end: null };
  return { start: padHm(m[1], m[2]), end: padHm(m[3], m[4]) };
}

// "13(13/0)" → 13. 숫자를 못 찾으면 null.
export function parseCapacity(v: unknown): number | null {
  const m = txt(v).match(/\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

// 연락처 표기 통일 — 직원이 눌러 걸 수 있게 하이픈을 넣는다.
//   ERP는 연락처("010-3489-6698")와 비상연락처("01045758633") 표기가 섞여 온다.
//   자릿수를 못 알아보면 원문을 그대로 둔다(임의 가공 금지).
export function formatPhone(v: unknown): string | null {
  const raw = nullable(v);
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) {
    // 02 지역번호는 2자리.
    if (d.startsWith("02")) return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  }
  if (d.length === 9 && d.startsWith("02"))
    return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
  return raw;
}

// "예약 확정" 판정 — 공백 차이만 허용. 그 외 상태(취소·대기 등)는 전부 제외.
export function isConfirmedStatus(v: unknown): boolean {
  const s = squash(v);
  return s === "예약확정" || s === "확정";
}

// =====================================================================
// 머리글 매핑
// =====================================================================
// 읽어야 하는 열만 정의한다. "연락처"가 "비상연락처"의 부분문자열이므로
// 부분일치 추측을 쓰지 않고 정확 일치(공백 제거)만 인정한다.
const COLUMN_ALIASES = {
  erpNo: ["번호", "신청번호"],
  category: ["카테고리"],
  programName: ["프로그램명"],
  classTime: ["수업시간"],
  capacity: ["정원"],
  name: ["이름", "성명"],
  grade: ["소속(교급)", "소속", "교급"],
  contact: ["연락처", "휴대전화", "휴대폰"],
  emergency: ["비상연락처"],
  school: ["학교명", "학교"],
  status: ["상태"],
} as const;

type ColumnKey = keyof typeof COLUMN_ALIASES;
type ColumnMap = Partial<Record<ColumnKey, number>>;

// 머리글 필수 3종 — 이 행이 머리글인지 판별하는 기준.
const HEADER_MARKERS = ["번호", "프로그램명", "이름"];

function findHeaderRow(rows: unknown[][]): number {
  const limit = Math.min(rows.length, 20);
  for (let i = 0; i < limit; i++) {
    const cells = (rows[i] ?? []).map((c) => squash(c));
    if (HEADER_MARKERS.every((m) => cells.includes(m))) return i;
  }
  return -1;
}

function mapColumns(headerRow: unknown[]): ColumnMap {
  const cells = (headerRow ?? []).map((c) => squash(c));
  const map: ColumnMap = {};
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES) as [
    ColumnKey,
    readonly string[],
  ][]) {
    for (const alias of aliases) {
      const idx = cells.indexOf(squash(alias));
      if (idx >= 0) {
        map[key] = idx;
        break;
      }
    }
  }
  return map;
}

// =====================================================================
// 파싱
// =====================================================================
export function parseErpRows(
  rows: unknown[][],
  sheetName = "Sheet1"
): ErpParseResult {
  const warnings: string[] = [];
  const empty: ErpParseResult = {
    sheetName,
    headerRowIndex: -1,
    totalRows: 0,
    confirmedRows: 0,
    excludedRows: 0,
    groups: [],
    warnings,
  };

  const headerRowIndex = findHeaderRow(rows);
  if (headerRowIndex < 0) {
    warnings.push(
      "머리글(번호·프로그램명·이름)을 찾지 못했습니다. ERP 신청자 목록 엑셀인지 확인하세요."
    );
    return empty;
  }

  const cols = mapColumns(rows[headerRowIndex]);
  for (const key of ["erpNo", "programName", "name", "status"] as ColumnKey[]) {
    if (cols[key] == null)
      warnings.push(`필수 열 '${COLUMN_ALIASES[key][0]}'을 찾지 못했습니다.`);
  }
  if (cols.erpNo == null || cols.programName == null || cols.name == null)
    return { ...empty, headerRowIndex };
  if (cols.classTime == null)
    warnings.push(
      "'수업시간' 열이 없어 같은 이름의 다른 교시를 구분할 수 없습니다. 매칭을 직접 확인하세요."
    );

  const cell = (row: unknown[], key: ColumnKey): unknown => {
    const i = cols[key];
    return i == null ? null : row[i];
  };

  const groups = new Map<string, ErpGroup>();
  let totalRows = 0;
  let confirmedRows = 0;
  let excludedRows = 0;
  const seenErpNo = new Set<string>();

  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const erpNo = txt(cell(row, "erpNo"));
    const studentName = txt(cell(row, "name"));
    const rawProgramName = txt(cell(row, "programName"));
    // 완전 빈 행(엑셀 꼬리) 건너뛰기.
    if (!erpNo && !studentName && !rawProgramName) continue;
    totalRows++;

    if (!erpNo) {
      warnings.push(`${r + 1}행: 번호(ERP 신청번호)가 비어 건너뜁니다.`);
      continue;
    }
    if (!rawProgramName) {
      warnings.push(`${r + 1}행: 프로그램명이 비어 건너뜁니다. (번호 ${erpNo})`);
      continue;
    }
    if (seenErpNo.has(erpNo)) {
      warnings.push(`번호 ${erpNo}가 파일 안에 중복되어 뒤의 행을 건너뜁니다.`);
      continue;
    }
    seenErpNo.add(erpNo);

    const classTime = nullable(cell(row, "classTime"));
    const baseName = stripTimeSuffix(rawProgramName);
    // 수업시간 열이 없으면 프로그램명 접미에서 시간을 뽑아 쓴다.
    const suffixMatch = rawProgramName.match(TIME_SUFFIX_RE);
    const range = classTime
      ? parseTimeRange(classTime)
      : suffixMatch
        ? { start: toHm(suffixMatch[1]), end: toHm(suffixMatch[2]) }
        : { start: null, end: null };

    const key = `${normalizeProgramName(baseName)}|${range.start ?? ""}~${range.end ?? ""}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        rawProgramName,
        baseName,
        classTime: classTime ?? (suffixMatch ? `${range.start}~${range.end}` : null),
        timeStart: range.start,
        timeEnd: range.end,
        category: nullable(cell(row, "category")),
        fileCapacity: parseCapacity(cell(row, "capacity")),
        students: [],
        excluded: [],
      };
      groups.set(key, group);
    }

    const status = txt(cell(row, "status"));
    if (!isConfirmedStatus(status)) {
      excludedRows++;
      group.excluded.push({
        erp_no: erpNo,
        student_name: studentName,
        status: status || "(상태 없음)",
      });
      continue;
    }

    confirmedRows++;
    // ↓ 여기서 담는 필드가 곧 DB 저장 필드. 그 외는 절대 담지 않는다.
    group.students.push({
      erp_no: erpNo,
      student_name: studentName,
      school: nullable(cell(row, "school")),
      grade: nullable(cell(row, "grade")),
      contact: formatPhone(cell(row, "contact")),
      emergency_contact: formatPhone(cell(row, "emergency")),
    });
  }

  return {
    sheetName,
    headerRowIndex,
    totalRows,
    confirmedRows,
    excludedRows,
    groups: [...groups.values()].sort((a, b) =>
      (a.timeStart ?? "").localeCompare(b.timeStart ?? "") ||
      a.baseName.localeCompare(b.baseName, "ko")
    ),
    warnings,
  };
}

// xlsx 버퍼 → 파싱 결과. 첫 시트만 읽는다.
export function parseErpWorkbook(buffer: Uint8Array): ErpParseResult {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return {
      sheetName: "",
      headerRowIndex: -1,
      totalRows: 0,
      confirmedRows: 0,
      excludedRows: 0,
      groups: [],
      warnings: ["엑셀에 시트가 없습니다."],
    };
  }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
    header: 1,
    defval: null,
    raw: false, // 날짜·번호를 문자열로 통일(서식 차이 흡수)
    blankrows: false,
  });
  const result = parseErpRows(rows, sheetName);
  if (wb.SheetNames.length > 1)
    result.warnings.push(
      `시트가 ${wb.SheetNames.length}개입니다. 첫 시트('${sheetName}')만 읽었습니다.`
    );
  return result;
}

// =====================================================================
// 프로그램 자동 매칭
//   판정 순서: ① 수업시간 일치로 후보를 좁힌다 → ② 이름으로 고른다.
//   "두둠칫 댄스교실"은 1교시(10:00~11:20)·2교시(11:30~12:50)에 동시에 있으므로
//   시간이 유일한 구분자다. 시간을 무시한 이름 단독 매칭은 weak 로만 인정한다.
// =====================================================================
export type MatchTarget = {
  id: string;
  name: string;
  time_start: string | null;
  time_end: string | null;
  period_no: number | null;
};

export type MatchConfidence = "exact" | "strong" | "weak" | "none";

export type GroupMatch = {
  programId: string | null;
  confidence: MatchConfidence;
  reason: string;
  candidateIds: string[]; // 동점 후보(수동 선택 안내용)
};

// 이름 유사도 — 3 완전일치 / 2 대괄호 접두 제거 후 일치 / 1 포함관계 / 0 무관.
function nameScore(erpName: string, progName: string): number {
  const a = normalizeProgramName(erpName);
  const b = normalizeProgramName(progName);
  if (!a || !b) return 0;
  if (a === b) return 3;
  const as = normalizeProgramName(stripBracketPrefix(erpName));
  const bs = normalizeProgramName(stripBracketPrefix(progName));
  if (as === bs) return 2;
  if (as.includes(bs) || bs.includes(as)) return 1;
  return 0;
}

function timeMatches(group: ErpGroup, p: MatchTarget): boolean {
  if (!group.timeStart) return false;
  const ps = toHm(p.time_start);
  const pe = toHm(p.time_end);
  if (!ps) return false;
  if (ps !== group.timeStart) return false;
  // 파일에 종료시각이 없으면 시작시각 일치만으로 본다.
  if (!group.timeEnd || !pe) return true;
  return pe === group.timeEnd;
}

function bestByName(
  group: ErpGroup,
  pool: MatchTarget[]
): { best: MatchTarget[]; score: number } {
  let score = 0;
  let best: MatchTarget[] = [];
  for (const p of pool) {
    const s = nameScore(group.baseName, p.name);
    if (s === 0) continue;
    if (s > score) {
      score = s;
      best = [p];
    } else if (s === score) {
      best.push(p);
    }
  }
  return { best, score };
}

export function matchErpGroup(
  group: ErpGroup,
  programs: MatchTarget[]
): GroupMatch {
  // ① 시간 일치 후보.
  const timed = programs.filter((p) => timeMatches(group, p));
  if (timed.length) {
    const { best, score } = bestByName(group, timed);
    if (best.length === 1)
      return {
        programId: best[0].id,
        confidence: score === 3 ? "exact" : score === 2 ? "strong" : "weak",
        reason:
          score === 3
            ? "프로그램명·수업시간 일치"
            : score === 2
              ? "수업시간 일치 + 반 표기 제외 이름 일치"
              : "수업시간 일치 + 이름 부분 일치",
        candidateIds: [best[0].id],
      };
    if (best.length > 1)
      return {
        programId: null,
        confidence: "none",
        reason: `수업시간이 같은 프로그램 ${best.length}개가 이름도 비슷합니다. 직접 선택하세요.`,
        candidateIds: best.map((p) => p.id),
      };
    return {
      programId: null,
      confidence: "none",
      reason: `수업시간(${group.timeStart}~${group.timeEnd ?? "?"}) 프로그램은 있으나 이름이 맞는 것이 없습니다.`,
      candidateIds: timed.map((p) => p.id),
    };
  }

  // ② 시간 후보가 없으면 이름 단독 — 교시가 갈릴 수 있으므로 weak.
  const { best, score } = bestByName(group, programs);
  if (best.length === 1)
    return {
      programId: best[0].id,
      confidence: "weak",
      reason:
        score === 3
          ? "이름은 같지만 수업시간이 다릅니다. 교시를 확인하세요."
          : "이름만 부분 일치합니다. 교시를 확인하세요.",
      candidateIds: [best[0].id],
    };
  if (best.length > 1)
    return {
      programId: null,
      confidence: "none",
      reason: `이름이 비슷한 프로그램이 ${best.length}개입니다. 직접 선택하세요.`,
      candidateIds: best.map((p) => p.id),
    };
  return {
    programId: null,
    confidence: "none",
    reason: "이 차시에서 맞는 프로그램을 찾지 못했습니다. 직접 선택하세요.",
    candidateIds: [],
  };
}

// =====================================================================
// 순번(seq_no) — 이름 가나다순 1..n. 동명이인은 erp_no 로 안정 정렬.
// =====================================================================
export function orderByKoreanName<
  T extends { student_name: string; erp_no?: string | null },
>(list: T[]): T[] {
  return [...list].sort(
    (a, b) =>
      a.student_name.localeCompare(b.student_name, "ko") ||
      (a.erp_no ?? "").localeCompare(b.erp_no ?? "", "ko")
  );
}
