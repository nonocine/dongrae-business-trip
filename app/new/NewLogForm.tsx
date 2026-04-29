"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { createDrivingLog } from "@/app/actions";
import { useDriverSession } from "@/app/components/DriverSession";
import { VEHICLE } from "@/lib/vehicle";

type Props = {
  defaultDate: string;
  previousCumulative: number;
};

type DepartureMode = "center" | "custom";

const labelCls = "block text-sm font-medium text-slate-700";
const inputCls =
  "mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-[color:var(--brand)] focus:outline-none focus:ring-1 focus:ring-[color:var(--brand)]";

function formatNumber(n: number) {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 }).format(n);
}

export default function NewLogForm({ defaultDate, previousCumulative }: Props) {
  const { ready, driver, signOut } = useDriverSession();
  const [odometer, setOdometer] = useState<string>("");
  const [departureMode, setDepartureMode] = useState<DepartureMode>("center");
  const [departureCustom, setDepartureCustom] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const resolvedDeparture =
    departureMode === "center" ? VEHICLE.centerName : departureCustom.trim();

  const odometerNum = Number(odometer);
  const rounded =
    Number.isFinite(odometerNum) && odometer !== ""
      ? Math.round(odometerNum * 10) / 10
      : null;
  const distance =
    rounded !== null ? Math.round((rounded - previousCumulative) * 10) / 10 : null;
  const distanceInvalid = distance !== null && distance < 0;

  if (!ready) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        세션 확인 중…
      </div>
    );
  }

  if (!driver) {
    return (
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <p className="text-sm text-slate-700">
          운행일지 작성은 <span className="font-semibold">로그인한 운전자</span>만
          가능합니다.
        </p>
        <Link
          href="/login?next=/new"
          className="inline-block rounded-md bg-[color:var(--brand)] px-4 py-2 text-sm font-semibold text-white hover:bg-[color:var(--brand-strong)]"
        >
          운전자 로그인
        </Link>
      </div>
    );
  }

  return (
    <form
      action={(formData) => {
        setError(null);
        if (!resolvedDeparture) {
          setError("출발지를 입력해주세요.");
          return;
        }
        if (distanceInvalid) {
          setError(
            `입력한 누적거리(${formatNumber(rounded ?? 0)} km)가 직전 누적(${formatNumber(
              previousCumulative
            )} km)보다 작습니다.`
          );
          return;
        }
        formData.set("driver", driver.name);
        formData.set("driver_password", driver.password);
        formData.set("departure", resolvedDeparture);
        startTransition(async () => {
          try {
            await createDrivingLog(formData);
          } catch (e) {
            const msg = e instanceof Error ? e.message : "저장 중 오류가 발생했습니다.";
            if (msg.includes("NEXT_REDIRECT")) throw e;
            setError(msg);
          }
        });
      }}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
    >
      <div className="flex items-center justify-between rounded-lg bg-[color:var(--brand-soft)]/60 px-3 py-2 text-sm">
        <div>
          <p className="text-xs text-[color:var(--brand)]">로그인 운전자</p>
          <p className="font-semibold text-[color:var(--brand-strong)]">
            {driver.name}
          </p>
        </div>
        <button
          type="button"
          onClick={signOut}
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
        >
          로그아웃
        </button>
      </div>

      <div>
        <label htmlFor="driven_at" className={labelCls}>
          운행 일자 <span className="text-[color:var(--accent)]">*</span>
        </label>
        <input
          id="driven_at"
          name="driven_at"
          type="date"
          required
          defaultValue={defaultDate}
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls}>확인 / 결재</label>
        <div className="mt-1 flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          <span className="font-medium text-slate-800">허일수</span>
          <span className="text-xs text-slate-400">고정</span>
        </div>
        <input type="hidden" name="confirmed_by" value="허일수" />
      </div>

      <div>
        <label htmlFor="purpose" className={labelCls}>
          용무 (운행 목적) <span className="text-[color:var(--accent)]">*</span>
        </label>
        <input
          id="purpose"
          name="purpose"
          type="text"
          required
          placeholder="예) 청소년 행사 물품 운반"
          className={inputCls}
        />
      </div>

      <div>
        <label htmlFor="departure_mode" className={labelCls}>
          출발지 <span className="text-[color:var(--accent)]">*</span>
        </label>
        <select
          id="departure_mode"
          value={departureMode}
          onChange={(e) => setDepartureMode(e.target.value as DepartureMode)}
          className={inputCls}
        >
          <option value="center">{VEHICLE.centerName}</option>
          <option value="custom">기타 (직접입력)</option>
        </select>
        {departureMode === "custom" && (
          <input
            type="text"
            value={departureCustom}
            onChange={(e) => setDepartureCustom(e.target.value)}
            required
            placeholder="출발지를 입력해주세요"
            className={`${inputCls} mt-2`}
          />
        )}
        <input type="hidden" name="departure" value={resolvedDeparture} />
      </div>

      <div>
        <label htmlFor="waypoint" className={labelCls}>
          경유지 <span className="text-slate-400">(선택)</span>
        </label>
        <input
          id="waypoint"
          name="waypoint"
          type="text"
          placeholder="여러 경유지는 쉼표로 구분"
          className={inputCls}
        />
      </div>

      <div>
        <label htmlFor="destination" className={labelCls}>
          도착지 <span className="text-[color:var(--accent)]">*</span>
        </label>
        <input
          id="destination"
          name="destination"
          type="text"
          required
          className={inputCls}
        />
      </div>

      <div>
        <label htmlFor="odometer" className={labelCls}>
          운행 후 계기판 누적거리 (km){" "}
          <span className="text-[color:var(--accent)]">*</span>
        </label>
        <input
          id="odometer"
          name="odometer"
          type="number"
          min="0"
          step="0.1"
          required
          inputMode="decimal"
          value={odometer}
          onChange={(e) => setOdometer(e.target.value)}
          placeholder={`${previousCumulative} 이상`}
          className={inputCls}
        />
        <p className="mt-1 text-xs text-slate-500">
          차량 계기판에 표시된 전체 누적 km를 그대로 입력해주세요.
        </p>
      </div>

      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-xs text-slate-500">이전 누적</p>
            <p className="mt-0.5 font-semibold text-slate-700">
              {formatNumber(previousCumulative)} km
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">이번 운행</p>
            <p
              className={`mt-0.5 font-bold ${
                distanceInvalid
                  ? "text-[color:var(--accent)]"
                  : "text-[color:var(--brand)]"
              }`}
            >
              {distance !== null ? `${formatNumber(distance)} km` : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">신규 누적</p>
            <p className="mt-0.5 font-semibold text-slate-900">
              {rounded !== null ? `${formatNumber(rounded)} km` : "—"}
            </p>
          </div>
        </div>
      </div>

      {error && (
        <p className="rounded-md bg-[color:var(--accent-soft)] px-3 py-2 text-sm text-[color:var(--accent)]">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Link
          href="/"
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          취소
        </Link>
        <button
          type="submit"
          disabled={pending || distanceInvalid}
          className="rounded-md bg-[color:var(--brand)] px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[color:var(--brand-strong)] disabled:opacity-60"
        >
          {pending ? "저장 중…" : "저장"}
        </button>
      </div>
    </form>
  );
}
