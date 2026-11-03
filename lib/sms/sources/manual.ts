// 출처 ⑧ 직접·붙여넣기 — 한 줄에 "이름, 번호" 또는 번호만. 엑셀 두 열 복사(탭)도 됩니다.
//   사용자가 직접 쓴 번호라 화면 → 서버로 그대로 보냅니다(이 출처만 예외).
//   잘못된 번호는 "번호 없음"으로 세어 빠집니다(화면 선택기가 빨갛게 미리 보여 줌).

import { parseContactLines } from "@/lib/sms/text";
import type { SmsSource } from "./types";

export const manualSource: SmsSource = {
  key: "manual",
  label: "직접·붙여넣기",
  icon: "⌨️",
  description: "이름, 번호 · 엑셀 두 열 복사",
  pickerType: "paste",
  color: "blue",
  canUse: () => true,

  async loadOptions() {
    return { filters: [], items: [] };
  },

  async resolvePhones(_u, sel) {
    const lines = parseContactLines(typeof sel.text === "string" ? sel.text.slice(0, 200_000) : "");
    const people = lines.map((l, i) => ({
      key: `manual:${l.valid ? l.phone : `line${l.line}-${i}`}`,
      name: l.name || (l.valid ? "직접 입력" : `잘못된 번호(${l.raw.slice(0, 20)})`),
      phone: l.valid ? l.phone : null,
      ref: { source: "manual", ref_id: null, phone: l.valid ? l.phone : null },
    }));
    return { label: `직접 입력 ${people.filter((p) => p.phone).length}명`, short: "직접 입력", people };
  },
};
