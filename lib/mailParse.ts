// =====================================================================
// 공용 메일함 — 순수 파싱·선별 헬퍼 (네트워크·DB 접근 없음).
//   * mailCollector 가 POP3 로 받아온 raw 바이트를 여기서만 해석합니다.
//     DB·Storage 를 건드리지 않으므로 단위 테스트에서 그대로 호출할 수 있습니다.
//   * 인코딩: 한국 메일은 EUC-KR(ks_c_5601-1987)/CP949 가 아직 많습니다.
//     mailparser 가 iconv-lite 로 charset 을 해석하므로, 우리는 소켓에서 받은
//     8bit 바이트를 "문자열로 바꾸지 않고" Buffer 그대로 넘기는 게 핵심입니다.
//     (string 으로 먼저 바꾸면 UTF-8 로 잘못 해석돼 복구 불가로 깨집니다.)
// =====================================================================

import { simpleParser } from "mailparser";

export type ParsedMailAttachment = {
  filename: string;
  size: number;
  contentType: string;
  content: Buffer;
};

export type ParsedMail = {
  message_id: string | null;
  from_name: string;
  from_email: string;
  subject: string;
  body_text: string;
  body_html: string | null;
  received_at: string | null; // ISO
  attachments: ParsedMailAttachment[];
};

// RFC 1939 byte-stuffing 해제 — 본문 줄머리의 ".." 는 실제로는 "." 한 개입니다.
//   POP3 클라이언트가 반드시 되돌려야 하는 처리인데 node-pop3 는 하지 않습니다.
//   base64/QP 본문에는 영향이 없고, 8bit 원문 본문에서만 의미가 있습니다.
export function unstuffDots(raw: Buffer): Buffer {
  const out = Buffer.allocUnsafe(raw.length);
  let w = 0;
  for (let i = 0; i < raw.length; i++) {
    const stuffed =
      raw[i] === 0x2e && // '.'
      raw[i + 1] === 0x2e && // '.'
      i >= 2 &&
      raw[i - 2] === 0x0d && // CR
      raw[i - 1] === 0x0a; // LF
    out[w++] = raw[i];
    if (stuffed) i++; // 두 번째 점은 버립니다.
  }
  return out.subarray(0, w);
}

// 파일명 정리 — 제어문자·경로 구분자 제거(Storage 키 안전). 한글은 그대로 둡니다.
//   정규식 문자클래스에 제어문자를 직접 넣지 않고 코드포인트로 거릅니다.
export function safeFileName(
  name: string | undefined,
  fallback: string,
): string {
  let cleaned = "";
  for (const ch of name ?? "") {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;
    cleaned += ch === "/" || ch === "\\" ? "_" : ch;
  }
  cleaned = cleaned.replace(/^\.+/, "").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 180) : fallback;
}

// Storage 오브젝트 키용 이름 — ASCII 안전 문자로만 만듭니다.
//   ★ 이 함수가 있는 이유(2단계 버그 수정):
//     Supabase Storage 는 오브젝트 키에 한글 등 비ASCII 문자를 허용하지 않아
//     "(공문)2026년 ….pdf" 같은 첨부의 업로드가 조용히 실패했습니다.
//     (508KB PDF 가 화면에 "용량이 커서" 로 잘못 안내된 진짜 원인)
//     표시용 원본 파일명은 attachments.name 에 그대로 보존하고, 키만 안전한
//     이름으로 바꿉니다. 확장자는 열람 시 뷰어 판별에 쓰이므로 살립니다.
export function storageSafeName(name: string, index: number): string {
  const dot = name.lastIndexOf(".");
  const rawBase = dot > 0 ? name.slice(0, dot) : name;
  const rawExt = dot > 0 ? name.slice(dot + 1) : "";

  const asciiOnly = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "");
  const base = asciiOnly(rawBase).replace(/^[._-]+/, "").slice(0, 60);
  const ext = asciiOnly(rawExt).toLowerCase().slice(0, 12);

  // 한글만으로 된 파일명은 base 가 비므로 순번으로 대체합니다.
  const stem = base.length > 0 ? `${index + 1}-${base}` : `attachment-${index + 1}`;
  return ext ? `${stem}.${ext}` : stem;
}

// raw MIME 바이트 → 정규화된 메일 한 통.
export async function parseRawMail(raw: Buffer): Promise<ParsedMail> {
  const parsed = await simpleParser(unstuffDots(raw));

  // from 은 배열일 수 있으나(그룹 주소 등) 대표 1건만 사용합니다.
  const fromValue = Array.isArray(parsed.from)
    ? parsed.from[0]?.value?.[0]
    : parsed.from?.value?.[0];
  const html = typeof parsed.html === "string" ? parsed.html : null;

  const attachments: ParsedMailAttachment[] = (parsed.attachments ?? []).map(
    (a, index) => ({
      filename: safeFileName(a.filename, `attachment-${index + 1}`),
      size: Number(a.size ?? a.content?.length ?? 0),
      contentType: String(a.contentType ?? "application/octet-stream"),
      content: Buffer.from(a.content ?? []),
    }),
  );

  return {
    message_id: parsed.messageId ?? null,
    from_name: String(fromValue?.name ?? "").trim(),
    from_email: String(fromValue?.address ?? "").trim(),
    subject: String(parsed.subject ?? "").trim(),
    body_text: String(parsed.text ?? "").trim(),
    body_html: html,
    received_at: parsed.date ? parsed.date.toISOString() : null,
    attachments,
  };
}

// UIDL 목록에서 "아직 저장하지 않은 것"만 골라 최대 limit 통까지 선별합니다.
//   * uidlPairs: node-pop3 UIDL() 결과 [[msgNumber, uid], ...] (오래된 것부터)
//   * 백로그가 limit 보다 많으면 남은 수를 remaining 으로 알려 다음 주기에 이어갑니다.
export function selectNewUids(
  uidlPairs: string[][],
  knownUids: Set<string>,
  limit: number,
): { picks: { msgNumber: number; uid: string }[]; remaining: number } {
  const fresh: { msgNumber: number; uid: string }[] = [];
  for (const pair of uidlPairs) {
    const msgNumber = Number(pair?.[0]);
    const uid = String(pair?.[1] ?? "").trim();
    if (!Number.isFinite(msgNumber) || msgNumber <= 0 || !uid) continue;
    if (knownUids.has(uid)) continue;
    fresh.push({ msgNumber, uid });
  }
  return {
    picks: fresh.slice(0, limit),
    remaining: Math.max(0, fresh.length - limit),
  };
}
