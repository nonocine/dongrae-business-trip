// 대관예약 조회 화면의 순수 규칙 검증 — 네트워크·DB 없이 돕니다.
//   실행: npm run test:rental-view
//
//   ① 시설(센터/온나) 판정 — space_name 의 '온나' 접두사
//   ② 공간 표기 중복 제거 — space_name 과 room_name 이 겹치는 실물 사례
//   ③ 온나 탭의 '온나' 접두사 생략
//   ④ 요약이 확정 건만 세는지
//
//   ①②의 fixture 는 라이브 DB 에서 뽑은 실제 조합입니다(2026-09-10, 12,851건
//   에서 space/room 조합 52종). 업체가 공간명을 바꾸면 여기가 먼저 깨집니다.
//   ※ 동기화 로직(lib/rentalSync.ts)은 이 스크립트 범위가 아닙니다 —
//     그쪽 라이브 스모크는 npm run test:rental 입니다.

import {
  formatSpace,
  rentalFacility,
  isConfirmed,
  isCancelled,
  RENTAL_FACILITY_LABELS,
  type RentalRow,
} from "../lib/rental";

let failed = 0;
function eq(actual: unknown, expected: unknown, what: string) {
  if (actual === expected) return;
  console.log(`✘ ${what} — 기대 ${JSON.stringify(expected)} / 실제 ${JSON.stringify(actual)}`);
  failed += 1;
}

// --- ① 시설 판정 ---
//   실제 온나 공간 7종 전부와, 접두사가 없는 센터 공간 몇 개.
const ONNA_SPACES = [
  "온나 다목적홀",
  "온나 스낵존",
  "온나 닌텐도존",
  "온나 노래방",
  "온나 숨숨존",
  "온나 보드게임존",
  "온나 네컷사진존",
];
const CENTER_SPACES = [
  "뒹굴뒹굴 청소년 ZONE",
  "룰루랄라 노래방",
  "E-스포츠존",
  "플레이 디딤",
  "와글와글 다목적실",
  "청소년운영위원회(청동거울)",
  "N-PORTS ZONE",
];

eq(ONNA_SPACES.length, 7, "온나 공간 7종");
for (const s of ONNA_SPACES) {
  eq(rentalFacility({ space_name: s }), "onna", `온나 판정: ${s}`);
}
for (const s of CENTER_SPACES) {
  eq(rentalFacility({ space_name: s }), "center", `센터 판정: ${s}`);
}
// 접두사 앞뒤 공백·빈 값도 죽지 않아야 합니다(space_name 빈 행은 실측 0건이지만
//   NOT NULL 이 아닌 컬럼이라 방어).
eq(rentalFacility({ space_name: "  온나 스낵존 " }), "onna", "앞 공백 있는 온나");
eq(rentalFacility({ space_name: "" }), "center", "빈 공간명은 센터로");
eq(rentalFacility({ space_name: null }), "center", "null 공간명은 센터로");
eq(RENTAL_FACILITY_LABELS.onna, "사직동 온나", "온나 정식 이름");
eq(RENTAL_FACILITY_LABELS.center, "센터(본관)", "센터 정식 이름");

