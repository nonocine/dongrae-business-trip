// =====================================================================
// 공용 메일함 — 첨부 다운로드 서명 URL (0단계)
//   * 버킷(shared-mail)은 비공개라 서명 URL 로만 내려받습니다.
//   * 서버 전용 모듈("use server" 아님) — 라우트에서 import 합니다.
//
//   ★★ createSignedUrl 의 { download } 옵션을 쓰지 마세요. 한글 파일명이
//      이중 인코딩돼 깨집니다.
//
//      @supabase/storage-js 는 download 값을 URLSearchParams 로 한 번
//      퍼센트 인코딩한 뒤, 완성된 URL 전체에 encodeURI 를 한 번 더 겁니다.
//      encodeURI 는 '%' 를 '%25' 로 이스케이프하므로 %EC%88%98 → %25EC%2588%2598
//      이 됩니다(storage-js StorageFileApi.createSignedUrl).
//
//      운영 Storage 실측 (2026-09-23, 같은 파일 같은 경로):
//        A) { download: "수정 26년 10월 5학년 …양식.hwp" }
//             Content-Disposition: … filename*=UTF-8''%25EC%2588%2598%25EC%25A0%2595…
//             브라우저 저장 이름: "%EC%88%98%EC%A0%95 26%EB%85%84 …양식.hwp"  ✗
//        B) 서명만 받고 &download=encodeURIComponent(name) 을 직접 부착
//             Content-Disposition: … filename*=UTF-8''%EC%88%98%EC%A0%95…
//             브라우저 저장 이름: "수정 26년 10월 5학년 …양식.hwp"            ✓
//        C) download 없음(0단계 이전 운영 동작)
//             Content-Disposition: 없음 → 브라우저가 경로 끝을 파일명으로 사용
//             저장 이름: "1-26105.hwp"                                       ✗
//
//      그래서 서명만 SDK 로 받고 download 파라미터는 우리가 1회만 붙입니다.
//      "SDK 옵션으로 정리하자" 는 생각이 들면 위 A 를 먼저 재현해 보세요.
//
//   * Storage 키가 ASCII 안전 이름인 것(lib/mailParse.ts storageSafeName)은
//     그대로 둡니다 — 한글 키는 업로드 자체가 거부됩니다. 표시·저장용 원본
//     이름은 attachments[].name 에 보존돼 있고, 여기서 그 값을 씁니다.
// =====================================================================

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { MAIL_BUCKET } from "@/lib/mail";

// 서명 수명 — 라우트가 받자마자 302 로 넘기므로 길 필요가 없습니다.
//   다만 큰 첨부를 느린 망에서 재시도(Range 재요청)하는 경우가 있어 5분을 둡니다.
const SIGN_TTL_SEC = 300;

export async function signedAttachmentUrl(
  path: string,
  downloadName: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin.storage
    .from(MAIL_BUCKET)
    .createSignedUrl(path, SIGN_TTL_SEC);
  if (error || !data) {
    console.warn("[mail] 첨부 서명 실패:", error?.message ?? "(사유 없음)");
    return null;
  }
  const name = downloadName.trim();
  if (!name) return data.signedUrl;
  // 서명 URL 에는 이미 ?token=… 이 붙어 있으므로 '&' 로 잇습니다.
  return `${data.signedUrl}&download=${encodeURIComponent(name)}`;
}

// --- 재첨부용 바이트 읽기 (1단계) ---
//   전달·답장에 원본 첨부를 다시 붙일 때 씁니다. 서명 URL 을 거치지 않고
//   service_role 로 곧장 내려받습니다 — 서버 안에서만 쓰이므로 URL 이 필요
//   없고, 만료를 신경 쓸 일도 없습니다.
//   ★ 사본을 새로 만들지 않습니다. 보낸 뒤 버퍼는 그대로 버립니다.
export async function readAttachmentBytes(
  path: string,
): Promise<Buffer | null> {
  const { data, error } = await supabaseAdmin.storage
    .from(MAIL_BUCKET)
    .download(path);
  if (error || !data) {
    console.warn(
      "[mail] 첨부 읽기 실패:",
      error?.message ?? "(사유 없음)",
      path,
    );
    return null;
  }
  return Buffer.from(await data.arrayBuffer());
}
