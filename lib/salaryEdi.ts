// =====================================================================
// 4대보험 EDI CSV 파싱 + 공제액 변환 (급여 2차 PART 5)
//   * 입력: EDI에서 내려받은 cp949 CSV (상단 6줄 공백, 7번째 줄 머리글).
//   * 출력: 직원 이름별 공제 항목 갱신값(pension/health/longterm_care/employment_ins).
//   * ⚠ 변환 규칙(실제 7월 급여대장으로 검증) — 파일값을 그대로 쓰지 않습니다:
//       - 국민연금: 결정보험료 ÷ 2 (본인부담 절반, 10원 절사)
//       - 건강보험: 첫 고지보험료→국민건강, 둘째 고지보험료→장기요양 (그대로)
//       - 고용보험: 월평균보수월액 × 근로자요율 (10원 절사). 결정보험료 사용 금지.
//       - 산재보험: 전액 사업주 부담 → 공제 반영 안 함(안내만).
//   * @/ 별칭·DB 의존 없음 → scripts/test-salary-edi.ts 로 단독 테스트 가능.
// =====================================================================

import { floor10 } from "./salary";

export type EdiFileType = "pension" | "health" | "employment" | "accident";

export const EDI_FILE_TYPES: { value: EdiFileType; label: string }[] = [
  { value: "pension", label: "국민연금" },
  { value: "health", label: "건강보험" },
  { value: "employment", label: "고용보험" },
  { value: "accident", label: "산재보험" },
];

// 갱신 대상 공제 키(employee_salary_profiles.extra 의 키와 동일).
export type EdiUpdateKey =
  | "pension"
  | "health"
  | "longterm_care"
  | "employment_ins";

export type EdiEntry = {
  name: string;
  update: Partial<Record<EdiUpdateKey, number>>;
  note: string | null; // 정산사유 등 참고 표시
};

export type EdiParseResult = {
  fileType: EdiFileType;
  entries: EdiEntry[];
  warnings: string[];
  headerRowIndex: number; // 0-based. -1 = 머리글 못 찾음
};

// --- 순수 변환 규칙 (숫자 in → 숫자 out) ------------------------------
// 국민연금 본인부담 = 결정보험료 ÷ 2, 10원 절사.
export function pensionDeduction(decision: number): number {
  return floor10(decision / 2);
}
// 고용보험 근로자부담 = 월평균보수월액 × 근로자요율, 10원 절사.
export function employmentDeduction(monthlyAvg: number, empRate: number): number {
  return floor10(monthlyAvg * empRate);
}

// --- cp949(EUC-KR) 디코딩 --------------------------------------------
//   Node(full ICU)·브라우저 모두 TextDecoder('euc-kr') 지원. euc-kr 디코더는
//   UHC(cp949) 전 영역을 처리합니다. BOM 은 decode 시 제거됩니다.
export function decodeEucKr(buffer: Uint8Array): string {
  return new TextDecoder("euc-kr").decode(buffer).replace(/^﻿/, "");
}

// --- CSV 파서 (RFC4180 근사: 따옴표·내부 콤마·개행 처리) ---------------
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      pushField();
    } else if (c === "\r") {
      // \r\n / \r 모두 줄바꿈으로.
      if (text[i + 1] === "\n") i++;
      pushRow();
    } else if (c === "\n") {
      pushRow();
    } else {
      field += c;
    }
  }
  // 마지막 필드/행(끝에 개행 없을 때).
  if (field.length > 0 || row.length > 0) pushRow();
  return rows;
}

// 헤더 매칭용 정규화(공백·따옴표 제거).
function norm(s: string | undefined): string {
  return (s ?? "").replace(/\s+/g, "").replace(/^"|"$/g, "").trim();
}

