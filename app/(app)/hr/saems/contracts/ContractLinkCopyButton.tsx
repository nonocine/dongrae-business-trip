"use client";

// 강사 계약서 [링크 복사] — 서명 대기(sent) 계약서에서만 씁니다(부르는 쪽이 상태를 거름).
//   방카 회차 신청 링크(bangka/enroll/[rid]/ApplyLinkPanel)와 같은 방식:
//   클릭 즉시 클립보드에 쓰고 2초간 표시, 클립보드가 막힌 브라우저는 prompt 로 대신 보여 줍니다.
//   복사한 뒤 instructor_contract_logs 에 link_copied 를 남깁니다(실패해도 복사는 그대로).
import { useState } from "react";
import { logInstructorContractLinkCopied } from "@/app/(app)/hr/saems/contractActions";
import { instructorContractLink, instructorContractLinkMessage } from "@/lib/instructorContract";

export default function ContractLinkCopyButton({
  contractId,
  saemBase,
  className,
}: {
  contractId: string;
  saemBase: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const text = instructorContractLinkMessage(instructorContractLink(saemBase, contractId));
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("아래 문구를 복사하세요", text);
    }
    void logInstructorContractLinkCopied(contractId);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={className ?? "rounded border border-navy/40 px-2 py-1 text-xs text-navy hover:bg-surface"}
      title="강사에게 보낼 안내 문구와 계약서 링크를 복사합니다"
    >
      {copied ? "✓ 복사했습니다" : "링크 복사"}
    </button>
  );
}
