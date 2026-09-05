import { supabaseAdmin } from "@/lib/supabaseAdmin";

// =====================================================================
// settings(key, value) 에 "마지막으로 ~한 시각" 을 남기는 공용 도우미.
//   * settings 는 프로젝트 공용 Key-Value 테이블입니다. 상태 하나 때문에
//     새 테이블을 만들지 않고 여기에 얹는 것이 이 프로젝트의 관례입니다
//     (mail_fetch_alert_at, mail_last_fetch_at 이 같은 방식).
//   * 쓰기는 upsert(onConflict:"key") — key 에 unique 제약이 있어 select 후
//     insert/update 로 나누면 동시 실행 시 충돌합니다.
//   * 서버 전용(supabaseAdmin 사용).
//
//   ※ lib/mailCollector.ts 에도 같은 모양의 사설 헬퍼가 있습니다. 수집 로직을
//     건드리지 않으려고 그대로 두었습니다 — 나중에 정리할 때 이쪽으로
//     합치면 됩니다.
// =====================================================================

export async function readMark(key: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error || !data) return null;
  const value = (data as { value: unknown }).value;
  return value == null ? null : String(value);
}

export async function writeMark(key: string, value: string): Promise<void> {
  await supabaseAdmin
    .from("settings")
    .upsert({ key, value }, { onConflict: "key" });
}

// 마지막 기록이 interval 보다 오래됐는지 — 알림 도배를 막는 데 씁니다.
export async function markIsStale(
  key: string,
  intervalMs: number,
  now: number,
): Promise<boolean> {
  const last = await readMark(key);
  if (!last) return true;
  const at = Date.parse(last);
  if (Number.isNaN(at)) return true;
  return now - at >= intervalMs;
}
