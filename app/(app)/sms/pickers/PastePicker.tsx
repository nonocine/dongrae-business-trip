"use client";

import { useMemo, useState } from "react";
import { parseContactLines } from "@/lib/sms/text";
import { btnPrimary, inputCls, labelCls } from "@/lib/ui";
import type { PickerProps } from "./types";

// 'paste' 선택기 — 한 줄에 "이름, 번호" / 번호만 / 엑셀 두 열(탭). 잘못된 줄은 빨갛게.
//   선택값 = { text } — 사용자가 쓴 번호라 그대로 서버로 갑니다.
export default function PastePicker({ onAdd }: PickerProps) {
  const [text, setText] = useState("");
  const lines = useMemo(() => parseContactLines(text), [text]);
  const valid = lines.filter((l) => l.valid);
  const invalid = lines.filter((l) => !l.valid);

  return (
    <div className="space-y-3">
      <label className="block">
        <span className={labelCls}>한 줄에 한 명 — “이름, 번호” 또는 번호만 (엑셀에서 이름·번호 두 열을 복사해 붙여도 됩니다)</span>
        <textarea
          className={`${inputCls} h-36 font-mono`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"홍길동, 010-1234-5678\n010-9876-5432\n김철수\t01011112222"}
        />
      </label>
      <p className="text-sm text-ink-body">
        번호 {valid.length}개 인식
        {invalid.length > 0 && <span className="ml-2 font-semibold text-stamp">잘못된 번호 {invalid.length}개</span>}
      </p>
      {invalid.length > 0 && (
        <ul className="max-h-32 overflow-y-auto rounded-lg border border-stamp/40 bg-stamp-soft p-2 text-xs text-stamp">
          {invalid.map((l, i) => (
            <li key={`${l.line}-${i}`}>
              {l.line}번째 줄: {l.raw}
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          className={btnPrimary}
          disabled={valid.length === 0}
          onClick={() => {
            onAdd({ text });
            setText("");
          }}
        >
          {valid.length}명 담기
        </button>
      </div>
    </div>
  );
}
