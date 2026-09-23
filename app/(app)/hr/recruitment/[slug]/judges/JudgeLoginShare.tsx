"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { cardCls, btnPrimary, btnSecondary } from "@/lib/ui";

// =====================================================================
// 위원 로그인 안내 — 로그인 URL 복사 + QR 코드(모달·인쇄) 공유.
//   * URL 은 클라이언트의 실제 origin 기준으로 구성(로컬/배포 일관).
//   * QR 은 qrcode 패키지로 data URL 생성(브라우저).
// =====================================================================
export default function JudgeLoginShare({
  slug,
  judgeNames = [],
}: {
  slug: string;
  judgeNames?: string[];
}) {
  const judgeLabel = judgeNames.join(", ");
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  // 실제 접속 도메인 기준으로 로그인 URL 구성.
  //   effect 내 동기 setState(연쇄 렌더) 회피 위해 마이크로태스크로 지연.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const origin = window.location.origin;
    const t = setTimeout(
      () => setUrl(`${origin}/recruitment/${slug}/judge-login`),
      0
    );
    return () => clearTimeout(t);
  }, [slug]);

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

  async function handleOpenQr() {
    setModalOpen(true);
    if (qrDataUrl || !url) return;
    try {
      const data = await QRCode.toDataURL(url, {
        width: 300,
        margin: 2,
        color: { dark: "#1e3a5f", light: "#ffffff" },
      });
      setQrDataUrl(data);
    } catch {
      setQrError("QR 코드 생성에 실패했습니다.");
    }
  }

  function handlePrint() {
    if (!qrDataUrl) return;
    const w = window.open("", "_blank", "width=420,height=520");
    if (!w) {
      window.alert("팝업이 차단되었습니다. 팝업 허용 후 다시 시도해주세요.");
      return;
    }
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    w.document.write(
      `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"/>` +
        `<title>외부위원 로그인 QR</title></head>` +
        `<body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:'Malgun Gothic',sans-serif;color:#1e3a5f">` +
        `<img src="${qrDataUrl}" alt="QR" style="width:300px;height:300px"/>` +
        `<p style="margin:16px 0 4px;font-size:15px;font-weight:700">외부위원 로그인</p>` +
        (judgeLabel
          ? `<p style="margin:0 0 4px;font-size:13px;color:#1e3a5f">대상 위원: ${esc(judgeLabel)}</p>`
          : "") +
        `<p style="margin:0;font-size:12px;color:#888;word-break:break-all;text-align:center;padding:0 24px">${url}</p>` +
        `</body></html>`
    );
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 350);
  }

  return (
    <section className={`${cardCls} mb-5 border-l-4 border-l-brand-blue`}>
      <h3 className="flex items-center gap-2 text-sm font-bold text-brand-blue">
        <span aria-hidden>🔗</span> 위원 로그인 안내
      </h3>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-muted sm:text-sm">
        위원님들이 아래 QR 또는 링크로 접속 후 이름과 등록된 연락처로 로그인합니다.
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="text"
          readOnly
          value={url || "주소를 불러오는 중…"}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs text-ink-body"
        />
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={handleCopy}
            disabled={!url}
            className={`${btnSecondary} flex-1 sm:flex-none`}
          >
            {copied ? "✓ 복사됨" : "링크 복사"}
          </button>
          <button
            type="button"
            onClick={handleOpenQr}
            disabled={!url}
            className={`${btnPrimary} flex-1 sm:flex-none`}
          >
            QR 코드 보기
          </button>
        </div>
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="w-full max-w-xs rounded-xl border border-line bg-card p-5 text-center shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className="text-sm font-bold text-ink">외부위원 로그인 QR</h4>
            {judgeLabel && (
              <p className="mt-1.5 text-xs font-medium text-ink-body">
                대상 위원{" "}
                <span className="text-ink-muted">({judgeNames.length}명)</span>
                <br />
                <span className="font-semibold text-navy">{judgeLabel}</span>
              </p>
            )}
            <div className="mt-3 flex items-center justify-center">
              {qrError ? (
                <p className="py-16 text-sm text-stamp">{qrError}</p>
              ) : qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrDataUrl}
                  alt="외부위원 로그인 QR 코드"
                  className="h-[300px] w-[300px] max-w-full"
                />
              ) : (
                <p className="py-16 text-sm text-ink-muted">
                  QR 생성 중…
                </p>
              )}
            </div>
            <p className="mt-2 break-all font-mono text-[11px] text-ink-hint">
              {url}
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <button
                type="button"
                onClick={handlePrint}
                disabled={!qrDataUrl}
                className={btnPrimary}
              >
                인쇄
              </button>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className={btnSecondary}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
