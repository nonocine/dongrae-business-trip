// =====================================================================
// dataURL(base64) → 바이트. 서버·브라우저 공용.
//   * 서버에서는 기존 lib/recruitmentApplicantDocData.decodeDataUrl 과 똑같이
//     Buffer 로 푼다(잘못된 글자를 건너뛰는 관대한 해석 그대로).
//   * 브라우저(일괄 출력)에는 Buffer 가 없어 atob 로 푼다.
//   * 형식이 아니거나 풀리지 않으면 null — 호출부는 그 칸을 빈칸으로 둔다.
// =====================================================================

export function decodeDataUrl(dataUrl: string | null): Uint8Array | null {
  if (!dataUrl) return null;
  const m = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
  if (!m) return null;
  return decodeBase64(m[1]);
}

export function decodeBase64(b64: string): Uint8Array | null {
  try {
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}
