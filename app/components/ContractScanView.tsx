"use client";

import { useEffect, useMemo } from "react";

// 종이 체결 계약서 원본 스캔(PDF) 보기 — 관리자 '내용' 창과 직원 '내 계약서' 공용.
//   서버가 권한 확인 후 내려준 base64 를 blob URL 로 띄웁니다(서명 URL 노출 없음).
//   휴대폰 브라우저는 PDF 를 첫 쪽만 보여주기도 해서 내려받기 버튼과 함께 씁니다.
export default function ContractScanView({ base64, title }: { base64: string; title: string }) {
  const url = useMemo(() => {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  }, [base64]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-muted">종이로 체결한 계약서 원본(스캔)입니다.</p>
      <iframe title={title} src={url} className="h-[70vh] w-full rounded-md border border-rule bg-white" />
    </div>
  );
}
