"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { createBusinessTrip } from "@/app/actions";
import { TRANSPORT_LABEL, type TransportType } from "@/lib/supabase";

const labelCls = "block text-sm font-medium text-slate-700";
const inputBase =
  "block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-[color:var(--brand)] focus:outline-none focus:ring-1 focus:ring-[color:var(--brand)]";
const inputCls = `mt-1 ${inputBase}`;
const textareaCls = `mt-1 ${inputBase} min-h-[88px] resize-y`;

const MAX_PHOTOS = 5;

type Props = {
  defaultDate: string;
  employees: string[];
  lockedTraveler: string | null;
};

export default function NewTripForm({
  defaultDate,
  employees,
  lockedTraveler,
}: Props) {
  const [transport, setTransport] = useState<TransportType>("vehicle");
  const [companions, setCompanions] = useState<string[]>([]);
  const [companionPick, setCompanionPick] = useState("");
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [receiptPreviews, setReceiptPreviews] = useState<string[]>([]);
  const [receiptFiles, setReceiptFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function addCompanion() {
    const v = companionPick.trim();
    if (!v) return;
    if (companions.includes(v)) {
      setCompanionPick("");
      return;
    }
    setCompanions([...companions, v]);
    setCompanionPick("");
  }
  function removeCompanion(name: string) {
    setCompanions(companions.filter((c) => c !== name));
  }

  function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const next = [...photoFiles, ...files].slice(0, MAX_PHOTOS);
    setPhotoFiles(next);
    setPhotoPreviews(next.map((f) => URL.createObjectURL(f)));
    e.target.value = "";
  }
  function removePhoto(i: number) {
    const next = photoFiles.filter((_, idx) => idx !== i);
    setPhotoFiles(next);
    setPhotoPreviews(next.map((f) => URL.createObjectURL(f)));
  }

  function handleReceiptSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const next = [...receiptFiles, ...files];
    setReceiptFiles(next);
    setReceiptPreviews(next.map((f) => URL.createObjectURL(f)));
    e.target.value = "";
  }
  function removeReceipt(i: number) {
    const next = receiptFiles.filter((_, idx) => idx !== i);
    setReceiptFiles(next);
    setReceiptPreviews(next.map((f) => URL.createObjectURL(f)));
  }

  return (
    <form
      ref={formRef}
      action={(formData) => {
        setError(null);
        // Override file inputs with our state-managed files
        formData.delete("photos");
        for (const f of photoFiles) formData.append("photos", f);
        formData.delete("receipts");
        for (const f of receiptFiles) formData.append("receipts", f);
        // Companions (multi)
        formData.delete("companion");
        for (const c of companions) formData.append("companion", c);

        startTransition(async () => {
          try {
            await createBusinessTrip(formData);
          } catch (e) {
            const msg =
              e instanceof Error ? e.message : "저장 중 오류가 발생했습니다.";
            if (msg.includes("NEXT_REDIRECT")) throw e;
            setError(msg);
          }
        });
      }}
      className="space-y-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
    >
      <div>
        <label htmlFor="trip_date" className={labelCls}>
          출장일자 <span className="text-[color:var(--accent)]">*</span>
        </label>
        <input
          id="trip_date"
          name="trip_date"
          type="date"
          required
          defaultValue={defaultDate}
          className={inputCls}
        />
      </div>

      <div>
        <label htmlFor="destination" className={labelCls}>
          출장지 <span className="text-[color:var(--accent)]">*</span>
        </label>
        <input
          id="destination"
          name="destination"
          type="text"
          required
          placeholder="예) 부산시청 4층 회의실"
          className={inputCls}
        />
      </div>

      <div>
        <label htmlFor="traveler" className={labelCls}>
          출장자 <span className="text-[color:var(--accent)]">*</span>
        </label>
        {lockedTraveler ? (
          <>
            <div className="mt-1 flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <span className="font-medium text-slate-800">
                {lockedTraveler}
              </span>
              <span className="text-xs text-slate-400">본인</span>
            </div>
            <input type="hidden" name="traveler" value={lockedTraveler} />
          </>
        ) : employees.length > 0 ? (
          <select
            id="traveler"
            name="traveler"
            required
            defaultValue=""
            className={inputCls}
          >
            <option value="" disabled>
              출장자를 선택해주세요
            </option>
            {employees.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        ) : (
          <input
            id="traveler"
            name="traveler"
            type="text"
            required
            placeholder="이름을 입력해주세요"
            className={inputCls}
          />
        )}
        {!lockedTraveler && employees.length === 0 && (
          <p className="mt-1 text-xs text-slate-500">
            * 관리자 페이지에서 직원을 등록하면 드롭다운으로 선택할 수 있습니다.
          </p>
        )}
      </div>

      <div>
        <label className={labelCls}>동행자 (선택)</label>
        {employees.length > 0 ? (
          <div className="mt-1 flex gap-2">
            <select
              value={companionPick}
              onChange={(e) => setCompanionPick(e.target.value)}
              className={`${inputBase} flex-1`}
            >
              <option value="">동행자를 선택해주세요</option>
              {employees.map((n) => (
                <option key={n} value={n} disabled={companions.includes(n)}>
                  {n}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={addCompanion}
              className="shrink-0 rounded-md bg-slate-800 px-3 text-sm font-semibold text-white hover:bg-slate-700"
            >
              추가
            </button>
          </div>
        ) : (
          <div className="mt-1 flex gap-2">
            <input
              type="text"
              value={companionPick}
              onChange={(e) => setCompanionPick(e.target.value)}
              placeholder="동행자 이름"
              className={`${inputBase} flex-1`}
            />
            <button
              type="button"
              onClick={addCompanion}
              className="shrink-0 rounded-md bg-slate-800 px-3 text-sm font-semibold text-white hover:bg-slate-700"
            >
              추가
            </button>
          </div>
        )}
        {companions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {companions.map((c) => (
              <span
                key={c}
                className="inline-flex items-center gap-1 rounded-full bg-[color:var(--brand-soft)] px-3 py-1 text-xs font-medium text-[color:var(--brand-strong)]"
              >
                {c}
                <button
                  type="button"
                  onClick={() => removeCompanion(c)}
                  className="text-[color:var(--brand)] hover:text-[color:var(--accent)]"
                  aria-label={`${c} 삭제`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div>
        <label htmlFor="purpose" className={labelCls}>
          출장 목적 <span className="text-[color:var(--accent)]">*</span>
        </label>
        <input
          id="purpose"
          name="purpose"
          type="text"
          required
          placeholder="예) 청소년 정책 협의"
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls}>
          이동수단 <span className="text-[color:var(--accent)]">*</span>
        </label>
        <div className="mt-1 grid grid-cols-3 gap-2">
          {(
            [
              { v: "vehicle", icon: "🚗" },
              { v: "public", icon: "🚌" },
              { v: "walk", icon: "🚶" },
            ] as { v: TransportType; icon: string }[]
          ).map(({ v, icon }) => {
            const active = transport === v;
            return (
              <label
                key={v}
                className={`flex cursor-pointer flex-col items-center gap-1 rounded-md border px-3 py-3 text-sm shadow-sm transition ${
                  active
                    ? "border-[color:var(--brand)] bg-[color:var(--brand-soft)] text-[color:var(--brand-strong)]"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                <input
                  type="radio"
                  name="transport_type"
                  value={v}
                  checked={active}
                  onChange={() => setTransport(v)}
                  className="sr-only"
                />
                <span className="text-2xl leading-none">{icon}</span>
                <span className="font-medium">{TRANSPORT_LABEL[v]}</span>
              </label>
            );
          })}
        </div>
        {transport === "public" && (
          <div className="mt-3">
            <label htmlFor="transport_cost" className={labelCls}>
              교통비 (원)
            </label>
            <input
              id="transport_cost"
              name="transport_cost"
              type="number"
              min="0"
              step="100"
              inputMode="numeric"
              placeholder="예) 2900"
              className={inputCls}
            />
          </div>
        )}
      </div>

      <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-semibold text-slate-800">출장 내용</p>
        <div>
          <label htmlFor="meeting_content" className={labelCls}>
            회의/방문 내용
          </label>
          <textarea
            id="meeting_content"
            name="meeting_content"
            placeholder="회의 진행 내용 또는 방문지 활동 내용을 작성해주세요."
            className={textareaCls}
          />
        </div>
        <div>
          <label htmlFor="main_agenda" className={labelCls}>
            주요 안건
          </label>
          <input
            id="main_agenda"
            name="main_agenda"
            type="text"
            placeholder="예) 2026년 청소년 사업 협의"
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="result" className={labelCls}>
            결과 및 성과
          </label>
          <textarea
            id="result"
            name="result"
            placeholder="회의 결과, 합의 사항, 후속 조치 등을 작성해주세요."
            className={textareaCls}
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label className={labelCls}>인증샷 (1~5장)</label>
          <span className="text-xs text-slate-400">
            {photoFiles.length}/{MAX_PHOTOS}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photoPreviews.map((src, i) => (
            <div
              key={i}
              className="relative aspect-square overflow-hidden rounded-md border border-slate-200 bg-slate-50"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt=""
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => removePhoto(i)}
                className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-xs font-bold text-white hover:bg-black/80"
                aria-label="사진 삭제"
              >
                ✕
              </button>
            </div>
          ))}
          {photoFiles.length < MAX_PHOTOS && (
            <label className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-white text-slate-500 hover:bg-slate-50">
              <span className="text-2xl">＋</span>
              <span className="text-xs">사진 추가</span>
              <input
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={handlePhotoSelect}
              />
            </label>
          )}
        </div>
      </div>

      {transport === "public" && (
        <div>
          <label className={labelCls}>영수증</label>
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {receiptPreviews.map((src, i) => (
              <div
                key={i}
                className="relative aspect-square overflow-hidden rounded-md border border-slate-200 bg-slate-50"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt=""
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeReceipt(i)}
                  className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-xs font-bold text-white hover:bg-black/80"
                  aria-label="영수증 삭제"
                >
                  ✕
                </button>
              </div>
            ))}
            <label className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-white text-slate-500 hover:bg-slate-50">
              <span className="text-2xl">＋</span>
              <span className="text-xs">영수증 추가</span>
              <input
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={handleReceiptSelect}
              />
            </label>
          </div>
        </div>
      )}

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
          disabled={pending}
          className="rounded-md bg-[color:var(--brand)] px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[color:var(--brand-strong)] disabled:opacity-60"
        >
          {pending ? "저장 중…" : "저장"}
        </button>
      </div>
    </form>
  );
}
