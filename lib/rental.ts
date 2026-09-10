// =====================================================================
// 홈페이지 대관예약 (rental_reservations) — 공용 타입·순수 헬퍼.
//
// ⚠️ 이 앱에서 rental_reservations 는 읽기 전용입니다.
//    유일한 쓰기 경로는 lib/rentalSync.ts 의 동기화(upsert)뿐이고, 그마저도
//    홈페이지 API 응답을 그대로 받아쓰는 복제입니다. 예약 생성·수정·취소는
//    홈페이지(onnainna.kr)에서만 합니다 — 여기에 INSERT/UPDATE/DELETE 경로를
//    추가하면 홈페이지가 원본이라는 전제가 깨지고, 다음 동기화에 덮여
//    사라지는 "저장한 것 같은데 없어지는" 변경이 됩니다.
//
// ※ 박준우 2단계(대관료 계산·정산 폼) 연동은 이번 범위가 아닙니다.
//    계산 규칙 확정 대기 중이며, 이 테이블이 그 토대가 됩니다
//    (예약 1건 = reservation_no 로, 계산 결과는 별도 테이블에서 참조).
//
//   * DB 접근 코드를 두지 않습니다(순수 함수·상수만) — 화면(클라이언트
//     컴포넌트)과 서버가 같은 표기 규칙을 쓰도록 lib/driving.ts 와 같은 구조.
// =====================================================================

export const RENTAL_TABLE = "rental_reservations";

// rental_reservations 한 행. 컬럼 구성은 업체 API v1.1 응답과 1:1 입니다
//   (synced_at 만 우리가 붙이는 값).
export type RentalRow = {
  // 홈페이지 예약번호 = PK. 시설 대관(rental)·청소년 공간(room)이 번호대를
  //   공유하지만 실제 중복은 없어(2026-06~09 7,667건 검증) 단일 PK 로 씁니다.
  reservation_no: number;
  reservation_type: string; // "rental"(시설 대관) | "room"(청소년 공간)
  reservation_date: string; // 대관일 "YYYY-MM-DD"
  start_time: string | null; // "HH:mm"
  end_time: string | null;
  space_name: string | null; // 공간명
  room_name: string | null; // 세부 교실(청소년 공간만 채워짐)
  purpose: string | null;
  program_name: string | null;
  applicant: string | null; // ⚠️ 개인정보 — 아래 주석 참고
  team_name: string | null;
  person_total: number;
  person_disabled: number;
  status: string; // "Y" 확정 | "N" 신청중 | "C" 취소
  status_name: string | null; // 홈페이지가 준 표기("확정"·"신청 중"·"취소")
  reg_date: string | null; // 신청 접수 시각
  synced_at: string | null; // 이 행을 마지막으로 동기화한 시각
};

// 업체 API 응답의 list 원소(모든 값이 문자열로 올 수 있다고 보고 느슨하게 받음).
export type RentalApiItem = Record<string, unknown>;

// 상단 요약 — 건수·이용인원은 "확정(Y)" 건만 셉니다.
//   신청 중은 아직 확정이 아니고 취소는 실제로 쓰지 않은 예약이라, 둘을
//   합계에 넣으면 "이번 달 몇 팀이 왔나" 라는 질문에 틀린 답이 나옵니다.
//   대신 각각 몇 건인지는 따로 보여줍니다(전체보기 없이도 알 수 있도록).
export type RentalSummary = {
  confirmed: number; // 확정 건수
  personTotal: number; // 확정 건의 이용인원 합계
  personDisabled: number; // 그중 장애인 인원 합계
  pending: number; // 신청 중 건수
  cancelled: number; // 취소 건수
};

// 목록 한 화면에 보여줄 행수. 한 달에 2,500건이 넘는 달이 있어(청소년 공간이
//   1인 1건씩 쌓입니다) 전부 한 번에 그리면 화면이 버벅입니다.
//   ※ 서버 액션 파일("use server")은 async 함수만 export 할 수 있어 이 상수와
//     아래 타입을 여기 둡니다.
export const RENTAL_PAGE_SIZE = 100;

// 조회 화면이 한 번에 받는 것 — 요약·현재 페이지 행·마지막 동기화 시각.
export type RentalPageData = {
  rows: RentalRow[]; // 현재 페이지에 그릴 행만
  summary: RentalSummary;
  // 상태 필터를 적용한 뒤의 전체 건수(페이지 계산용)
  filtered: number;
  page: number;
  totalPages: number;
  lastSyncAt: string | null;
};

// --- 구분(reservation_type) ---
export const RENTAL_TYPE_LABELS: Record<string, string> = {
  rental: "시설 대관",
  room: "청소년 공간",
};

export function rentalTypeLabel(type: string | null | undefined): string {
  const t = (type ?? "").trim();
  return RENTAL_TYPE_LABELS[t] ?? (t || "-");
}

// 화면 필터 값 — "all" 은 구분 무관.
export type RentalTypeFilter = "all" | "rental" | "room";

export function isRentalTypeFilter(v: unknown): v is RentalTypeFilter {
  return v === "all" || v === "rental" || v === "room";
}

// --- 상태(status) ---
// 기본은 '확정만' — 대관 현황을 볼 때 취소된 건이 섞이면 건수를 잘못 읽습니다.
export type RentalStatusFilter = "confirmed" | "all";

export function isRentalStatusFilter(v: unknown): v is RentalStatusFilter {
  return v === "confirmed" || v === "all";
}

