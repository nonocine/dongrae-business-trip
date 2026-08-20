"use client";

// 강의확인증 발급대장 — 목록(발급번호·강사명·강의내용·요청일·상태·출력일) + 상세 검토.
//   담당자는 pending 건만 수정·승인·반려할 수 있고, 처리된 건은 읽기 전용이다.
//   발급번호는 승인 시점에 부여된다 — 신청중·반려 건은 "미발급" 으로 보인다
//   (반려된 건이 번호를 먹으면 승인건 번호가 건너뛰어진다).
//   ⚠️ 주민번호는 신청 데이터에 없다 — 표시·입력 칸을 만들지 않는다.
//   양식 미리보기(PDF)는 열어볼 수 있지만 주민번호 칸은 공란이고 출력 이력도 남지
//   않는다. 실제 발급은 강사 화면(1부-B) 몫 — 출력일자 열은 값이 없으면 "-" 로 둔다.

import { useMemo, useState, useTransition } from "react";
import {
  listLectureCertificates,
  updateLectureCertificate,
  approveLectureCertificate,
  rejectLectureCertificate,
  type LectureCertRow,
} from "@/app/hr/saems/certificateActions";
import {
  CERT_STATUS_LABEL,
  CERT_NO_UNISSUED,
  certNoLabel,
  type CertStatus,
} from "@/lib/saem";
import {
  cardCls,
  inputCls,
  labelCls,
  btnPrimary,
  btnSecondary,
  btnDanger,
  badgeSuccess,
  badgeWarning,
  badgeNeutral,
  badgeDanger,
  noticeError,
  noticeSuccess,
} from "@/lib/ui";

const thCls =
  "px-2 py-2 text-left text-xs font-semibold text-navy whitespace-nowrap";
const tdCls = "px-2 py-2 align-middle text-sm text-ink-body";

type Filter = "all" | CertStatus;
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "pending", label: "신청중" },
  { key: "approved", label: "승인" },
  { key: "rejected", label: "반려" },
];

function StatusBadge({ status }: { status: CertStatus }) {
  const cls =
    status === "approved"
      ? badgeSuccess
      : status === "rejected"
        ? badgeDanger
        : badgeWarning;
  return <span className={cls}>{CERT_STATUS_LABEL[status]}</span>;
}

