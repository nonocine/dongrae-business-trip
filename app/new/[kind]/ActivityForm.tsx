"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { createActivity } from "@/app/actions";
import { btnPrimary, btnSecondary, cardCls } from "@/lib/ui";
import {
  DEFAULT_DEPARTURE,
  DEFAULT_VEHICLE_CONFIRMER,
  TRANSPORT_LABEL,
  TRANSPORT_ICON,
  getAllowedTransports,
  type ActivityKind,
  type Settings,
  type TransportType,
} from "@/lib/supabase";

const labelCls = "block text-sm font-medium text-ink-body";
const inputBase =
  "block w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink-body shadow-sm placeholder:text-ink-hint focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const inputCls = `mt-1 ${inputBase}`;
const textareaCls = `mt-1 ${inputBase} min-h-[88px] resize-y`;

const MAX_PHOTOS = 5;

type Props = {
  kind: ActivityKind;
  defaultDate: string;
  employees: string[];
  lockedTraveler: string | null;
  settings: Settings | null;
};

const KIND_DATE_LABEL: Record<
  ActivityKind,
  { start: string; end?: string }
> = {
  outside_work: { start: "날짜" },
  business_trip: { start: "시작일", end: "종료일" },
  domestic_training: { start: "시작일", end: "종료일" },
  overseas_training: { start: "출국일", end: "귀국일" },
  education: { start: "날짜" },
};

