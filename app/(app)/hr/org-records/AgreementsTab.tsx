"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AGREEMENT_STATUSES,
  AGREEMENT_STATUS_LABEL,
  agreementBadge,
  fmtDotDate,
  yearOf,
  type AgreementStatus,
  type OrgAgreement,
} from "@/lib/orgRecords";
import {
  deleteOrgRecord,
  saveAgreement,
  type PartnerOption,
  type StaffOption,
} from "@/app/(app)/hr/org-records/actions";
import { ExportPanel, FileLink, YearFilter, useYears } from "@/app/(app)/hr/org-records/OrgRecordParts";
import {
  badgeDanger,
  badgeNeutral,
  badgeSuccess,
  badgeWarning,
  btnDanger,
  btnPrimary,
  btnSecondary,
  inputCls,
  labelCls,
  linkCls,
  noticeError,
  panelToneCls,
  sectionTitleCls,
  tableHeadCls,
  tableRowCls,
} from "@/lib/ui";

const BADGE = { ok: badgeSuccess, warn: badgeWarning, danger: badgeDanger, muted: badgeNeutral } as const;

type Form = {
  id: string | null;
  partner_name: string;
  business_partner_id: string | null;
  agreed_on: string;
  content: string;
  period_start: string;
  period_end: string;
  status: AgreementStatus;
  manager_driver_id: string;
  memo: string;
  has_file: boolean;
  can_delete: boolean;
};

const EMPTY: Form = {
  id: null,
  partner_name: "",
  business_partner_id: null,
  agreed_on: "",
  content: "",
  period_start: "",
  period_end: "",
  status: "active",
  manager_driver_id: "",
  memo: "",
  has_file: false,
  can_delete: false,
};

// 거래처 이름 비교용 — 공백·법인 표기·괄호를 빼고 봅니다.
function norm(s: string): string {
  return s
    .replace(/\(주\)|㈜|주식회사|\(사\)|사단법인|\(재\)|재단법인/g, "")
    .replace(/[\s()·.\-]/g, "")
    .toLowerCase();
}
function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}
// 비슷한 거래처 추천 — 포함 관계 우선, 그다음 두 글자 겹침 비율.
export function suggestPartners(input: string, partners: PartnerOption[], limit = 5): PartnerOption[] {
  const q = norm(input);
  if (q.length < 2) return [];
  const qb = bigrams(q);
  const scored: { p: PartnerOption; s: number }[] = [];
  for (const p of partners) {
    const n = norm(p.name);
    if (!n) continue;
    let s = 0;
    if (n === q) s = 3;
    else if (n.includes(q) || q.includes(n)) s = 2;
    else {
      const nb = bigrams(n);
      let hit = 0;
      for (const b of qb) if (nb.has(b)) hit++;
      const ratio = hit / Math.max(1, Math.min(qb.size, nb.size));
      if (ratio >= 0.5) s = ratio;
    }
    if (s > 0) scored.push({ p, s });
  }
  return scored
    .sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name))
    .slice(0, limit)
    .map((x) => x.p);
}

