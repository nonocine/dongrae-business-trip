"use client";

import type { ComponentType } from "react";
import type { SmsPickerType } from "@/lib/sms/text";
import ListPicker from "./ListPicker";
import SearchPicker from "./SearchPicker";
import PastePicker from "./PastePicker";
import type { PickerProps } from "./types";

// 선택기 종류 → 공용 컴포넌트. 같은 종류를 쓰는 새 출처는 여기도 고칠 필요가 없습니다.
//   새 '종류'를 만들 때만 한 줄 추가합니다(docs/SMS_SOURCES.md).
export const PICKERS: Record<SmsPickerType, ComponentType<PickerProps>> = {
  list: ListPicker,
  "term-program": ListPicker,
  search: SearchPicker,
  paste: PastePicker,
};
