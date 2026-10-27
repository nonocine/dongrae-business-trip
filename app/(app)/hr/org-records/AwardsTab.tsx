"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  RECIPIENT_TYPES,
  RECIPIENT_TYPE_LABEL,
  fmtDotDate,
  yearOf,
  type OrgAward,
  type OrgRecordFile,
  type RecipientType,
} from "@/lib/orgRecords";
import { deleteOrgRecord, saveAward, type StaffOption } from "@/app/(app)/hr/org-records/actions";
import {
  AttachCell,
  AttachmentPanel,
  ExportPanel,
  YearFilter,
  uploadQueued,
  useYears,
  type QueuedFile,
} from "@/app/(app)/hr/org-records/OrgRecordParts";
import {
  badgeNavy,
  badgeNeutral,
  btnDanger,
  btnPrimary,
  btnSecondary,
  inputCls,
  labelCls,
  linkCls,
  noticeError,
  panelToneCls,
  rowLinkCls,
  sectionTitleCls,
  tableHeadCls,
  tableRowCls,
} from "@/lib/ui";

type Form = {
  id: string | null;
  award_name: string;
  recipient_type: RecipientType | "";
  recipient_name: string;
  recipient_driver_id: string;
  awarded_by: string;
  awarded_on: string;
  related_program: string;
  memo: string;
  can_delete: boolean;
};

const EMPTY: Form = {
  id: null,
  award_name: "",
  recipient_type: "",
  recipient_name: "",
  recipient_driver_id: "",
  awarded_by: "",
  awarded_on: "",
  related_program: "",
  memo: "",
  can_delete: false,
};

