"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { BANGKA_MEDIA_BUCKET } from "@/lib/bangkaContent";

// =====================================================================
// 브라우저 → Storage 직접 업로드(서버가 발급한 서명 업로드 토큰으로).
//   Vercel 함수 요청 본문 한도(4.5MB) 때문에 파일은 서버 액션을 거치지 않습니다.
//   토큰이 있어야만 그 경로 하나에 올릴 수 있고, 버킷은 비공개 그대로입니다.
//   (lib/supabase 는 서버용 클라이언트도 함께 불러와서 여기서는 따로 만듭니다.)
// =====================================================================

let client: SupabaseClient | null = null;
function browserClient(): SupabaseClient {
  if (!client) {
    client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
  }
  return client;
}

export async function uploadToSlot(slot: { path: string; token: string }, file: File): Promise<void> {
  const { error } = await browserClient()
    .storage.from(BANGKA_MEDIA_BUCKET)
    .uploadToSignedUrl(slot.path, slot.token, file, { contentType: file.type || "application/octet-stream" });
  if (error) throw new Error(`${file.name}: 올리지 못했습니다(${error.message}).`);
}
