// =====================================================================
// 업무 메뉴 단일 출처 — 라벨·경로·아이콘·그룹·권한조건.
//
//   왜 필요한가:
//     좌측 고정 사이드바 개편을 하면 같은 메뉴 정보가 대시보드 카드와 사이드바
//     두 곳에 생깁니다. 한쪽만 고치면 조용히 어긋나므로 먼저 한 곳으로 모읍니다.
//     지금은 대시보드(app/components/EmployeeDashboard.tsx)만 이 배열을 읽고,
//     사이드바가 생기면 같은 배열을 읽습니다.
//
//   ★ 여기에 넣지 않는 것 — 데이터. 배지 숫자는 Record<경로, 숫자> 로 주입받고
//     (badges), 그보다 복잡한 문구는 화면이 descOverrides 로 덮습니다.
//     메뉴 정의가 배지 계산에 오염되면 사이드바가 대시보드의 데이터 조회를
//     그대로 끌고 들어가야 합니다.
//
//   ★ 여기에 없는 카드 — "있을 때만 보이는 알림".
//     내 심사 배정 / 내 의무교육 / 연차 사용계획서는 데이터가 있을 때만 나타나는
//     안내이지 메뉴가 아닙니다. 사이드바에 상주할 항목이 아니므로 화면이 직접
//     그립니다. 공개 페이지(로그인 없이 보는 채용 공고)도 제외합니다.
//
//   ★ 권한 조건은 각 라우트의 실제 서버 가드와 맞춰 둡니다. 메뉴가 가드보다
//     넓으면 눌렀다 튕기고, 좁으면 진입점이 사라집니다. 둘 다 버그입니다.
//     2026-09 대조에서 나온 세 건은 모두 정리했습니다.
//
//       1·2) /hr?tab=records · /hr?tab=recruitment — 가드를 넓혔습니다.
//            requireHrAdmin 이 직급(관장·부장)만 보던 것을 직무·권한등급까지
//            보도록 바꿨습니다(app/hr/actions.ts). 이제 hr·recruitment 직무
//            보유자와 auth_level='M0' 인 직원이 통과합니다. 메뉴 조건은 그대로
//            두어도 가드와 맞습니다(관리자 영역 카드가 M0 몫을 덮습니다).
//
//       3) /hr/facility/* · /hr/salary · /hr/leave-plans — 메뉴를 넓혔습니다.
//          가드가 `isM0 || 직무` 인데 메뉴가 직무만 봤습니다 → m0OrRole 로
//          바꿔 가드와 일치시켰습니다. 가드는 건드리지 않았습니다.
//
//   ★ 여기 조건과 라우트 가드는 각자 따로 삽니다. 이 배열은 '무엇을 보여줄까'
//     를 정할 뿐이고, 실제 차단은 언제나 서버 가드가 합니다. 새 항목을 넣을
//     때는 그 라우트의 가드를 읽고 같은 조건을 쓰세요.
//
//   선례: lib/employeeRoles.ts — 상수 배열 + 순수 헬퍼.
// =====================================================================

// 메뉴 그룹 — 현재 대시보드의 구획을 그대로 옮긴 것입니다.
export const MENU_GROUPS = [
  "common", // 공통 — 전 직원
  "facility", // 담당 업무 › 시설관리
  "accounting", // 담당 업무 › 회계
  "hr", // 담당 업무 › 인사
  "mutual", // 담당 업무 › 상조회
  "recruitment", // 담당 업무 › 채용
  "admin", // 관리자 영역 — M0
  "legacy", // 활동일지 계열 — 5단계에서 하단으로 내립니다
] as const;
export type MenuGroup = (typeof MENU_GROUPS)[number];

export const MENU_GROUP_LABEL: Record<MenuGroup, string> = {
  common: "공통",
  facility: "시설관리",
  accounting: "회계",
  hr: "인사",
  mutual: "상조회",
  recruitment: "채용",
  admin: "관리자 영역",
  legacy: "활동일지",
};

