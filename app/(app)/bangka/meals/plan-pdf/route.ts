import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveBangkaAccess } from "@/lib/bangkaAccess";
import { isYm, shiftYm } from "@/lib/bangkaContent";
import { buildMealPlanPdf, mealPhotoJpeg, type MealPhoto } from "@/lib/bangkaFormPdf";
import { bucket } from "@/lib/bangkaMedia";
import { kstTodayYmd } from "@/lib/trainings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// [필수 운영서식 2] 급식계획 PDF — ?ym=2026-10. 작성자 = 로그인 직원, 작성일자 = 오늘(KST).
//   결재란(담당·팀장·관장)은 비워 둡니다(종이 결재). 메뉴마다 알레르기 번호(업체 표로 올린 날만).
//   &photos=0 이 아니면 뒤에 "급식 사진" 장 — bangka-media 는 비공개라 서버가 직접 내려받아 줄여 넣습니다.
export async function GET(request: Request) {
  const me = await resolveBangkaAccess();
  if (!me) return new Response("방과후아카데미 관리 권한이 없습니다.", { status: 403 });
  const ym = new URL(request.url).searchParams.get("ym") ?? kstTodayYmd().slice(0, 7);
  if (!isYm(ym)) return new Response("달이 올바르지 않습니다.", { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("bk_meals")
    .select("meal_date, menu_text, menu_items, kcal, photo_path")
    .gte("meal_date", `${ym}-01`)
    .lt("meal_date", `${shiftYm(ym, 1)}-01`)
    .order("meal_date");
  if (error) return new Response(error.message, { status: 500 });
  const rows = (data ?? []) as { meal_date: string; menu_text: string | null; menu_items: { name?: string; allergens?: unknown }[] | null; kcal: number | null; photo_path: string | null }[];
  const days = rows.map((r) => ({
    date: r.meal_date,
    // 업체 표로 올린 날은 메뉴 이름 + 알레르기 번호, 손으로 넣은 날은 줄 그대로(번호 없음).
    menus: Array.isArray(r.menu_items) && r.menu_items.length
      ? r.menu_items
          .map((i) => ({
            name: String(i.name ?? ""),
            allergens: Array.isArray(i.allergens) ? i.allergens.filter((n): n is number => Number.isInteger(n)) : [],
          }))
          .filter((i) => i.name)
      : (r.menu_text ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((name) => ({ name, allergens: [] })),
    kcal: r.kcal,
  }));

  const photos: MealPhoto[] = [];
  if (new URL(request.url).searchParams.get("photos") !== "0") {
    for (const r of rows) {
      if (!r.photo_path) continue;
      const { data: blob } = await bucket().download(r.photo_path);
      if (!blob) continue; // 파일이 없으면 그 날만 건너뜀
      try {
        const menus = days.find((d) => d.date === r.meal_date)?.menus.map((x) => x.name) ?? [];
        photos.push({ date: r.meal_date, jpeg: await mealPhotoJpeg(new Uint8Array(await blob.arrayBuffer())), menus });
      } catch {
        // 읽을 수 없는 이미지 — 그 날만 건너뜀
      }
    }
  }

  const bytes = await buildMealPlanPdf({ ym, writtenOn: kstTodayYmd(), writer: me.name, days, photos });
  const [y, m] = ym.split("-").map(Number);
  const filename = `급식계획_${y}년${m}월.pdf`;
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
