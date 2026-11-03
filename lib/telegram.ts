// =====================================================================
// 텔레그램 봇 알림 — 관장 개인 알림 전용(슬랙 아님). 서버 전용.
//   * TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 가 없으면 조용히 skip.
//   * 실패·타임아웃해도 throw 하지 않습니다(알림 때문에 본 작업이 실패하지 않게).
//   * 토큰은 주소에만 들어가므로 오류 메시지·로그에 주소를 남기지 않습니다.
// =====================================================================

const TIMEOUT_MS = 5000;

export async function sendTelegram(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN/CHAT_ID 미설정 — 알림 skip");
    return false;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 3500), disable_web_page_preview: true }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.warn(`[telegram] 응답 ${res.status}`);
      return false;
    }
    return true;
  } catch {
    console.warn("[telegram] 발송 실패");
    return false;
  } finally {
    clearTimeout(timer);
  }
}
