// =====================================================================
// 민감정보 가림 표기 — 클라이언트·서버 공용(순수 함수, DB·키 없음).
//   * 주민번호: resident_number_mask / rrn_mask = 앞 7자리("900101-1")
//     → 화면 표기 "900101-1******"
//   * 계좌번호: bank_account_last4 = 뒤 4자리("1234") → 화면 표기 "****1234"
//   전체 값은 서버(lib/sensitiveServer)에서만 복호화합니다.
// =====================================================================

// 숫자 13자리 → 앞 7자리 마스크("900101-1"). 형식이 아니면 null.
export function rrnMaskOf(raw: string | null | undefined): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  return d.length === 13 ? `${d.slice(0, 6)}-${d[6]}` : null;
}

// "900101-1" → "900101-1******". 없으면 "".
export function rrnMaskDisplay(mask: string | null | undefined): string {
  const m = String(mask ?? "").trim();
  return m ? `${m}******` : "";
}

// 계좌번호 → 뒤 4자리 숫자. 숫자가 4자리 미만이면 있는 만큼.
export function accountLast4Of(raw: string | null | undefined): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  return d ? d.slice(-4) : null;
}

// "1234" → "****1234". 없으면 null.
export function accountMaskDisplay(last4: string | null | undefined): string | null {
  const l = String(last4 ?? "").trim();
  return l ? `****${l}` : null;
}

// 열람 목적(주민번호 보기) — 화면 선택지. '기타'는 직접 입력.
export const RRN_VIEW_PURPOSES = ["4대보험", "원천징수", "증명서"] as const;
