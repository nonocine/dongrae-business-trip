"use client";

import { useState, useTransition } from "react";
import { saveEmployeeProfile } from "@/app/hr/actions";
import type { Driver, EmployeeProfile } from "@/lib/supabase";

const cardCls =
  "rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5";
const inputCls =
  "mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const labelCls = "block text-xs font-medium text-slate-600";

export default function EmployeeProfileForm({
  driver,
  profile,
}: {
  driver: Driver;
  profile: EmployeeProfile | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <section className={cardCls}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">
          {driver.name}
          {driver.rank && (
            <span className="ml-1 text-xs font-normal text-slate-400">
              ({driver.rank})
            </span>
          )}{" "}
          인사기록카드
        </h3>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            profile
              ? "bg-emerald-100 text-emerald-700"
              : "bg-slate-100 text-slate-500"
          }`}
        >
          {profile ? "입력됨" : "미입력"}
        </span>
      </div>

      <form
        action={(formData) => {
          setError(null);
          setOk(null);
          startTransition(async () => {
            try {
              await saveEmployeeProfile(formData);
              setOk("저장되었습니다.");
            } catch (e) {
              setError(
                e instanceof Error
                  ? e.message
                  : "저장 중 오류가 발생했습니다."
              );
            }
          });
        }}
        className="mt-4 space-y-3"
      >
        <input type="hidden" name="driver_id" value={driver.id} />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>한자명</label>
            <input
              name="name_chinese"
              type="text"
              defaultValue={profile?.name_chinese ?? ""}
              placeholder="洪吉童"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>주민등록번호</label>
            <input
              name="resident_number"
              type="text"
              defaultValue={profile?.resident_number ?? ""}
              placeholder="000000-0000000"
              className={`${inputCls} font-mono`}
            />
          </div>

          <div>
            <label className={labelCls}>성별</label>
            <div className="mt-1 flex gap-4 py-1.5">
              {(["남", "여"] as const).map((g) => (
                <label
                  key={g}
                  className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-slate-700"
                >
                  <input
                    type="radio"
                    name="gender"
                    value={g}
                    defaultChecked={profile?.gender === g}
                    className="h-3.5 w-3.5 border-slate-300 text-blue-500 focus:ring-blue-500"
                  />
                  {g}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className={labelCls}>생년월일</label>
            <input
              name="birth_date"
              type="date"
              defaultValue={profile?.birth_date ?? ""}
              className={inputCls}
            />
          </div>

          <div className="sm:col-span-2">
            <label className={labelCls}>주소</label>
            <input
              name="address"
              type="text"
              defaultValue={profile?.address ?? ""}
              placeholder="부산광역시 동래구 …"
              className={inputCls}
            />
          </div>

          <div>
            <label className={labelCls}>이메일</label>
            <input
              name="email"
              type="email"
              defaultValue={profile?.email ?? ""}
              placeholder="name@example.com"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>전화번호</label>
            <input
              name="phone"
              type="tel"
              defaultValue={profile?.phone ?? ""}
              placeholder="010-0000-0000"
              className={inputCls}
            />
          </div>

          <div>
            <label className={labelCls}>입사일</label>
            <input
              name="join_date"
              type="date"
              defaultValue={profile?.join_date ?? ""}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>퇴사일 (선택)</label>
            <input
              name="leave_date"
              type="date"
              defaultValue={profile?.leave_date ?? ""}
              className={inputCls}
            />
          </div>

          <div className="sm:col-span-2">
            <label className={labelCls}>병역 (선택)</label>
            <input
              name="military_service"
              type="text"
              defaultValue={profile?.military_service ?? ""}
              placeholder="예: 육군 병장 만기전역 / 해당없음"
              className={inputCls}
            />
          </div>
        </div>

        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">
            {error}
          </p>
        )}
        {ok && (
          <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            {ok}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="h-[38px] w-full rounded-md bg-blue-500 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-600 disabled:opacity-60 sm:w-auto sm:px-6"
        >
          {pending ? "저장 중…" : "저장"}
        </button>
      </form>
    </section>
  );
}
