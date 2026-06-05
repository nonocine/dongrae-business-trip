// =====================================================================
// 입사지원서 docx — DB row → 빌더 입력 매핑 + 이미지(Storage/서명) 로딩
//   * Route Handler 전용(서버). supabaseAdmin Storage 에서 사진/서명을 받아옵니다.
//   * 빌더(applicantDocxBuilder)는 순수 함수 — 여기서 이미지 바이트를 채워 넘깁니다.
// =====================================================================

import {
  parseEducationInput,
  parseLicenseInput,
  parseCareerInput,
  parseAwardInput,
  parseTrainingInput,
  HR_DOCUMENTS_BUCKET,
} from "./supabase";
import { supabaseAdmin } from "./supabaseAdmin";
import type { ApplicantDocInput } from "./applicantDocxBuilder";

function jsonbToString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return null;
  }
}

export type MappedApplicant = {
  // 이미지(photoImage/signatureImage)는 null 인 상태 — 호출 측에서 채움.
  input: ApplicantDocInput;
  photoPath: string | null;
  // 손글씨 서명 dataURL(있을 때만). 타이핑 서명은 input.consent_signature_text 로.
  signatureDataUrl: string | null;
};

// recruitment_applicants 한 행 → 빌더 입력(이미지 제외).
export function mapApplicantRow(app: Record<string, unknown>): MappedApplicant {
  const type =
    app.consent_signature_type === "drawn" ||
    app.consent_signature_type === "typed"
      ? (app.consent_signature_type as "drawn" | "typed")
      : null;
  const sig =
    typeof app.consent_signature === "string" ? app.consent_signature : null;
  const isDrawn = type === "drawn" && !!sig && sig.startsWith("data:");

  return {
    photoPath: (app.photo_url as string | null) ?? null,
    signatureDataUrl: isDrawn ? sig : null,
    input: {
      applicant_number: String(app.applicant_number ?? ""),
      name: String(app.name ?? ""),
      name_hanja: (app.name_hanja as string | null) ?? null,
      birth_date: String(app.birth_date ?? ""),
      gender: app.gender === "M" || app.gender === "F" ? app.gender : null,
      address: (app.address as string | null) ?? null,
      email: String(app.email ?? ""),
      phone: String(app.phone ?? ""),
      education: parseEducationInput(jsonbToString(app.education)),
      licenses: parseLicenseInput(jsonbToString(app.licenses)),
      career: parseCareerInput(jsonbToString(app.career)),
      awards: parseAwardInput(jsonbToString(app.awards)),
      trainings: parseTrainingInput(jsonbToString(app.trainings)),
      motivation: (app.motivation as string | null) ?? null,
      self_development: (app.self_development as string | null) ?? null,
      career_summary: (app.career_summary as string | null) ?? null,
      philosophy: (app.philosophy as string | null) ?? null,
      agreed_privacy: app.agreed_privacy === true,
      agreed_criminal_check: app.agreed_criminal_check === true,
      agreed_truth: app.agreed_truth === true,
      consent_at: (app.consent_at as string | null) ?? null,
      consent_signature_type: type,
      consent_signature_text: type === "typed" ? sig : null,
      photoImage: null,
      signatureImage: null,
    },
  };
}

// base64 dataURL → 바이트. 실패하면 null.
export function decodeDataUrl(dataUrl: string | null): Uint8Array | null {
  if (!dataUrl) return null;
  const m = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
  if (!m) return null;
  try {
    return new Uint8Array(Buffer.from(m[1], "base64"));
  } catch {
    return null;
  }
}

// hr-documents Storage 경로 → 바이트. 실패해도 throw 하지 않고 null
// (이미지 누락 시 문서 생성은 계속되어야 함).
export async function downloadHrImage(
  path: string | null
): Promise<Uint8Array | null> {
  if (!path) return null;
  try {
    const { data, error } = await supabaseAdmin.storage
      .from(HR_DOCUMENTS_BUCKET)
      .download(path);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  } catch {
    return null;
  }
}

// MappedApplicant → 이미지까지 채운 최종 빌더 입력.
export async function resolveApplicantDocInput(
  mapped: MappedApplicant
): Promise<ApplicantDocInput> {
  const [photoImage, signatureImage] = await Promise.all([
    downloadHrImage(mapped.photoPath),
    Promise.resolve(decodeDataUrl(mapped.signatureDataUrl)),
  ]);
  return { ...mapped.input, photoImage, signatureImage };
}

// 파일명 안전화 — 경로 구분자·제어문자 제거. 빈 이름이면 접수번호 대체.
export function safeFileBase(name: string, fallback: string): string {
  const cleaned = (name ?? "")
    .replace(/[\\/:*?"<>|\r\n\t]/g, "")
    .trim();
  return cleaned.length > 0 ? cleaned : fallback;
}