// --- ② 공간 표기 중복 제거 ---
//   [space_name, room_name, 기대 표기, 온나탭 기대 표기]
const SPACE_CASES: [string, string, string, string?][] = [
  // 세부 교실이 공간명에 이미 들어있음 → 생략
  ["온나 네컷사진존", "네컷사진존", "온나 네컷사진존", "네컷사진존"],
  ["온나 보드게임존", "보드게임존", "온나 보드게임존", "보드게임존"],
  // 공간명과 완전히 같음 → 생략
  ["플레이 디딤", "플레이 디딤", "플레이 디딤"],
  // "앞말(괄호)" 이고 앞말이 공간명에 있음 → 괄호 안만
  ["온나 스낵존", "스낵존(한강라면)", "온나 스낵존 · 한강라면", "스낵존 · 한강라면"],
  ["온나 스낵존", "스낵존(컵라면)", "온나 스낵존 · 컵라면", "스낵존 · 컵라면"],
  ["룰루랄라 노래방", "노래방(랄라)", "룰루랄라 노래방 · 랄라"],
  ["온나 닌텐도존", "닌텐도(데이지)", "온나 닌텐도존 · 데이지", "닌텐도존 · 데이지"],
  // 앞말이 공간명에 없음 → 세부 교실을 그대로(정보가 있는 값)
  [
    "뒹굴뒹굴 청소년 ZONE",
    "닌텐도(마리오)",
    "뒹굴뒹굴 청소년 ZONE · 닌텐도(마리오)",
  ],
  ["뒹굴뒹굴 청소년 ZONE", "플스(소닉)", "뒹굴뒹굴 청소년 ZONE · 플스(소닉)"],
  // '숨숨존' vs '숨숨방' — 글자가 달라 앞말을 못 걷어냅니다. 살짝 겹치지만
  //   어느 방인지가 정보라 그대로 두는 쪽을 택했습니다(알려진 허용 사례).
  ["온나 숨숨존", "숨숨방(스며듦)", "온나 숨숨존 · 숨숨방(스며듦)", "숨숨존 · 숨숨방(스며듦)"],
  // 괄호가 없고 겹치지도 않음 → 그대로
  ["E-스포츠존", "PC10", "E-스포츠존 · PC10"],
  // 세부 교실이 없음
  ["두둠칫 댄스실", "", "두둠칫 댄스실"],
  ["온나 다목적홀", "", "온나 다목적홀", "다목적홀"],
  // 공간명 자체에 괄호가 있고 세부 교실은 없음 → 손대지 않음
  ["청소년운영위원회(청동거울)", "", "청소년운영위원회(청동거울)"],
];

for (const [space, room, expected, onnaExpected] of SPACE_CASES) {
  const row = { space_name: space, room_name: room };
  eq(formatSpace(row), expected, `공간 표기: ${space} + ${room || "(없음)"}`);
  if (onnaExpected !== undefined) {
    eq(
      formatSpace(row, { onnaTab: true }),
      onnaExpected,
      `온나탭 표기: ${space} + ${room || "(없음)"}`,
    );
  }
}

// 개편 전 표기보다 길어지는 조합은 없어야 합니다(줄바꿈을 없애려는 개편이므로).
for (const [space, room] of SPACE_CASES) {
  const before =
    space && room && room !== space ? `${space} (${room})` : space || room;
  const after = formatSpace({ space_name: space, room_name: room });
  if (after.length > before.length) {
    console.log(`✘ 표기가 더 길어짐: ${before} → ${after}`);
    failed += 1;
  }
}

// 빈 값 방어 — 둘 다 없으면 "-".
eq(formatSpace({ space_name: "", room_name: "" }), "-", "공간·교실 모두 없음");
eq(
  formatSpace({ space_name: "", room_name: "PC01" }),
  "PC01",
  "공간명만 없을 때는 교실명",
);

// --- ④ 확정/취소 판정 (요약이 확정 건만 세는 근거) ---
const rows: Pick<RentalRow, "status">[] = [
  { status: "Y" },
  { status: "Y" },
  { status: "N" },
  { status: "C" },
];
eq(rows.filter(isConfirmed).length, 2, "확정 건수");
eq(rows.filter(isCancelled).length, 1, "취소 건수");
eq(rows.filter((r) => !isConfirmed(r) && !isCancelled(r)).length, 1, "신청 중 건수");
// 소문자로 와도 확정으로 읽어야 합니다(status 는 업체 값).
eq(isConfirmed({ status: "y" }), true, "소문자 y 도 확정");

console.log(
  failed === 0
    ? `모두 통과 (시설 판정 ${ONNA_SPACES.length + CENTER_SPACES.length}종 · 공간 표기 ${SPACE_CASES.length}조합)`
    : `실패 ${failed}건`,
);
process.exit(failed === 0 ? 0 : 1);
