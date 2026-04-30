"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  TRANSPORT_ICON,
  TRANSPORT_LABEL,
  type BusinessTrip,
} from "@/lib/supabase";
import { deleteBusinessTrip } from "@/app/actions";
import TripPdfReport from "@/app/components/TripPdfReport";
import { generateTripPdf } from "@/lib/pdf";

function formatDate(d: string) {
  const [y, m, day] = d.split("-");
  return `${y}년 ${Number(m)}월 ${Number(day)}일`;
}

export default function TripDetail({
  trip,
  isAdmin,
}: {
  trip: BusinessTrip;
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
      const filename = `출장보고서_${trip.trip_date}_${trip.traveler}.pdf`;
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
    if (!confirm("이 출장일지를 삭제하시겠습니까?")) return;
    setDelBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("id", trip.id);
      await deleteBusinessTrip(fd);
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

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-[color:var(--brand)]">
              {formatDate(trip.trip_date)}
            </p>
            <h3 className="mt-1 text-xl font-bold text-slate-900">
              {trip.destination}
            </h3>
            <p className="mt-1 text-sm text-slate-600">{trip.purpose}</p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
            {TRANSPORT_ICON[trip.transport_type]}{" "}
            {TRANSPORT_LABEL[trip.transport_type]}
            {trip.transport_type === "public" && trip.transport_cost != null && (
              <span className="ml-1 text-xs text-slate-500">
                {trip.transport_cost.toLocaleString("ko-KR")}원
              </span>
            )}
          </span>
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex gap-3">
            <dt className="w-16 shrink-0 text-slate-500">출장자</dt>
            <dd className="font-medium text-slate-800">{trip.traveler}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-16 shrink-0 text-slate-500">동행자</dt>
            <dd className="text-slate-800">
              {trip.companion.length > 0 ? trip.companion.join(", ") : "-"}
            </dd>
          </div>
        </dl>
      </section>

      {(trip.meeting_content || trip.main_agenda || trip.result) && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">출장 내용</h3>
          {trip.main_agenda && (
            <div>
              <p className="text-xs font-medium text-slate-500">주요 안건</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">
                {trip.main_agenda}
              </p>
            </div>
          )}
          {trip.meeting_content && (
            <div>
              <p className="text-xs font-medium text-slate-500">회의/방문 내용</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">
                {trip.meeting_content}
              </p>
            </div>
          )}
          {trip.result && (
            <div>
              <p className="text-xs font-medium text-slate-500">결과 및 성과</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">
                {trip.result}
              </p>
            </div>
          )}
        </section>
      )}

      {trip.photos.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">
            인증샷 ({trip.photos.length}장)
          </h3>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {trip.photos.map((src, i) => (
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
                  alt={`인증샷 ${i + 1}`}
                  className="h-full w-full object-cover"
                />
              </a>
            ))}
          </div>
        </section>
      )}

      {trip.receipts.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">
            영수증 ({trip.receipts.length}장)
          </h3>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {trip.receipts.map((src, i) => (
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
                  alt={`영수증 ${i + 1}`}
                  className="h-full w-full object-cover"
                />
              </a>
            ))}
          </div>
        </section>
      )}

      {error && (
        <p className="rounded-md bg-[color:var(--accent-soft)] px-3 py-2 text-sm text-[color:var(--accent)]">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {isAdmin && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={delBusy}
            className="rounded-md border border-[color:var(--accent)] bg-white px-4 py-2 text-sm font-semibold text-[color:var(--accent)] hover:bg-[color:var(--accent-soft)] disabled:opacity-60"
          >
            {delBusy ? "삭제 중…" : "삭제"}
          </button>
        )}
        <button
          type="button"
          onClick={handleDownloadPdf}
          disabled={pdfBusy}
          className="inline-flex items-center gap-1.5 rounded-md bg-[color:var(--brand)] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[color:var(--brand-strong)] disabled:opacity-60"
        >
          <span aria-hidden>📄</span>
          {pdfBusy ? "PDF 생성 중…" : "PDF 다운로드"}
        </button>
      </div>

      {/* Off-screen rendered report used for PDF capture */}
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
          <TripPdfReport trip={trip} />
        </div>
      </div>
    </div>
  );
}
