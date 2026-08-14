// 양식 PDF 검증용 공용 도구 — 근무일지·출석부 테스트가 함께 쓴다.
//   렌더러 없이 "무엇이 어디에 그려졌나"를 확인하려면 콘텐츠 스트림을 직접 읽어야 한다.
//   pdf-lib 는 사각형을 `re` 가 아니라 translate(cm) + 경로(m/l)로 그리고,
//   이미지는 translate + scale 뒤 `/X Do` 로 그린다 — 그 패턴을 좌표로 되읽는다.
import { deflateSync } from "zlib";
import { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } from "pdf-lib";

export type Box = { x: number; y: number; w: number; h: number };

// 페이지 콘텐츠 스트림을 문자열로. (PDF 좌표 = 좌하단 원점)
export async function pageOps(
  bytes: Uint8Array,
  pageIndex = 0
): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const contents = doc.getPage(pageIndex).node.Contents();
  if (!contents) return "";
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((r) => doc.context.lookup(r))
      : [contents];
  return streams
    .map((s) =>
      s instanceof PDFRawStream
        ? Buffer.from(decodePDFRawStream(s).decode()).toString("latin1")
        : ""
    )
    .join("\n");
}

// translate 뒤 `0 0 m / 0 H l / W H l` 경로 → 사각형(y = 아래쪽 변).
export function rects(ops: string): Box[] {
  const re =
    /1 0 0 1 (-?[\d.]+) (-?[\d.]+) cm[\s\S]{0,80}?0 0 m\s+0 (-?[\d.]+) l\s+(-?[\d.]+) \3 l/g;
  const out: Box[] = [];
  for (const m of ops.matchAll(re))
    out.push({
      x: Number(m[1]),
      y: Number(m[2]),
      w: Number(m[4]),
      h: Number(m[3]),
    });
  return out;
}

// translate + rotate(항등) + scale + skew(항등) + `/X Do` → 그려진 이미지 박스.
export function images(ops: string): Box[] {
  const re =
    /1 0 0 1 (-?[\d.]+) (-?[\d.]+) cm\s+1 0 0 1 0 0 cm\s+(-?[\d.]+) 0 0 (-?[\d.]+) 0 0 cm\s+1 0 0 1 0 0 cm\s+\/[\w.-]+ Do/g;
  const out: Box[] = [];
  for (const m of ops.matchAll(re))
    out.push({
      x: Number(m[1]),
      y: Number(m[2]),
      w: Number(m[3]),
      h: Number(m[4]),
    });
  return out;
}

// --- 서명·도장 대역 PNG 를 즉석에서 만든다(고정 바이트를 저장소에 두지 않기 위해) ---
function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// 가운데에 가로 획 하나가 있는 RGBA PNG 바이트.
//   w×h 비율만 맞으면 검증에는 충분하다(실제 손서명·도장도 트림된 이미지다).
export function inkPngBytes(w: number, h: number): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((1 + w * 4) * h);
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * 4);
    raw[off] = 0; // filter: none
    const ink = y > h * 0.4 && y < h * 0.6;
    for (let x = 0; x < w; x++) {
      const p = off + 1 + x * 4;
      raw[p] = raw[p + 1] = raw[p + 2] = 0;
      raw[p + 3] = ink ? 255 : 0;
    }
  }
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk("IHDR", ihdr),
      pngChunk("IDAT", deflateSync(raw)),
      pngChunk("IEND", Buffer.alloc(0)),
    ])
  );
}

// DB(saem_instructors.signature_data)에 들어 있는 것과 같은 모양의 dataURL.
export function signaturePng(w: number, h: number): string {
  return `data:image/png;base64,${Buffer.from(inkPngBytes(w, h)).toString(
    "base64"
  )}`;
}
