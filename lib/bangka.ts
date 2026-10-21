// =====================================================================
// 방과후아카데미(동래방카) — 표시·판정·일괄 등록 파싱 (순수 모듈)
//
//   학부모앱 동래방카(dongrae-bangka)와 같은 Supabase 의 bk_* 테이블을
//   여기서 관리합니다. 보호자는 초대 링크(/invite/{token})를 열어 PIN 4자리를
//   정하면 status 가 invited → active 로 바뀝니다(동래방카 app/api/auth/invite).
//
//   클라이언트에서도 쓰는 순수 모듈입니다(서버 전용 import·환경변수 금지).
//   초대 유효기간(7/14/30일, 기본 14일)은 동래샘들과 같은 lib/saemInvite 를 씁니다.
// =====================================================================

import { inviteDateKst, type InviteState } from "@/lib/saemInvite";

// --- 반 ---------------------------------------------------------------
export const BK_CLASS_CODES = ["ieum", "jieum"] as const;
export type BkClassCode = (typeof BK_CLASS_CODES)[number];

export const BK_CLASS_LABEL: Record<BkClassCode, string> = {
  ieum: "이음반",
  jieum: "지음반",
};

export function bkClassLabel(code: string): string {
  return BK_CLASS_LABEL[code as BkClassCode] ?? code;
}

export function isBkClassCode(v: unknown): v is BkClassCode {
  return (BK_CLASS_CODES as readonly unknown[]).includes(v);
}

// 붙여넣기·입력의 반 표기 → 코드. "이음반"·"이음"·"ieum" 모두 허용.
export function parseBkClass(input: string): BkClassCode | null {
  const s = input.replace(/\s/g, "").toLowerCase();
  if (s === "ieum" || s === "이음" || s === "이음반") return "ieum";
  if (s === "jieum" || s === "지음" || s === "지음반") return "jieum";
  return null;
}

// --- 전화번호 -----------------------------------------------------------
// 숫자만(하이픈/공백 제거). 동래방카 로그인도 같은 규칙으로 찾습니다.
export function normalizeBkPhone(input: string): string {
  return (input ?? "").replace(/\D/g, "");
}

// 휴대폰·일반전화 자릿수(9~11).
export function isValidBkPhone(digits: string): boolean {
  return /^0\d{8,10}$/.test(digits);
}

export function formatBkPhone(digits: string): string {
  const d = normalizeBkPhone(digits);
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return d;
}

// --- 보호자 상태 ---------------------------------------------------------
export type BkGuardianStatus = "invited" | "active" | "suspended";

export const BK_GUARDIAN_STATUS_LABEL: Record<BkGuardianStatus, string> = {
  invited: "초대중",
  active: "사용중",
  suspended: "정지",
};

export function bkGuardianStatusLabel(s: string): string {
  return BK_GUARDIAN_STATUS_LABEL[s as BkGuardianStatus] ?? s;
}

// 잠금 여부 — 서버에서 계산해 내려보냅니다(클라이언트 시계와 어긋나지 않게).
export function isBkLocked(lockedUntil: string | null, nowMs = Date.now()): boolean {
  return !!lockedUntil && new Date(lockedUntil).getTime() > nowMs;
}

// 카톡으로 보낼 안내문(관장 지정 문구).
export function bkInviteMessage(input: {
  guardianName: string;
  url: string;
  expiresAt: string;
}): string {
  return `[동래구청소년센터 방과후아카데미] ${input.guardianName}님, 동래방카 앱 가입 링크입니다. ${inviteDateKst(input.expiresAt)}까지 접속해 PIN 4자리를 설정해 주세요. ${input.url}`;
}

// --- 일괄 등록 붙여넣기 파싱 ---------------------------------------------
//   엑셀에서 복사한 탭 구분 텍스트. 열 순서 고정:
//     이름, 학교, 학년, 반, 보호자명, 관계, 보호자 전화
//   · 첫 줄이 머리글("이름"으로 시작)이면 건너뜁니다.
//   · 보호자 세 칸(보호자명·관계·전화)은 비워도 됩니다(학생만 등록).
//     보호자명이나 전화 중 하나만 있으면 오류입니다.
//   · 형제가 둘인 보호자, 보호자가 둘인 학생은 여러 줄로 씁니다 —
//     같은 학생(이름·학교·학년·반 동일) 줄은 한 학생으로 묶습니다.
export const BK_BULK_COLUMNS = [
  "이름",
  "학교",
  "학년",
  "반",
  "보호자명",
  "관계",
  "보호자 전화",
] as const;

