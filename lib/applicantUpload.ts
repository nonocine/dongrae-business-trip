// =====================================================================
// 채용 지원자 첨부(사진·서류) — 경로·소유권·파일 형식 규칙 (순수 함수)
//   * 지원자는 로그인 없는 외부인(카카오 세션)입니다. 2026-10 부터 업로드가
//     service_role 로 바뀌어 Storage 권한 검사가 없으므로, 서버가 이 규칙으로
//     직접 막습니다(app/recruitment/[slug]/apply/actions.ts).
//       · 경로는 서버가 만든다 — recruitment/{postingId}/{세션의 지원자 id}/{slot}.{ext}
//         클라이언트가 보낸 applicant_id 는 세션의 지원자와 같은지 대조만 한다.
//       · slot 은 photo 또는 공고에 정의된 서류 key 이고, 영문·숫자·_- 만 허용.
//       · 파일은 선언된 MIME 과 실제 앞부분 바이트(시그니처)가 모두 맞아야 한다.
//       · 서명 URL 은 그 지원자 행에 기록된 본인 경로만 발급한다.
//   * DB·Storage 의존 없음 — scripts/test-applicant-upload.ts 가 그대로 검증합니다.
// =====================================================================

export const APPLICANT_PHOTO_MAX = 8 * 1024 * 1024;
export const APPLICANT_DOC_MAX = 16 * 1024 * 1024;

export type ApplicantFileKind = "jpg" | "png" | "webp" | "pdf";

export const APPLICANT_PHOTO_TYPES: Record<string, ApplicantFileKind> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const APPLICANT_DOC_TYPES: Record<string, ApplicantFileKind> = {
  ...APPLICANT_PHOTO_TYPES,
  "application/pdf": "pdf",
};

// 실제 내용으로 형식 판별 — 확장자·MIME 은 클라이언트가 바꿀 수 있습니다.
export function sniffFileKind(bytes: Uint8Array): ApplicantFileKind | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  )
    return "png";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  )
    return "webp";
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d)
    return "pdf"; // %PDF-
  return null;
}

// 형식·크기 검사. 통과하면 확장자, 아니면 사용자에게 보일 메시지.
export function checkApplicantFile(
  input: { type: string; size: number; head: Uint8Array },
  allowed: Record<string, ApplicantFileKind>,
  maxBytes: number
): { ok: true; ext: ApplicantFileKind } | { ok: false; message: string } {
  if (input.size <= 0) return { ok: false, message: "업로드할 파일을 선택해주세요." };
  if (input.size > maxBytes)
    return { ok: false, message: `파일 용량은 ${Math.round(maxBytes / 1024 / 1024)}MB 이하여야 합니다.` };
  const declared = allowed[input.type];
  if (!declared) {
    const names = Array.from(new Set(Object.values(allowed))).map((k) => k.toUpperCase()).join(", ");
    return { ok: false, message: `${names} 형식만 업로드할 수 있습니다.` };
  }
  if (sniffFileKind(input.head) !== declared)
    return { ok: false, message: "파일 내용이 형식과 맞지 않습니다. 원본 파일을 다시 선택해주세요." };
  return { ok: true, ext: declared };
}

const SLOT_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;

export function isSafeSlot(slot: string): boolean {
  return SLOT_RE.test(slot);
}

// 저장 경로 — 반드시 세션에서 확인한 지원자 id 로만 만듭니다.
export function applicantStoragePath(
  postingId: string,
  sessionApplicantId: string,
  slot: string,
  ext: ApplicantFileKind
): string {
  if (!ID_RE.test(postingId) || !ID_RE.test(sessionApplicantId))
    throw new Error("지원 정보가 올바르지 않습니다.");
  if (!isSafeSlot(slot)) throw new Error("허용되지 않은 서류 종류입니다.");
  return `recruitment/${postingId}/${sessionApplicantId}/${slot}.${ext}`;
}

// 클라이언트가 보낸 applicant_id 와 세션의 지원자 대조.
//   세션 지원자가 없으면(임시저장 전) 업로드 불가. 다르면 거부.
export function resolveOwnApplicant(
  sessionApplicantId: string | null,
  clientApplicantId: string | null
): { ok: true; applicantId: string } | { ok: false; message: string } {
  if (!sessionApplicantId)
    return { ok: false, message: "먼저 임시저장으로 지원자 정보를 등록해주세요." };
  if (clientApplicantId && clientApplicantId !== sessionApplicantId)
    return { ok: false, message: "본인 지원서에만 첨부할 수 있습니다. 다시 로그인해주세요." };
  return { ok: true, applicantId: sessionApplicantId };
}

// 서명 URL 발급 허용 — 그 지원자 행에 기록된 경로(사진·서류)와 정확히 같을 때만.
export function canSignApplicantPath(
  path: string,
  own: { applicantId: string; photoPath: string | null; documents: Record<string, string> }
): boolean {
  if (!path || path.includes("..")) return false;
  const recorded = [own.photoPath, ...Object.values(own.documents)].filter(
    (p): p is string => typeof p === "string" && p.length > 0
  );
  if (!recorded.includes(path)) return false;
  // 기록값이 오염됐더라도 본인 폴더 밖은 서명하지 않습니다.
  const seg = path.split("/");
  return seg.length === 4 && seg[0] === "recruitment" && seg[2] === own.applicantId;
}