export default function AwardsTab({ rows, staff }: { rows: OrgAward[]; staff: StaffOption[] }) {
  const router = useRouter();
  const years = useYears(rows.map((r) => r.awarded_on));
  const [year, setYear] = useState<number | null>(null);
  const [form, setForm] = useState<Form | null>(null);

  const visible = useMemo(
    () => (year == null ? rows : rows.filter((r) => yearOf(r.awarded_on) === year)),
    [rows, year],
  );

  const formTop = useRef<HTMLDivElement>(null);
  const openEdit = (r: OrgAward) => {
    formTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setForm({
      id: r.id,
      award_name: r.award_name,
      recipient_type: r.recipient_type ?? "",
      recipient_name: r.recipient_name ?? "",
      recipient_driver_id: r.recipient_driver_id ?? "",
      awarded_by: r.awarded_by,
      awarded_on: r.awarded_on,
      related_program: r.related_program,
      memo: r.memo,
      can_delete: r.can_delete,
    });
  };

  return (
    <div className="space-y-4">
      <div ref={formTop} className="scroll-mt-4" />
      {form && (
        <AwardForm
          key={form.id ?? "new"}
          form={form}
          setForm={setForm}
          files={(form.id && rows.find((r) => r.id === form.id)?.files) || []}
          staff={staff}
          onDone={() => {
            setForm(null);
            router.refresh();
          }}
        />
      )}

      <section className={panelToneCls("green")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className={sectionTitleCls("green")}>
            수상 현황 <span className="text-sm font-normal text-ink-muted">{visible.length}건</span>
          </h3>
          <div className="flex items-center gap-3">
            <YearFilter years={years} value={year} onChange={setYear} />
            {!form && (
              <button type="button" className={btnPrimary} onClick={() => setForm({ ...EMPTY })}>
                + 수상 등록
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className={tableHeadCls}>
                <th className="w-12 py-2 text-center">연번</th>
                <th className="py-2">수상명</th>
                <th className="py-2">수상자</th>
                <th className="py-2">수상기관</th>
                <th className="w-28 py-2">수상일</th>
                <th className="w-20 py-2 text-center">첨부</th>
                <th className="w-12 py-2" />
              </tr>
            </thead>
            <tbody>
              {visible.map((r, i) => (
                <tr
                  key={r.id}
                  className={`${tableRowCls} ${rowLinkCls} align-top`}
                  onClick={() => openEdit(r)}
                  title="눌러서 상세·첨부 보기"
                >
                  <td className="py-2 text-center tabular-nums text-ink-muted">{String(i + 1).padStart(2, "0")}</td>
                  <td className="py-2 font-medium text-ink">
                    {r.award_name}
                    {r.related_program && <div className="text-xs font-normal text-ink-hint">{r.related_program}</div>}
                  </td>
                  <td className="py-2">
                    {r.recipient_name || <span className="text-ink-hint">-</span>}
                    {r.recipient_type && (
                      <span className={`${r.recipient_type === "youth" ? badgeNavy : badgeNeutral} ml-1`}>
                        {RECIPIENT_TYPE_LABEL[r.recipient_type]}
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-ink-body">{r.awarded_by}</td>
                  <td className="py-2 tabular-nums">{fmtDotDate(r.awarded_on)}</td>
                  <td className="py-2 text-center">
                    <AttachCell kind="awards" recordId={r.id} count={r.files.length} onOpen={() => openEdit(r)} />
                  </td>
                  <td className="py-2 text-right">
                    <span className={`${linkCls} text-xs`}>수정</span>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-sm text-ink-hint">
                    등록된 수상 기록이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <ExportPanel kind="awards" years={years} />
    </div>
  );
}

function AwardForm({
  form,
  files,
  setForm,
  staff,
  onDone,
}: {
  form: Form;
  files: OrgRecordFile[];
  setForm: (f: Form | null) => void;
  staff: StaffOption[];
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v });
  const activeStaff = staff.filter((s) => !s.resigned || s.driverId === form.recipient_driver_id);

  const submit = () =>
    start(async () => {
      setError(null);
      const fd = new FormData();
      if (form.id) fd.set("id", form.id);
      fd.set("award_name", form.award_name);
      fd.set("recipient_type", form.recipient_type);
      fd.set("recipient_name", form.recipient_name);
      fd.set("recipient_driver_id", form.recipient_type === "staff" ? form.recipient_driver_id : "");
      fd.set("awarded_by", form.awarded_by);
      fd.set("awarded_on", form.awarded_on);
      fd.set("related_program", form.related_program);
      fd.set("memo", form.memo);
      const r = await saveAward(fd);
      if (!r.ok) return setError(r.message);
      // 새 건이면 저장으로 id 가 생긴 뒤 대기열의 첨부를 올립니다.
      if (queue.length) {
        const errors = await uploadQueued("awards", r.id, queue);
        if (errors.length) alert(`저장했지만 일부 첨부를 올리지 못했습니다.\n${errors.join("\n")}`);
      }
      onDone();
    });

  const remove = () => {
    if (!form.id || !confirm(`'${form.award_name}' 수상 기록을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    start(async () => {
      const r = await deleteOrgRecord("awards", form.id!);
      if (r.ok) onDone();
      else setError(r.message);
    });
  };

  return (
    <section className={panelToneCls("yellow")}>
      <h3 className={sectionTitleCls("yellow")}>{form.id ? "수상 수정" : "수상 등록"}</h3>
      <div className="mt-3">
        <AttachmentPanel kind="awards" recordId={form.id} files={files} queue={queue} setQueue={setQueue} />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={`${labelCls} sm:col-span-2`}>
          수상명 <span className="text-stamp">*</span>
          <input
            className={inputCls}
            value={form.award_name}
            onChange={(e) => set("award_name", e.target.value)}
            placeholder="예: 지역사회청소년성장지원 우수"
          />
        </label>
        <label className={labelCls}>
          수상자 구분
          <select
            className={inputCls}
            value={form.recipient_type}
            onChange={(e) => setForm({ ...form, recipient_type: e.target.value as RecipientType | "", recipient_driver_id: "" })}
          >
            <option value="">(구분 없음)</option>
            {RECIPIENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {RECIPIENT_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        {form.recipient_type === "staff" ? (
          <label className={labelCls}>
            수상 직원
            <select
              className={inputCls}
              value={form.recipient_driver_id}
              onChange={(e) => {
                const s = staff.find((x) => x.driverId === e.target.value);
                setForm({ ...form, recipient_driver_id: e.target.value, recipient_name: s?.name ?? form.recipient_name });
              }}
            >
              <option value="">(직원 선택)</option>
              {activeStaff.map((s) => (
                <option key={s.driverId} value={s.driverId}>
                  {s.name}
                  {s.resigned ? " (퇴사)" : ""}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className={labelCls}>
            수상자 <span className="text-ink-hint">(없으면 비워 두세요 — 출력 시 수상명만)</span>
            <input
              className={inputCls}
              value={form.recipient_name}
              onChange={(e) => set("recipient_name", e.target.value)}
              placeholder={form.recipient_type === "organization" ? "예: 동래구청소년센터" : ""}
            />
          </label>
        )}
        <label className={labelCls}>
          수상기관 <span className="text-stamp">*</span>
          <input
            className={inputCls}
            value={form.awarded_by}
            onChange={(e) => set("awarded_by", e.target.value)}
            placeholder="예: 부산광역시장"
          />
        </label>
        <label className={labelCls}>
          수상일 <span className="text-stamp">*</span>
          <input type="date" className={inputCls} value={form.awarded_on} onChange={(e) => set("awarded_on", e.target.value)} />
        </label>
        <label className={labelCls}>
          관련 사업
          <input className={inputCls} value={form.related_program} onChange={(e) => set("related_program", e.target.value)} />
        </label>
        <label className={`${labelCls} sm:col-span-2`}>
          메모
          <textarea rows={2} className={inputCls} value={form.memo} onChange={(e) => set("memo", e.target.value)} />
        </label>
      </div>
      {error && <p className={`${noticeError} mt-3`}>{error}</p>}
      <div className="mt-4 flex flex-wrap justify-between gap-2">
        <div className="flex gap-2">
          <button type="button" className={btnPrimary} disabled={pending} onClick={submit}>
            {pending ? "저장 중…" : "저장"}
          </button>
          <button type="button" className={btnSecondary} disabled={pending} onClick={() => setForm(null)}>
            취소
          </button>
        </div>
        {form.id && form.can_delete && (
          <button type="button" className={btnDanger} disabled={pending} onClick={remove}>
            삭제
          </button>
        )}
      </div>
    </section>
  );
}