// 노출 조건 — 대시보드와 사이드바가 같은 판정을 쓰게 합니다.
//   everyone: 로그인한 직원 전원
//   m0      : 권한등급 M0(관장·부장·master)
//   role    : 해당 직무(employee_roles) 보유자
//   m0OrRole: M0 이거나 해당 직무 — 가드가 `isM0 || 직무` 인 라우트용.
//     ★ 예전에는 이런 라우트도 role 로만 걸어 두어, facility 직무가 없는
//       관장에게는 비품관리·안전점검·운행기록·대관예약 진입점이 아예 없었습니다
//       (들어갈 수는 있는데 메뉴에 없어 주소를 직접 쳐야 했습니다).
//       메뉴가 가드보다 좁으면 그냥 버그입니다.
//   managerAdmin: /admin 진입 가능 여부 — isManagerAdmin() 과 같은 기준.
//     ★ m0 보다 좁습니다. isM0Grant 는 rank ∈ (관장·부장) 이거나 master 이거나
//       auth_level='M0' 면 참이지만, isManagerAdmin 은 '구글 세션' 이면서
//       master 이거나 rank='관장' 일 때만 참입니다. 부장(M0)도, 비번 로그인도
//       /admin 에서는 튕깁니다. m0 로 걸면 눌렀다 튕기는 메뉴가 됩니다.
export type MenuVisibility =
  | { kind: "everyone" }
  | { kind: "m0" }
  | { kind: "role"; role: string }
  | { kind: "m0OrRole"; role: string }
  | { kind: "managerAdmin" };

export type MenuItem = {
  // 같은 경로가 여러 그룹에 있어(예: /mail 은 공통·관리자 양쪽) 경로로는
  //   가릴 수 없습니다. 키는 화면의 React key 로도 씁니다.
  key: string;
  group: MenuGroup;
  label: string;
  href: string;
  icon: string;
  // 카드 설명(사이드바에서는 쓰지 않습니다).
  desc: string;
  show: MenuVisibility;
  // 5단계에서 하단으로 내릴 항목 표시. 지금은 동작에 영향이 없습니다.
  legacy?: true;
  // 아직 만들지 않은 기능 — 링크 대신 "준비 중" 으로 그립니다.
  pending?: true;
  // 배지를 소비하는 항목만 선언합니다. 인자는 badges[href] 이며, 값이 없으면
  //   undefined 가 들어옵니다("아직 못 셌다" 와 "0건" 은 다른 상태입니다).
  //   ★ 같은 경로라도 그룹마다 문구가 달라 항목별로 따로 둡니다.
  badgeDesc?: (count: number | undefined) => string;
};

// 공용 메일함 — 공통·관리자 양쪽에서 같은 문구를 씁니다.
const mailDesc = (n: number | undefined): string =>
  n && n > 0
    ? `미처리 ${n}건 — 센터 대표 메일 확인·담당 지정`
    : "센터 대표 메일 확인·담당 지정 (미처리 없음)";

