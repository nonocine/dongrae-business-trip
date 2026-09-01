// ERP 명단 파싱·프로그램 매칭 검증 (SA-18)
//   실행: npx tsx scripts/test-saem-enrollment.ts  (package.json: npm run test:enroll)
//
//   실파일("3차시 두둠칫댄스교실 1교시 출석부.xlsx")의 구조를 그대로 재현해
//   가장 위험한 두 가지를 못박습니다.
//     ① "두둠칫 댄스교실 (10:00~11:20)" → 2교시(11:30~12:50)가 아니라
//        1교시(10:00~11:20) 프로그램에 매칭되는가.
//     ② 상태 "예약 확정"만 반영되고 "취소"는 제외되는가.
//     ③ 생년월일은 결과에 담기고(2026-09 정책 변경 — 관장 승인),
//        성별·장애여부·환불계좌·회원ID는 여전히 담기지 않는가.
import * as XLSX from "xlsx";
import {
  parseErpRows,
  parseErpWorkbook,
  matchErpGroup,
  orderByKoreanName,
  stripTimeSuffix,
  parseTimeRange,
  parseCapacity,
  formatPhone,
  isConfirmedStatus,
  normalizeProgramName,
  stripBracketPrefix,
  type MatchTarget,
} from "../lib/saemEnrollment";

