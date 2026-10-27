import MenuUpload from "@/app/(app)/bangka/meals/upload/MenuUpload";

export const dynamic = "force-dynamic";

// 업체 주간 식단표(xlsx) 올리기. 접근 가드는 meals/layout(BangkaShell).
export default function BangkaMenuUploadPage() {
  return <MenuUpload />;
}