export const MENU_ITEMS: MenuItem[] = [
  // ---------- 공통 — 전 직원 ----------
  {
    key: "common-mail",
    group: "common",
    label: "공용 메일함",
    href: "/mail",
    icon: "📬",
    desc: "센터 대표 메일 확인·담당 지정 (미처리 없음)",
    show: { kind: "everyone" },
    badgeDesc: mailDesc,
  },
  {
    key: "common-business-results",
    group: "common",
    label: "사업실적",
    href: "/business-results",
    icon: "📊",
    desc: "담당 사업의 월별 실적·홍보내용 입력",
    show: { kind: "everyone" },
  },
  {
    key: "common-clubs",
    group: "common",
    label: "동아리관리",
    href: "/hr/clubs",
    icon: "🎸",
    desc: "동아리샘·활동일지·월간 결과보고·실적 연계",
    show: { kind: "everyone" },
  },
  {
    // 2026-09 관장 지시로 '담당 업무 › 강사관리' 에서 공통으로 옮겼습니다.
    //   동아리관리와 같은 정책 — 로그인한 직원이면 누구나 들어옵니다.
    //   단 계좌·주민번호·정산 금액·수강생 연락처는 여전히 관리 권한(M0 또는
    //   saem 직무)에게만 갑니다. lib/saemAccess.ts 의 resolveSaemView 참고.
    key: "saem-instructors",
    group: "common",
    label: "강사·프로그램 관리",
    href: "/hr/saems/instructors",
    icon: "🧑‍🏫",
    desc: "외부 강사·프로그램·근무일지 조회 (편성·정산은 담당자)",
    show: { kind: "everyone" },
  },
  {
    key: "common-profile",
    group: "common",
    label: "내 인사기록카드",
    href: "/profile/hr",
    icon: "🗂",
    desc: "내 인사정보·증명사진·첨부서류 입력/수정",
    show: { kind: "everyone" },
  },
  // 명함첩·거래처 — 관장 결정으로 전 직원 열람(협업 자산)이 되어 관리자
  //   영역에서 여기로 내렸습니다. 비공개(🔒) 항목만 관장·부장·인사 담당자에게
  //   보이며, 그 필터는 서버에서 겁니다.
  //   거래처관리는 시설관리 그룹에도 두었다가(8/17), 시설 직무가 없는 직원 눈에
  //   진입점이 안 띈다는 관장 지적으로 8/25 부터 공통에만 둡니다.
  {
    key: "common-cards",
    group: "common",
    label: "명함첩",
    href: "/hr/cards",
    icon: "💳",
    desc: "명함 촬영·AI 판독으로 거래처 연락처 보관",
    show: { kind: "everyone" },
  },
  {
    key: "common-partners",
    group: "common",
    label: "거래처관리",
    href: "/hr/partners",
    icon: "🤝",
    desc: "분야별 거래처·담당자 주소록 (인수인계용)",
    show: { kind: "everyone" },
  },
  {
    key: "common-my-certificates",
    group: "common",
    label: "증명서 발급",
    href: "/profile/hr#my-certificates",
    icon: "🧾",
    desc: "재직증명서 즉시 발급 · 발급 이력",
    show: { kind: "everyone" },
  },
  // 공용 비밀번호 — 전 직원에게 보이되, 목록은 본인이 열람 가능한 항목만
  //   나옵니다(지정 안 된 항목은 존재 자체가 보이지 않음).
  //   문구가 열람 가능 건수 + 관리 권한에 따라 4갈래라 숫자 하나로 표현되지
  //   않습니다 → 화면이 descOverrides 로 덮습니다.
  {
    key: "common-credentials",
    group: "common",
    label: "비밀번호 관리",
    href: "/hr/credentials",
    icon: "🔐",
    desc: "앱·메일·구매·은행 계정 비밀번호 (암호화 보관)",
    show: { kind: "everyone" },
  },
  // MU-5. 상조회는 직원 자치 조직 — 장부·회원·규정은 전 직원 열람.
  {
    key: "common-mutual",
    group: "common",
    label: "상조회 현황",
    href: "/hr/mutual/ledger",
    icon: "🤲",
    desc: "회비 장부·회원 명단·규정 열람 (기입은 담당자)",
    show: { kind: "everyone" },
  },

  // ---------- 담당 업무 › 시설관리 ----------
  {
    key: "facility-assets",
    group: "facility",
    label: "비품관리",
    href: "/hr/facility/assets",
    icon: "📦",
    desc: "비품 대장·장소 관리·엑셀",
    show: { kind: "m0OrRole", role: "facility" },
  },
  {
    key: "facility-safety",
    group: "facility",
    label: "안전점검",
    href: "/hr/facility/safety",
    icon: "🦺",
    desc: "월별 안전점검표·PDF 출력",
    show: { kind: "m0OrRole", role: "facility" },
  },
  {
    key: "facility-driving",
    group: "facility",
    label: "운행기록",
    href: "/hr/facility/driving",
    icon: "🚗",
    desc: "차량 운행일지 조회·월별 운행대장",
    show: { kind: "m0OrRole", role: "facility" },
  },
  {
    key: "facility-rentals",
    group: "facility",
    label: "대관예약",
    href: "/hr/facility/rentals",
    icon: "🏛️",
    desc: "홈페이지 대관·청소년 공간 예약 조회 (조회 전용)",
    show: { kind: "m0OrRole", role: "facility" },
  },

  // ---------- 담당 업무 › 회계 ----------
  {
    key: "accounting-salary",
    group: "accounting",
    label: "급여 기준 관리",
    href: "/hr/salary",
    icon: "💰",
    desc: "호봉표·기준값·직원별 급여 설정",
    show: { kind: "m0OrRole", role: "accounting" },
  },
  {
    // 강사비 지출표 — 회계 담당이 이체·품의를 올리는 화면.
    //   가드는 /hr/salary 와 같은 resolveSalaryAccess(M0 또는 accounting)
    //   이므로 여기 조건도 m0OrRole 로 맞춰 둡니다.
    key: "accounting-payouts",
    group: "accounting",
    label: "강사비 지출표",
    href: "/hr/payouts",
    icon: "🧾",
    desc: "정산 확정분 지급 내역·계좌·합계, 엑셀 내려받기",
    show: { kind: "m0OrRole", role: "accounting" },
  },
  {
    key: "accounting-leave-plans",
    group: "accounting",
    label: "연차 사용촉진",
    href: "/hr/leave-plans",
    icon: "🌴",
    desc: "미사용 연차 사용계획서 발부·수합·서식 출력",
    show: { kind: "m0OrRole", role: "accounting" },
  },
  {
    key: "accounting-budget",
    group: "accounting",
    label: "예산",
    href: "",
    icon: "📊",
    desc: "예산 관리",
    show: { kind: "m0OrRole", role: "accounting" },
    pending: true,
  },

  // ---------- 담당 업무 › 인사 ----------
  {
    key: "hr-records",
    group: "hr",
    label: "직원 인사관리",
    href: "/hr?tab=records",
    icon: "👥",
    desc: "직원 인사기록카드 열람·입력",
    show: { kind: "role", role: "hr" },
  },
  {
    key: "hr-certificates",
    group: "hr",
    label: "증명서 발급대장",
    href: "/hr/certificates",
    icon: "🧾",
    // ★ 관리자 영역의 같은 항목과 달리 승인 대기 배지를 쓰지 않습니다(현행 유지).
    desc: "재직·경력증명서 발급·발급 기록",
    show: { kind: "role", role: "hr" },
  },
  {
    key: "hr-trainings",
    group: "hr",
    label: "의무교육 현황",
    href: "/hr/trainings",
    icon: "🎓",
    desc: "법정 의무교육 등록·이수 현황",
    show: { kind: "role", role: "hr" },
    // 관리자 영역과 달리 0건일 때 "모두 이수" 문구를 쓰지 않습니다(현행 유지).
    badgeDesc: (n) =>
      n && n > 0
        ? `미이수 총 ${n}건 — 등록·현황판`
        : "법정 의무교육 등록·이수 현황",
  },

  // ---------- 담당 업무 › 상조회 ----------
  {
    key: "mutual-manage",
    group: "mutual",
    label: "상조회 관리",
    href: "/hr/mutual/ledger",
    icon: "🤲",
    desc: "회비·장부, 경조사 지출, 연도 마감",
    show: { kind: "role", role: "mutual" },
  },

  // ---------- 담당 업무 › 채용 ----------
  {
    key: "recruitment-manage",
    group: "recruitment",
    label: "채용 관리",
    href: "/hr?tab=recruitment",
    icon: "📢",
    desc: "공고·지원자 전형 관리",
    show: { kind: "role", role: "recruitment" },
  },

  // ---------- 관리자 영역 — M0 ----------
  {
    key: "admin-mail",
    group: "admin",
    label: "공용 메일함",
    href: "/mail",
    icon: "📬",
    desc: "센터 대표 메일 확인·담당 지정 (미처리 없음)",
    show: { kind: "m0" },
    badgeDesc: mailDesc,
  },
  {
    key: "admin-recruitment",
    group: "admin",
    label: "채용 관리",
    href: "/hr?tab=recruitment",
    icon: "📢",
    desc: "공고 작성·게시, 지원자 전형·합격자 전환",
    show: { kind: "m0" },
  },
  {
    key: "admin-records",
    group: "admin",
    label: "전 직원 인사관리",
    href: "/hr?tab=records",
    icon: "👥",
    desc: "인사기록카드 열람·입력, 첨부서류",
    show: { kind: "m0" },
  },
  {
    // 경로는 위와 같지만 사람이 찾는 이름이 달라 카드를 따로 둡니다.
    key: "admin-roles",
    group: "admin",
    label: "권한·직무 지정",
    href: "/hr?tab=records",
    icon: "🔑",
    desc: "권한등급·담당 직무 변경 (인사기록카드 편집)",
    show: { kind: "m0" },
  },
  {
    key: "admin-trainings",
    group: "admin",
    label: "의무교육 현황",
    href: "/hr/trainings",
    icon: "🎓",
    desc: "법정 의무교육 등록·이수 현황",
    show: { kind: "m0" },
    // 집계를 못 받은 경우(undefined)와 0건을 구분합니다.
    badgeDesc: (n) =>
      n == null
        ? "법정 의무교육 등록·이수 현황"
        : n > 0
          ? `미이수 총 ${n}건 — 등록·현황판`
          : "올해 모두 이수 완료 ✓",
  },
  {
    key: "admin-external-judges",
    group: "admin",
    label: "외부 심사위원",
    href: "/hr/external-judges",
    icon: "🧑‍⚖️",
    desc: "심사위원 명단 관리·채용별 배정",
    show: { kind: "m0" },
  },
  {
    key: "admin-mutual",
    group: "admin",
    label: "상조회",
    href: "/hr/mutual/ledger",
    icon: "🤲",
    desc: "회비·장부, 경조사 지출 (상조회 담당과 공유)",
    show: { kind: "m0" },
  },
  {
    key: "admin-certificates",
    group: "admin",
    label: "증명서 발급대장",
    href: "/hr/certificates",
    icon: "🧾",
    desc: "재직·경력증명서 발급·발급 기록",
    show: { kind: "m0" },
    badgeDesc: (n) =>
      n && n > 0
        ? `승인 대기 ${n}건 — 발급·기록`
        : "재직·경력증명서 발급·발급 기록",
  },
  {
    key: "admin-saems",
    group: "admin",
    label: "강사·프로그램 관리",
    href: "/hr/saems/instructors",
    icon: "🧑‍🏫",
    desc: "외부 강사 등록·초대, 프로그램·근무일지(동래샘들)",
    show: { kind: "m0" },
  },
  {
    key: "admin-business-results",
    group: "admin",
    label: "사업실적",
    href: "/business-results",
    icon: "📊",
    desc: "월별 실적 취합·검토·결과보고서",
    show: { kind: "m0" },
  },
  {
    // 상단 가로 네비를 걷어내면서(2026-09) 여기로 옮긴 항목입니다.
    //   예전에는 헤더 네비와 계정 메뉴에만 있어 사이드바에서는 갈 수 없었습니다.
    //   ★ 조건이 managerAdmin 인 이유는 위 MenuVisibility 주석 참고 —
    //     /admin 가드(isManagerAdmin)가 m0 보다 좁습니다.
    key: "admin-console",
    group: "admin",
    label: "관리자 대시보드",
    href: "/admin",
    icon: "🛠",
    desc: "직원 계정·활동 통계 등 관리자 전용 화면",
    show: { kind: "managerAdmin" },
  },

  // ---------- 레거시 — 활동일지 계열 ----------
  //   대시보드 카드로는 지금도 없고 상단 네비(HeaderClient)에만 있습니다.
  //   5단계에서 사이드바 하단으로 내릴 때 쓰려고 정의만 해 둡니다.
  {
    key: "legacy-activities",
    group: "legacy",
    label: "활동일지",
    href: "/activities",
    icon: "📒",
    desc: "외근·출장·교육 활동 기록 조회",
    show: { kind: "everyone" },
    legacy: true,
  },
  {
    key: "legacy-new",
    group: "legacy",
    label: "활동 작성",
    href: "/new",
    icon: "✍️",
    desc: "외근·출장·교육 활동 새로 쓰기",
    show: { kind: "everyone" },
    legacy: true,
  },
];

