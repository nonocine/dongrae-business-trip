// =====================================================================
// 채용 지원자 첨부 "액션" 검증 — 실제 서버 액션(app/recruitment/[slug]/apply/actions.ts)을
//   그대로 부르고, DB·Storage·쿠키만 메모리 가짜로 바꿔 확인합니다(운영 DB 를 건드리지 않음).
//
//   증명하려는 것(2026-10 Storage 공개 정책 제거 대비, 업로드가 service_role 로 바뀜):
//     · 지원자 B 의 세션으로 A 의 applicant_id 를 보내도 A 폴더에 쓰지 못한다
//     · 업로드 경로는 항상 "세션 지원자" 폴더 — 폼 값으로 바꿀 수 없다
//     · A 의 사진·서류를 B 가 지우거나 서명 URL 로 열 수 없다(직원 서류·직인도)
//     · 로그인 없음·임시저장 전·제출 완료 후·기간 밖은 업로드 거부
//     · 위장 파일(MIME 과 내용 불일치)·서류 key 경로 조작 거부
//
//   실행: npm run test:applicant-upload-actions
//     (node --experimental-test-module-mocks — 모듈 교체에 필요)
// =====================================================================

import { mock } from "node:test";
import { pathToFileURL } from "node:url";
import path from "node:path";

process.env.SESSION_SECRET ||= "test-secret-for-applicant-upload";

const root = process.cwd();
const url = (p: string) => pathToFileURL(path.join(root, p)).href;

let passed = 0;
function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(`FAIL: ${message}`);
  passed++;
}

// ---------------------------------------------------------------------
// 메모리 가짜 DB/Storage
// ---------------------------------------------------------------------
const POSTING = { id: "11111111-1111-1111-1111-111111111111", slug: "test-open" };
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const KAKAO_A = "kakao-a";
const KAKAO_B = "kakao-b";

type Row = Record<string, unknown>;
const now = Date.now();
const db: Record<string, Row[]> = {
  recruitment_postings: [
    {
      id: POSTING.id,
      slug: POSTING.slug,
      status: "published",
      title: "테스트",
      field: "청소년지도사",
      application_start: new Date(now - 86400000).toISOString(),
      application_end: new Date(now + 86400000).toISOString(),
      required_documents: [
        { key: "resume", label: "이력서", required: true },
        { key: "cert", label: "자격증", required: false },
      ],
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      slug: "test-closed",
      status: "published",
      title: "마감",
      field: "x",
      application_start: new Date(now - 10 * 86400000).toISOString(),
      application_end: new Date(now - 86400000).toISOString(),
      required_documents: [{ key: "resume", label: "이력서", required: true }],
    },
  ],
  recruitment_applicants: [
    {
      id: A,
      kakao_id: KAKAO_A,
      photo_url: `recruitment/${POSTING.id}/${A}/photo.jpg`,
      documents: { resume: `recruitment/${POSTING.id}/${A}/resume.pdf` },
    },
    { id: B, kakao_id: KAKAO_B, photo_url: null, documents: {} },
    { id: "cccccccc-cccc-cccc-cccc-cccccccccccc", kakao_id: "kakao-c", photo_url: null, documents: {} },
  ],
  recruitment_applications: [
    { id: "app-a", posting_id: POSTING.id, applicant_id: A, status: "draft" },
    { id: "app-b", posting_id: POSTING.id, applicant_id: B, status: "draft" },
    // C 는 이미 제출 완료.
    { id: "app-c", posting_id: POSTING.id, applicant_id: "cccccccc-cccc-cccc-cccc-cccccccccccc", status: "submitted" },
  ],
};

const storage = new Map<string, number>(); // path → size
storage.set(`recruitment/${POSTING.id}/${A}/photo.jpg`, 10);
storage.set(`recruitment/${POSTING.id}/${A}/resume.pdf`, 10);
storage.set("org/center_seal.png", 10);
const uploads: string[] = [];
const removed: string[] = [];
const signed: string[] = [];

function query(table: string) {
  const filters: [string, unknown][] = [];
  let patch: Row | null = null;
  const rows = () => (db[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
  const q = {
    select: () => q,
    eq: (k: string, v: unknown) => {
      filters.push([k, v]);
      return q;
    },
    update: (p: Row) => {
      patch = p;
      return q;
    },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    single: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => void) => {
      if (patch) for (const r of rows()) Object.assign(r, patch);
      resolve({ data: null, error: null });
    },
  };
  return q;
}

const fakeClient = {
  from: (t: string) => query(t),
  storage: {
    from: () => ({
      upload: async (p: string, data: Uint8Array) => {
        uploads.push(p);
        storage.set(p, data.byteLength);
        return { error: null };
      },
      remove: async (ps: string[]) => {
        removed.push(...ps);
        ps.forEach((p) => storage.delete(p));
        return { error: null };
      },
      createSignedUrl: async (p: string) => {
        signed.push(p);
        return { data: { signedUrl: `signed://${p}` }, error: null };
      },
    }),
  },
};

// 카카오 세션 — 테스트마다 바꿉니다.
let cookieJar: Record<string, string> = {};
const { signPayload } = await import(url("lib/signedCookie.ts"));
function loginAs(kakaoId: string | null) {
  cookieJar = kakaoId ? { kakao_id: signPayload({ kakaoId }) } : {};
}

mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({
      get: (k: string) => (k in cookieJar ? { value: cookieJar[k] } : undefined),
      delete: () => {},
      set: () => {},
    }),
  },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
