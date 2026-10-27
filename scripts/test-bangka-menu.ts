// 업체 식단표 해석 확인 — npx tsx scripts/test-bangka-menu.ts <파일.xlsx> [--grid]
import { readFileSync } from "fs";
import { readXlsxGrid } from "../lib/bangkaMenuXlsx";
import { allergyNoteOf, menuItemsOf, parseVendorWeek } from "../lib/bangkaMenuParse";

(async () => {
  const file = process.argv[2];
  const g = await readXlsxGrid(readFileSync(file));
  if (process.argv.includes("--grid")) g.rows.forEach((r, i) => console.log(i + 1, JSON.stringify(r)));
  const w = parseVendorWeek(g.rows);
  console.log("시트", g.sheetName, "| 제목", w.title, "| 영양사", w.dietitian, "| 업체", w.vendor);
  console.log("구분", w.slots.join("·"));
  console.log("오류", w.errors, "경고", w.warnings);
  for (const d of w.days) {
    console.log(`\n[${d.label}] ${d.date ?? "날짜없음"} ${d.hasMeal ? "" : "(급식 없음)"} kcal=${d.nutrition.kcal} 단백질=${d.nutrition.protein_pct} 칼슘=${d.nutrition.calcium_mg} 철분=${d.nutrition.iron_mg}`);
    if (!d.hasMeal) continue;
    for (const it of d.items) console.log(`  ${it.slot.padEnd(3)} ${JSON.stringify(it.raw)} → ${it.name} [${it.allergens}]${it.warn ? " ⚠ " + it.warn : ""}`);
    console.log("  allergy_note:", allergyNoteOf(menuItemsOf(d)));
  }
  console.log("\n기준:", w.nutritionBasis, "\n알레르기표:", w.allergenLegend, "\n원산지:", w.originText);
})();
