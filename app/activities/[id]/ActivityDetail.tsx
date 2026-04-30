"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ACTIVITY_BADGE_CLASS,
  ACTIVITY_ICON,
  ACTIVITY_LABEL,
  TRANSPORT_ICON,
  TRANSPORT_LABEL,
  type Activity,
} from "@/lib/supabase";
import { deleteActivity } from "@/app/actions";
import ActivityPdfReport from "@/app/components/ActivityPdfReport";
import { generateTripPdf } from "@/lib/pdf";

function formatDate(d: string | null) {
  if (!d) return "-";
  const [y, m, day] = d.split("-");
  return `${y}년 ${Number(m)}월 ${Number(day)}일`;
}

function formatRange(start: string | null, end: string | null) {
  if (!start) return "-";
  if (!end || end === start) return formatDate(start);
  return `${formatDate(start)} ~ ${formatDate(end)}`;
}

export default function ActivityDetail({
  activity,
  isAdmin,
}: {
  activity: Activity;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const reportRef = useRef<HTMLDivElement>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [delBusy, setDelBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownloadPdf() {
    if (!reportRef.current) return;
    setPdfBusy(true);
    setError(null);
    try {
      const datePart = activity.start_date ?? "";
      const filename = `${ACTIVITY_LABEL[activity.kind]}_보고서_${datePart}_${activity.author}.pdf`;
      await generateTripPdf(reportRef.current, filename);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "PDF 생성 중 오류가 발생했습니다."
      );
    } finally {
      setPdfBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm("이 활동을 삭제하시겠습니까?\n첨부된 사진/영수증/수료증도 함께 삭제됩니다."))
      return;
    setDelBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("id", activity.id);
      await deleteActivity(fd);
      router.push("/");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "삭제 중 오류가 발생했습니다.";
      if (msg.includes("NEXT_REDIRECT")) {
        router.push("/");
        return;
      }
      setError(msg);
      setDelBusy(false);
    }
  }

  const a = activity;
  const usesRange =
    a.kind === "business_trip" ||
    a.kind === "domestic_training" ||
    a.kind === "overseas_training";

  const locationLabel =
    a.kind === "overseas_training"
      ? "국가/도시"
      : a.kind === "business_trip"
      ? "출장지"
      : a.kind === "domestic_training"
      ? "연수 장소"
      : "장소";

  const locationValue =
    a.kind === "overseas_training"
      ? [a.country, a.city].filter(Boolean).join(" / ") || "-"
      : a.location || "-";

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${ACTIVITY_BADGE_CLASS[a.kind]}`}
          >
            {ACTIVITY_ICON[a.kind]} {ACTIVITY_LABEL[a.kind]}
          </span>
          <span className="text-xs font-medium text-slate-500">
            {usesRange
              ? formatRange(a.start_date, a.end_date)
              : formatDate(a.start_date)}
          </span>
        </div>
        <h3 className="mt-2 text-xl font-bold text-slate-900">
          {locationValue}
        </h3>
        <p className="mt-1 text-sm text-slate-600">{a.purpose}</p>

        <dl className="mt-4 grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          <Field label="작성자" value={a.author} />
          <Field
            label="동행자"
            value={a.companion.length > 0 ? a.companion.join(", ") : "-"}
          />
          <Field label={locationLabel} value={locationValue} />
          {a.transport_type && (
            <Field
              label="이동수단"
              value={`${TRANSPORT_ICON[a.transport_type] ?? ""} ${
                TRANSPORT_LABEL[a.transport_type] ?? a.transport_type
              }`}
            />
          )}
          {a.transport_cost != null && (
            <Field
              label="교통비"
              value={`${a.transport_cost.toLocaleString("ko-KR")}원`}
            />
          )}
          {a.accommodation_cost != null && (
            <Field
              label="숙박비"
              value={`${a.accommodation_cost.toLocaleString("ko-KR")}원`}
            />
          )}
          {a.training_cost != null && (
            <Field
              label="연수비"
              value={`${a.training_cost.toLocaleString("ko-KR")}원`}
            />
          )}
          {a.kind === "business_trip" && a.accommodation && (
            <Field label="숙박" value="있음" />
          )}
          {a.organization && (
            <Field label="연수 기관" value={a.organization} />
          )}
          {a.course_name && <Field label="과정명" value={a.course_name} />}
          {a.visa_info && <Field label="비자 정보" value={a.visa_info} />}
          {a.kind === "education" && (
            <>
              {a.education_type && (
                <Field label="교육 분류" value={a.education_type} />
              )}
              {a.instructor && <Field label="강사" value={a.instructor} />}
              {a.education_hours != null && (
                <Field label="교육 시간" value={`${a.education_hours}시간`} />
              )}
              {a.attendees_count != null && (
                <Field label="참석자 수" value={`${a.attendees_count}명`} />
              )}
            </>
          )}
        </dl>
      </section>

      {(a.content || a.result) && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">
            {ACTIVITY_LABEL[a.kind]} 내용
          </h3>
          {a.content && (
            <Block
              label={
                a.kind === "outside_work"
                  ? "외근 내용"
                  : a.kind === "business_trip"
                  ? "회의/방문 내용"
                  : a.kind === "education"
                  ? "교육 내용"
                  : "연수 내용"
              }
              content={a.content}
            />
          )}
          {a.result && <Block label="결과 및 성과" content={a.result} />}
        </section>
      )}

      {a.photos.length > 0 && (
        <FileGallery title={`인증샷 (${a.photos.length}장)`} urls={a.photos} />
      )}
      {a.receipts.length > 0 && (
        <FileGallery title={`영수증 (${a.receipts.length}장)`} urls={a.receipts} />
      )}
      {a.certificate.length > 0 && (
        <FileGallery
          title={`${a.kind === "education" ? "교육 자료" : "수료증"} (${a.certificate.length}장)`}
          urls={a.certificate}
        />
      )}

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {isAdmin && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={delBusy}
            className="rounded-md border border-red-500 bg-white px-4 py-2 text-sm font-semibold text-red-500 hover:bg-red-50 disabled:opacity-60"
          >
            {delBusy ? "삭제 중…" : "삭제"}
          </button>
        )}
        <button
          type="button"
          onClick={handleDownloadPdf}
          disabled={pdfBusy}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-600 disabled:opacity-60"
        >
          <span aria-hidden>📄</span>
          {pdfBusy ? "PDF 생성 중…" : "PDF 다운로드"}
        </button>
      </div>

      <div
        aria-hidden
        style={{
          position: "fixed",
          left: "-10000px",
          top: 0,
          width: "794px",
          pointerEvents: "none",
        }}
      >
        <div ref={reportRef}>
          <ActivityPdfReport activity={a} />
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-800">{value}</dd>
    </div>
  );
}

function Block({ label, content }: { label: string; content: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">
        {content}
      </p>
    </div>
  );
}

function FileGallery({ title, urls }: { title: string; urls: string[] }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {urls.map((src, i) => (
          <a
            key={i}
            href={src}
            target="_blank"
            rel="noreferrer"
            className="block aspect-square overflow-hidden rounded-md border border-slate-200 bg-slate-50"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={`${title} ${i + 1}`}
              className="h-full w-full object-cover"
            />
          </a>
        ))}
      </div>
    </section>
  );
}
