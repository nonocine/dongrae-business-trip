// =====================================================================
// 언론보도 대표 이미지 — PRESS_AUTOMATION 3-8 ③
//   * 홈페이지 API 는 기사 링크에서 사진을 뽑아 주지 않습니다. 동업자씨가 기사 페이지의
//     og:image(없으면 twitter:image, link rel=image_src)를 찾아 내려받고,
//     홈페이지 규칙(JPG/PNG/GIF, 2MiB 이하)에 맞게 JPG 로 바꿔 press-images 에 보관합니다.
//   * 서버 전용. 바깥 주소를 서버가 직접 여는 기능이라 SSRF 를 막습니다:
//       - http(s) 만, 기본 포트(80·443)만
//       - 주소를 DNS 로 풀어 사설·루프백·링크로컬 등 내부 대역이면 거절
//       - 리다이렉트는 직접 따라가며(최대 3번) 매번 같은 검사
//       - 시간 제한, 받는 크기 제한(HTML 3MB, 이미지 15MB)
//   * 홈페이지 이미지 주소는 인증 없이 열리므로, 여기서는 기사에 공개된 대표 이미지만 다룹니다.
// =====================================================================

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import sharp from "sharp";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { HOMEPAGE_NEWS_LIMITS } from "@/lib/homepageNewsPublish";

export const PRESS_IMAGE_BUCKET = "press-images";

const UA = "Mozilla/5.0 (compatible; dongrae-business-trip/1.0; +https://www.onnainna.kr)";
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const MAX_HTML_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_EDGE = 1600; // 홈페이지 게시판 대표 이미지로 충분한 크기
const MIN_EDGE = 200; // 이보다 작으면 아이콘·로고로 보고 대표 이미지로 쓰지 않음

export class PressImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PressImageError";
  }
}

// --- 주소 안전 검사 ----------------------------------------------------

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // 링크로컬·클라우드 메타데이터
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // 멀티캐스트·예약
  );
}

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) return isPrivateIPv4(ip);
  const v = ip.toLowerCase();
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return (
    v === "::" ||
    v === "::1" ||
    v.startsWith("fc") ||
    v.startsWith("fd") || // 고유 로컬
    v.startsWith("fe8") ||
    v.startsWith("fe9") ||
    v.startsWith("fea") ||
    v.startsWith("feb") || // 링크로컬
    v.startsWith("ff") // 멀티캐스트
  );
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new PressImageError("주소 형식이 올바르지 않습니다.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new PressImageError("http(s) 주소만 열 수 있습니다.");
  }
  if (u.port && u.port !== "80" && u.port !== "443") {
    throw new PressImageError("기본 포트가 아닌 주소는 열지 않습니다.");
  }
  if (u.username || u.password) throw new PressImageError("계정 정보가 든 주소는 열지 않습니다.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addrs.length === 0) throw new PressImageError("주소를 찾을 수 없습니다.");
  if (addrs.some((a) => isPrivateIp(a.address))) {
    throw new PressImageError("내부망 주소는 열지 않습니다.");
  }
  return u;
}

// 리다이렉트를 직접 따라가며 매번 주소 검사. 본문은 maxBytes 까지만 읽습니다.
export async function safeFetch(
  raw: string,
  accept: string,
  maxBytes: number,
): Promise<{ url: string; contentType: string; bytes: Uint8Array }> {
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = await assertPublicUrl(current);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(u, {
        headers: { "User-Agent": UA, Accept: accept },
        redirect: "manual",
        signal: ctrl.signal,
        cache: "no-store",
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        await res.body?.cancel();
        if (!loc) throw new PressImageError(`이동할 주소가 없습니다(HTTP ${res.status}).`);
        current = new URL(loc, u).href;
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw new PressImageError(`페이지를 열지 못했습니다(HTTP ${res.status}).`);
      }
      const declared = Number(res.headers.get("content-length") ?? "0");
      if (declared > maxBytes) {
        await res.body?.cancel();
        throw new PressImageError("파일이 너무 큽니다.");
      }
      const reader = res.body?.getReader();
      if (!reader) throw new PressImageError("빈 응답입니다.");
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new PressImageError("파일이 너무 큽니다.");
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        bytes.set(c, off);
        off += c.byteLength;
      }
      return { url: u.href, contentType: res.headers.get("content-type") ?? "", bytes };
    } catch (e) {
      if (e instanceof PressImageError) throw e;
      const reason = e instanceof Error && e.name === "AbortError" ? "응답 시간 초과" : "연결 실패";
      throw new PressImageError(`페이지를 열지 못했습니다(${reason}).`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new PressImageError("주소 이동이 너무 많습니다.");
}

// --- og:image 찾기 -----------------------------------------------------

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? "") : null;
}

