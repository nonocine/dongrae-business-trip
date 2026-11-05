"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteRecruitment,
  hideRecruitment,
  saveRecruitment,
  type RecruitmentInput,
  type RecruitmentListRow,
} from "@/app/(app)/bangka/enroll/actions";
import { GRADES, RECRUITMENT_STATUS_LABEL, defaultPrepNotice, type RecruitmentStatus } from "@/lib/bangkaEnroll";
import { fmtKstDateTime } from "@/lib/datetime";
import { RECRUIT_STATUS_BADGE } from "@/app/(app)/bangka/enroll/badges";
import {
  btnPrimary,
  btnSecondary,
  inputCls,
  labelCls,
  linkCls,
  noticeError,
  noticeSuccess,
  panelToneCls,
  sectionTitleCls,
  tableHeadCls,
  tableRowCls,
} from "@/lib/ui";

// =====================================================================
// 모집 회차 — 매년 새 회차를 만들어 같은 신청 화면을 다시 씁니다.
//   · 접수 기간은 한국 시각으로 넣습니다(datetime-local 값 + "+09:00").
//   · 상태를 '종료'로 바꾸면 결정 안 된 신청서의 보관기간 계산이 시작됩니다.
//   · '모집 예정'은 보호자 화면에 회차·기간·준비 서류(prep_notice)만 미리 보여 줍니다.
//   · 삭제: 신청서가 없거나 작성중뿐 → [삭제](회차 이름 입력). 제출된 신청서가 있으면 → [종료·숨김].
// =====================================================================

const STATUSES: RecruitmentStatus[] = ["draft", "scheduled", "open", "closed", "ended"];

// 제출(작성중 아닌) 신청서 수
function submittedCount(r: RecruitmentListRow): number {
  return Object.entries(r.counts)
    .filter(([k]) => k !== "draft")
    .reduce((n, [, v]) => n + v, 0);
}