// 숫자 파싱 — 콤마·원·공백 등 제거. 실패 시 0.
function num(s: string | undefined): number {
  if (s == null) return 0;
  const cleaned = String(s).replace(/[^0-9.\-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

// 헤더 행에서 특정 라벨의 열 인덱스(첫 일치). 없으면 -1.
function colIndex(header: string[], ...labels: string[]): number {
  const targets = labels.map(norm);
  for (let i = 0; i < header.length; i++) {
    if (targets.includes(norm(header[i]))) return i;
  }
  return -1;
}

// 헤더 행에서 특정 라벨의 모든 열 인덱스(건강보험 '고지보험료' 2회 등장 대응).
function colIndicesAll(header: string[], label: string): number[] {
  const t = norm(label);
  const out: number[] = [];
  for (let i = 0; i < header.length; i++) {
    if (norm(header[i]) === t) out.push(i);
  }
  return out;
}

// 파일명으로 종류 추정(고용/산재 머리글 동일 → 담당자 최종 선택용 기본값).
export function guessFileType(filename: string): EdiFileType | null {
  const n = filename ?? "";
  if (n.includes("산재")) return "accident";
  if (n.includes("고용")) return "employment";
  if (n.includes("연금")) return "pension";
  if (n.includes("건강")) return "health";
  return null;
}

// 데이터 행의 이름이 집계행/빈행인지.
function isSkippableName(name: string): boolean {
  const n = norm(name);
  if (!n) return true;
  return /^(합계|총계|소계|계|합\s*계)$/.test(n);
}

// --- 핵심: 파싱된 표(rows) → EDI 결과 --------------------------------
export function parseEdiRows(
  rows: string[][],
  fileType: EdiFileType,
  opts: { employmentEmpRate?: number } = {}
): EdiParseResult {
  const warnings: string[] = [];

  // 머리글 행 탐지 — '가입자명'/'성명' 이 있는 첫 행. 없으면 spec상 7번째(idx 6).
  let headerRowIndex = rows.findIndex(
    (r) => colIndex(r, "가입자명", "성명") >= 0
  );
  if (headerRowIndex < 0) {
    headerRowIndex = rows.length > 6 ? 6 : -1;
  }
  if (headerRowIndex < 0) {
    return {
      fileType,
      entries: [],
      warnings: ["머리글(가입자명/성명) 행을 찾지 못했습니다."],
      headerRowIndex: -1,
    };
  }

  const header = rows[headerRowIndex];
  const dataRows = rows.slice(headerRowIndex + 1);
  const nameIdx = colIndex(header, "가입자명", "성명");
  if (nameIdx < 0) {
    warnings.push("이름 열(가입자명/성명)을 찾지 못했습니다.");
  }

  // 산재보험 — 공제 대상 아님. 안내만.
  if (fileType === "accident") {
    return {
      fileType,
      entries: [],
      warnings: ["산재보험은 급여 공제 대상이 아닙니다. (전액 사업주 부담)"],
      headerRowIndex,
    };
  }

  const entries: EdiEntry[] = [];

  if (fileType === "pension") {
    const decIdx = colIndex(header, "결정보험료");
    const reasonIdx = colIndex(header, "정산사유");
    if (decIdx < 0) warnings.push("국민연금: '결정보험료' 열을 찾지 못했습니다.");
    for (const r of dataRows) {
      const name = (r[nameIdx] ?? "").trim();
      if (isSkippableName(name)) continue;
      const decision = num(r[decIdx]);
      entries.push({
        name,
        update: { pension: pensionDeduction(decision) },
        note: reasonIdx >= 0 ? (r[reasonIdx] ?? "").trim() || null : null,
      });
    }
    return { fileType, entries, warnings, headerRowIndex };
  }

  if (fileType === "health") {
    // '고지보험료' 2회 등장: 첫=국민건강, 둘째=장기요양.
    const notiIdx = colIndicesAll(header, "고지보험료");
    if (notiIdx.length === 0) {
      warnings.push("건강보험: '고지보험료' 열을 찾지 못했습니다.");
    } else if (notiIdx.length === 1) {
      warnings.push(
        "건강보험: '고지보험료' 열이 1개만 있어 장기요양을 반영하지 못했습니다."
      );
    }
    for (const r of dataRows) {
      const name = (r[nameIdx] ?? "").trim();
      if (isSkippableName(name)) continue;
      const update: EdiEntry["update"] = {};
      if (notiIdx[0] != null) update.health = num(r[notiIdx[0]]);
      if (notiIdx[1] != null) update.longterm_care = num(r[notiIdx[1]]);
      entries.push({ name, update, note: null });
    }
    return { fileType, entries, warnings, headerRowIndex };
  }

  // employment
  const avgIdx = colIndex(header, "월평균보수월액");
  const rate = opts.employmentEmpRate ?? 0;
  if (avgIdx < 0) {
    warnings.push("고용보험: '월평균보수월액' 열을 찾지 못했습니다.");
  }
  if (!rate) {
    warnings.push(
      "고용보험: 근로자 요율(employment_emp_rate)이 없어 0으로 계산됩니다. 급여 기준값을 확인하세요."
    );
  }
  for (const r of dataRows) {
    const name = (r[nameIdx] ?? "").trim();
    if (isSkippableName(name)) continue;
    const avg = num(r[avgIdx]);
    entries.push({
      name,
      update: { employment_ins: employmentDeduction(avg, rate) },
      note: null,
    });
  }
  return { fileType, entries, warnings, headerRowIndex };
}

// --- 편의: 원본 버퍼 → 결과 -----------------------------------------
export function parseEdiBuffer(
  buffer: Uint8Array,
  fileType: EdiFileType,
  opts: { employmentEmpRate?: number } = {}
): EdiParseResult {
  const text = decodeEucKr(buffer);
  const rows = parseCsv(text);
  return parseEdiRows(rows, fileType, opts);
}