// HTML 에서 대표 이미지 주소 후보를 우선순위대로. 순수 함수(테스트용으로 export).
export function extractImageCandidates(html: string, pageUrl: string): string[] {
  // 이미지 주소는 ASCII 라 문자셋(EUC-KR 등)과 상관없이 latin1 로 읽어도 됩니다.
  //   대표 이미지는 <head> 에만 있습니다. 본문 안 메타 태그(광고·관련기사)는 무시합니다.
  const headEnd = html.search(/<\/head>/i);
  const head = html.slice(0, headEnd >= 0 ? headEnd : 500_000);
  const metas = head.match(/<meta\b[^>]*>/gi) ?? [];
  const links = head.match(/<link\b[^>]*>/gi) ?? [];
  const byKey = (keys: string[]) =>
    metas
      .filter((t) => {
        const k = (attr(t, "property") ?? attr(t, "name") ?? "").toLowerCase();
        return keys.includes(k);
      })
      .map((t) => attr(t, "content"))
      .filter((v): v is string => !!v);

  const raw = [
    ...byKey(["og:image:secure_url", "og:image", "og:image:url"]),
    ...byKey(["twitter:image", "twitter:image:src"]),
    ...links.filter((t) => (attr(t, "rel") ?? "").toLowerCase() === "image_src").map((t) => attr(t, "href") ?? ""),
  ];
  const out: string[] = [];
  for (const r of raw) {
    if (!r) continue;
    try {
      const abs = new URL(r, pageUrl).href;
      if (/^https?:/i.test(abs) && !out.includes(abs)) out.push(abs);
    } catch {
      // 잘못된 주소는 건너뜀
    }
  }
  return out;
}

// --- JPG 변환 ----------------------------------------------------------

// 홈페이지 규칙에 맞는 JPG. 투명 배경은 흰색, 움직이는 GIF 는 첫 장면.
//   2MiB 를 넘으면 품질 → 크기 순으로 낮춥니다.
export async function toHomepageJpeg(input: Uint8Array): Promise<{ jpeg: Buffer; width: number; height: number }> {
  let meta: sharp.Metadata;
  try {
    meta = await sharp(input, { animated: false }).metadata();
  } catch {
    throw new PressImageError("이미지 파일이 아닙니다.");
  }
  if (!meta.width || !meta.height) throw new PressImageError("이미지 크기를 읽지 못했습니다.");
  if (Math.max(meta.width, meta.height) < MIN_EDGE) {
    throw new PressImageError("이미지가 너무 작습니다(로고·아이콘으로 보임).");
  }
  for (const edge of [MAX_EDGE, 1200, 900]) {
    for (const quality of [85, 75, 65]) {
      const { data, info } = await sharp(input, { animated: false })
        .rotate()
        .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
      if (data.byteLength <= HOMEPAGE_NEWS_LIMITS.imageBytes) {
        return { jpeg: data, width: info.width, height: info.height };
      }
    }
  }
  throw new PressImageError("이미지를 2MiB 이하로 줄이지 못했습니다.");
}

// --- 진입점 ------------------------------------------------------------

export type PreparedPressImage = {
  path: string; // press-images 안 경로
  sourceUrl: string; // 원래 이미지 주소(출처)
  bytes: number;
  width: number;
  height: number;
};

// 기사 페이지에서 대표 이미지를 찾아 JPG 로 바꿔 보관합니다. 못 찾으면 null.
//   (사진이 없는 기사는 정상 — 화면에서 직원이 센터 사진을 고르거나 이미지 없이 등록)
export async function fetchArticleImage(
  articleId: string,
  articleUrl: string,
): Promise<PreparedPressImage | null> {
  const page = await safeFetch(articleUrl, "text/html,application/xhtml+xml", MAX_HTML_BYTES);
  const html = new TextDecoder("latin1").decode(page.bytes);
  const candidates = extractImageCandidates(html, page.url);
  if (candidates.length === 0) return null;

  let lastErr: unknown = null;
  for (const src of candidates.slice(0, 3)) {
    try {
      const img = await safeFetch(src, "image/*", MAX_IMAGE_BYTES);
      const { jpeg, width, height } = await toHomepageJpeg(img.bytes);
      const path = await savePressImage(articleId, jpeg);
      return { path, sourceUrl: src, bytes: jpeg.byteLength, width, height };
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr instanceof PressImageError) throw lastErr;
  throw new PressImageError("대표 이미지를 가져오지 못했습니다.");
}

// 직원이 직접 고른 사진(센터 사진 등)도 같은 규칙으로 변환·보관합니다.
export async function storeUploadedPressImage(articleId: string, input: Uint8Array): Promise<PreparedPressImage> {
  const { jpeg, width, height } = await toHomepageJpeg(input);
  const path = await savePressImage(articleId, jpeg);
  return { path, sourceUrl: "", bytes: jpeg.byteLength, width, height };
}

async function savePressImage(articleId: string, jpeg: Buffer): Promise<string> {
  const path = `articles/${articleId}/${Date.now()}.jpg`;
  const { error } = await supabaseAdmin.storage
    .from(PRESS_IMAGE_BUCKET)
    .upload(path, jpeg, { contentType: "image/jpeg", upsert: false });
  if (error) throw new PressImageError(`이미지 보관 실패: ${error.message}`);
  return path;
}

export async function loadPressImage(path: string): Promise<Uint8Array> {
  const { data, error } = await supabaseAdmin.storage.from(PRESS_IMAGE_BUCKET).download(path);
  if (error || !data) throw new PressImageError("보관된 대표 이미지를 읽지 못했습니다.");
  return new Uint8Array(await data.arrayBuffer());
}