// ISO → "YYYY-MM-DDTHH:mm"(KST)
function isoToKstLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16);
}
function kstLocalToIso(v: string): string {
  if (!v) return "";
  const d = new Date(`${v}:00+09:00`);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

type Form = {
  id?: string;
  title: string;
  start: string;
  end: string;
  capacity: string;
  target_grades: string[];
  status: RecruitmentStatus;
  notice: string;
  prep_notice: string;
  stops: { time: string; place: string }[];
  years: string;
  months: string;
  consent_version: string;
};

function emptyForm(): Form {
  const y = new Date().getFullYear() + 1;
  return {
    title: `${y}년 신규 모집`,
    start: "",
    end: "",
    capacity: "",
    target_grades: ["초4", "초5", "초6", "중1"],
    status: "draft",
    notice: "",
    prep_notice: defaultPrepNotice(),
    stops: [],
    years: "3",
    months: "6",
    consent_version: `${y}-v1`,
  };
}

function toForm(r: RecruitmentListRow): Form {
  return {
    id: r.id,
    title: r.title,
    start: isoToKstLocal(r.apply_start_at),
    end: isoToKstLocal(r.apply_end_at),
    capacity: r.capacity == null ? "" : String(r.capacity),
    target_grades: r.target_grades,
    status: r.status,
    notice: r.notice ?? "",
    // 비어 있으면 기본 문구를 제안(저장해야 반영)
    prep_notice: r.prep_notice ?? defaultPrepNotice(),
    stops:r.shuttle_stops.map((s) => ({ time: s.time, place: s.place })),
    years: String(r.retention_accepted_years),
    months: String(r.retention_rejected_months),
    consent_version: r.consent_version,
  };
}

export default function RecruitmentsManager({ rows: allRows }: { rows: RecruitmentListRow[] }) {
  const router = useRouter();
  const [form, setForm] = useState<Form | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [pending, start] = useTransition();
  const hiddenCount = allRows.filter((r) => r.deleted_at).length;
  const rows = showHidden ? allRows : allRows.filter((r) => !r.deleted_at);

  function remove(r: RecruitmentListRow) {
    setListErr(null);
    setMsg(null);
    const drafts = r.counts.draft ?? 0;
    const typed = prompt(
      `'${r.title}' 회차를 삭제합니다.${drafts > 0 ? `\n작성중 신청서 ${drafts}건과 올린 파일·인증 기록도 함께 지워집니다.` : ""}\n되돌릴 수 없습니다. 회차 이름을 그대로 입력하세요.`,
    );
    if (typed == null) return;
    start(async () => {
      const res = await deleteRecruitment(r.id, typed);
      if (!res.ok) return setListErr(res.message);
      if (form?.id === r.id) setForm(null);
      setMsg(`'${r.title}' 회차를 삭제했습니다${res.drafts > 0 ? `(작성중 ${res.drafts}건, 파일 ${res.files}개)` : ""}.`);
      router.refresh();
    });
  }

  function hide(r: RecruitmentListRow, on: boolean) {
    setListErr(null);
    setMsg(null);
    if (
      on &&
      !confirm(
        `'${r.title}' 회차를 종료하고 목록에서 숨깁니다.\n제출된 신청서는 그대로 남고, 합격하지 않은 신청서는 지금부터 ${r.retention_rejected_months}개월 보관 뒤 서류가 자동 삭제됩니다. 계속할까요?`,
      )
    )
      return;
    start(async () => {
      const res = await hideRecruitment(r.id, on);
      if (!res.ok) return setListErr(res.message);
      if (form?.id === r.id) setForm(null);
      setMsg(on ? `'${r.title}' 회차를 종료·숨김 했습니다.` : `'${r.title}' 회차 숨김을 풀었습니다.`);
      router.refresh();
    });
  }

  function set<K extends keyof Form>(k: K, v: Form[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }

  function moveStop(i: number, dir: -1 | 1) {
    setForm((f) => {
      if (!f) return f;
      const j = i + dir;
      if (j < 0 || j >= f.stops.length) return f;
      const stops = [...f.stops];
      [stops[i], stops[j]] = [stops[j], stops[i]];
      return { ...f, stops };
    });
  }

  function submit() {
    if (!form) return;
    setErr(null);
    setMsg(null);
    const original = rows.find((r) => r.id === form.id);
    if (form.status === "ended" && original?.status !== "ended") {
      if (
        !confirm(
          `'종료'로 바꾸면 합격하지 않은 신청서(작성중 포함)의 보관기한이 지금부터 ${form.months}개월로 정해지고, 기한이 지나면 서류가 자동 삭제됩니다. 계속할까요?`,
        )
      )
        return;
    }
    const input: RecruitmentInput = {
      id: form.id,
      title: form.title,
      apply_start_at: kstLocalToIso(form.start),
      apply_end_at: kstLocalToIso(form.end),
      capacity: form.capacity.trim() === "" ? null : Number(form.capacity),
      target_grades: form.target_grades,
      status: form.status,
      notice: form.notice,
      prep_notice: form.prep_notice,
      shuttle_stops: form.stops,
      retention_accepted_years: Number(form.years),
      retention_rejected_months: Number(form.months),
      consent_version: form.consent_version,
    };
    start(async () => {
      const r = await saveRecruitment(input);
      if (!r.ok) {
        setErr(r.message);
        return;
      }
      setMsg(r.ended > 0 ? `저장했습니다. 신청서 ${r.ended}건의 보관기한을 정했습니다.` : "저장했습니다.");
      setForm(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <section className={panelToneCls("green")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className={sectionTitleCls("green")}>모집 회차</h3>
          <button type="button" className={btnPrimary} onClick={() => { setErr(null); setMsg(null); setForm(emptyForm()); }}>
            새 회차
          </button>
        </div>
        {hiddenCount > 0 && (
          <label className="mt-2 inline-flex items-center gap-1 text-sm text-ink-muted">
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
            숨긴 회차 보기({hiddenCount})
          </label>
        )}
        {msg && <p className={`mt-3 ${noticeSuccess}`}>{msg}</p>}
        {listErr && <p className={`mt-3 ${noticeError}`}>{listErr}</p>}
        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">
            {hiddenCount > 0 ? "보이는 회차가 없습니다(숨긴 회차만 있음)." : "아직 회차가 없습니다. [새 회차]로 만드세요."}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className={tableHeadCls}>
                  <th className="py-2 pr-2">회차</th>
                  <th className="py-2 pr-2">상태</th>
                  <th className="py-2 pr-2">접수 기간</th>
                  <th className="py-2 pr-2">대상</th>
                  <th className="py-2 pr-2 text-right">제출</th>
                  <th className="py-2 pr-2 text-right">합격/정원</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const submitted = submittedCount(r);
                  return (
                    <tr key={r.id} className={`${tableRowCls} ${r.deleted_at ? "opacity-60" : ""}`}>
                      <td className="py-2 pr-2">
                        <Link href={`/bangka/enroll/${r.id}`} className={linkCls}>
                          {r.title}
                        </Link>
                        {r.deleted_at && (
                          <span className="block text-xs text-ink-hint">
                            숨김 {fmtKstDateTime(r.deleted_at)}
                            {r.deleted_by ? ` · ${r.deleted_by}` : ""}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-2">
                        <span className={RECRUIT_STATUS_BADGE[r.status]}>{RECRUITMENT_STATUS_LABEL[r.status]}</span>
                      </td>
                      <td className="py-2 pr-2 text-xs text-ink-body">
                        {fmtKstDateTime(r.apply_start_at)} ~ {fmtKstDateTime(r.apply_end_at)}
                      </td>
                      <td className="py-2 pr-2 text-xs">{r.target_grades.join("·") || "제한 없음"}</td>
                      <td className="py-2 pr-2 text-right">
                        {submitted}
                        {r.counts.draft ? <span className="ml-1 text-xs text-ink-hint">(작성중 {r.counts.draft})</span> : null}
                      </td>
                      <td className="py-2 pr-2 text-right">
                        {r.counts.accepted ?? 0}/{r.capacity ?? "-"}
                      </td>
                      <td className="py-2 text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          <button
                            type="button"
                            className={btnSecondary}
                            disabled={pending}
                            onClick={() => {
                              setErr(null);
                              setMsg(null);
                              setForm(toForm(r));
                            }}
                          >
                            고치기
                          </button>
                          {r.deleted_at ? (
                            <button type="button" className={btnSecondary} disabled={pending} onClick={() => hide(r, false)}>
                              숨김 풀기
                            </button>
                          ) : submitted > 0 ? (
                            <button type="button" className={btnSecondary} disabled={pending} onClick={() => hide(r, true)}>
                              종료·숨김
                            </button>
                          ) : (
                            <button
                              type="button"
                              className={`${btnSecondary} !text-stamp`}
                              disabled={pending}
                              onClick={() => remove(r)}
                            >
                              삭제
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {form && (
        <section className={panelToneCls("yellow")}>
          <h3 className={sectionTitleCls("yellow")}>{form.id ? "회차 고치기" : "새 회차"}</h3>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className={labelCls}>회차 이름</span>
              <input className={inputCls} value={form.title} maxLength={100} onChange={(e) => set("title", e.target.value)} />
            </label>
            <label>
              <span className={labelCls}>접수 시작(한국 시각)</span>
              <input type="datetime-local" className={inputCls} value={form.start} onChange={(e) => set("start", e.target.value)} />
            </label>
            <label>
              <span className={labelCls}>접수 마감(한국 시각)</span>
              <input type="datetime-local" className={inputCls} value={form.end} onChange={(e) => set("end", e.target.value)} />
            </label>
            <label>
              <span className={labelCls}>정원(모르면 비움)</span>
              <input
                type="number"
                min={0}
                className={inputCls}
                value={form.capacity}
                onChange={(e) => set("capacity", e.target.value)}
              />
            </label>
            <label>
              <span className={labelCls}>상태</span>
              <select className={inputCls} value={form.status} onChange={(e) => set("status", e.target.value as RecruitmentStatus)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {RECRUITMENT_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <div className="sm:col-span-2">
              <span className={labelCls}>대상 학년(고르지 않으면 제한 없음)</span>
              <div className="mt-1 flex flex-wrap gap-3">
                {GRADES.map((g) => (
                  <label key={g} className="inline-flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      checked={form.target_grades.includes(g)}
                      onChange={(e) =>
                        set(
                          "target_grades",
                          e.target.checked ? [...form.target_grades, g] : form.target_grades.filter((x) => x !== g),
                        )
                      }
                    />
                    {g}
                  </label>
                ))}
              </div>
            </div>
            <label className="sm:col-span-2">
              <span className={labelCls}>신청 화면 첫 안내 문구</span>
              <textarea className={`${inputCls} min-h-[100px]`} value={form.notice} onChange={(e) => set("notice", e.target.value)} />
            </label>
            <div className="sm:col-span-2">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <span className={labelCls}>미리 준비할 서류·안내(모집 예정 화면의 &quot;미리 준비해 주세요&quot;)</span>
                <button type="button" className={btnSecondary} onClick={() => set("prep_notice", defaultPrepNotice())}>
                  기본 문구로 채우기
                </button>
              </div>
              <textarea
                className={`${inputCls} min-h-[200px]`}
                value={form.prep_notice}
                onChange={(e) => set("prep_notice", e.target.value)}
              />
              <p className="mt-1 text-xs text-ink-hint">
                비워 두고 저장하면 보호자 화면에는 기본 문구(공통 서류 + 우선지원 유형별 서류)가 보입니다.
              </p>
            </div>

            <div className="sm:col-span-2">
              <span className={labelCls}>귀가차량 하차 장소(순서대로)</span>
              <div className="mt-1 space-y-2">
                {form.stops.map((s, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <span className="w-6 text-right text-sm text-ink-muted">{i + 1}</span>
                    <input
                      className={`${inputCls} !mt-0 w-24`}
                      placeholder="18:10"
                      value={s.time}
                      onChange={(e) => set("stops", form.stops.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)))}
                    />
                    <input
                      className={`${inputCls} !mt-0 min-w-0 flex-1`}
                      placeholder="명륜역 1번 출구"
                      value={s.place}
                      onChange={(e) => set("stops", form.stops.map((x, j) => (j === i ? { ...x, place: e.target.value } : x)))}
                    />
                    <button type="button" className={btnSecondary} onClick={() => moveStop(i, -1)} disabled={i === 0} aria-label="위로">
                      ↑
                    </button>
                    <button
                      type="button"
                      className={btnSecondary}
                      onClick={() => moveStop(i, 1)}
                      disabled={i === form.stops.length - 1}
                      aria-label="아래로"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className={btnSecondary}
                      onClick={() => set("stops", form.stops.filter((_, j) => j !== i))}
                    >
                      빼기
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className={btnSecondary}
                  onClick={() => set("stops", [...form.stops, { time: "", place: "" }])}
                >
                  정류장 추가
                </button>
                {form.id && (
                  <p className="text-xs text-ink-hint">
                    보호자가 고른 하차 장소는 순번으로 저장됩니다. 접수가 시작된 뒤에는 순서를 바꾸지 마세요.
                  </p>
                )}
              </div>
            </div>

            <label>
              <span className={labelCls}>합격자 서류 보관(합격한 해 연말 + N년)</span>
              <input type="number" min={0} max={10} className={inputCls} value={form.years} onChange={(e) => set("years", e.target.value)} />
            </label>
            <label>
              <span className={labelCls}>불합격·대기·미제출 보관(결정 뒤 N개월)</span>
              <input type="number" min={0} max={60} className={inputCls} value={form.months} onChange={(e) => set("months", e.target.value)} />
            </label>
            <label>
              <span className={labelCls}>동의서 버전</span>
              <input className={inputCls} value={form.consent_version} maxLength={40} onChange={(e) => set("consent_version", e.target.value)} />
            </label>
          </div>
          {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} disabled={pending} onClick={submit}>
              {pending ? "저장 중…" : "저장"}
            </button>
            <button type="button" className={btnSecondary} disabled={pending} onClick={() => setForm(null)}>
              닫기
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
