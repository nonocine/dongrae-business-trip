// =====================================================================
// 채용 지원자 첨부 규칙 검증 — lib/applicantUpload 는 순수 모듈이라 DB 없이 확인합니다.
//
//   왜 필요한가:
//     2026-10 Storage 공개 정책 제거에 맞춰 지원자 업로드를 service_role 로 옮겼습니다.
//     그러면 Storage 가 아무것도 막지 않으므로, "다른 지원자 폴더에 쓰거나 덮어쓰기"
//     "직원 서류 서명 URL 받기" 를 막는 것은 이 규칙뿐입니다. 액션(apply/actions.ts)은
//     경로를 applicantStoragePath(세션 지원자 id) 로만 만들고, 폼의 applicant_id 는
//     resolveOwnApplicant 로 대조만 하며, 서명은 canSignApplicantPath 를 통과해야 합니다.
// =====================================================================

import {
  APPLICANT_DOC_MAX,
  APPLICANT_DOC_TYPES,
  APPLICANT_PHOTO_MAX,
  APPLICANT_PHOTO_TYPES,
  applicantStoragePath,
  canSignApplicantPath,
  checkApplicantFile,
  isSafeSlot,
  resolveOwnApplicant,
  sniffFileKind,
} from "../lib/applicantUpload";

let passed = 0;
function assert(cond: boolean, message: string) {
  if (!cond) throw new Error(`FAIL: ${message}`);
  passed++;
}
function throws(fn: () => unknown, message: string) {
  try {
    fn();
  } catch {
    passed++;
    return;
  }
  throw new Error(`FAIL (예외가 나야 함): ${message}`);
}

const POSTING = "11111111-1111-1111-1111-111111111111";
const ME = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"; // 세션(카카오)으로 확인된 본인
const OTHER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"; // 다른 지원자

// --- 1. 다른 지원자 id 를 보내도 본인 것으로 바뀌지 않고 거부된다 ---------------
{
  const r = resolveOwnApplicant(ME, OTHER);
  assert(!r.ok, "폼에 다른 지원자 id 를 넣으면 거부");
  const r2 = resolveOwnApplicant(ME, ME);
  assert(r2.ok && r2.applicantId === ME, "본인 id 는 통과");
  const r3 = resolveOwnApplicant(ME, null);
  assert(r3.ok && r3.applicantId === ME, "폼에 id 가 없어도 세션 id 로 진행");
  const r4 = resolveOwnApplicant(null, OTHER);
  assert(!r4.ok, "세션 지원자 행이 없으면(임시저장 전) 거부 — 폼 id 로 대신하지 않음");
}

// --- 2. 경로는 세션 지원자 폴더로만 만들어지고, 다른 폴더로 빠져나갈 수 없다 ---------
{
  const p = applicantStoragePath(POSTING, ME, "photo", "jpg");
  assert(p === `recruitment/${POSTING}/${ME}/photo.jpg`, "사진 경로 형식");
  assert(p.split("/")[2] === ME && !p.includes(OTHER), "경로의 지원자 폴더 = 세션 지원자");

  // 서류 key 로 경로 조작 시도 — 상위 폴더·다른 지원자 폴더·슬래시·빈 값.
  for (const evil of [
    `../${OTHER}/photo`,
    `${OTHER}/photo`,
    "../../employees/x/resume",
    "a/b",
    "a\\b",
    "photo.jpg",
    "",
    " ",
    "x".repeat(65),
  ]) {
    assert(!isSafeSlot(evil), `위험한 서류 key 거부: ${JSON.stringify(evil)}`);
    throws(() => applicantStoragePath(POSTING, ME, evil, "pdf"), `경로 생성 거부: ${JSON.stringify(evil)}`);
  }
  // id 자리에 경로 조각을 넣는 시도.
  throws(() => applicantStoragePath(POSTING, `${ME}/../${OTHER}`, "photo", "jpg"), "지원자 id 에 경로 조각");
  throws(() => applicantStoragePath(`../org`, ME, "photo", "jpg"), "공고 id 에 경로 조각");
  assert(isSafeSlot("resume") && isSafeSlot("career_cert") && isSafeSlot("doc-1"), "정상 서류 key 통과");
}