// --- 판정·조회 헬퍼 (순수 함수) ---------------------------------------

export type MenuContext = {
  isM0: boolean;
  roles: ReadonlySet<string> | string[];
  // /admin 진입 가능 여부(isManagerAdmin). m0 와 기준이 다릅니다 — 위 주석 참고.
  //   값을 주지 않으면 false 로 봅니다(메뉴는 좁게 여는 쪽이 안전합니다).
  isManagerAdmin?: boolean;
};

function hasRole(ctx: MenuContext, role: string): boolean {
  return Array.isArray(ctx.roles)
    ? ctx.roles.includes(role)
    : ctx.roles.has(role);
}

export function canSeeMenuItem(item: MenuItem, ctx: MenuContext): boolean {
  switch (item.show.kind) {
    case "everyone":
      return true;
    case "m0":
      return ctx.isM0;
    case "role":
      return hasRole(ctx, item.show.role);
    case "m0OrRole":
      return ctx.isM0 || hasRole(ctx, item.show.role);
    case "managerAdmin":
      return ctx.isManagerAdmin === true;
  }
}

// 한 그룹에서 이 사람에게 보일 항목들 — 배열에 적힌 순서를 그대로 지킵니다.
export function menuItemsFor(group: MenuGroup, ctx: MenuContext): MenuItem[] {
  return MENU_ITEMS.filter(
    (i) => i.group === group && canSeeMenuItem(i, ctx),
  );
}

// 담당 업무(직무) 그룹들 — 보일 항목이 하나도 없는 그룹은 빼고 돌려줍니다.
export const ROLE_MENU_GROUPS: readonly MenuGroup[] = [
  "facility",
  "accounting",
  "hr",
  "mutual",
  "recruitment",
];

export function roleMenuGroupsFor(
  ctx: MenuContext,
): { group: MenuGroup; label: string; items: MenuItem[] }[] {
  return ROLE_MENU_GROUPS.map((group) => ({
    group,
    label: MENU_GROUP_LABEL[group],
    items: menuItemsFor(group, ctx),
  })).filter((g) => g.items.length > 0);
}

// 카드 설명 — 배지 숫자(경로별)와 화면이 덮은 문구를 반영합니다.
//   우선순위: descOverrides > badgeDesc(badges[href]) > desc
export function menuItemDesc(
  item: MenuItem,
  badges?: Record<string, number | undefined>,
  descOverrides?: Record<string, string>,
): string {
  const override = descOverrides?.[item.key];
  if (override != null) return override;
  if (item.badgeDesc) return item.badgeDesc(badges?.[item.href]);
  return item.desc;
}
