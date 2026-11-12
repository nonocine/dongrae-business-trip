"use client";

import { useState, useTransition } from "react";
import { backfillSensitiveEncryption, type BackfillResult } from "@/app/(app)/admin/sensitive/actions";

// [민감정보 암호화 채우기] — 일회성. 몇 번을 눌러도 이미 채운 행은 건너뜁니다.
export default function BackfillButton() {
  const [res, setRes] = useState<BackfillResult | null>(null);
  const [pending, start] = useTransition();

  function run() {
    if (!confirm("직원 주민번호·강사 계좌번호 중 암호문이 없는 행을 암호화해 채웁니다. 진행할까요?")) return;
    start(async () => setRes(await backfillSensitiveEncryption()));
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="rounded-md bg-navy px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? "암호화 중…" : "민감정보 암호화 채우기"}
      </button>
      {res &&
        (res.ok ? (
          <ul className="space-y-0.5 text-sm text-ink-body">
            <li>
              직원 주민번호 — 새로 암호화 {res.rrn.encrypted}건 · 이미 암호화 {res.rrn.alreadyEncrypted}건
              {res.rrn.invalid > 0 && ` · 형식 오류(13자리 아님) ${res.rrn.invalid}건`}
              {res.rrn.failed > 0 && ` · 저장 실패 ${res.rrn.failed}건`}
            </li>
            <li>
              강사 계좌번호 — 새로 암호화 {res.bank.encrypted}건 · 이미 암호화 {res.bank.alreadyEncrypted}건
              {res.bank.invalid > 0 && ` · 형식 오류 ${res.bank.invalid}건`}
              {res.bank.failed > 0 && ` · 저장 실패 ${res.bank.failed}건`}
            </li>
          </ul>
        ) : (
          <p className="text-sm text-stamp">{res.message}</p>
        ))}
    </div>
  );
}
