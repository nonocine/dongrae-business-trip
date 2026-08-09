// =====================================================================
// 인증 공용 상수 — 의존성 없는 순수 상수 모듈.
//   * lib/googleAuth.ts 는 서버 전용(node:crypto 서명)이지만, lib/authLevels.ts 는
//     클라이언트 컴포넌트(app/hr/EmployeeProfileForm.tsx 등)에서도 import 합니다.
//     authLevels → googleAuth 로 이어지면 서명 모듈이 클라이언트 번들에 딸려와
//     브라우저에서 SESSION_SECRET 부재로 throw 합니다.
//   * 그래서 양쪽이 함께 쓰는 상수만 여기로 분리합니다. 이 파일은 아무것도
//     import 하지 않으며 어떤 사이드이펙트도 없습니다.
// =====================================================================

// 허용 도메인 — Google 콘솔 Internal 설정 + 콜백/세션 양쪽에서 이중 검증.
export const GOOGLE_WORKSPACE_DOMAIN = "onnainna.kr";

// 마스터 계정 — employee_profiles 매핑 없이도 무조건 관장 권한으로 통과.
export const MASTER_EMAIL = "master@onnainna.kr";
