// /sms 화면 전용 스타일 — 동업자씨 색 체계(lib/ui, globals.css 토큰)에 맞춘 박스·카드·칩.
import type { SmsChipColor } from "@/lib/sms/text";

export const pageBg = "bg-[#f5f7fa]";
export const stepBox = "rounded-[12px] border border-[#cbd5e1] bg-card p-4 sm:p-5";
export const cartBox = "rounded-[12px] border border-[#cbd5e1] bg-[#f1f5fb] p-4 sm:p-5";
export const pickerBox = "rounded-[12px] border-2 border-brand-blue bg-card p-4";
export const sourceCard = (on: boolean) =>
  `flex h-full w-full flex-col items-start gap-1 rounded-[10px] p-3 text-left transition ${
    on
      ? "border-2 border-brand-blue bg-brand-blue-soft"
      : "border border-[#cbd5e1] bg-[#f8fafc] hover:border-edge-blue"
  }`;

export const CHIP: Record<SmsChipColor, string> = {
  blue: "border-[#c6d3e8] bg-[#eaf2fb] text-[#1e4e92]",
  green: "border-[#c5e7cf] bg-[#ecf8ef] text-[#2f7a3f]",
  amber: "border-[#f3dfa6] bg-[#fdf6e3] text-[#8a5d00]",
  violet: "border-[#d9cff0] bg-[#f3effb] text-[#5b3fa0]",
};

export const chipCls = (c: SmsChipColor) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium ${CHIP[c]}`;

export const modalBackdrop = "fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6";
export const modalPanel = "max-h-full w-full overflow-y-auto rounded-[12px] bg-card p-5 shadow-xl";

let seq = 0;
export function newUid(): string {
  seq += 1;
  return `b${Date.now().toString(36)}${seq}`;
}
