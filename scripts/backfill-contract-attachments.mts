// =====================================================================
// 기존 체결 근로계약서 → 인사기록카드 소급 첨부 (2026-10 노미현 부장 요청)
//   대상: 센터장 서명까지 끝난 전자 근로계약서 중 아직 카드에 연결되지 않은 것
//         (employment_contracts.document_file_id 가 비어 있음, 무효 제외 —
//          2026-10-22 기준 여다원·한지형·정소연·정다영 4건).
//   계약일은 DB 의 contract_date 를 씁니다(관장 원칙: 계약 시작일 또는 그 달 1일).
//
//   두 가지 방식:
//     (기본)        저장된 확정 PDF 를 그대로 카드에 붙입니다. PDF 안 날짜는 체결 당시(서명일) 그대로입니다.
//     --regen-seal  지금 계약일로 PDF 를 다시 만들어 붙입니다. 4건 모두 기관 직인(org/center_seal.png)으로
//                   체결된 것을 PDF 안 이미지 대조로 확인했습니다(2026-10-22) — 재생성본은 날짜 한 줄 외 동일.
//                   · 새 PDF 는 새 경로({계약}.regen-{시각}.pdf)에 쓰고 contract_pdf_url 을 그쪽으로 바꿉니다.
//                     "계약서 보기"·직원 내려받기·카드 첨부가 모두 같은 새 PDF 를 봅니다.
//                   · 옛 PDF 는 지우지 않습니다(경로를 출력).
//                   · 직인 이미지를 보관해 이후 계약일 수정 때도 다시 그릴 수 있게 합니다.
//
//   실행(프로젝트 루트):
//     미리보기(쓰지 않음):  node --env-file=.env.local --import tsx scripts/backfill-contract-attachments.mts
//     실제 반영:            node --env-file=.env.local --import tsx scripts/backfill-contract-attachments.mts --apply
//     직인으로 다시 그림:   node --env-file=.env.local --import tsx scripts/backfill-contract-attachments.mts --apply --regen-seal
//     (--regen-seal 만 주고 --apply 를 빼면 무엇을 할지 미리보기만)
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
const seal = regenSeal && apply ? await loadOrgSeal() : null;
if (regenSeal && apply && !seal) throw new Error("기관 직인이 등록되어 있지 않습니다(/hr/seal).");

const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
for (const r of rows) {
  const oldPath = String(r.contract_pdf_url);
  const newPath = oldPath.replace(/\.pdf$/, `.regen-${stamp}.pdf`);
  const label =
    `${nameOf.get(String(r.driver_id)) ?? "?"} · 계약일 ${r.contract_date ?? "미정"}(시작일 ${r.contract_start})` +
    ` · 센터장 서명 ${String(r.employer_signed_at)} · ${String(r.id).slice(0, 8)}`;
  if (!apply) {
    console.log(`  - ${label}`);
    console.log(
      regenSeal
        ? `      PDF: ${oldPath} (보존) → ${newPath} (새 계약일로 다시 그림, contract_pdf_url 교체) → 카드 첨부`
        : `      PDF: ${oldPath} 그대로 카드 첨부 (PDF 안 날짜는 체결 당시)`
    );
    continue;
  }
  let bytes: Uint8Array;
  if (seal) {
    bytes = await renderFinalPdf("employment", r, { bytes: seal, isSeal: true });
    const { error: upErr } = await supabaseAdmin.storage
      .from(HR_DOCUMENTS_BUCKET)
      .upload(newPath, Buffer.from(bytes), { contentType: "application/pdf", upsert: false });
    if (upErr) throw new Error(`${label}: PDF 저장 실패 ${upErr.message}`);
    const { error: urlErr } = await supabaseAdmin
      .from("employment_contracts")
      .update({ contract_pdf_url: newPath })
      .eq("id", String(r.id));
    if (urlErr) throw new Error(`${label}: contract_pdf_url 교체 실패 ${urlErr.message}`);
    r.contract_pdf_url = newPath;
    await saveEmployerImage("employment", String(r.driver_id), String(r.id), { bytes: seal, isSeal: true });
    console.log(`      옛 PDF 보존: ${oldPath}`);
  } else {
    const { data: file, error: dlErr } = await supabaseAdmin.storage.from(HR_DOCUMENTS_BUCKET).download(String(r.contract_pdf_url));
    if (dlErr || !file) throw new Error(`${label}: 저장된 PDF 를 읽지 못했습니다.`);
    bytes = new Uint8Array(await file.arrayBuffer());
  }
  const ok = await syncCardAttachment(r, bytes);
  console.log(`  ${ok ? "✓" : "✗"} ${label}${seal ? " (직인으로 다시 그림)" : ""}`);
}