export default function ActivityForm({
  kind,
  defaultDate,
  employees,
  lockedTraveler,
  settings,
}: Props) {
  const allowedTransports = getAllowedTransports(kind);
  const showTransport =
    kind === "outside_work" || kind === "business_trip";
  const showEndDate =
    kind === "business_trip" ||
    kind === "domestic_training" ||
    kind === "overseas_training";
  const showLocation =
    kind !== "overseas_training" &&
    kind !== "domestic_training" || // 국내연수는 별도 라벨
    false; // we'll handle below
  const showOrganization =
    kind === "domestic_training" || kind === "overseas_training";
  const showCourseName =
    kind === "domestic_training" || kind === "overseas_training";
  const showCountry = kind === "overseas_training";
  const showCity = kind === "overseas_training";
  const showVisa = kind === "overseas_training";
  const showAccommodation = kind === "business_trip";
  const showAccommodationCost =
    kind === "business_trip" || kind === "overseas_training";
  const showTrainingCost =
    kind === "domestic_training" || kind === "overseas_training";
  const showCertificate =
    kind === "domestic_training" ||
    kind === "overseas_training" ||
    kind === "education";
  const showReceipts = kind !== "education"; // 교육은 receipts 대신 certificate 만
  const showEducationFields = kind === "education";

  // 외근/출장은 location 표시; 국내연수는 "연수 장소", 해외연수는 city/country로 대체, 교육은 location.
  const locationLabel: string =
    kind === "domestic_training"
      ? "연수 장소"
      : kind === "business_trip"
      ? "출장지"
      : kind === "outside_work"
      ? "장소"
      : "장소";
  const showLocationField = kind !== "overseas_training";

  const purposeLabel =
    kind === "outside_work"
      ? "외근 목적"
      : kind === "business_trip"
      ? "출장 목적"
      : kind === "domestic_training" || kind === "overseas_training"
      ? "연수 목적"
      : "교육 목적";
  const contentLabel =
    kind === "outside_work"
      ? "외근 내용"
      : kind === "business_trip"
      ? "출장 내용"
      : kind === "domestic_training" || kind === "overseas_training"
      ? "연수 내용"
      : "교육 내용";

  const certificateLabel =
    kind === "education" ? "교육 자료" : "수료증/이수증";

  // Form state
  const [transport, setTransport] = useState<TransportType | "">(
    allowedTransports[0] ?? ""
  );
  const [accommodation, setAccommodation] = useState(false);
  const [companions, setCompanions] = useState<string[]>([]);
  const [companionPick, setCompanionPick] = useState("");
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [receiptFiles, setReceiptFiles] = useState<File[]>([]);
  const [certFiles, setCertFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // 차량(기관차량) 사용 시 driving_logs 자동 작성용 입력
  const showDrivingFields =
    (kind === "outside_work" || kind === "business_trip") &&
    transport === "vehicle";
  const [totalDistance, setTotalDistance] = useState<string>("");
  const prevMileage = settings?.initial_mileage ?? 0;
  const totalNum = Number(totalDistance);
  const drivingDistance =
    Number.isFinite(totalNum) && totalDistance !== ""
      ? Math.max(0, totalNum - prevMileage)
      : null;

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

  function handleSimpleFileSelect(
    setter: React.Dispatch<React.SetStateAction<File[]>>
  ) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (!files.length) return;
      setter((prev) => [...prev, ...files]);
      e.target.value = "";
    };
  }
  function removeAt(
    setter: React.Dispatch<React.SetStateAction<File[]>>,
    i: number
  ) {
    setter((prev) => prev.filter((_, idx) => idx !== i));
  }

  return (
    <form
      action={(formData) => {
        setError(null);
        // override managed inputs
        formData.set("kind", kind);
        formData.delete("photos");
        for (const f of photoFiles) formData.append("photos", f);
        formData.delete("receipts");
        for (const f of receiptFiles) formData.append("receipts", f);
        formData.delete("certificate");
        for (const f of certFiles) formData.append("certificate", f);
        formData.delete("companion");
        for (const c of companions) formData.append("companion", c);

        startTransition(async () => {
          try {
            await createActivity(formData);
          } catch (e) {
            const msg =
              e instanceof Error ? e.message : "저장 중 오류가 발생했습니다.";
            if (msg.includes("NEXT_REDIRECT")) throw e;
            setError(msg);
          }
        });
      }}
      className={`space-y-5 ${cardCls}`}
    >
      {/* Hidden kind for safety (form action also sets it) */}
      <input type="hidden" name="kind" value={kind} />

      {/* 작성자 */}
      <div>
        <label htmlFor="author" className={labelCls}>
          작성자 <span className="text-stamp">*</span>
        </label>
        {lockedTraveler ? (
          <>
            <div className="mt-1 flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-2 text-sm">
              <span className="font-medium text-ink">{lockedTraveler}</span>
              <span className="text-xs text-ink-hint">본인</span>
            </div>
            <input type="hidden" name="author" value={lockedTraveler} />
          </>
        ) : employees.length > 0 ? (
          <select
            id="author"
            name="author"
            required
            defaultValue=""
            className={inputCls}
          >
            <option value="" disabled>
              작성자를 선택해주세요
            </option>
            {employees.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        ) : (
          <input
            id="author"
            name="author"
            type="text"
            required
            placeholder="이름"
            className={inputCls}
          />
        )}
      </div>

      {/* 날짜 */}
      <div className={showEndDate ? "grid grid-cols-2 gap-3" : ""}>
        <div>
          <label htmlFor="start_date" className={labelCls}>
            {KIND_DATE_LABEL[kind].start} <span className="text-stamp">*</span>
          </label>
          <input
            id="start_date"
            name="start_date"
            type="date"
            required
            defaultValue={defaultDate}
            className={inputCls}
          />
        </div>
        {showEndDate && (
          <div>
            <label htmlFor="end_date" className={labelCls}>
              {KIND_DATE_LABEL[kind].end}
            </label>
            <input
              id="end_date"
              name="end_date"
              type="date"
              className={inputCls}
            />
          </div>
        )}
      </div>

      {/* 장소 / 국가·도시 */}
      {showLocationField && (
        <div>
          <label htmlFor="location" className={labelCls}>
            {locationLabel} <span className="text-stamp">*</span>
          </label>
          <input
            id="location"
            name="location"
            type="text"
            required
            placeholder={locationLabel}
            className={inputCls}
          />
        </div>
      )}
      {showCountry && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="country" className={labelCls}>
              국가 <span className="text-stamp">*</span>
            </label>
            <input
              id="country"
              name="country"
              type="text"
              required
              placeholder="예) 일본"
              className={inputCls}
            />
          </div>
          {showCity && (
            <div>
              <label htmlFor="city" className={labelCls}>
                도시
              </label>
              <input
                id="city"
                name="city"
                type="text"
                placeholder="예) 도쿄"
                className={inputCls}
              />
            </div>
          )}
        </div>
      )}

      {/* 기관 / 과정명 */}
      {showOrganization && (
        <div>
          <label htmlFor="organization" className={labelCls}>
            연수 기관명
          </label>
          <input
            id="organization"
            name="organization"
            type="text"
            placeholder="예) 한국청소년정책연구원"
            className={inputCls}
          />
        </div>
      )}
      {showCourseName && (
        <div>
          <label htmlFor="course_name" className={labelCls}>
            과정명
          </label>
          <input
            id="course_name"
            name="course_name"
            type="text"
            placeholder="예) 청소년 정책 심화과정"
            className={inputCls}
          />
        </div>
      )}

      {/* 비자 정보 (해외연수) */}
      {showVisa && (
        <div>
          <label htmlFor="visa_info" className={labelCls}>
            비자 정보
          </label>
          <input
            id="visa_info"
            name="visa_info"
            type="text"
            placeholder="예) 단기상용 (C-2)"
            className={inputCls}
          />
        </div>
      )}

      {/* 동행자 */}
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
              className="shrink-0 rounded-lg bg-navy px-3 text-sm font-semibold text-white transition hover:bg-navy-strong"
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
              className="shrink-0 rounded-lg bg-navy px-3 text-sm font-semibold text-white transition hover:bg-navy-strong"
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
                className="inline-flex items-center gap-1 rounded-full bg-navy-soft px-3 py-1 text-xs font-medium text-navy"
              >
                {c}
                <button
                  type="button"
                  onClick={() => removeCompanion(c)}
                  className="text-navy hover:text-stamp"
                  aria-label={`${c} 삭제`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 목적 */}
      <div>
        <label htmlFor="purpose" className={labelCls}>
          {purposeLabel} <span className="text-stamp">*</span>
        </label>
        <input
          id="purpose"
          name="purpose"
          type="text"
          required
          className={inputCls}
        />
      </div>

      {/* 이동수단 */}
      {showTransport && allowedTransports.length > 0 && (
        <div>
          <label className={labelCls}>
            이동수단 <span className="text-stamp">*</span>
          </label>
          <div
            className={`mt-1 grid gap-2`}
            style={{
              gridTemplateColumns: `repeat(${allowedTransports.length}, minmax(0, 1fr))`,
            }}
          >
            {allowedTransports.map((v) => {
              const active = transport === v;
              return (
                <label
                  key={v}
                  className={`flex cursor-pointer flex-col items-center gap-1 rounded-lg border px-3 py-3 text-sm shadow-sm transition ${
                    active
                      ? "border-navy bg-navy-soft text-navy"
                      : "border-line bg-card text-ink-body hover:bg-surface"
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
                  <span className="text-2xl leading-none">
                    {TRANSPORT_ICON[v]}
                  </span>
                  <span className="font-medium">{TRANSPORT_LABEL[v]}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* 차량 운행 정보 (외근/출장 + 기관차량) */}
      {showDrivingFields && (
        <div className="space-y-3 rounded-lg border border-line bg-surface p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-navy">
              🚗 차량 운행 정보
            </h4>
            {settings && (settings.vehicle_number || settings.vehicle_model) && (
              <span className="text-xs text-navy">
                {[settings.vehicle_model, settings.vehicle_number]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
          </div>
          <p className="text-xs text-ink-muted">
            저장 시 운행일지에도 함께 기록되며, 차량 누적거리가 자동으로
            업데이트됩니다. 위에 입력한 <strong>출장지(장소)</strong>가 운행일지의
            출장지로 자동 저장됩니다.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>출발지</label>
              <div className="mt-1 rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink-muted">
                {DEFAULT_DEPARTURE}
              </div>
            </div>
            <div>
              <label className={labelCls}>도착지</label>
              <div className="mt-1 rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink-muted">
                {DEFAULT_DEPARTURE}
              </div>
            </div>
          </div>

          <div>
            <label className={labelCls}>확인자</label>
            <div className="mt-1 rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink-muted">
              {DEFAULT_VEHICLE_CONFIRMER}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>현재 누적거리</label>
              <div className="mt-1 rounded-lg border border-line bg-card px-3 py-2 text-sm font-mono text-ink-body">
                {prevMileage.toLocaleString("ko-KR")} km
              </div>
            </div>
            <div>
              <label htmlFor="driving_total_distance" className={labelCls}>
                운행 후 누적거리 (km){" "}
                <span className="text-stamp">*</span>
              </label>
              <input
                id="driving_total_distance"
                name="driving_total_distance"
                type="number"
                min={prevMileage}
                step="0.1"
                inputMode="decimal"
                required
                value={totalDistance}
                onChange={(e) => setTotalDistance(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          <div className="rounded-lg border border-line bg-card px-3 py-2 text-xs text-ink-body shadow-sm">
            운행거리:{" "}
            <span className="font-semibold text-navy">
              {drivingDistance == null
                ? "-"
                : `${drivingDistance.toLocaleString("ko-KR")} km`}
            </span>
            <span className="ml-2 text-ink-muted">(자동 계산)</span>
          </div>
        </div>
      )}

      {/* 비용 (교통비/숙박비/연수비) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
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
            placeholder="0"
            className={inputCls}
          />
        </div>
        {showAccommodationCost && (
          <div>
            <label htmlFor="accommodation_cost" className={labelCls}>
              숙박비 (원)
            </label>
            <input
              id="accommodation_cost"
              name="accommodation_cost"
              type="number"
              min="0"
              step="100"
              inputMode="numeric"
              placeholder="0"
              className={inputCls}
            />
          </div>
        )}
        {showTrainingCost && (
          <div>
            <label htmlFor="training_cost" className={labelCls}>
              연수비 (원)
            </label>
            <input
              id="training_cost"
              name="training_cost"
              type="number"
              min="0"
              step="100"
              inputMode="numeric"
              placeholder="0"
              className={inputCls}
            />
          </div>
        )}
      </div>

      {/* 숙박 여부 (출장) */}
      {showAccommodation && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="accommodation"
            checked={accommodation}
            onChange={(e) => setAccommodation(e.target.checked)}
            className="h-4 w-4 rounded border-line text-navy focus:ring-navy"
          />
          <span className="font-medium text-ink-body">숙박 있음</span>
        </label>
      )}

      {/* 교육 전용 필드 */}
      {showEducationFields && (
        <div className="space-y-3 rounded-lg border border-line bg-surface p-4">
          <div>
            <label className={labelCls}>교육 분류</label>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {(["집합", "온라인", "외부"] as const).map((v) => (
                <label
                  key={v}
                  className="flex cursor-pointer items-center justify-center rounded-lg border border-line bg-card px-3 py-2 text-sm has-[:checked]:border-navy has-[:checked]:bg-navy-soft has-[:checked]:text-navy"
                >
                  <input
                    type="radio"
                    name="education_type"
                    value={v}
                    defaultChecked={v === "집합"}
                    className="sr-only"
                  />
                  {v}
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="instructor" className={labelCls}>
                강사명
              </label>
              <input
                id="instructor"
                name="instructor"
                type="text"
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="education_hours" className={labelCls}>
                교육 시간
              </label>
              <input
                id="education_hours"
                name="education_hours"
                type="number"
                min="0"
                step="0.5"
                inputMode="decimal"
                placeholder="시간"
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="attendees_count" className={labelCls}>
                참석자 수
              </label>
              <input
                id="attendees_count"
                name="attendees_count"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                placeholder="명"
                className={inputCls}
              />
            </div>
          </div>
        </div>
      )}

      {/* 내용 / 결과 */}
      <div>
        <label htmlFor="content" className={labelCls}>
          {contentLabel}
        </label>
        <textarea id="content" name="content" className={textareaCls} />
      </div>
      <div>
        <label htmlFor="result" className={labelCls}>
          결과 및 성과
        </label>
        <textarea id="result" name="result" className={textareaCls} />
      </div>

      {/* 인증샷 */}
      <div>
        <div className="flex items-center justify-between">
          <label className={labelCls}>인증샷 (1~5장)</label>
          <span className="text-xs text-ink-hint">
            {photoFiles.length}/{MAX_PHOTOS}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photoPreviews.map((src, i) => (
            <div
              key={i}
              className="relative aspect-square overflow-hidden rounded-lg border border-line bg-surface"
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
              >
                ✕
              </button>
            </div>
          ))}
          {photoFiles.length < MAX_PHOTOS && (
            <label className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-line bg-card text-ink-muted hover:bg-surface">
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

      {/* 영수증 */}
      {showReceipts && (
        <FileListField
          label="영수증"
          files={receiptFiles}
          onChange={handleSimpleFileSelect(setReceiptFiles)}
          onRemove={(i) => removeAt(setReceiptFiles, i)}
        />
      )}

      {/* 수료증 / 교육자료 */}
      {showCertificate && (
        <FileListField
          label={certificateLabel}
          files={certFiles}
          onChange={handleSimpleFileSelect(setCertFiles)}
          onRemove={(i) => removeAt(setCertFiles, i)}
        />
      )}

      {error && (
        <p className="rounded-lg bg-stamp-soft px-3 py-2 text-sm text-stamp">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Link href="/new" className={btnSecondary}>
          취소
        </Link>
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "저장 중…" : "저장"}
        </button>
      </div>
    </form>
  );
}

function FileListField({
  label,
  files,
  onChange,
  onRemove,
}: {
  label: string;
  files: File[];
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <div className="mt-2 space-y-1.5">
        {files.map((f, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm"
          >
            <span className="truncate text-ink-body">{f.name}</span>
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="text-xs font-medium text-stamp hover:underline"
            >
              삭제
            </button>
          </div>
        ))}
        <label className="flex cursor-pointer items-center justify-center gap-1 rounded-lg border border-dashed border-line bg-card px-3 py-2 text-sm font-medium text-ink-muted hover:bg-surface">
          <span aria-hidden>＋</span> 파일 추가
          <input
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="sr-only"
            onChange={onChange}
          />
        </label>
      </div>
    </div>
  );
}