let failures = 0;
function expectEq(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "✓" : "✗"} ${label}: ${JSON.stringify(actual)}${
      ok ? "" : ` (기대 ${JSON.stringify(expected)})`
    }`
  );
}

// =====================================================================
// 실파일과 동일한 머리글 21열 (1행 머리글).
// =====================================================================
const HEADER = [
  "번호",
  "카테고리",
  "프로그램명",
  "수업시간",
  "정원",
  "이름",
  "회원 ID",
  "소속(교급)",
  "생년월일",
  "성별",
  "연락처",
  "장애 여부",
  "비상연락처",
  "추가 문의사항",
  "학교명",
  "자유수강권 대상자 여부",
  "상태",
  "취소사유",
  "환불 계좌번호",
  "관리자 메모",
  "등록일",
];

type RowSpec = {
  no: string;
  prog: string;
  time: string;
  cap: string;
  name: string;
  memberId: string;
  grade: string;
  birth: string;
  sex: string;
  phone: string;
  disabled: string;
  emergency: string;
  school: string;
  status: string;
};

function row(s: RowSpec): unknown[] {
  return [
    s.no,
    "통합방과후학교",
    s.prog,
    s.time,
    s.cap,
    s.name,
    s.memberId,
    s.grade,
    s.birth,
    s.sex,
    s.phone,
    s.disabled,
    s.emergency,
    null,
    s.school,
    "아니오",
    s.status,
    null,
    null,
    null,
    "2026-06-23 13:00:39",
  ];
}

const DANCE = "두둠칫 댄스교실 (10:00~11:20)";
const T1 = "10:00~11:20";
const CAP = "13(13/0)";

// 실파일 그대로: 예약 확정 13명 + 취소 1명 = 14행.
const CONFIRMED_NAMES = [
  "예유정",
  "예하정",
  "강서율",
  "김나윤",
  "김유민",
  "유나연",
  "강나경",
  "황시안",
  "이윤우",
  "문민서",
  "이고운",
  "최지유",
  "최서연",
];
const CANCELLED_NAME = "문연서";

const DATA_ROWS: unknown[][] = [
  ...CONFIRMED_NAMES.map((name, i) =>
    row({
      no: String(7643 + i),
      prog: DANCE,
      time: T1,
      cap: CAP,
      name,
      memberId: `mid${i}`,
      grade: "초등학생",
      birth: "2018-09-27",
      sex: "여",
      phone: `010-3489-66${String(10 + i)}`,
      disabled: "비장애",
      emergency: "01045758633",
      school: "교동초",
      status: "예약 확정",
    })
  ),
  row({
    no: "7919",
    prog: DANCE,
    time: T1,
    cap: CAP,
    name: CANCELLED_NAME,
    memberId: "h2430000",
    grade: "초등학생",
    birth: "2017-02-10",
    sex: "여",
    phone: "010-7671-4096",
    disabled: "비장애",
    emergency: "01050944096",
    school: "교동초",
    status: "취소",
  }),
];

const SHEET: unknown[][] = [HEADER, ...DATA_ROWS];

// =====================================================================
// 실 DB(3차시)의 프로그램 편성 — 같은 이름이 1·2교시에 동시에 있는 상황.
// =====================================================================
const PROGRAMS: MatchTarget[] = [
  { id: "p0", name: "MOVE! 비보잉 교실", time_start: "09:00:00", time_end: "09:50:00", period_no: 0 },
  { id: "p1-dance", name: "두둠칫 댄스교실", time_start: "10:00:00", time_end: "11:20:00", period_no: 1 },
  { id: "p2-dance", name: "두둠칫 댄스교실", time_start: "11:30:00", time_end: "12:50:00", period_no: 2 },
  { id: "p1-ai", name: "[자격증반:AICE 퓨처]인공지능 코딩", time_start: "10:00:00", time_end: "11:20:00", period_no: 1 },
  { id: "p2-ai", name: "인공지능 코딩", time_start: "11:30:00", time_end: "12:50:00", period_no: 2 },
  { id: "p1-itq", name: "[자격증반:ITQ 한글]톡톡 컴퓨터 교실", time_start: "10:00:00", time_end: "11:20:00", period_no: 1 },
  { id: "p2-itq", name: "[자격증반:ITQ 한글]톡톡 컴퓨터 교실", time_start: "11:30:00", time_end: "12:50:00", period_no: 2 },
  { id: "p3-yt", name: "[기초반]유튜브 크리에이터", time_start: "13:00:00", time_end: "14:20:00", period_no: 3 },
  { id: "p4-yt", name: "[전문반]유튜브 크리에이터", time_start: "14:30:00", time_end: "15:50:00", period_no: 4 },
];

// =====================================================================
console.log("\n--- 문자열 헬퍼 ---");
expectEq("시간 접미 제거", stripTimeSuffix(DANCE), "두둠칫 댄스교실");
expectEq("시간 접미 없으면 그대로", stripTimeSuffix("윙윙 드론교실"), "윙윙 드론교실");
expectEq("수업시간 파싱", parseTimeRange(T1), { start: "10:00", end: "11:20" });
expectEq("한 자리 시각 패딩", parseTimeRange("9:00~9:50"), {
  start: "09:00",
  end: "09:50",
});
expectEq("정원 '13(13/0)' → 13", parseCapacity(CAP), 13);
expectEq("연락처 하이픈 유지", formatPhone("010-3489-6698"), "010-3489-6698");
expectEq("비상연락처 하이픈 부여", formatPhone("01045758633"), "010-4575-8633");
expectEq("빈 연락처 → null", formatPhone("  "), null);
expectEq("'예약 확정' 인정", isConfirmedStatus("예약 확정"), true);
expectEq("공백 없는 '예약확정' 인정", isConfirmedStatus("예약확정"), true);
expectEq("'취소' 거부", isConfirmedStatus("취소"), false);
expectEq("빈 상태 거부", isConfirmedStatus(null), false);
expectEq(
  "대괄호 반 표기 제거",
  stripBracketPrefix("[자격증반:ITQ 한글]톡톡 컴퓨터 교실"),
  "톡톡 컴퓨터 교실"
);
expectEq(
  "이름 정규화(공백 무시)",
  normalizeProgramName("두둠칫  댄스교실") === normalizeProgramName("두둠칫댄스교실"),
  true
);

console.log("\n--- 파싱(예약 확정만) ---");
const parsed = parseErpRows(SHEET);
expectEq("머리글 행", parsed.headerRowIndex, 0);
expectEq("데이터 행 수", parsed.totalRows, 14);
expectEq("반영 대상(예약 확정)", parsed.confirmedRows, 13);
expectEq("제외(취소)", parsed.excludedRows, 1);
expectEq("경고 없음", parsed.warnings, []);
expectEq("그룹 수", parsed.groups.length, 1);

const g = parsed.groups[0];
expectEq("그룹 baseName", g.baseName, "두둠칫 댄스교실");
expectEq("그룹 시간", [g.timeStart, g.timeEnd], ["10:00", "11:20"]);
expectEq("그룹 파일 정원", g.fileCapacity, 13);
expectEq("학생 수", g.students.length, 13);
expectEq("취소자 제외됨", g.excluded.map((e) => e.student_name), [CANCELLED_NAME]);
expectEq(
  "취소자가 학생 목록에 없음",
  g.students.some((s) => s.student_name === CANCELLED_NAME),
  false
);

console.log("\n--- 개인정보 최소화(생년월일은 수집, 나머지는 계속 미수집) ---");
expectEq(
  "학생 필드 7개(erp_no·이름·학교·교급·생년월일·연락처·비상연락처)",
  Object.keys(g.students[0]).sort(),
  [
    "birth_date",
    "contact",
    "emergency_contact",
    "erp_no",
    "grade",
    "school",
    "student_name",
  ]
);
const serialized = JSON.stringify(g.students);
for (const forbidden of [
  "여", // 성별
  "비장애", // 장애여부
  "mid0", // 회원ID
]) {
  expectEq(`금지 값 '${forbidden}' 미포함`, serialized.includes(forbidden), false);
}

console.log("\n--- 생년월일 파싱 ---");
expectEq("생년월일이 결과에 담김", g.students[0].birth_date, "2018-09-27");
expectEq(
  "13명 모두 생년월일 있음",
  g.students.filter((s) => s.birth_date).length,
  13
);
// 읽지 못하는 값은 오류가 아니라 null — 그 사람만 빈칸으로 두고 나머지는 반영한다.
const birthSheet = [
  HEADER,
  ...[
    { no: "8001", birth: "2018-09-27", label: "정상" },
    { no: "8002", birth: "", label: "빈칸" },
    { no: "8003", birth: "2018.09.27", label: "점 구분" },
    { no: "8004", birth: "18-09-27", label: "두자리 연도" },
    { no: "8005", birth: "2018-02-31", label: "없는 날짜" },
  ].map((b) =>
    row({
      no: b.no,
      prog: DANCE,
      time: T1,
      cap: CAP,
      name: `테스트${b.no}`,
      memberId: "mid",
      grade: "초등학생",
      birth: b.birth,
      sex: "여",
      phone: "010-0000-0000",
      disabled: "비장애",
      emergency: "01000000000",
      school: "교동초",
      status: "예약 확정",
    })
  ),
];
expectEq(
  "정상만 담기고 나머지는 null(YYYY-MM-DD·실재 날짜만)",
  parseErpRows(birthSheet).groups[0].students.map((s) => s.birth_date),
  ["2018-09-27", null, null, null, null]
);
expectEq(
  "생년월일을 못 읽어도 그 행은 반영된다",
  parseErpRows(birthSheet).confirmedRows,
  5
);

// "생년월일" 열이 아예 없는 파일도 그대로 동작해야 한다(경고 없이 null).
const noBirthHeader = HEADER.filter((h) => h !== "생년월일");
const noBirthSheet = [
  noBirthHeader,
  ...DATA_ROWS.map((r) => r.filter((_, i) => HEADER[i] !== "생년월일")),
];
const noBirth = parseErpRows(noBirthSheet);
expectEq("생년월일 열 없어도 파싱됨", noBirth.confirmedRows, 13);
expectEq(
  "생년월일 열 없으면 전원 null",
  noBirth.groups[0].students.every((s) => s.birth_date === null),
  true
);

console.log("\n--- 프로그램 매칭(교시 구분) ---");
const m = matchErpGroup(g, PROGRAMS);
expectEq("1교시(10:00~11:20)에 매칭", m.programId, "p1-dance");
expectEq("2교시가 아님", m.programId === "p2-dance", false);
expectEq("확신도 exact", m.confidence, "exact");

// 같은 이름을 2교시로 올린 파일은 2교시로 가야 한다(대칭 검증).
const sheet2 = [
  HEADER,
  row({
    no: "9001",
    prog: "두둠칫 댄스교실 (11:30~12:50)",
    time: "11:30~12:50",
    cap: "13(13/0)",
    name: "김하늘",
    memberId: "x",
    grade: "초등학생",
    birth: "2016-01-01",
    sex: "남",
    phone: "010-1111-2222",
    disabled: "비장애",
    emergency: "01011112222",
    school: "온천초",
    status: "예약 확정",
  }),
];
const p2 = parseErpRows(sheet2);
expectEq("2교시 파일 → 2교시 매칭", matchErpGroup(p2.groups[0], PROGRAMS).programId, "p2-dance");

// 반(class) 대괄호 표기가 갈리는 경우 — 시간이 유일한 구분자.
const sheet3 = [
  HEADER,
  row({
    no: "9002",
    prog: "인공지능 코딩 (10:00~11:20)",
    time: T1,
    cap: "8(8/0)",
    name: "박서준",
    memberId: "y",
    grade: "초등학생",
    birth: "2016-01-01",
    sex: "남",
    phone: "010-3333-4444",
    disabled: "비장애",
    emergency: "01033334444",
    school: "사직초",
    status: "예약 확정",
  }),
];
const p3 = parseErpRows(sheet3);
const m3 = matchErpGroup(p3.groups[0], PROGRAMS);
expectEq(
  "대괄호 표기 차이 — 시간으로 1교시 인공지능 코딩",
  m3.programId,
  "p1-ai"
);
expectEq("확신도 strong(반 표기 제외 일치)", m3.confidence, "strong");

// 완전 일치 후보가 있으면 대괄호 표기 후보를 이긴다(우선순위 검증).
const exactWins: MatchTarget[] = [
  { id: "w1", name: "유튜브 크리에이터", time_start: "13:00:00", time_end: "14:20:00", period_no: 3 },
  { id: "w2", name: "[기초반]유튜브 크리에이터", time_start: "13:00:00", time_end: "14:20:00", period_no: 3 },
];
// 같은 시간대에 반만 다른 프로그램이 둘 → 어느 쪽인지 알 수 없으므로 수동 선택.
const ambiguous: MatchTarget[] = [
  { id: "a1", name: "[기초반]유튜브 크리에이터", time_start: "13:00:00", time_end: "14:20:00", period_no: 3 },
  { id: "a2", name: "[전문반]유튜브 크리에이터", time_start: "13:00:00", time_end: "14:20:00", period_no: 3 },
];
const sheet4 = [
  HEADER,
  row({
    no: "9003",
    prog: "유튜브 크리에이터 (13:00~14:20)",
    time: "13:00~14:20",
    cap: "9(9/0)",
    name: "정다은",
    memberId: "z",
    grade: "중학생",
    birth: "2013-01-01",
    sex: "여",
    phone: "010-5555-6666",
    disabled: "비장애",
    emergency: "01055556666",
    school: "동래중",
    status: "예약 확정",
  }),
];
const g4 = parseErpRows(sheet4).groups[0];
expectEq(
  "완전 일치가 대괄호 후보를 이긴다",
  matchErpGroup(g4, exactWins).programId,
  "w1"
);
const m4 = matchErpGroup(g4, ambiguous);
expectEq("동점 후보는 자동 배정 안 함", m4.programId, null);
expectEq("후보 2개 안내", m4.candidateIds.length, 2);
expectEq("확신도 none", m4.confidence, "none");

console.log("\n--- 순번(가나다순) ---");
const ordered = orderByKoreanName(g.students).map((s) => s.student_name);
expectEq("첫 3명", ordered.slice(0, 3), ["강나경", "강서율", "김나윤"]);
expectEq("마지막 2명", ordered.slice(-2), ["최지유", "황시안"]);
expectEq("인원 보존", ordered.length, 13);

console.log("\n--- 여러 프로그램 혼재 파일 ---");
const mixed = [
  HEADER,
  ...DATA_ROWS,
  row({
    no: "8001",
    prog: "윙윙 드론교실 (10:00~11:20)",
    time: T1,
    cap: "8(8/0)",
    name: "최민호",
    memberId: "d1",
    grade: "초등학생",
    birth: "2015-05-05",
    sex: "남",
    phone: "010-7777-8888",
    disabled: "비장애",
    emergency: "01077778888",
    school: "명륜초",
    status: "예약 확정",
  }),
  row({
    no: "8002",
    prog: "두둠칫 댄스교실 (11:30~12:50)",
    time: "11:30~12:50",
    cap: "13(13/0)",
    name: "한지우",
    memberId: "d2",
    grade: "초등학생",
    birth: "2015-05-05",
    sex: "여",
    phone: "010-9999-0000",
    disabled: "비장애",
    emergency: "01099990000",
    school: "명륜초",
    status: "예약 확정",
  }),
];
const pm = parseErpRows(mixed);
expectEq("그룹 3개(댄스 1교시·드론 1교시·댄스 2교시)", pm.groups.length, 3);
expectEq(
  "그룹별 인원",
  pm.groups.map((x) => [x.baseName, x.timeStart, x.students.length]),
  [
    ["두둠칫 댄스교실", "10:00", 13],
    ["윙윙 드론교실", "10:00", 1],
    ["두둠칫 댄스교실", "11:30", 1],
  ]
);
expectEq("총 반영 대상", pm.confirmedRows, 15);

console.log("\n--- 이상 입력 방어 ---");
const noHeader = parseErpRows([["아무", "관계", "없는"], ["1", "2", "3"]]);
expectEq("머리글 없으면 -1", noHeader.headerRowIndex, -1);
expectEq("머리글 없으면 그룹 0", noHeader.groups.length, 0);

// 머리글이 3행에 있는 파일(위에 안내 문구가 붙는 ERP 변형).
const shifted = [["동래구청소년센터 신청자 목록"], [], HEADER, ...DATA_ROWS];
expectEq("머리글 위치 자동 탐색", parseErpRows(shifted).headerRowIndex, 2);
expectEq("이동해도 인원 동일", parseErpRows(shifted).confirmedRows, 13);

// 파일 내 번호 중복 → 뒤 행 건너뛰고 경고.
const dupSheet = [HEADER, DATA_ROWS[0], DATA_ROWS[0]];
const dupParsed = parseErpRows(dupSheet);
expectEq("중복 번호 1명만 반영", dupParsed.confirmedRows, 1);
expectEq("중복 경고 있음", dupParsed.warnings.length, 1);

console.log("\n--- xlsx 왕복(실제 워크북 바이트) ---");
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(SHEET), "Sheet1");
const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
const fromFile = parseErpWorkbook(new Uint8Array(buf));
expectEq("워크북 파싱 인원", fromFile.confirmedRows, 13);
expectEq("워크북 제외 인원", fromFile.excludedRows, 1);
expectEq(
  "워크북 매칭",
  matchErpGroup(fromFile.groups[0], PROGRAMS).programId,
  "p1-dance"
);

console.log(
  `\n${failures === 0 ? "✅ 전부 통과" : `❌ 실패 ${failures}건`}`
);
process.exit(failures === 0 ? 0 : 1);
