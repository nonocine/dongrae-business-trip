import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// 공유비번 관리자 로그인은 제거되었습니다.
//   * 관리자(관장) 진입은 구글 워크스페이스 로그인(master/관장)으로 통합.
//   * 기존 /admin/login 진입은 홈으로 보냅니다.
export default async function AdminLoginPage() {
  redirect("/");
}
