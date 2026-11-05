"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { btnPrimary, btnSecondary, noticeError } from "@/lib/ui";

// =====================================================================
// 링크 발행 — 보호자 정식 신청 주소(동래방카 /apply) 복사 · QR(PNG 1000px) · 문자 안내.
//   * 링크는 회차마다 같습니다(/apply 가 지금 보일 회차를 알아서 고름).
//   * [문자로 안내]는 동업자씨 /sms 를 본문만 채워 엽니다 — 받는 사람은 거기서 고릅니다.
// =====================================================================

export default function ApplyLinkPanel({ url, title, smsBody }: { url: string; title: string; smsBody: string }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function copy() {
    setErr(null);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("아래 링크를 복사하세요", url);
    }
  }

  async function downloadQr() {
    setErr(null);
    setBusy(true);
    try {
      const dataUrl = await QRCode.toDataURL(url, {
        width: 1000,
        margin: 4,
        errorCorrectionLevel: "M",
        color: { dark: "#000000", light: "#ffffff" },
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${title.replace(/[\\/:*?"<>|]/g, "_")}_신청QR.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      setErr("QR 코드를 만들지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="text-sm font-semibold text-ink">보호자 신청 링크</p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="text"
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-lg border border-line bg-card px-3 py-2 font-mono text-xs text-ink-body"
        />
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnPrimary} onClick={copy}>
            {copied ? "✓ 복사됨" : "링크 복사"}
          </button>
          <button type="button" className={btnSecondary} disabled={busy} onClick={downloadQr}>
            QR코드 내려받기
          </button>
          <button
            type="button"
            className={btnSecondary}
            onClick={() => router.push(`/sms?body=${encodeURIComponent(smsBody)}`)}
          >
            문자로 안내
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-ink-hint">
        모든 회차가 같은 주소입니다. 보호자 화면은 접수중 → 모집 예정 → 마감 순으로 가장 가까운 회차 하나를 보여 줍니다.
      </p>
      {err && <p className={`mt-2 ${noticeError}`}>{err}</p>}
    </div>
  );
}
