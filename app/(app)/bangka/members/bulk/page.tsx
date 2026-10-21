import BulkImport from "@/app/(app)/bangka/members/bulk/BulkImport";

export const dynamic = "force-dynamic";

// 학생 일괄 등록 — 엑셀에서 복사해 붙여넣기 → 미리보기 → 저장.
export default function BangkaBulkPage() {
  return <BulkImport />;
}
