// =====================================================================
// 동래방카 미디어(bangka-media 비공개 버킷) — 서버 전용.
//   업로드 흐름(Vercel 함수 요청 본문 4.5MB 제한 때문에 파일은 서버 액션을 거치지 않음):
//     1) 서버가 서명 업로드 URL 발급(createSignedUploadUrl) — 사진은 tmp/, 그 밖은 최종 경로
//     2) 브라우저가 Storage 로 직접 올림(uploadToSignedUrl)
//     3) 서버가 마무리 — 사진은 tmp 원본을 받아 긴 변 1600px 로 줄여 최종 경로에 저장하고
//        tmp 를 지움. 목록용 축소본(가로 400px webp, thumbPathOf)도 함께 만듭니다. 기록(bk_post_files·bk_meals)은 이 단계에서만 씁니다.
//   클라이언트가 보낸 경로는 서버가 발급한 형식인지 다시 확인합니다.
// =====================================================================

import sharp from "sharp";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { BANGKA_MEDIA_BUCKET, BK_IMAGE_MAX_EDGE, BK_THUMB_WIDTH, extOf, thumbPathOf } from "@/lib/bangkaContent";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const TMP_RE = new RegExp(`^tmp/${UUID}\\.[a-z0-9]{1,6}$`);

export const bucket = () => supabaseAdmin.storage.from(BANGKA_MEDIA_BUCKET);

export function newObjectName(name: string, fallbackExt: string): string {
  const ext = extOf(name) || fallbackExt;
  return `${crypto.randomUUID()}.${ext}`;
}

export async function signUpload(path: string): Promise<{ path: string; token: string }> {
  const { data, error } = await bucket().createSignedUploadUrl(path);
  if (error || !data) throw new Error(`업로드 준비 실패: ${error?.message ?? "알 수 없음"}`);
  return { path: data.path, token: data.token };
}

export async function signedUrl(path: string | null, seconds = 3600): Promise<string | null> {
  if (!path) return null;
  const { data } = await bucket().createSignedUrl(path, seconds);
  return data?.signedUrl ?? null;
}

export async function signedUrls(paths: string[], seconds = 3600): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (paths.length === 0) return map;
  const { data } = await bucket().createSignedUrls(paths, seconds);
  for (const d of data ?? []) if (d.path && d.signedUrl) map.set(d.path, d.signedUrl);
  return map;
}

export type ResizedImage = { bytes: Buffer; mime: string; ext: string; width: number; height: number };

// tmp 원본 → 긴 변 1600px. 사진 방향(EXIF)을 바로잡고, PNG 는 투명을 살려 PNG, WebP 는
//   WebP, 그 밖(JPEG·HEIC 등)은 JPEG. 움직이는 GIF 는 줄이지 않고 그대로 둡니다.
export async function resizeImage(input: Buffer, mime: string): Promise<ResizedImage> {
  const meta = await sharp(input, { animated: true }).metadata();
  if (meta.format === "gif" && (meta.pages ?? 1) > 1) {
    return { bytes: input, mime: "image/gif", ext: "gif", width: meta.width ?? 0, height: meta.pageHeight ?? meta.height ?? 0 };
  }
  let img = sharp(input)
    .rotate()
    .resize({ width: BK_IMAGE_MAX_EDGE, height: BK_IMAGE_MAX_EDGE, fit: "inside", withoutEnlargement: true });
  let outMime = "image/jpeg";
  let ext = "jpg";
  if (meta.format === "png" || mime === "image/png") {
    img = img.png({ compressionLevel: 9 });
    outMime = "image/png";
    ext = "png";
  } else if (meta.format === "webp") {
    img = img.webp({ quality: 82 });
    outMime = "image/webp";
    ext = "webp";
  } else {
    img = img.jpeg({ quality: 82, mozjpeg: true });
  }
  const { data, info } = await img.toBuffer({ resolveWithObject: true });
  return { bytes: data, mime: outMime, ext, width: info.width, height: info.height };
}

// tmp 원본을 받아 줄인 뒤 최종 경로(dir/uuid.ext)에 저장하고 tmp 를 지웁니다.
export async function finalizeImage(tmpPath: string, dir: string, mime: string): Promise<ResizedImage & { path: string }> {
  if (!TMP_RE.test(tmpPath)) throw new Error("업로드 경로가 올바르지 않습니다.");
  const { data, error } = await bucket().download(tmpPath);
  if (error || !data) throw new Error("올린 사진을 찾지 못했습니다. 다시 올려 주세요.");
  let resized: ResizedImage;
  try {
    resized = await resizeImage(Buffer.from(await data.arrayBuffer()), mime);
  } catch {
    await bucket().remove([tmpPath]);
    throw new Error("사진을 읽지 못했습니다(지원하지 않는 형식일 수 있습니다 — JPG·PNG 로 다시 올려 주세요).");
  }
  const path = `${dir}/${crypto.randomUUID()}.${resized.ext}`;
  const { error: upErr } = await bucket().upload(path, resized.bytes, { contentType: resized.mime, upsert: false });
  if (upErr) throw new Error(`사진 저장 실패: ${upErr.message}`);
  await uploadThumb(path, resized.bytes);
  await bucket().remove([tmpPath]);
  return { ...resized, path };
}

// 축소본 — 실패해도 원본 저장은 그대로(보호자 앱은 축소본이 없으면 원본을 씁니다).
export async function makeThumb(input: Buffer): Promise<Buffer> {
  return sharp(input).rotate().resize({ width: BK_THUMB_WIDTH, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
}
export async function uploadThumb(path: string, original: Buffer): Promise<boolean> {
  try {
    const { error } = await bucket().upload(thumbPathOf(path), await makeThumb(original), { contentType: "image/webp", upsert: true });
    return !error;
  } catch {
    return false;
  }
}

// 사진을 지울 때 축소본도 함께(없는 파일은 무시됩니다).
export function removeWithThumbs(paths: string[]) {
  return bucket().remove([...paths, ...paths.map(thumbPathOf)]);
}

// 직접 올린 파일(동영상·문서)의 크기·형식 — 실제로 올라갔는지 확인을 겸합니다.
export async function statObject(path: string): Promise<{ size: number; mime: string | null } | null> {
  const slash = path.lastIndexOf("/");
  const { data } = await bucket().list(path.slice(0, slash), { search: path.slice(slash + 1), limit: 1 });
  const o = (data ?? []).find((x) => x.name === path.slice(slash + 1));
  if (!o) return null;
  const m = (o.metadata ?? {}) as { size?: number; mimetype?: string };
  return { size: Number(m.size ?? 0), mime: m.mimetype ?? null };
}
