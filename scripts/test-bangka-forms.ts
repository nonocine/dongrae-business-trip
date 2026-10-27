// 동래방카 운영서식 출력 확인 — npx tsx scripts/test-bangka-forms.ts <출력폴더> [업체식단표.xlsx]
//   급식계획(업체 샘플 식단 + 긴 메뉴 칸) · 공결확인서(서명·증빙 사진 1장)를 만들어 저장합니다.
//   DB 는 쓰지 않습니다.
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import sharp from "sharp";
import { readXlsxGrid } from "../lib/bangkaMenuXlsx";
import { menuItemsOf, parseVendorWeek } from "../lib/bangkaMenuParse";
import { buildAbsencePdf, buildMealPlanPdf, mealPlanWeeks, type MealPlanDay } from "../lib/bangkaFormPdf";

(async () => {
  const out = process.argv[2] ?? ".";
  mkdirSync(out, { recursive: true });
  const days: MealPlanDay[] = [];
  if (process.argv[3]) {
    const w = parseVendorWeek((await readXlsxGrid(readFileSync(process.argv[3]))).rows);
    for (const d of w.days.filter((x) => x.hasMeal)) days.push({ date: d.date!, menus: menuItemsOf(d).map((i) => ({ name: i.name, allergens: i.allergens })), kcal: d.nutrition.kcal });
  }
  // 넘침 확인용 — 아주 긴 메뉴 하루.
  days.push({
    date: "2026-10-05",
    // 알레르기 번호까지 붙은 가장 긴 날(번호가 많아도 칸 안에 들어가는지).
    menus: (
      [
        ["현미찹쌀흑미잡곡밥", []],
        ["얼큰한소고기버섯육개장", [5, 6, 13, 16]],
        ["치즈돈까스와타르타르소스", [1, 2, 5, 6, 10, 12, 13]],
        ["매콤달콤양념치킨강정", [5, 6, 12, 13, 15]],
        ["청포묵김가루무침", [5, 6, 13]],
        ["깍두기", [9, 13]],
        ["브로콜리초장무침", [5, 6, 13]],
        ["요구르트", [2]],
        ["과일샐러드와요거트드레싱", [1, 2, 5, 11, 12]],
        ["수제초코머핀", [1, 2, 4, 5, 6, 14]],
      ] as [string, number[]][]
    ).map(([name, allergens]) => ({ name, allergens })),
    kcal: 702,
  });
  days.push({ date: "2026-10-01", menus: [{ name: "백미밥", allergens: [] }, { name: "미역국", allergens: [5, 6, 16] }, { name: "불고기", allergens: [5, 6, 13, 16] }], kcal: 640 });
  console.log("10월 주:", mealPlanWeeks("2026-10"), "| 2026-08(6주):", mealPlanWeeks("2026-08"));
  writeFileSync(path.join(out, "meal-plan.pdf"), await buildMealPlanPdf({ ym: "2026-10", writtenOn: "2026-10-27", writer: "정다영", days }));
  writeFileSync(path.join(out, "meal-plan-6weeks.pdf"), await buildMealPlanPdf({ ym: "2026-08", writtenOn: "2026-10-27", writer: "정다영", days: [] }));
  // 각주 넘침 확인용 — 11월 평일·토요일 전부 위 "아주 긴 하루" 메뉴 → 각주가 표 아래에 다 안 들어가 맨 뒤 장으로 이어짐.
  const heavy = days.find((d) => d.date === "2026-10-05")!;
  const novDays = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`)
    .filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0)
    .map((date) => ({ ...heavy, date }));
  writeFileSync(path.join(out, "meal-plan-footnote-overflow.pdf"), await buildMealPlanPdf({ ym: "2026-11", writtenOn: "2026-10-27", writer: "정다영", days: novDays }));

  const sig = await sharp({ create: { width: 300, height: 120, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from(`<svg width="300" height="120"><path d="M20 80 C60 10, 90 110, 130 50 S200 20, 280 70" stroke="black" stroke-width="6" fill="none"/></svg>`) }])
    .png()
    .toBuffer();
  const photo = await sharp({ create: { width: 800, height: 1100, channels: 3, background: { r: 230, g: 236, b: 245 } } })
    .composite([{ input: Buffer.from(`<svg width="800" height="1100"><text x="80" y="200" font-size="60">진료확인서(테스트)</text></svg>`) }])
    .jpeg()
    .toBuffer();
  const base = {
    name: "김방카",
    school: "창신초등학교",
    grade: "초4",
    afterClass: "이음반", // 방과후 반 — "반" 글자는 서식에 있어 "이음"만 찍힘
    confirmedOn: "2026-10-27",
    signature: { bytes: sig, mime: "image/png" },
    evidence: [{ name: "진료확인서.jpg", mime: "image/jpeg", bytes: photo }],
  };
  writeFileSync(
    path.join(out, "absence-guardian.pdf"),
    await buildAbsencePdf({
      ...base,
      startDate: "2026-10-28",
      endDate: "2026-10-30",
      confirmerType: "guardian",
      confirmerOther: null,
      confirmerName: "김보호",
      reasonLabel: "질병",
      reason: "독감(인플루엔자 A형) 진단으로 의사 소견에 따라 3일간 등원하지 않습니다.\n완치 후 등원 예정입니다.",
    }),
  );
  writeFileSync(
    path.join(out, "absence-other.pdf"),
    await buildAbsencePdf({
      ...base,
      signature: null,
      afterClass: "지음반",
      evidence: [],
      startDate: "2026-11-02",
      endDate: "2026-11-02",
      confirmerType: "other",
      confirmerOther: "할머니",
      confirmerName: "박할매",
      reasonLabel: "가족행사",
      reason: "외조부 칠순 잔치(가족행사)",
    }),
  );
  console.log("저장:", out);
})();
