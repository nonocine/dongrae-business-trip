// =====================================================================
// 내 인사기록카드(/profile/hr) 탭 ↔ 주소 해시 — 순수 모듈(화면·메뉴 공용).
//   MyHrTabs(탭 전환)와 lib/menuActive(사이드바 선택 표시)가 같은 표를 씁니다.
//   새 해시(#info/#certs/#trainings)와 함께, 기존 북마크·대시보드 링크가 쓰던
//   섹션 앵커(#my-trainings/#my-certificates/#duty-record 등)도 같은 탭으로 매핑합니다.
// =====================================================================

export type MyHrTabKey = "info" | "contracts" | "certs" | "trainings" | "erpLeave" | "leave" | "discipline";

export const HASH_TO_TAB: Record<string, MyHrTabKey> = {
  info: "info",
  profile: "info",
  contracts: "contracts",
  contract: "contracts",
  "my-contracts": "contracts",
  certs: "certs",
  certificates: "certs",
  "my-certificates": "certs",
  trainings: "trainings",
  "my-trainings": "trainings",
  "erp-leave": "erpLeave",
  "duty-record": "erpLeave",
  duty: "erpLeave",
  erpleave: "erpLeave",
  annual: "erpLeave",
  "my-leave": "erpLeave",
  leave: "leave",
  "leave-plan": "leave",
  "my-leave-plan": "leave",
  discipline: "discipline",
  incident: "discipline",
  award: "discipline",
};

export function tabFromHash(hash: string): MyHrTabKey | null {
  const key = hash.replace(/^#/, "").trim().toLowerCase();
  return HASH_TO_TAB[key] ?? null;
}