export type BkBulkLine = {
  line: number; // 붙여넣은 텍스트의 줄 번호(1부터)
  name: string;
  school: string;
  grade: string;
  classCode: BkClassCode | null;
  classRaw: string;
  guardianName: string;
  relation: string;
  phone: string; // 숫자만
  errors: string[];
};

export function parseBkBulkText(text: string): BkBulkLine[] {
  const out: BkBulkLine[] = [];
  const lines = (text ?? "").replace(/\r\n?/g, "\n").split("\n");
  lines.forEach((raw, i) => {
    if (raw.trim() === "") return;
    const cells = raw.split("\t").map((c) => c.trim());
    if (i === 0 && cells[0] === "이름") return; // 머리글
    const [name = "", school = "", grade = "", classRaw = "", guardianName = "", relation = "", phoneRaw = ""] =
      cells;
    const phone = normalizeBkPhone(phoneRaw);
    const classCode = parseBkClass(classRaw);
    const errors: string[] = [];
    if (cells.length < 4)
      errors.push("칸이 부족합니다 — 엑셀 셀을 그대로 복사했는지 확인하세요(탭 구분)");
    if (!name) errors.push("이름이 비었습니다");
    if (!classCode) errors.push(`반을 알 수 없습니다("${classRaw}") — 이음반/지음반`);
    if (guardianName && !phone) errors.push("보호자 전화가 비었습니다");
    if (!guardianName && phone) errors.push("보호자명이 비었습니다");
    if (phone && !isValidBkPhone(phone)) errors.push(`전화번호 형식이 이상합니다("${phoneRaw}")`);
    out.push({ line: i + 1, name, school, grade, classCode, classRaw, guardianName, relation, phone, errors });
  });
  return out;
}

// 같은 학생 판정 키 — 붙여넣기 안에서 묶을 때, 기존 재원생과 대조할 때 공용.
export function bkStudentKey(s: {
  name: string;
  school: string | null;
  grade: string | null;
  class_code: string;
}): string {
  const n = (v: string | null) => (v ?? "").replace(/\s/g, "");
  return [n(s.name), n(s.school), n(s.grade), s.class_code].join("|");
}

// --- 화면 행 타입 (서버 액션이 만들어 내려보냄) ------------------------------
export type BkStudentRow = {
  id: string;
  name: string;
  school: string | null;
  grade: string | null;
  class_code: string;
  status: "active" | "left";
  enrolled_on: string | null;
  left_on: string | null;
  memo: string | null;
  guardians: { id: string; name: string; status: string }[];
};

export type BkStudentInput = {
  id?: string;
  name: string;
  school: string;
  grade: string;
  class_code: string;
  enrolled_on: string;
  memo: string;
};

export type BkGuardianRow = {
  id: string;
  name: string;
  phone: string;
  relation: string | null;
  status: BkGuardianStatus;
  last_login_at: string | null;
  locked: boolean;
  invite: InviteState;
  students: { id: string; name: string; class_code: string; status: string }[];
};

export type BkGuardianDetail = BkGuardianRow & {
  failed_attempts: number;
  locked_until: string | null;
  pin_set_at: string | null;
  memo: string | null;
  // 지금 유효한 초대 링크(있을 때만). 토큰은 관리 권한자에게만 내려갑니다.
  inviteUrl: string | null;
  inviteExpiresAt: string | null;
};

// 일괄 등록 미리보기 — 학생 단위로 묶은 계획.
export type BkBulkPlanGuardian = {
  name: string;
  relation: string;
  phone: string;
  existingId: string | null;
  existingName: string | null; // 이름이 다르면 화면이 경고
  alreadyLinked: boolean;
};

export type BkBulkPlanStudent = {
  lines: number[];
  name: string;
  school: string;
  grade: string;
  class_code: BkClassCode;
  existingId: string | null; // 같은 이름·학교·학년·반 재원생 → 새로 만들지 않음
  guardians: BkBulkPlanGuardian[];
};

export type BkBulkPlan = {
  errors: { line: number; message: string }[];
  students: BkBulkPlanStudent[];
  summary: {
    newStudents: number;
    existingStudents: number;
    newGuardians: number;
    existingGuardians: number;
    newLinks: number;
  };
};