export function rentalStatusLabel(row: {
  status: string;
  status_name?: string | null;
}): string {
  const given = (row.status_name ?? "").trim();
  if (given) return given;
  const s = (row.status ?? "").trim().toUpperCase();
  return s === "Y" ? "확정" : s === "N" ? "신청 중" : s === "C" ? "취소" : s || "-";
}

export function isConfirmed(row: { status: string }): boolean {
  return (row.status ?? "").trim().toUpperCase() === "Y";
}

export function isCancelled(row: { status: string }): boolean {
  return (row.status ?? "").trim().toUpperCase() === "C";
}

// --- 표기 헬퍼 ---
// "09:30 ~ 17:30". 한쪽이 없으면 있는 쪽만.
export function formatTimeRange(row: {
  start_time?: string | null;
  end_time?: string | null;
}): string {
  const s = (row.start_time ?? "").trim();
  const e = (row.end_time ?? "").trim();
  if (s && e) return `${s} ~ ${e}`;
  return s || e || "-";
}

// 공간 표기 — 세부 교실이 있으면 "공간명 (세부교실)".
//   청소년 공간은 room_name 이 실제 이용 단위(예: 스낵존(컵라면))이라
//   공간명만 보이면 같은 줄이 여러 건 겹쳐 보입니다.
export function formatSpace(row: {
  space_name?: string | null;
  room_name?: string | null;
}): string {
  const space = (row.space_name ?? "").trim();
  const room = (row.room_name ?? "").trim();
  if (space && room && room !== space) return `${space} (${room})`;
  return space || room || "-";
}

// 인원 표기 — "46명", 장애인이 있으면 "46명 (장애 2)".
export function formatPersons(row: {
  person_total?: number | null;
  person_disabled?: number | null;
}): string {
  const total = Number(row.person_total) || 0;
  const disabled = Number(row.person_disabled) || 0;
  const base = `${total.toLocaleString("ko-KR")}명`;
  return disabled > 0 ? `${base} (장애 ${disabled})` : base;
}

// "YYYY-MM-DD" → "MM.DD (수)". 목록이 날짜순이라 연도는 생략합니다.
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function formatRentalDate(d: string | null | undefined): string {
  const raw = (d ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw || "-";
  // 요일은 UTC 로 계산 — 로컬 타임존에 따라 하루 밀리지 않게(lib/datetime.ts 원칙).
  const t = Date.parse(`${raw}T00:00:00Z`);
  const wd = Number.isNaN(t) ? "" : WEEKDAYS[new Date(t).getUTCDay()];
  return `${raw.slice(5, 7)}.${raw.slice(8, 10)}${wd ? ` (${wd})` : ""}`;
}

// 빈 문자열을 null 로 —  API 는 값이 없을 때 null 이 아니라 "" 를 줍니다.
//   그대로 저장하면 화면에서 "-" 폴백이 걸리지 않아 빈 칸으로 보입니다.
function nz(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// API list 원소 → DB 행. 예약번호가 없거나 숫자가 아니면 null(호출부에서 skip).
//   syncedAt 을 인자로 받는 이유: 한 번의 동기화로 들어간 행들이 모두 같은
//   시각을 갖게 해, "이 행이 어느 동기화에서 왔나" 를 되짚을 수 있게 합니다.
export function toRentalUpsert(
  item: RentalApiItem,
  syncedAt: string
): Omit<RentalRow, "synced_at"> & { synced_at: string } | null {
  const no = Number(item.reservation_no);
  if (!Number.isInteger(no)) return null;
  const date = nz(item.reservation_date);
  if (!date) return null;
  return {
    reservation_no: no,
    reservation_type: nz(item.reservation_type) ?? "rental",
    reservation_date: date,
    start_time: nz(item.start_time),
    end_time: nz(item.end_time),
    space_name: nz(item.space_name),
    room_name: nz(item.room_name),
    purpose: nz(item.purpose),
    program_name: nz(item.program_name),
    applicant: nz(item.applicant),
    team_name: nz(item.team_name),
    person_total: num(item.person_total),
    person_disabled: num(item.person_disabled),
    // status 는 NOT NULL — 값이 비어 오면 "신청 중"(N)으로 두어 확정 집계에
    //   섞이지 않게 합니다(확정으로 잘못 세는 쪽이 더 위험).
    status: (nz(item.status) ?? "N").toUpperCase(),
    status_name: nz(item.status_name),
    reg_date: nz(item.reg_date),
    // ★ synced_at 은 DB 기본값(now())이 insert 때만 걸리고 upsert 로 덮을 때는
    //   갱신되지 않습니다(실측 확인). 매번 명시해야 "마지막 동기화 시각" 이 됩니다.
    synced_at: syncedAt,
  };
}

// month(YYYY-MM) → [시작일, 다음달 1일). 형식이 아니면 null(= 전체 기간).
//   lib/driving.ts monthRange 와 동일한 계산식입니다.
export function rentalMonthRange(
  month: string | null | undefined
): { start: string; end: string } | null {
  const m = (month ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(m)) return null;
  const [y, mm] = m.split("-").map(Number);
  return {
    start: `${m}-01`,
    end: new Date(Date.UTC(y, mm, 1)).toISOString().slice(0, 10),
  };
}

// "2026-09" → "2026년 9월"
export function rentalMonthLabel(month: string | null | undefined): string {
  const m = (month ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(m)) return "전체";
  return `${m.slice(0, 4)}년 ${Number(m.slice(5, 7))}월`;
}
