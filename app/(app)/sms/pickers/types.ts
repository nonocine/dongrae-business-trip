import type {
  SmsOptionsRequest,
  SmsOptionsResult,
  SmsSelection,
  SmsSourceMeta,
} from "@/lib/sms/text";

// 모든 선택기가 받는 props — 출처 메타 + "담기" 콜백. 출처가 늘어도 이 모양은 그대로.
export type PickerProps = {
  meta: SmsSourceMeta;
  onAdd: (selection: SmsSelection) => void;
};

export async function fetchOptions(
  req: SmsOptionsRequest,
): Promise<{ ok: true; data: SmsOptionsResult } | { ok: false; error: string }> {
  try {
    const r = await fetch("/api/sms/options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    const j = (await r.json().catch(() => ({}))) as SmsOptionsResult & { ok?: boolean; error?: string };
    if (!r.ok || j.ok === false) return { ok: false, error: j.error ?? `목록을 불러오지 못했습니다(${r.status}).` };
    return { ok: true, data: { filters: j.filters ?? [], items: j.items ?? [], bulkLabel: j.bulkLabel, note: j.note, grouped: j.grouped } };
  } catch {
    return { ok: false, error: "목록을 불러오지 못했습니다." };
  }
}