mock.module(url("lib/supabaseAdmin.ts"), { namedExports: { supabaseAdmin: fakeClient } });
mock.module(url("lib/supabase.ts"), {
  namedExports: {
    supabase: fakeClient,
    HR_DOCUMENTS_BUCKET: "hr-documents",
    signHrDocument: async (p: string | null) => (p ? (await fakeClient.storage.from().createSignedUrl(p)).data.signedUrl : null),
    removeHrDocuments: async (ps: string[]) => {
      await fakeClient.storage.from().remove(ps);
    },
    parseEducationInput: () => [],
    parseLicenseInput: () => [],
    parseCareerInput: () => [],
    parseAwardInput: () => [],
    parseTrainingInput: () => [],
  },
});
mock.module(url("lib/slack.ts"), {
  namedExports: { sendSlack: async () => {}, siteBaseUrl: () => "", slackLink: () => "" },
});
mock.module(url("lib/mailer.ts"), {
  namedExports: { sendPlainMail: async () => {}, isMailerConfigured: () => false },
});

const actions = await import(url("app/recruitment/[slug]/apply/actions.ts"));

const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const HTML = new TextEncoder().encode("<html><script>alert(1)</script></html>");

function form(fields: Record<string, string>, file?: { field: string; bytes: Uint8Array; type: string; name: string }) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (file) fd.set(file.field, new File([file.bytes as unknown as BlobPart], file.name, { type: file.type }));
  return fd;
}

const aPhoto = `recruitment/${POSTING.id}/${A}/photo.jpg`;
const aResume = `recruitment/${POSTING.id}/${A}/resume.pdf`;
const inFolder = (p: string, who: string) => p.startsWith(`recruitment/${POSTING.id}/${who}/`);

// ---------------------------------------------------------------------
// 1. B 로그인 + A 의 applicant_id → 거부, A 폴더에 아무것도 안 써짐
// ---------------------------------------------------------------------
loginAs(KAKAO_B);
{
  const r = await actions.uploadApplicantPhoto(
    form({ slug: POSTING.slug, applicant_id: A }, { field: "photo", bytes: JPG, type: "image/jpeg", name: "x.jpg" })
  );
  assert(!r.ok, "B 가 A 의 id 로 사진 업로드 → 거부");
  const r2 = await actions.uploadApplicantDocument(
    form({ slug: POSTING.slug, applicant_id: A, doc_key: "resume" }, { field: "file", bytes: PDF, type: "application/pdf", name: "x.pdf" })
  );
  assert(!r2.ok, "B 가 A 의 id 로 서류 업로드 → 거부");
  assert(uploads.every((p) => !inFolder(p, A)), "A 폴더에 업로드 0건");
  assert(storage.get(aPhoto) === 10 && storage.get(aResume) === 10, "A 의 기존 파일 그대로(덮어쓰기 없음)");

  // B 가 A 의 파일을 지우려는 시도.
  const d1 = await actions.deleteApplicantPhoto(POSTING.slug, A);
  const d2 = await actions.deleteApplicantDocument(POSTING.slug, A, "resume");
  assert(!d1.ok && !d2.ok, "B 가 A 의 사진·서류 삭제 → 거부");
  assert(!removed.some((p) => inFolder(p, A)), "A 파일 삭제 0건");
  const aRow = db.recruitment_applicants.find((r) => r.id === A)!;
  assert(aRow.photo_url === aPhoto && (aRow.documents as Row).resume === aResume, "A 의 DB 기록 그대로");

  // B 가 A 의 파일·직원 서류·직인 서명 URL 요청.
  for (const p of [aPhoto, aResume, "org/center_seal.png", "stamps/employee/x.png", `recruitment/${POSTING.id}/${B}/../${A}/photo.jpg`]) {
    const u = await actions.signApplicantStoragePath(p);
    assert(u === null, `B 가 서명 URL 요청 → null: ${p}`);
  }
  assert(signed.length === 0, "서명 URL 발급 0건");
}

