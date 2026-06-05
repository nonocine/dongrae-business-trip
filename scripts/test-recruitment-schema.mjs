// 라이브 스키마 스모크 — loadReportData 가 사용하는 .select() 컬럼들이 실제
// Supabase 스키마와 일치하는지 service_role 로 직접 검증(인증 우회).
//   실행: node scripts/test-recruitment-schema.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// .env.local 간단 파서.
const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("환경변수 없음");
  process.exit(1);
}
const sb = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let fail = 0;
async function check(label, promise) {
  const { error, count, data } = await promise;
  if (error) {
    console.log(`  ✗ ${label}: ${error.message}`);
    fail++;
    return null;
  }
  const n = count != null ? count : Array.isArray(data) ? data.length : "?";
  console.log(`  ✓ ${label}${n !== "?" ? ` (rows: ${n})` : ""}`);
  return data;
}

console.log("[스키마] loadReportData 쿼리 컬럼 검증");
await check(
  "recruitment_postings.select",
  sb
    .from("recruitment_postings")
    .select("id, slug, title, field, recruit_count, status", { count: "exact", head: true })
);
await check(
  "recruitment_applications + applicants join",
  sb
    .from("recruitment_applications")
    .select(
      "id, status, submitted_at, applicant:recruitment_applicants(applicant_number, name, phone, birth_date, gender)"
    )
    .limit(1)
);
await check(
  "recruitment_scores.select (memo/is_absent 포함)",
  sb
    .from("recruitment_scores")
    .select("application_id, stage, reviewer_name, total_score, is_absent, memo, scores")
    .limit(1)
);

console.log("\n[데이터] 테스트 가능한 공고");
const postings = await check(
  "공고 목록",
  sb
    .from("recruitment_postings")
    .select("slug, title, status")
    .order("created_at", { ascending: false })
);
for (const p of postings ?? []) {
  console.log(`    · /${p.slug}  [${p.status}]  ${p.title}`);
}

console.log(`\n결과: ${fail === 0 ? "스키마 일치 ✓" : fail + "건 불일치 ✗"}`);
process.exit(fail > 0 ? 1 : 0);
