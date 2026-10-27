// =====================================================================
// Storage 접근 경로 실측 — 운영 Storage 에 붙어 앱의 "실제 헬퍼"로 확인합니다.
//   (2026-10 Storage 공개 정책 제거 작업용. 정책을 지우기 전·후 모두 돌립니다.)
//
//   확인하는 것
//     A. service_role 경로(앱이 쓰는 길) — 정책과 무관하게 항상 되어야 함
//        · hr-documents: 폴더별(수료증·지원서·인사서류·강사서류·도장·명함·직인) 기존 파일
//          내려받기(downloadHrImage) + 1시간 서명 URL(signHrDocument) 열기
//        · hr-documents: 시험 파일 업로드(uploadStampImage)→서명 URL→삭제(removeHrDocuments)
//        · trip-photos·trip-receipts(동업자씨)·report-photos·program-plans(byct): 시험 파일 업로드→
//          1시간 서명 URL 열기→공개 URL 상태→삭제. 비공개 전환 후 `-- --private` 로 돌리면
//          "공개 URL 은 안 열려야 함"을 검사 (docs/TRIP_STORAGE_PUBLIC_URL.md)
//        · 기관 직인 로드(loadOrgSeal)
//     B. anon 키(브라우저 번들에 있는 키)로 할 수 있는 일 — 정책 상태를 보여 줌
//        · 정책 제거 전: 열려 있음(현재 상태 기록용)
//        · 정책 제거 후: `-- --locked` 로 돌리면 "막혀 있어야 함"을 검사
//
//   시험 파일은 __selftest/ 아래에만 만들고 끝나면 지웁니다. 기존 파일은 읽기만 합니다.
//   실행: npx tsx scripts/verify-storage-access.ts [--locked] [--private]
// =====================================================================

import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}