export default function AgreementsTab({
  rows,
  partners,
  staff,
  today,
}: {
  // KST 오늘 — 서버에서 계산해 넘깁니다(하이드레이션 불일치 방지).
  today: string;
  rows: OrgAgreement[];
  partners: PartnerOption[];
  staff: StaffOption[];
}) {
  const router = useRouter();
  const years = useYears(rows.map((r) => r.agreed_on));
  const [year, setYear] = useState<number | null>(null);
  const [form, setForm] = useState<Form | null>(null);

  // 협약일 오름차순(서버가 이미 정렬) — 연도 필터만 겁니다.
  const visible = useMemo(
    () => (year == null ? rows : rows.filter((r) => yearOf(r.agreed_on) === year)),
    [rows, year],
  );
  const alertCount = rows.filter((r) => agreementBadge(r, today).tone === "warn").length;

  const openEdit = (r: OrgAgreement) =>
    setForm({
      id: r.id,
      partner_name: r.partner_name,
      business_partner_id: r.business_partner_id,
      agreed_on: r.agreed_on,
      content: r.content,
      period_start: r.period_start ?? "",
      period_end: r.period_end ?? "",
      status: r.status,
      manager_driver_id: r.manager_driver_id ?? "",
      memo: r.memo,
      has_file: r.has_file,
      can_delete: r.can_delete,
    });

  return (
    <div className="space-y-4">
      {form && (
        <AgreementForm
          form={form}
          setForm={setForm}
          partners={partners}
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
            업무협약 체결 현황 <span className="text-sm font-normal text-ink-muted">{visible.length}건</span>
          </h3>
          <div className="flex items-center gap-3">
            <YearFilter years={years} value={year} onChange={setYear} />
            {!form && (
              <button type="button" className={btnPrimary} onClick={() => setForm({ ...EMPTY })}>
                + 협약 등록
              </button>
            )}
          </div>
        </div>
        {alertCount > 0 && (
          <p className="mt-2 text-xs text-warning">⚠ 30일 안에 기간이 끝나는 협약이 {alertCount}건 있습니다.</p>
        )}

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className={tableHeadCls}>
                <th className="w-12 py-2 text-center">번호</th>
                <th className="py-2">기관명</th>
                <th className="w-28 py-2">협약일</th>
                <th className="py-2">협약내용</th>
                <th className="w-20 py-2 text-center">상태</th>
                <th className="w-24 py-2" />
              </tr>
            </thead>
            <tbody>
              {visible.map((r, i) => {
                const b = agreementBadge(r, today);
                return (
                  <tr key={r.id} className={`${tableRowCls} align-top`}>
                    <td className="py-2 text-center tabular-nums text-ink-muted">{String(i + 1).padStart(2, "0")}</td>
                    <td className="py-2 font-medium text-ink">
                      {r.partner_name}
                      {r.business_partner_id && (
                        <a href={`/hr/partners?id=${r.business_partner_id}`} className={`${linkCls} ml-1 text-xs`} title="거래처관리에서 보기">
                          🔗
                        </a>
                      )}
                      {r.period_end && (
                        <div className="text-xs font-normal text-ink-hint">
                          기간 {fmtDotDate(r.period_start) || "?"} ~ {fmtDotDate(r.period_end)}
                        </div>
                      )}
                    </td>
                    <td className="py-2 tabular-nums">{fmtDotDate(r.agreed_on)}</td>
                    <td className="whitespace-pre-line py-2 text-ink-body">
                      {r.content}
                      {r.manager_name && <div className="text-xs text-ink-hint">담당 {r.manager_name}</div>}
                    </td>
                    <td className="py-2 text-center">
                      <span className={BADGE[b.tone]}>{b.label}</span>
                    </td>
                    <td className="py-2 text-right">
                      <div className="flex flex-col items-end gap-1">
                        <button type="button" className={`${linkCls} text-xs`} onClick={() => openEdit(r)}>
                          수정
                        </button>
                        {r.has_file && <FileLink kind="agreements" id={r.id} />}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-sm text-ink-hint">
                    등록된 협약이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <ExportPanel kind="agreements" years={years} />
    </div>
  );
}

function AgreementForm({
  form,
  setForm,
  partners,
  staff,
  onDone,
}: {
  form: Form;
  setForm: (f: Form | null) => void;
  partners: PartnerOption[];
  staff: StaffOption[];
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v });

  const linked = partners.find((p) => p.id === form.business_partner_id) ?? null;
  const suggestions = linked ? [] : suggestPartners(form.partner_name, partners);
  const activeStaff = staff.filter((s) => !s.resigned || s.driverId === form.manager_driver_id);

  const submit = () =>
    start(async () => {
      setError(null);
      const fd = new FormData();
      if (form.id) fd.set("id", form.id);
      fd.set("partner_name", form.partner_name);
      fd.set("business_partner_id", form.business_partner_id ?? "");
      fd.set("agreed_on", form.agreed_on);
      fd.set("content", form.content);
      fd.set("period_start", form.period_start);
      fd.set("period_end", form.period_end);
      fd.set("status", form.status);
      fd.set("manager_driver_id", form.manager_driver_id);
      fd.set("memo", form.memo);
      if (file) fd.set("file", file);
      if (removeFile) fd.set("removeFile", "1");
      const r = await saveAgreement(fd);
      if (r.ok) onDone();
      else setError(r.message);
    });

  const remove = () => {
    if (!form.id || !confirm(`'${form.partner_name}' 협약을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    start(async () => {
      const r = await deleteOrgRecord("agreements", form.id!);
      if (r.ok) onDone();
      else setError(r.message);
    });
  };

  return (
    <section className={panelToneCls("yellow")}>
      <h3 className={sectionTitleCls("yellow")}>{form.id ? "협약 수정" : "협약 등록"}</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelCls}>
            기관명 <span className="text-stamp">*</span>
            <input
              className={inputCls}
              value={form.partner_name}
              onChange={(e) => setForm({ ...form, partner_name: e.target.value, business_partner_id: null })}
              placeholder="예: 동래구청소년상담복지센터"
            />
          </label>
          {linked ? (
            <p className="mt-1 text-xs text-success">
              ✓ 거래처관리 「{linked.name}」와 연결됨{" "}
              <button type="button" className={linkCls} onClick={() => set("business_partner_id", null)}>
                연결 해제
              </button>
            </p>
          ) : suggestions.length > 0 ? (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
              거래처관리에 비슷한 곳:
              {suggestions.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="rounded-full border border-line px-2 py-0.5 text-ink-body hover:bg-surface"
                  onClick={() => setForm({ ...form, partner_name: p.name, business_partner_id: p.id })}
                >
                  {p.name}
                </button>
              ))}
              <span className="text-ink-hint">(골라야 연결됩니다 · 안 골라도 저장 가능)</span>
            </div>
          ) : null}
        </div>
        <label className={labelCls}>
          협약일 <span className="text-stamp">*</span>
          <input type="date" className={inputCls} value={form.agreed_on} onChange={(e) => set("agreed_on", e.target.value)} />
        </label>
        <label className={labelCls}>
          상태
          <select className={inputCls} value={form.status} onChange={(e) => set("status", e.target.value as AgreementStatus)}>
            {AGREEMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {AGREEMENT_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className={`${labelCls} sm:col-span-2`}>
          협약내용
          <textarea
            rows={2}
            className={inputCls}
            value={form.content}
            onChange={(e) => set("content", e.target.value)}
            placeholder="예: 청소년 활동 프로그램 연계 및 시설 공동 활용"
          />
        </label>
        <label className={labelCls}>
          협약 기간 시작
          <input type="date" className={inputCls} value={form.period_start} onChange={(e) => set("period_start", e.target.value)} />
        </label>
        <label className={labelCls}>
          협약 기간 끝 <span className="text-ink-hint">(지나면 만료, 30일 이내면 만료 임박 표시)</span>
          <input type="date" className={inputCls} value={form.period_end} onChange={(e) => set("period_end", e.target.value)} />
        </label>
        <label className={labelCls}>
          담당 직원
          <select className={inputCls} value={form.manager_driver_id} onChange={(e) => set("manager_driver_id", e.target.value)}>
            <option value="">(지정 안 함)</option>
            {activeStaff.map((s) => (
              <option key={s.driverId} value={s.driverId}>
                {s.name}
                {s.resigned ? " (퇴사)" : ""}
              </option>
            ))}
          </select>
        </label>
        <div className={labelCls}>
          협약서 파일 <span className="text-ink-hint">(PDF·JPG·PNG, 16MB 이하)</span>
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            className="mt-1 block w-full text-sm"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {form.has_file && form.id && !file && (
            <div className="mt-1 flex items-center gap-3">
              <FileLink kind="agreements" id={form.id} />
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={removeFile} onChange={(e) => setRemoveFile(e.target.checked)} />
                첨부 삭제
              </label>
            </div>
          )}
        </div>
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
