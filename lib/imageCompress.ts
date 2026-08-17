// =====================================================================
// 브라우저 이미지 압축 — canvas 리사이즈 + JPEG 재인코딩.
//   * 명함 촬영본은 원본이 수 MB 라 그대로 올리면 서버 액션 본문·Storage·
//     AI 입력이 모두 무거워집니다. 업로드 전에 긴 변 기준으로 줄입니다.
//   * 클라이언트 전용(canvas/Image 사용) — 서버에서 import 하지 마세요.
// =====================================================================

export type CompressedImage = {
  dataUrl: string; // "data:image/jpeg;base64,...."
  bytes: number; // 인코딩 결과의 대략 크기(base64 → 바이트 환산)
  width: number;
  height: number;
};

const DEFAULT_MAX_EDGE = 1600; // 명함 글자 판독에 충분한 해상도
const QUALITY_STEPS = [0.8, 0.7, 0.6, 0.5];
const TARGET_BYTES = 900 * 1024; // 이 아래로 떨어지면 더 줄이지 않습니다.

function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  // base64 4문자 = 3바이트. 패딩(=)은 제외합니다.
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지를 읽지 못했습니다."));
    };
    img.src = url;
  });
}

// 긴 변을 maxEdge 로 맞춰 축소하고 JPEG 로 재인코딩합니다.
//   목표 용량을 넘으면 품질을 단계적으로 낮춰 다시 인코딩합니다.
export async function compressImageFile(
  file: File,
  maxEdge = DEFAULT_MAX_EDGE,
): Promise<CompressedImage> {
  const img = await loadImage(file);
  const longEdge = Math.max(img.width, img.height) || 1;
  const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이미지를 처리하지 못했습니다.");
  // 투명 PNG 를 JPEG 로 바꾸면 배경이 검게 나오므로 흰색으로 깔아줍니다.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  let dataUrl = canvas.toDataURL("image/jpeg", QUALITY_STEPS[0]);
  for (let i = 1; i < QUALITY_STEPS.length; i += 1) {
    if (dataUrlBytes(dataUrl) <= TARGET_BYTES) break;
    dataUrl = canvas.toDataURL("image/jpeg", QUALITY_STEPS[i]);
  }
  return { dataUrl, bytes: dataUrlBytes(dataUrl), width, height };
}