const LOCKED = process.argv.includes("--locked");
// 4개 첨부 버킷을 비공개로 바꾼 뒤: 공개 URL 이 막혔는지 검사(전에는 상태만 기록).
const PRIVATE = process.argv.includes("--private");
let failed = 0;
function check(ok: boolean, label: string, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

(async () => {
  const { supabaseAdmin } = await import("../lib/supabaseAdmin");
  const { HR_DOCUMENTS_BUCKET, signHrDocument, removeHrDocuments, uploadStampImage } = await import("../lib/supabase");
  const { downloadHrImage } = await import("../lib/recruitmentApplicantDocData");
  const { loadOrgSeal } = await import("../lib/orgSeal");
  const { createClient } = await import("@supabase/supabase-js");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
  );

  // 폴더 안의 첫 파일 하나(하위 폴더를 따라 내려감).
  async function firstFile(prefix: string, depth = 0): Promise<string | null> {
    const { data } = await supabaseAdmin.storage.from(HR_DOCUMENTS_BUCKET).list(prefix, { limit: 5 });
    for (const it of data ?? []) {
      const p = `${prefix}/${it.name}`;
      if (it.id) return p; // 파일
      if (depth < 3) {
        const f = await firstFile(p, depth + 1);
        if (f) return f;
      }
    }
    return null;
  }

  console.log("\nA. service_role 경로 — hr-documents 기존 파일 열람");
  const folders: [string, string][] = [
    ["trainings", "수료증"],
    ["recruitment", "지원서 첨부"],
    ["employees", "인사서류·증명사진"],
    ["instructors", "강사 서류(동래샘들 업로드)"],
    ["stamps", "도장"],
    ["business-cards", "명함"],
  ];
  for (const [prefix, label] of folders) {
    const p = await firstFile(prefix);
    if (!p) {
      check(false, `${label}: 파일을 찾지 못함`, prefix);
      continue;
    }
    const bytes = await downloadHrImage(p);
    check(!!bytes && bytes.length > 0, `${label}: 내려받기(service_role)`, `${bytes?.length ?? 0} bytes`);
    const signed = await signHrDocument(p);
    const r = signed ? await fetch(signed) : null;
    check(!!r && r.status === 200, `${label}: 서명 URL 열기`, String(r?.status ?? "URL 없음"));
  }
  const seal = await loadOrgSeal();
  check(!!seal && seal.length > 0, "기관 직인: loadOrgSeal", `${seal?.length ?? 0} bytes`);

  console.log("\nA. service_role 경로 — hr-documents 쓰기·삭제(시험 파일)");
  const testPath = `__selftest/storage-${Date.now()}.png`;
  try {
    await uploadStampImage(testPath, PNG, "image/png");
    check(true, "업로드(uploadStampImage)");
  } catch (e) {
    check(false, "업로드(uploadStampImage)", e instanceof Error ? e.message : String(e));
  }
  {
    const s = await signHrDocument(testPath);
    const r = s ? await fetch(s) : null;
    const body = r ? Buffer.from(await r.arrayBuffer()) : null;
    check(!!body && body.equals(PNG), "서명 URL 로 같은 내용 읽힘");
  }
  await removeHrDocuments([testPath]);
  check((await downloadHrImage(testPath)) === null, "삭제(removeHrDocuments) 후 없음");

  console.log(`\nA. service_role 경로 — 첨부 버킷 4개(${PRIVATE ? "비공개 전환 후: 공개 URL 막혀야 함" : "공개 URL 상태는 기록만"})`);
  //   앱은 서명 URL(1시간)로만 엽니다 — 동업자씨 /api/activity-file, byct /api/admin/storage-file.
  for (const bucket of ["trip-photos", "trip-receipts", "report-photos", "program-plans"]) {
    const key = `__selftest_${Date.now()}.png`;
    const { error } = await supabaseAdmin.storage.from(bucket).upload(key, PNG, { contentType: "image/png", upsert: false });
    check(!error, `${bucket}: 업로드`, error?.message ?? "");
    const { data: signed } = await supabaseAdmin.storage.from(bucket).createSignedUrl(key, 60);
    const rs = signed?.signedUrl ? await fetch(signed.signedUrl) : null;
    check(rs?.status === 200, `${bucket}: 서명 URL 열림`, String(rs?.status ?? "발급 실패"));
    const pub = supabaseAdmin.storage.from(bucket).getPublicUrl(key).data.publicUrl;
    const r = await fetch(pub);
    if (PRIVATE) check(r.status !== 200, `${bucket}: 공개 URL 막힘`, String(r.status));
    else console.log(`  · ${bucket}: 공개 URL = ${r.status === 200 ? "열림(공개 버킷)" : `안 열림(${r.status})`}`);
    const { error: rmErr } = await supabaseAdmin.storage.from(bucket).remove([key]);
    check(!rmErr, `${bucket}: 삭제`, rmErr?.message ?? "");
  }

  console.log(`\nB. anon 키(브라우저에 노출된 키)로 가능한 일 — ${LOCKED ? "막혀 있어야 함(--locked)" : "현재 상태 기록"}`);
  {
    const { data } = await anon.storage.from(HR_DOCUMENTS_BUCKET).download("org/center_seal.png");
    const can = !!data;
    if (LOCKED) check(!can, "anon: 기관 직인 내려받기 차단");
    else console.log(`  · anon: 기관 직인 내려받기 = ${can ? "가능(열려 있음)" : "불가"}`);
  }
  {
    const { data } = await anon.storage.from(HR_DOCUMENTS_BUCKET).list("stamps/employee", { limit: 100 });
    const n = data?.length ?? 0;
    if (LOCKED) check(n === 0, "anon: 도장 목록 조회 차단", `${n}건 보임`);
    else console.log(`  · anon: 도장 목록 조회 = ${n}건 보임`);
  }
  {
    const p = `__selftest/anon-${Date.now()}.png`;
    const { error } = await anon.storage.from(HR_DOCUMENTS_BUCKET).upload(p, PNG, { contentType: "image/png" });
    if (!error) await supabaseAdmin.storage.from(HR_DOCUMENTS_BUCKET).remove([p]); // 열려 있으면 시험 파일 정리
    if (LOCKED) check(!!error, "anon: hr-documents 업로드 차단", error ? "" : "업로드됨");
    else console.log(`  · anon: hr-documents 업로드 = ${error ? "불가" : "가능(열려 있음)"}`);
  }
  for (const bucket of ["trip-photos", "trip-receipts"]) {
    const { data } = await anon.storage.from(bucket).list("", { limit: 100 });
    const n = data?.length ?? 0;
    const k = `__selftest_anon_${Date.now()}.png`;
    const { error } = await anon.storage.from(bucket).upload(k, PNG, { contentType: "image/png" });
    if (!error) await supabaseAdmin.storage.from(bucket).remove([k]);
    if (LOCKED) {
      check(n === 0, `anon: ${bucket} 목록 조회 차단`, `${n}건 보임`);
      check(!!error, `anon: ${bucket} 업로드 차단`, error ? "" : "업로드됨");
    } else console.log(`  · anon: ${bucket} 목록 ${n}건 보임, 업로드 ${error ? "불가" : "가능(열려 있음)"}`);
  }

  console.log(failed ? `\n✗ ${failed}건 실패` : "\n✓ 모두 통과");
  process.exit(failed ? 1 : 0);
})();
