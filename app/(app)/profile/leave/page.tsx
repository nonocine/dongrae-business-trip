import { redirect } from "next/navigation";

// 옛 주소 — '내 연차·대휴'는 내 인사기록카드의 '연차·대휴' 탭으로 옮겼습니다.
export default function MyLeaveRedirect() {
  redirect("/profile/hr#erp-leave");
}
