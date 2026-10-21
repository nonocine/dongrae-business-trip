// =====================================================================
// 기존 체결 근로계약서 → 인사기록카드 소급 첨부 (2026-10 노미현 부장 요청)
//   대상: 센터장 서명까지 끝난 전자 근로계약서 중 아직 카드에 연결되지 않은 것
//         (employment_contracts.document_file_id 가 비어 있음 — 2026-10 기준 여다원·한지형·정소연).
//   ⚠️ 관장이 계약일(contract_date)을 먼저 고친 뒤에 돌립니다.
//
//   두 가지 방식:
//     (기본)        저장된 확정 PDF 를 그대로 카드에 붙입니다. 이 건들은 센터장 서명 이미지가
//                   보관되기 전에 체결돼서, 계약일을 고쳤어도 PDF 안 날짜는 체결 당시 그대로입니다.
//     --regen-seal  기관 직인으로 체결한 건이 확실할 때만. 지금 계약일로 PDF 를 다시 만들어
//                   계약서 확정본을 바꾸고(같은 경로), 직인 이미지를 보관한 뒤 카드에 붙입니다.
//                   직인이 아닌 서명으로 체결한 건에 쓰면 서명이 직인으로 바뀌니 쓰지 마세요.
//
//   실행(프로젝트 루트):
//     미리보기(쓰지 않음):  node --env-file=.env.local --import tsx scripts/backfill-contract-attachments.mts
//     실제 반영:            node --env-file=.env.local --import tsx scripts/backfill-contract-attachments.mts --apply
//     직인으로 다시 그림:   ... --apply --regen-seal
// =====================================================================

import { supabaseAdmin } from "../lib/supabaseAdmin";
import { HR_DOCUMENTS_BUCKET } from "../lib/supabase";
import { CONTRACT_LIST_COLUMNS } from "../lib/employmentContracts";
import { renderFinalPdf, saveEmployerImage, syncCardAttachment } from "../lib/contractServer";
import { loadOrgSeal } from "../lib/orgSeal";

const args = new Set(process.argv.slice(2));
if (args.has("--help")) {
  console.log("사용법: 위 머리 주석 참고. 기본은 미리보기(쓰지 않음), --apply 로 반영, --regen-seal 로 직인 재생성.");
  process.exit(0);
}
const apply = args.has("--apply");
const regenSeal = args.has("--regen-seal");

const { data, error } = await supabaseAdmin
  .from("employment_contracts")
  .select(`${CONTRACT_LIST_COLUMNS}, employee_signature`)
  .eq("status", "signed")
  .not("employer_signed_at", "is", null)
  .not("contract_pdf_url", "is", null)
  .is("document_file_id", null);
if (error) throw new Error(error.message);
const rows = ((data ?? []) as unknown as Record<string, unknown>[]).filter((r) => r.signing_method !== "paper");

const ids = [...new Set(rows.map((r) => String(r.driver_id)))];
const { data: drivers } = await supabaseAdmin.from("drivers").select("id, name").in("id", ids.length ? ids : ["-"]);
const nameOf = new Map((drivers ?? []).map((d) => [String((d as { id: string }).id), String((d as { name: string }).name)]));

console.log(`대상 ${rows.length}건 — ${apply ? (regenSeal ? "반영(직인으로 PDF 재생성)" : "반영(저장된 PDF 그대로)") : "미리보기(쓰지 않음)"}`);
const seal = regenSeal ? await loadOrgSeal() : null;
if (regenSeal && !seal) throw new Error("기관 직인이 등록되어 있지 않습니다(/hr/seal).");

for (const r of rows) {
  const label = `${nameOf.get(String(r.driver_id)) ?? "?"} · 계약일 ${r.contract_date ?? "미정"} · ${String(r.id).slice(0, 8)}`;
  if (!apply) {
    console.log(`  - ${label}`);
    continue;
  }
  let bytes: Uint8Array;
  if (seal) {
    bytes = await renderFinalPdf("employment", r, { bytes: seal, isSeal: true });
    const { error: upErr } = await supabaseAdmin.storage
      .from(HR_DOCUMENTS_BUCKET)
      .upload(String(r.contract_pdf_url), Buffer.from(bytes), { contentType: "application/pdf", upsert: true });
    if (upErr) throw new Error(`${label}: PDF 저장 실패 ${upErr.message}`);
    await saveEmployerImage("employment", String(r.driver_id), String(r.id), { bytes: seal, isSeal: true });
  } else {
    const { data: file, error: dlErr } = await supabaseAdmin.storage.from(HR_DOCUMENTS_BUCKET).download(String(r.contract_pdf_url));
    if (dlErr || !file) throw new Error(`${label}: 저장된 PDF 를 읽지 못했습니다.`);
    bytes = new Uint8Array(await file.arrayBuffer());
  }
  const ok = await syncCardAttachment(r, bytes);
  console.log(`  ${ok ? "✓" : "✗"} ${label}${seal ? " (직인으로 다시 그림)" : ""}`);
}
