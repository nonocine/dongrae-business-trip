// =====================================================================
// 담긴 명단(묶음들) → 실제 받는 사람 계산 — 미리보기·발송·주소록 저장이 같은 함수를 씁니다.
//   * 묶음마다 출처의 canUse 를 다시 확인합니다(화면 값을 믿지 않음).
//   * 번호는 숫자만 남겨 검사하고, 앞 묶음과 같은 번호는 중복으로 뺍니다.
//   * 개별로 뺀 사람(excluded)은 계산에서 제외합니다.
//   ⚠️ 번호는 이 모듈과 발송 라우트 밖으로 나가지 않습니다(미리보기 응답엔 hasPhone 만).
//   * 서버 전용.
// =====================================================================

import type { SmsUser } from "@/lib/sms/access";
import {
  isValidSmsPhone,
  normalizeSmsPhone,
  type SmsBundle,
  type SmsChipColor,
  type SmsPreviewPerson,
  type SmsPreviewResult,
} from "@/lib/sms/text";
import { findSmsSource } from "@/lib/sms/sources";
import type { SmsPersonRef } from "@/lib/sms/sources/types";

export const MAX_BUNDLES = 30;

export type ComputedRecipients = {
  phones: string[]; // 보낼 번호(중복 제거)
  preview: SmsPreviewResult;
  sources: string[]; // 쓰인 출처 key
  // 주소록 저장용 — 사람별 참조(빠진 사람·번호 없는 사람 제외, 중복 제거 전).
  refs: (SmsPersonRef & { name: string })[];
};

export function cleanBundles(raw: unknown): SmsBundle[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_BUNDLES)
    .map((b) => b as Partial<SmsBundle>)
    .filter((b) => typeof b?.source === "string" && typeof b?.uid === "string")
    .map((b) => ({
      uid: String(b.uid).slice(0, 64),
      source: String(b.source),
      selection: b.selection && typeof b.selection === "object" ? b.selection : {},
      excluded: Array.isArray(b.excluded)
        ? b.excluded.filter((x): x is string => typeof x === "string").slice(0, 5000)
        : [],
    }));
}

export async function computeRecipients(
  user: SmsUser,
  bundles: SmsBundle[],
): Promise<ComputedRecipients> {
  const seen = new Set<string>();
  const phones: string[] = [];
  const people: SmsPreviewPerson[] = [];
  const refs: ComputedRecipients["refs"] = [];
  const chips: { uid: string; label: string; count: number; color: SmsChipColor }[] = [];
  const summaryParts: string[] = [];
  let duplicates = 0;
  let noPhone = 0;

  for (const b of bundles) {
    const src = findSmsSource(b.source);
    if (!src) throw new Error(`알 수 없는 출처입니다: ${b.source}`);
    if (!src.canUse(user)) throw new Error(`"${src.label}" 출처를 쓸 권한이 없습니다.`);
    const r = await src.resolvePhones(user, b.selection);
    const excluded = new Set(b.excluded);
    let count = 0;
    for (const p of r.people) {
      if (excluded.has(p.key)) continue;
      const d = normalizeSmsPhone(p.phone ?? "");
      const valid = isValidSmsPhone(d);
      const dup = valid && seen.has(d);
      if (!valid) noPhone += 1;
      else if (dup) duplicates += 1;
      else {
        seen.add(d);
        phones.push(d);
        count += 1;
      }
      if (valid && (p.ref.ref_id || p.ref.source === "manual"))
        refs.push({ ...p.ref, phone: p.ref.source === "manual" ? d : null, name: p.name });
      people.push({
        key: p.key,
        bundle: b.uid,
        name: p.name,
        sourceLabel: src.label,
        hasPhone: valid,
        duplicate: dup,
      });
    }
    chips.push({ uid: b.uid, label: r.label, count, color: src.color });
    summaryParts.push(`${r.short ?? r.label} ${count}`);
  }

  return {
    phones,
    sources: [...new Set(bundles.map((b) => b.source))],
    refs,
    preview: {
      ok: true,
      total: phones.length,
      duplicates,
      noPhone,
      bundles: chips,
      people,
      summary: summaryParts.join(" + "),
    },
  };
}
