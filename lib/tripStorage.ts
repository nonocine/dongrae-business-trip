// =====================================================================
// 활동 첨부(사진·영수증·수료증) 파일 참조 — 클라이언트·서버 공용(서버 전용 import 금지).
//   trip-photos / trip-receipts 는 비공개 버킷으로 바꿉니다(2026-10, docs/TRIP_STORAGE_PUBLIC_URL.md).
//   · DB(activities.photos·receipts·certificate)에는 버킷 안 경로만 저장합니다.
//     예전에 저장된 공개 URL 도 그대로 읽힙니다(tripRefPath 가 경로를 뽑음 — DB 를 고쳐 쓰지 않음).
//   · 화면·보고서는 공개 URL 대신 /api/activity-file 로 엽니다. 그 라우트가 활동 보기 권한
//     (작성자 본인 + 관장·부장·master)을 확인한 뒤 1시간 서명 URL 로 넘겨 줍니다.
//   · 보고서 PDF 처럼 파일 내용을 넣는 곳은 raw=1 — 서버가 직접 내려받은 바이트(같은 출처라 캡처도 됨).
// =====================================================================

export const TRIP_BUCKETS = ["trip-photos", "trip-receipts"] as const;
export type TripBucket = (typeof TRIP_BUCKETS)[number];

export function isTripBucket(v: unknown): v is TripBucket {
  return (TRIP_BUCKETS as readonly unknown[]).includes(v);
}

// 저장된 값(경로 · 예전 공개 URL · 서명 URL) → 버킷 안 경로. 상위 경로·다른 버킷이면 null.
export function tripRefPath(ref: string, bucket: TripBucket): string | null {
  let path = ref.trim();
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) {
    const marker = `/${bucket}/`;
    const idx = path.indexOf(marker);
    if (idx < 0) return null;
    path = path.slice(idx + marker.length).split("?")[0];
    try {
      path = decodeURIComponent(path);
    } catch {
      return null;
    }
  }
  if (!path || path.startsWith("/") || path.includes("..")) return null;
  return path;
}

// 화면·링크 주소. raw=true 면 서버가 내려받은 파일 내용을 그대로 돌려줌(보고서 PDF 사진).
export function activityFileUrl(
  activityId: string,
  bucket: TripBucket,
  ref: string,
  opts: { raw?: boolean } = {}
): string {
  const q = new URLSearchParams({ id: activityId, bucket, ref });
  if (opts.raw) q.set("raw", "1");
  return `/api/activity-file?${q.toString()}`;
}

// 링크에 보일 파일 이름(경로·URL 끝부분).
export function tripFileName(ref: string): string {
  const tail = ref.split("?")[0].split("/").pop() ?? ref;
  try {
    return decodeURIComponent(tail);
  } catch {
    return tail;
  }
}