export default function CertificatesManager({
  initial,
}: {
  initial: LectureCertRow[];
}) {
  const [rows, setRows] = useState<LectureCertRow[]>(initial);
  const [filter, setFilter] = useState<Filter>("all");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  // 모달은 항상 최신 목록의 행을 본다 — 저장 후 되읽은 값이 그대로 반영되게.
  const detail = useMemo(
    () => rows.find((r) => r.id === detailId) ?? null,
    [rows, detailId]
  );

  const counts = useMemo(() => {
    const c: Record<Filter, number> = {
      all: rows.length,
      pending: 0,
      approved: 0,
      rejected: 0,
    };
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);

  const shown = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter]
  );

  function reload(after?: () => void) {
    start(async () => {
      setRows(await listLectureCertificates());
      after?.();
    });
  }

  return (
    <div className="space-y-5">
      <section className={cardCls}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-bold text-ink">강의확인증 발급대장</h3>
          <span className="text-xs text-ink-hint">
            강사가 동래샘들에서 신청한 건을 검토·승인합니다.
          </span>
          <button
            type="button"
            onClick={() => reload()}
            disabled={pending}
            className={`${btnSecondary} ml-auto`}
          >
            새로고침
          </button>
        </div>

        <div className="mb-3 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${
                filter === f.key
                  ? "border-navy bg-navy text-white"
                  : "border-line bg-card text-ink-body hover:bg-surface"
              }`}
            >
              {f.label}
              <span
                className={`ml-1.5 text-xs font-normal ${
                  filter === f.key ? "text-white/80" : "text-ink-hint"
                }`}
              >
                {counts[f.key]}
              </span>
            </button>
          ))}
        </div>

        {msg && (
          <p className={`mb-3 ${msg.ok ? noticeSuccess : noticeError}`}>
            {msg.text}
          </p>
        )}

        {shown.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-hint">
            {rows.length === 0
              ? "아직 신청된 강의확인증이 없습니다."
              : "해당 상태의 신청이 없습니다."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th className={thCls}>발급번호</th>
                  <th className={thCls}>강사명</th>
                  <th className={thCls}>강의내용</th>
                  <th className={thCls}>요청일자</th>
                  <th className={thCls}>상태</th>
                  <th className={thCls}>출력일자</th>
                  <th className={`${thCls} text-right`}>보기</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-b border-line/60 hover:bg-surface"
                    onClick={() => setDetailId(r.id)}
                  >
                    <td className={`${tdCls} whitespace-nowrap font-mono text-xs`}>
                      {r.certNo == null ? (
                        <span className="text-ink-hint">{CERT_NO_UNISSUED}</span>
                      ) : (
                        certNoLabel(r.certYear, r.certNo)
                      )}
                    </td>
                    <td className={`${tdCls} whitespace-nowrap font-medium text-ink`}>
                      {r.applicantName || r.instructorName || "-"}
                      {/* 명부 이름과 신청서 성명이 다르면 누구 건지 알 수 있게 함께 보인다. */}
                      {r.instructorName &&
                        r.applicantName &&
                        r.instructorName !== r.applicantName && (
                          <span className="ml-1 text-xs font-normal text-ink-hint">
                            ({r.instructorName})
                          </span>
                        )}
                    </td>
                    <td className={`${tdCls} max-w-[280px] truncate`}>
                      {r.lectureContent || "-"}
                    </td>
                    <td className={`${tdCls} whitespace-nowrap`}>
                      {r.requestedOn || "-"}
                    </td>
                    <td className={tdCls}>
                      <StatusBadge status={r.status} />
                    </td>
                    <td className={`${tdCls} whitespace-nowrap`}>
                      {r.printedOn || "-"}
                    </td>
                    <td className={`${tdCls} text-right`}>
                      <span className="text-xs font-semibold text-navy underline">
                        {r.status === "pending" ? "검토" : "보기"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {detail && (
        <DetailModal
          key={detail.id}
          row={detail}
          pendingOuter={pending}
          onClose={() => setDetailId(null)}
          onDone={(text, close) => {
            setMsg({ ok: true, text });
            reload(close ? () => setDetailId(null) : undefined);
          }}
          onError={(text) => setMsg({ ok: false, text })}
        />
      )}
    </div>
  );
}

function DetailModal({
  row,
  pendingOuter,
  onClose,
  onDone,
  onError,
}: {
  row: LectureCertRow;
  pendingOuter: boolean;
  onClose: () => void;
  onDone: (text: string, close: boolean) => void;
  onError: (text: string) => void;
}) {
  const editable = row.status === "pending";
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({
    applicantName: row.applicantName,
    address: row.address,
    lectureContent: row.lectureContent,
    lecturePeriod: row.lecturePeriod,
  });
  const [askReject, setAskReject] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const busy = pending || pendingOuter;

  const set = (k: keyof typeof form) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-card p-5 shadow-lg">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">
            {row.certNo == null
              ? "강의확인증 신청"
              : certNoLabel(row.certYear, row.certNo)}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-ink-muted hover:underline"
          >
            닫기
          </button>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          <StatusBadge status={row.status} />
          <span>요청 {row.requestedOn || "-"}</span>
          {row.reviewedOn && (
            <span>
              검토 {row.reviewedOn}
              {row.reviewedBy ? ` · ${row.reviewedBy}` : ""}
            </span>
          )}
          <span>출력 {row.printedOn || "-"}</span>
        </div>

        {row.certNo == null && (
          <p className="mb-3 text-[11px] text-ink-muted">
            발급번호({CERT_NO_UNISSUED}) — 승인할 때 그 해 승인건 다음 번호로
            부여됩니다.
            {row.status === "rejected"
              ? " 반려된 건은 번호를 받지 않습니다."
              : " 미리보기의 발급번호 칸은 아직 공란입니다."}
          </p>
        )}

        {row.status === "rejected" && row.rejectReason && (
          <p className={`mb-3 ${noticeError}`}>반려 사유 — {row.rejectReason}</p>
        )}
        {row.status === "approved" && (
          <p className={`mb-3 ${noticeSuccess}`}>
            승인된 신청입니다. 강사가 동래샘들에서 출력할 수 있습니다.
          </p>
        )}

        {edit ? (
          <div className="space-y-3">
            <Field label="성명">
              <input
                className={inputCls}
                value={form.applicantName}
                onChange={(e) => set("applicantName")(e.target.value)}
              />
            </Field>
            <Field label="주소">
              <input
                className={inputCls}
                value={form.address}
                onChange={(e) => set("address")(e.target.value)}
              />
            </Field>
            <Field label="강의내용">
              <textarea
                className={`${inputCls} min-h-[88px]`}
                value={form.lectureContent}
                onChange={(e) => set("lectureContent")(e.target.value)}
              />
            </Field>
            <Field label="강의일자">
              <input
                className={inputCls}
                value={form.lecturePeriod}
                onChange={(e) => set("lecturePeriod")(e.target.value)}
                placeholder="예: 2026. 3. 2. ~ 2026. 8. 29."
              />
            </Field>
          </div>
        ) : (
          <div className="space-y-3">
            <Row label="성명" value={row.applicantName} />
            <Row label="주소" value={row.address} />
            <Row label="강의내용" value={row.lectureContent} multiline />
            <Row label="강의일자" value={row.lecturePeriod} />
            {row.instructorName && (
              <Row label="신청 강사(명부)" value={row.instructorName} />
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {editable && !edit && (
            <>
              <button
                type="button"
                disabled={busy}
                className={btnPrimary}
                onClick={() =>
                  start(async () => {
                    const res = await approveLectureCertificate(row.id);
                    if (!res.ok) return onError(res.message);
                    onDone("승인했습니다.", true);
                  })
                }
              >
                승인
              </button>
              <button
                type="button"
                disabled={busy}
                className={btnSecondary}
                onClick={() => setEdit(true)}
              >
                내용 수정
              </button>
              <button
                type="button"
                disabled={busy}
                className={btnDanger}
                onClick={() => setAskReject(true)}
              >
                반려
              </button>
            </>
          )}
          {edit && (
            <>
              <button
                type="button"
                disabled={busy}
                className={btnPrimary}
                onClick={() =>
                  start(async () => {
                    const res = await updateLectureCertificate(row.id, form);
                    if (!res.ok) return onError(res.message);
                    setEdit(false);
                    onDone("수정했습니다.", false);
                  })
                }
              >
                저장
              </button>
              <button
                type="button"
                disabled={busy}
                className={btnSecondary}
                onClick={() => {
                  setForm({
                    applicantName: row.applicantName,
                    address: row.address,
                    lectureContent: row.lectureContent,
                    lecturePeriod: row.lecturePeriod,
                  });
                  setEdit(false);
                }}
              >
                수정 취소
              </button>
            </>
          )}
          {!edit && (
            // 미리보기 — 주민번호 칸은 공란으로 나간다(신청 데이터에 없음).
            //   실제 발급(주민번호 기재)은 강사 화면에서 한다. 출력 이력도 남지 않는다.
            <a
              href={`/hr/saems/certificates/${row.id}/preview`}
              target="_blank"
              rel="noopener noreferrer"
              className={btnSecondary}
            >
              양식 미리보기
            </a>
          )}
          {!editable && (
            <span className={badgeNeutral}>
              처리된 신청은 수정할 수 없습니다.
            </span>
          )}
          <button type="button" onClick={onClose} className={btnSecondary}>
            닫기
          </button>
        </div>

        {askReject && (
          <div className="mt-4 rounded-lg border border-stamp/40 bg-stamp-soft p-3">
            <p className="text-sm text-stamp">
              {row.applicantName || "신청자"} 님의 강의확인증 신청을 반려합니다.
            </p>
            <p className="mt-1 text-[11px] text-ink-muted">
              사유는 강사에게 그대로 보입니다. 무엇을 고쳐 다시 신청해야 하는지
              적어 주세요.
            </p>
            <textarea
              className={`${inputCls} mt-2 min-h-[72px]`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="예: 강의일자가 위촉 기간과 다릅니다. 확인 후 다시 신청해 주세요."
            />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={busy || !reason.trim()}
                className={btnDanger}
                onClick={() =>
                  start(async () => {
                    const res = await rejectLectureCertificate(row.id, reason);
                    if (!res.ok) return onError(res.message);
                    setAskReject(false);
                    onDone("반려했습니다.", true);
                  })
                }
              >
                반려
              </button>
              <button
                type="button"
                disabled={busy}
                className={btnSecondary}
                onClick={() => {
                  setAskReject(false);
                  setReason("");
                }}
              >
                취소
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-navy">{label}</p>
      <p
        className={`mt-0.5 rounded-lg border border-line bg-surface/50 px-3 py-2 text-sm text-ink-body ${
          multiline ? "whitespace-pre-wrap" : ""
        }`}
      >
        {value || "—"}
      </p>
    </div>
  );
}
