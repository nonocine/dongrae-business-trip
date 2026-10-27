import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveBangkaAccess } from "@/lib/bangkaAccess";
import { isYm, shiftYm } from "@/lib/bangkaContent";
import { buildMealPlanPdf } from "@/lib/bangkaFormPdf";
import { kstTodayYmd } from "@/lib/trainings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// [필수 운영서식 2] 급식계획 PDF — ?ym=2026-10. 작성자 = 로그인 직원, 작성일자 = 오늘(KST).
//   결재란(담임·팀장)은 비워 둡니다(종이 결재).
export async function GET(request: Request) {
  const me = await resolveBangkaAccess();
  if (!me) return new Response("방과후아카데미 관리 권한이 없습니다.", { status: 403 });
  const ym = new URL(request.url).searchParams.get("ym") ?? kstTodayYmd().slice(0, 7);
  if (!isYm(ym)) return new Response("달이 올바르지 않습니다.", { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("bk_meals")
    .select("meal_date, menu_text, menu_items, kcal")
    .gte("meal_date", `${ym}-01`)
    .lt("meal_date", `${shiftYm(ym, 1)}-01`)
    .order("meal_date");
  if (error) return new Response(error.message, { status: 500 });
  const rows = (data ?? []) as { meal_date: string; menu_text: string | null; menu_items: { name?: string }[] | null; kcal: number | null }[];
  const days = rows.map((r) => ({
    date: r.meal_date,
    // 업체 표로 올린 날은 메뉴 이름(알레르기 번호 뺀 것), 손으로 넣은 날은 줄 그대로.
    menus: Array.isArray(r.menu_items) && r.menu_items.length
      ? r.menu_items.map((i) => String(i.name ?? "")).filter(Boolean)
      : (r.menu_text ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
    kcal: r.kcal,
  }));

  const bytes = await buildMealPlanPdf({ ym, writtenOn: kstTodayYmd(), writer: me.name, days });
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
