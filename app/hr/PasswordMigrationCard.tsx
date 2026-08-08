"use client";

import { useState, useTransition } from "react";
import Button from "@/app/components/Button";
import { cardCls, noticeError, noticeSuccess } from "@/lib/ui";
import {
  migratePlaintextPasswords,
  type PasswordHashMigrationResult,
} from "@/app/hr/actions";

// =====================================================================
// SEC-1b: 평문 비밀번호 일괄 해시 전환 (M0 전용 카드)
//   * 비밀번호 "값" 은 그대로 두고 저장 형태만 바꿉니다.
//   * ★ 화면에는 건수만 표시합니다 — 비번 값은 서버 밖으로 나오지 않습니다.
// =====================================================================
export default function PasswordMigrationCard() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<PasswordHashMigrationResult | null>(
    null,
  );
  const [confirming, setConfirming] = useState(false);

  function run() {
    setResult(null);
    start(async () => {
      const res = await migratePlaintextPasswords();
      setResult(res);
      setConfirming(false);
    });
  }

  return (
    <section className={cardCls}>
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        <span aria-hidden>🔐</span>
        비밀번호 일괄 해시 전환
      </h3>
      <p className="mt-2 text-xs leading-6 text-ink-muted">
        예전에 평문으로 저장된 직원 비밀번호를 암호화(bcrypt) 형태로 바꿉니다.
        <b className="text-ink-body">
          {" "}
          비밀번호 자체는 바뀌지 않습니다
        </b>{" "}
        — 저장 형태만 바뀌므로 직원이 비밀번호 로그인을 쓰게 되면 쓰던 비밀번호가
        그대로 통합니다. 이미 암호화된 계정은 건너뜁니다.
      </p>
      <p className="mt-1 text-[11px] text-ink-hint">
        비밀번호 로그인으로 접속하면 그 시점에 자동으로 전환되지만, 구글
        로그인만 쓰는 직원은 전환되지 않아 이 버튼이 필요합니다. 여러 번 실행해도
        안전합니다.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {confirming ? (
          <>
            <span className="text-xs font-semibold text-ink">
              전체 직원 계정을 대상으로 실행할까요?
            </span>
            <Button loading={pending} onClick={run}>
              {pending ? "전환 중…" : "실행"}
            </Button>
            <button
              type="button"
              className="text-xs text-ink-muted underline-offset-2 hover:underline"
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              취소
            </button>
          </>
        ) : (
          <Button variant="secondary" onClick={() => setConfirming(true)}>
            비밀번호 일괄 해시 전환
          </Button>
        )}
      </div>

      {result && !result.ok && (
        <p className={`mt-3 ${noticeError}`}>{result.message}</p>
      )}
      {result && result.ok && (
        <div className={`mt-3 ${noticeSuccess}`}>
          <p className="font-semibold">
            전환 {result.converted}건 · 이미 해시 {result.alreadyHashed}건
          </p>
          <p className="mt-1 text-[11px]">
            {result.empty > 0 && `비밀번호 미설정 ${result.empty}건 · `}
            {result.failed > 0
              ? `실패 ${result.failed}건 (서버 로그 확인 필요)`
              : "실패 0건"}
          </p>
        </div>
      )}
    </section>
  );
}