// ---------------------------------------------------------------------
// 2. B 본인 업로드 — 경로는 B 폴더, 폼 값으로 바꿀 수 없음
// ---------------------------------------------------------------------
{
  const r = await actions.uploadApplicantPhoto(
    form({ slug: POSTING.slug, applicant_id: B }, { field: "photo", bytes: JPG, type: "image/jpeg", name: "../../a.jpg" })
  );
  assert(r.ok, "B 본인 사진 업로드 성공");
  assert(uploads.at(-1) === `recruitment/${POSTING.id}/${B}/photo.jpg`, "경로 = B 폴더/photo.jpg (파일명 무시)");

  // applicant_id 를 비워도 세션 기준으로 B 폴더.
  const r2 = await actions.uploadApplicantDocument(
    form({ slug: POSTING.slug, doc_key: "resume" }, { field: "file", bytes: PDF, type: "application/pdf", name: "r.pdf" })
  );
  assert(r2.ok && uploads.at(-1) === `recruitment/${POSTING.id}/${B}/resume.pdf`, "applicant_id 없이도 B 폴더");

  // 서류 key 경로 조작·공고에 없는 key.
  for (const key of [`../${A}/resume`, "../../org/center_seal", "cert/../../x", "not_in_posting"]) {
    const bad = await actions.uploadApplicantDocument(
      form({ slug: POSTING.slug, applicant_id: B, doc_key: key }, { field: "file", bytes: PDF, type: "application/pdf", name: "r.pdf" })
    );
    assert(!bad.ok, `서류 key 거부: ${key}`);
  }
  assert(uploads.every((p) => !inFolder(p, A) && p !== "org/center_seal.png"), "A 폴더·직인 경로에 업로드 0건");

  // 위장 파일.
  const fake = await actions.uploadApplicantPhoto(
    form({ slug: POSTING.slug, applicant_id: B }, { field: "photo", bytes: HTML, type: "image/jpeg", name: "x.jpg" })
  );
  assert(!fake.ok, "JPG 로 위장한 HTML 거부");

  // B 는 자기 파일 서명 가능.
  const u = await actions.signApplicantStoragePath(`recruitment/${POSTING.id}/${B}/photo.jpg`);
  assert(u === `signed://recruitment/${POSTING.id}/${B}/photo.jpg`, "B 본인 사진 서명 URL 발급");
}

// ---------------------------------------------------------------------
// 3. 로그인 없음 / 제출 완료 / 기간 밖 / 임시저장 전
// ---------------------------------------------------------------------
{
  const before = uploads.length;
  loginAs(null);
  const r1 = await actions.uploadApplicantPhoto(
    form({ slug: POSTING.slug, applicant_id: A }, { field: "photo", bytes: JPG, type: "image/jpeg", name: "x.jpg" })
  );
  assert(!r1.ok, "로그인 없이 업로드 거부");
  assert((await actions.signApplicantStoragePath(aPhoto)) === null, "로그인 없이 서명 URL 거부");

  loginAs("kakao-c"); // 제출 완료
  const r2 = await actions.uploadApplicantPhoto(
    form({ slug: POSTING.slug }, { field: "photo", bytes: JPG, type: "image/jpeg", name: "x.jpg" })
  );
  assert(!r2.ok, "제출 완료된 지원서 업로드 거부");

  loginAs(KAKAO_A); // 마감 공고
  const r3 = await actions.uploadApplicantPhoto(
    form({ slug: "test-closed" }, { field: "photo", bytes: JPG, type: "image/jpeg", name: "x.jpg" })
  );
  assert(!r3.ok, "접수 기간 밖 업로드 거부");

  loginAs("kakao-new"); // 지원자 행 없음(임시저장 전)
  const r4 = await actions.uploadApplicantPhoto(
    form({ slug: POSTING.slug, applicant_id: A }, { field: "photo", bytes: JPG, type: "image/jpeg", name: "x.jpg" })
  );
  assert(!r4.ok, "임시저장 전(지원자 행 없음) + 남의 id → 거부");
  assert(uploads.length === before, "위 4건 모두 업로드 0건");
}

// ---------------------------------------------------------------------
// 4. A 본인 교체 — 옛 파일은 A 폴더 것만 정리
// ---------------------------------------------------------------------
{
  loginAs(KAKAO_A);
  const r = await actions.uploadApplicantDocument(
    form({ slug: POSTING.slug, applicant_id: A, doc_key: "resume" }, { field: "file", bytes: JPG, type: "image/jpeg", name: "r.jpg" })
  );
  assert(r.ok, "A 본인 서류 교체(pdf→jpg) 성공");
  assert(removed.includes(aResume), "A 의 옛 resume.pdf 정리");
  assert(removed.every((p) => inFolder(p, A)), "정리된 파일은 모두 A 폴더");
}

console.log(`✓ applicant-upload-actions: ${passed}개 확인 통과`);
