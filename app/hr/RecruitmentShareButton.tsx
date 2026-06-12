"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { btnPrimary, btnSecondary } from "@/lib/ui";

// =====================================================================
// 지원자용 공고 공유 — 공개 상세 URL(/recruitment/[slug]) 복사 + QR(모달·인쇄).
//   * JudgeLoginShare 의 복사/QR/인쇄 패턴을 지원자용 URL 로 재구성.
//   * 절대 URL 은 NEXT_PUBLIC_SITE_URL(있으면) → 없으면 실제 접속 origin 기준.
//     (하드코딩 없이 로컬/배포 일관. 홈페이지에 붙여넣기 좋게 복사 명확히 동작)
// =====================================================================
export default function RecruitmentShareButton({
  slug,
  title,
}: {
  slug: string;
  title: string;
}) {
  const [url, setUrl] = useState("");
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  // 공개 상세 URL 구성 — effect 내 동기 setState 연쇄 회피 위해 마이크로태스크 지연.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const origin =
      process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
    const t = setTimeout(
      () => setUrl(`${origin.replace(/\/+$/, "")}/recruitment/${slug}`),
      0
    );
    return () => clearTimeout(t);
  }, [slug]);

  // 모달이 열리고 URL 이 준비되면 QR 1회 생성.
  useEffect(() => {
    if (!open || !url || qrDataUrl) return;
    let cancelled = false;
    QRCode.toDataURL(url, {
      width: 300,
      margin: 2,
      color: { dark: "#1e3a5f", light: "#ffffff" },
    })
      .then((data) => {
        if (!cancelled) setQrDataUrl(data);
      })
      .catch(() => {
        if (!cancelled) setQrError("QR 코드 생성에 실패했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [open, url, qrDataUrl]);

  async function handleCopy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 클립보드 권한이 없으면 사용자가 직접 복사하도록 안내.
      setCopied(false);
      window.prompt("아래 링크를 복사하세요", url);
    }
  }

  function handlePrint() {
    if (!qrDataUrl) return;
    const w = window.open("", "_blank", "width=420,height=560");
    if (!w) {
      window.alert("팝업이 차단되었습니다. 팝업 허용 후 다시 시도해주세요.");
      return;
    }
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    w.document.write(
      `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"/>` +
        `<title>채용공고 공유 QR</title></head>` +
        `<body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:'Malgun Gothic',sans-serif;color:#1e3a5f">` +
        `<img src="${qrDataUrl}" alt="QR" style="width:300px;height:300px"/>` +
        `<p style="margin:16px 0 4px;font-size:15px;font-weight:700">${esc(title)}</p>` +
        `<p style="margin:0 0 4px;font-size:13px;color:#1e3a5f">스마트폰 카메라로 QR을 스캔하면 채용공고로 이동합니다.</p>` +
        `<p style="margin:0;font-size:12px;color:#888;word-break:break-all;text-align:center;padding:0 24px">${url}</p>` +
        `</body></html>`
    );
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 350);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex grow items-center justify-center rounded-md border border-brand-blue bg-card px-2.5 py-1.5 text-xs font-semibold text-brand-blue hover:bg-brand-blue-soft sm:grow-0 sm:py-1"
      >
        🔗 공유 / QR
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-line bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className="text-sm font-bold text-ink">채용공고 공유</h4>
            <p className="mt-1 break-keep text-xs text-ink-muted">{title}</p>

            <div className="mt-3 flex flex-col gap-2">
              <input
                type="text"
                readOnly
                value={url || "주소를 불러오는 중…"}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs text-ink-body"
              />
              <button
                type="button"
                onClick={handleCopy}
                disabled={!url}
                className={`${btnSecondary} w-full`}
              >
                {copied ? "✓ 링크 복사됨" : "링크 복사"}
              </button>
            </div>

            <div className="mt-4 flex items-center justify-center">
              {qrError ? (
                <p className="py-16 text-sm text-stamp">{qrError}</p>
              ) : qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrDataUrl}
                  alt="채용공고 QR 코드"
                  className="h-[240px] w-[240px] max-w-full"
                />
              ) : (
                <p className="py-16 text-sm text-ink-muted">QR 생성 중…</p>
              )}
            </div>

            <div className="mt-4 flex justify-center gap-2">
              <button
                type="button"
                onClick={handlePrint}
                disabled={!qrDataUrl}
                className={btnPrimary}
              >
                QR 인쇄
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className={btnSecondary}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
