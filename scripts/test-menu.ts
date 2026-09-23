// =====================================================================
// 메뉴 노출 조건 검증 — lib/menu.ts 는 순수 모듈이라 DB 없이 확인합니다.
//
//   왜 필요한가:
//     메뉴 조건과 라우트 가드가 어긋나면 두 가지로 터집니다.
//       · 메뉴가 넓으면  → 눌렀는데 홈으로 튕긴다
//       · 메뉴가 좁으면  → 들어갈 수 있는데 진입점이 없다(주소를 직접 쳐야 함)
//     후자가 실제로 있었습니다. /hr/facility/* · /hr/salary 는 가드가
//     `isM0 || 직무` 인데 메뉴는 직무만 봐서, facility 직무가 없는 관장에게
//     비품관리·안전점검·운행기록·대관예약이 아예 안 보였습니다.
//     지금 운영 인원은 관장·부장이 그 직무를 갖고 있어 화면으로는 드러나지
//     않으므로(직무를 떼는 순간 드러남) 여기서 조건 자체를 확인합니다.
// =====================================================================

import {
  MENU_ITEMS,
  canSeeMenuItem,
  menuItemsFor,
  roleMenuGroupsFor,
  type MenuContext,
} from "../lib/menu";

function assert(cond: boolean, message: string) {
  if (!cond) throw new Error(message);
}

const ctx = (isM0: boolean, roles: string[]): MenuContext => ({
  isM0,
  roles: new Set(roles),
});

function sees(c: MenuContext, key: string): boolean {
  const item = MENU_ITEMS.find((i) => i.key === key);
  if (!item) throw new Error(`메뉴 항목이 없습니다: ${key}`);
  return canSeeMenuItem(item, c);
}

// --- 1) c) 수정 — 가드가 `isM0 || 직무` 인 항목 -------------------------
const M0_OR_ROLE = [
  ["facility-assets", "facility"],
  ["facility-safety", "facility"],
  ["facility-driving", "facility"],
  ["facility-rentals", "facility"],
  ["accounting-salary", "accounting"],
  ["accounting-leave-plans", "accounting"],
] as const;

for (const [key, role] of M0_OR_ROLE) {
  // ★ 직무가 없는 M0(=관장) 도 보여야 합니다. 이게 고친 버그입니다.
  assert(
    sees(ctx(true, []), key),
    `${key}: 직무 없는 M0 에게 보여야 합니다(가드가 isM0 || ${role}).`,
  );
  // 직무만 있는 일반 직원도 보여야 합니다.
  assert(
    sees(ctx(false, [role]), key),
    `${key}: ${role} 직무 보유자에게 보여야 합니다.`,
  );
  // 둘 다 아니면 안 보입니다.
  assert(
    !sees(ctx(false, ["saem"]), key),
    `${key}: M0 도 ${role} 직무도 아니면 보이면 안 됩니다.`,
  );
}

// --- 2) 직무 전용 항목은 M0 라고 해서 '담당 업무' 에 끼어들지 않습니다 ---
//   M0 의 진입점은 '관리자 영역' 카드가 따로 맡습니다(중복 노출 방지).
for (const key of ["hr-records", "hr-certificates", "hr-trainings"]) {
  assert(
    !sees(ctx(true, []), key),
    `${key}: 직무 없는 M0 의 '담당 업무' 에는 나오면 안 됩니다(관리자 영역이 맡음).`,
  );
  assert(sees(ctx(false, ["hr"]), key), `${key}: hr 직무에게 보여야 합니다.`);
}
assert(
  sees(ctx(false, ["recruitment"]), "recruitment-manage"),
  "recruitment 직무는 채용 관리를 봐야 합니다.",
);
assert(
  !sees(ctx(false, ["hr"]), "recruitment-manage"),
  "hr 직무에게 채용 관리가 보이면 안 됩니다(영역이 다릅니다).",
);

// --- 3) 공통·관리자 --------------------------------------------------
assert(sees(ctx(false, []), "common-mail"), "공통은 전 직원에게 보입니다.");
assert(
  !sees(ctx(false, ["hr"]), "admin-records"),
  "관리자 영역은 M0 만 봅니다.",
);
assert(sees(ctx(true, []), "admin-records"), "M0 는 관리자 영역을 봅니다.");

// --- 4) 직무가 하나도 없는 일반 직원 ----------------------------------
//   공통만 보이고 '담당 업무'·'관리자 영역' 은 비어 있어야 합니다.
const plain = ctx(false, []);
assert(
  roleMenuGroupsFor(plain).length === 0,
  "직무가 없으면 '담당 업무' 그룹이 하나도 없어야 합니다.",
);
assert(
  menuItemsFor("admin", plain).length === 0,
  "직무가 없으면 관리자 영역이 비어야 합니다.",
);
assert(
  menuItemsFor("common", plain).length > 0,
  "공통은 누구에게나 있어야 합니다.",
);

// --- 5) 직무 없는 M0 가 보는 '담당 업무' -------------------------------
//   시설·회계만 나오고(가드가 isM0 를 받아주므로), 인사·채용은 관리자 영역이
//   맡으므로 나오지 않습니다.
const m0NoRole = roleMenuGroupsFor(ctx(true, [])).map((g) => g.group);
assert(
  JSON.stringify(m0NoRole) === JSON.stringify(["facility", "accounting"]),
  `직무 없는 M0 의 담당 업무 그룹이 예상과 다릅니다: ${m0NoRole.join(",")}`,
);

// --- 6) 키 중복 방지 ---------------------------------------------------
const keys = MENU_ITEMS.map((i) => i.key);
assert(
  new Set(keys).size === keys.length,
  "MENU_ITEMS 의 key 가 중복됩니다(화면 React key 로도 쓰입니다).",
);
// pending 이 아닌 항목은 경로가 있어야 합니다.
for (const i of MENU_ITEMS) {
  assert(
    i.pending === true || i.href.length > 0,
    `${i.key}: 경로가 비어 있는데 pending 이 아닙니다.`,
  );
}

console.log(`✓ isM0 || 직무 항목 ${M0_OR_ROLE.length}개 — 직무 없는 M0 도 보임`);
console.log("✓ 직무 전용 항목은 M0 의 담당 업무에 끼어들지 않음");
console.log("✓ 직무 없는 일반 직원 — 공통만, 담당 업무·관리자 영역 없음");
console.log(`✓ key 중복 없음(${keys.length}개) · 경로 누락 없음`);
console.log("\n메뉴 노출 조건 검증 통과");