// --- 3. 서명 URL 은 본인 행에 기록된 본인 폴더 경로만 ---------------------------
{
  const own = {
    applicantId: ME,
    photoPath: `recruitment/${POSTING}/${ME}/photo.jpg`,
    documents: { resume: `recruitment/${POSTING}/${ME}/resume.pdf` },
  };
  assert(canSignApplicantPath(own.photoPath, own), "본인 사진 서명 허용");
  assert(canSignApplicantPath(own.documents.resume, own), "본인 서류 서명 허용");
  assert(!canSignApplicantPath(`recruitment/${POSTING}/${OTHER}/photo.jpg`, own), "다른 지원자 사진 거부");
  assert(!canSignApplicantPath("org/center_seal.png", own), "기관 직인 거부");
  assert(!canSignApplicantPath("stamps/employee/x.png", own), "직원 도장 거부");
  assert(!canSignApplicantPath(`recruitment/${POSTING}/${ME}/other.pdf`, own), "본인 폴더라도 기록에 없는 경로 거부");
  assert(!canSignApplicantPath(`recruitment/${POSTING}/${ME}/../${OTHER}/photo.jpg`, own), "'..' 거부");
  assert(!canSignApplicantPath("", own), "빈 경로 거부");
  // DB 기록이 오염돼 다른 폴더를 가리켜도 서명하지 않는다.
  const tainted = { ...own, documents: { resume: `recruitment/${POSTING}/${OTHER}/resume.pdf` } };
  assert(!canSignApplicantPath(tainted.documents.resume, tainted), "기록이 다른 지원자 폴더를 가리키면 거부");
}

// --- 4. 파일 형식·크기 — 선언 MIME 과 실제 바이트가 모두 맞아야 ------------------
{
  const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
  const HTML = new TextEncoder().encode("<html><script>alert(1)</script>");
  const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);

  assert(sniffFileKind(JPG) === "jpg" && sniffFileKind(PNG) === "png", "시그니처 판별 jpg/png");
  assert(sniffFileKind(WEBP) === "webp" && sniffFileKind(PDF) === "pdf", "시그니처 판별 webp/pdf");
  assert(sniffFileKind(HTML) === null && sniffFileKind(EXE) === null, "html·exe 는 판별 안 됨");

  const ok = checkApplicantFile({ type: "image/jpeg", size: 100, head: JPG }, APPLICANT_PHOTO_TYPES, APPLICANT_PHOTO_MAX);
  assert(ok.ok && ok.ext === "jpg", "정상 JPG 사진 통과");
  assert(checkApplicantFile({ type: "application/pdf", size: 100, head: PDF }, APPLICANT_DOC_TYPES, APPLICANT_DOC_MAX).ok, "정상 PDF 서류 통과");
  assert(!checkApplicantFile({ type: "application/pdf", size: 100, head: PDF }, APPLICANT_PHOTO_TYPES, APPLICANT_PHOTO_MAX).ok, "사진 칸에 PDF 거부");
  assert(!checkApplicantFile({ type: "image/jpeg", size: 100, head: HTML }, APPLICANT_PHOTO_TYPES, APPLICANT_PHOTO_MAX).ok, "JPG 로 위장한 HTML 거부");
  assert(!checkApplicantFile({ type: "image/png", size: 100, head: JPG }, APPLICANT_PHOTO_TYPES, APPLICANT_PHOTO_MAX).ok, "MIME·내용 불일치 거부");
  assert(!checkApplicantFile({ type: "text/html", size: 100, head: HTML }, APPLICANT_DOC_TYPES, APPLICANT_DOC_MAX).ok, "text/html 거부");
  assert(!checkApplicantFile({ type: "image/svg+xml", size: 100, head: HTML }, APPLICANT_DOC_TYPES, APPLICANT_DOC_MAX).ok, "SVG 거부");
  assert(!checkApplicantFile({ type: "image/jpeg", size: APPLICANT_PHOTO_MAX + 1, head: JPG }, APPLICANT_PHOTO_TYPES, APPLICANT_PHOTO_MAX).ok, "사진 8MB 초과 거부");
  assert(!checkApplicantFile({ type: "application/pdf", size: APPLICANT_DOC_MAX + 1, head: PDF }, APPLICANT_DOC_TYPES, APPLICANT_DOC_MAX).ok, "서류 16MB 초과 거부");
  assert(!checkApplicantFile({ type: "image/jpeg", size: 0, head: JPG }, APPLICANT_PHOTO_TYPES, APPLICANT_PHOTO_MAX).ok, "빈 파일 거부");
}

console.log(`✓ applicant-upload: ${passed}개 확인 통과`);
