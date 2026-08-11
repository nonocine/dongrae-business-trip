"use client";

// =====================================================================
// SA-18. [수강생] 탭 — 차시별 프로그램 명단 현황 / ERP 엑셀 업로드 / 명단 상세
//   * 연락처·비상연락처는 직원 화면 전용. 강사 앱에는 내려가지 않는다.
// =====================================================================

import { useEffect, useState, useTransition } from "react";
import {
  listEnrollmentOverview,
  listProgramEnrollments,
  previewErpUpload,
  applyErpUpload,
  addEnrollment,
  updateEnrollment,
  updateEnrollmentBirthDate,
  setEnrollmentStatus,
  deleteEnrollment,
  type EnrollmentOverviewRow,
  type EnrollmentRow,
  type EnrollmentInput,
  type ErpPreviewResult,
  type GroupPreview,
} from "@/app/hr/saems/enrollmentActions";
import type { TermOption } from "@/app/hr/saems/logActions";
import { TERM_STATUS_LABEL, type TermStatus } from "@/lib/saem";
import { calcGrade } from "@/lib/schoolGrade";
import {
  cardCls,
  btnPrimary,
  btnSecondary,
  badgeSuccess,
  badgeNeutral,
  badgeWarning,
  badgeDanger,
  badgeNavy,
  noticeError,
  noticeSuccess,
  noticeWarning,
} from "@/lib/ui";

const selCls =
  "rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const inCls =
  "block w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const thCls = "px-2 py-2 text-left text-xs font-semibold text-navy whitespace-nowrap";
const tdCls = "px-2 py-2 align-middle text-sm text-ink-body whitespace-nowrap";
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");

// 파일 → base64 (급여 EDI 업로드와 동일 방식).
async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    bin += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export default function EnrollmentsManager({
  termOptions,
  defaultTermId,
}: {
  termOptions: TermOption[];
  defaultTermId: string;
}) {
  const [termId, setTermId] = useState(defaultTermId);
  // null = 아직 안 불러옴(로딩).
  const [rows, setRows] = useState<EnrollmentOverviewRow[] | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [detail, setDetail] = useState<EnrollmentOverviewRow | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = termId ? await listEnrollmentOverview(termId) : [];
        if (alive) setRows(r);
      } catch (e) {
        if (!alive) return;
        setRows([]);
        setMsg({
          ok: false,
          text: e instanceof Error ? e.message : "명단 현황을 불러오지 못했습니다.",
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [termId]);

  async function reload() {
    if (!termId) return;
    setRows(await listEnrollmentOverview(termId));
  }

  const list = rows ?? [];
  const totalActive = list.reduce((s, r) => s + r.activeCount, 0);
  const totalCapacity = list.reduce((s, r) => s + (r.capacity ?? 0), 0);
  const emptyPrograms = list.filter((r) => r.activeCount === 0).length;

  // 교시 구분행 위치.
  const items = list.map((r, i) => ({
    r,
    showDivider: i === 0 || r.periodNo !== list[i - 1].periodNo,
  }));

  return (
    <div className="space-y-5">
      <section className={cardCls}>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={termId}
            onChange={(e) => {
              setTermId(e.target.value);
              setMsg(null);
            }}
            className={selCls}
            aria-label="차시"
          >
            {termOptions.length === 0 && <option value="">차시 없음</option>}
            {termOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.projectName} · {t.name} (
                {TERM_STATUS_LABEL[t.status as TermStatus] ?? t.status})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              setMsg(null);
              setUploadOpen(true);
            }}
            className={`ml-auto ${btnPrimary}`}
            disabled={!termId}
          >
            명단 업로드
          </button>
        </div>
        {list.length > 0 && (
          <p className="mt-2 text-xs text-ink-hint">
            프로그램 {list.length}개 · 등록 {totalActive}명
            {totalCapacity > 0 && ` / 정원 합계 ${totalCapacity}명`}
            {emptyPrograms > 0 && ` · 명단 없는 프로그램 ${emptyPrograms}개`}
          </p>
        )}
      </section>

      {msg && <p className={msg.ok ? noticeSuccess : noticeError}>{msg.text}</p>}

      <section className={cardCls}>
        <h3 className="mb-3 text-sm font-bold text-ink">프로그램별 명단 현황</h3>
        {!termId ? (
          <p className="py-8 text-center text-sm text-ink-hint">차시를 선택하세요.</p>
        ) : rows === null ? (
          <p className="py-8 text-center text-sm text-ink-hint">불러오는 중…</p>
        ) : list.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-hint">
            이 차시에 프로그램이 없습니다. [프로그램 관리]에서 먼저 편성하세요.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th className={thCls}>프로그램</th>
                  <th className={thCls}>강사</th>
                  <th className={`${thCls} text-right`}>정원</th>
                  <th className={`${thCls} text-right`}>등록</th>
                  <th className={thCls}>상태</th>
                  <th className={`${thCls} text-right`}>명단</th>
                </tr>
              </thead>
              <tbody>
                {items.map(({ r, showDivider }) => {
                  const over =
                    r.capacity != null && r.activeCount > r.capacity;
                  return (
                    <Rows key={r.programId}>
                      {showDivider && (
                        <tr className="bg-surface/70">
                          <td colSpan={6} className="px-2 py-1 text-xs font-bold text-navy">
                            {r.periodNo != null ? `${r.periodNo}교시` : "교시 미지정"}
                            {r.timeStart
                              ? ` ${hhmm(r.timeStart)}~${hhmm(r.timeEnd)}`
                              : ""}
                          </td>
                        </tr>
                      )}
                      <tr
                        className="group cursor-pointer border-b border-line/60 hover:bg-surface"
                        onClick={() => setDetail(r)}
                      >
                        <td className={`${tdCls} font-medium text-ink`}>
                          {r.programName}
                        </td>
                        <td className={tdCls}>{r.instructorName ?? "-"}</td>
                        <td className={`${tdCls} text-right`}>
                          {r.capacity ?? "-"}
                        </td>
                        <td className={`${tdCls} text-right font-mono`}>
                          {r.activeCount}
                        </td>
                        <td className={tdCls}>
                          <span className="inline-flex flex-wrap items-center gap-1">
                            {r.activeCount === 0 ? (
                              <span className={badgeNeutral}>명단 없음</span>
                            ) : over ? (
                              <span className={badgeDanger}>정원 초과</span>
                            ) : (
                              <span className={badgeSuccess}>등록됨</span>
                            )}
                            {r.manualCount > 0 && (
                              <span className={badgeNavy} title="엑셀 없이 직접 추가한 인원">
                                수동 {r.manualCount}
                              </span>
                            )}
                            {r.cancelledCount > 0 && (
                              <span className={badgeWarning}>
                                취소 {r.cancelledCount}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className={`${tdCls} text-right`}>
                          <span className="text-xs text-navy underline-offset-2 group-hover:underline">
                            보기 →
                          </span>
                        </td>
                      </tr>
                    </Rows>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {uploadOpen && (
        <UploadModal
          termId={termId}
          onClose={() => setUploadOpen(false)}
          onApplied={async (text) => {
            setUploadOpen(false);
            await reload();
            setMsg({ ok: true, text });
          }}
        />
      )}

      {detail && (
        <DetailModal
          program={detail}
          onClose={() => setDetail(null)}
          onChanged={async () => {
            await reload();
          }}
        />
      )}
    </div>
  );
}

// tbody 직계 자식만 허용되므로 divider+row 를 함께 반환.
function Rows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

// =====================================================================
// 명단 업로드 — 미리보기 → 적용 (급여 EDI 업로드와 같은 흐름)
// =====================================================================
type Decision = { programId: string; cancelMissing: boolean };

function UploadModal({
  termId,
  onClose,
  onApplied,
}: {
  termId: string;
  onClose: () => void;
  onApplied: (text: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [base64, setBase64] = useState<string>("");
  const [preview, setPreview] = useState<ErpPreviewResult | null>(null);
  // 그룹 key → 결정. programId "" = 이 그룹 건너뛰기.
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function onFile(f: File | null) {
    setFile(f);
    setBase64("");
    setPreview(null);
    setDecisions({});
    setMsg(null);
  }

  // 미리보기 실행. overrides 를 넘기면 서버가 그 배정으로 대조를 다시 계산한다.
  function runPreview(b64: string, overrides?: Record<string, string>) {
    start(async () => {
      const res = await previewErpUpload({ termId, base64: b64, overrides });
      if (!res.ok) {
        setPreview(null);
        setMsg({ ok: false, text: res.message });
        return;
      }
      setPreview(res);
      setMsg(null);
      setDecisions((prev) => {
        const next: Record<string, Decision> = {};
        for (const g of res.groups) {
          next[g.key] = {
            programId: g.programId ?? "",
            cancelMissing: prev[g.key]?.cancelMissing ?? false,
          };
        }
        return next;
      });
    });
  }

  function doPreview() {
    if (!file) {
      setMsg({ ok: false, text: "엑셀 파일을 선택하세요." });
      return;
    }
    setMsg(null);
    start(async () => {
      const b64 = await fileToBase64(file);
      setBase64(b64);
      const res = await previewErpUpload({ termId, base64: b64 });
      if (!res.ok) {
        setPreview(null);
        setMsg({ ok: false, text: res.message });
        return;
      }
      setPreview(res);
      const next: Record<string, Decision> = {};
      for (const g of res.groups)
        next[g.key] = { programId: g.programId ?? "", cancelMissing: false };
      setDecisions(next);
    });
  }

  // 드롭다운 변경 → 대조를 다시 계산(기존 명단 비교가 프로그램에 달려 있다).
  function changeProgram(key: string, programId: string) {
    const next = { ...decisions, [key]: { ...decisions[key], programId } };
    setDecisions(next);
    if (!base64) return;
    const overrides: Record<string, string> = {};
    for (const [k, d] of Object.entries(next)) overrides[k] = d.programId;
    runPreview(base64, overrides);
  }

  const groups = preview?.ok ? preview.groups : [];
  const assigned = groups.filter((g) => decisions[g.key]?.programId);
  const applyCount = assigned.reduce((s, g) => s + g.fileCount, 0);
  const dupProgram = (() => {
    const ids = assigned.map((g) => decisions[g.key].programId);
    return ids.some((id, i) => ids.indexOf(id) !== i);
  })();

  function doApply() {
    if (!base64 || !assigned.length) return;
    if (
      !confirm(
        `${assigned.length}개 프로그램에 수강생 ${applyCount}명을 반영합니다. 계속할까요?`
      )
    )
      return;
    setMsg(null);
    start(async () => {
      const res = await applyErpUpload({
        termId,
        base64,
        assignments: assigned.map((g) => ({
          key: g.key,
          programId: decisions[g.key].programId,
          cancelMissing: decisions[g.key].cancelMissing,
        })),
      });
      if (!res.ok) {
        setMsg({ ok: false, text: res.message });
        return;
      }
      const parts = [
        `프로그램 ${res.programs}개`,
        `신규 ${res.inserted}명`,
        `갱신 ${res.updated}명`,
      ];
      if (res.cancelled > 0) parts.push(`취소 처리 ${res.cancelled}명`);
      onApplied(`명단을 반영했습니다. (${parts.join(" · ")})`);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="my-4 w-full max-w-3xl rounded-xl border border-line bg-card p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">명단 업로드</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-ink-muted hover:underline"
          >
            닫기
          </button>
        </div>
        <p className="mb-3 text-xs text-ink-hint">
          ERP 신청자 목록 엑셀(xlsx)을 올리면 (프로그램명·수업시간)별로 묶어
          프로그램에 자동 배정합니다. 상태가 <b>예약 확정</b>인 신청만 반영되고,
          이름·학교·교급·연락처·비상연락처만 저장합니다. (생년월일·성별·장애여부·
          환불계좌·회원ID는 저장하지 않습니다.)
        </p>

        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1">
            <label className="block text-[11px] font-semibold text-navy">
              엑셀 파일
            </label>
            <input
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-ink-body file:mr-2 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-ink-body"
            />
          </div>
          <button
            type="button"
            onClick={doPreview}
            disabled={pending || !file}
            className={btnSecondary}
          >
            미리보기
          </button>
        </div>

        {msg && (
          <p className={`mt-3 ${msg.ok ? noticeSuccess : noticeError}`}>{msg.text}</p>
        )}

        {preview?.ok && (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-line bg-surface/60 px-3 py-2 text-xs text-ink-body">
              시트 &lsquo;{preview.sheetName}&rsquo; · 신청 {preview.totalRows}건 → 반영 대상{" "}
              <b className="text-navy">{preview.confirmedRows}명</b>
              {preview.excludedRows > 0 && (
                <> · 제외(취소 등) {preview.excludedRows}명</>
              )}{" "}
              · 그룹 {preview.groups.length}개
            </div>

            {preview.warnings.length > 0 && (
              <div className={noticeWarning}>
                <ul className="list-inside list-disc space-y-0.5">
                  {preview.warnings.slice(0, 8).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {dupProgram && (
              <p className={noticeError}>
                한 프로그램에 두 그룹이 배정되어 있습니다. 배정을 정리한 뒤 적용하세요.
              </p>
            )}

            {preview.groups.map((g) => (
              <GroupCard
                key={g.key}
                group={g}
                options={preview.programOptions}
                decision={
                  decisions[g.key] ?? { programId: "", cancelMissing: false }
                }
                disabled={pending}
                onProgram={(id) => changeProgram(g.key, id)}
                onCancelMissing={(v) =>
                  setDecisions((prev) => ({
                    ...prev,
                    [g.key]: { ...prev[g.key], cancelMissing: v },
                  }))
                }
              />
            ))}

            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <p className="text-xs text-ink-muted">
                배정된 그룹 {assigned.length}개 · 반영 인원 {applyCount}명
              </p>
              <div className="ml-auto flex gap-2">
                <button type="button" onClick={onClose} className={btnSecondary}>
                  취소
                </button>
                <button
                  type="button"
                  onClick={doApply}
                  disabled={pending || !assigned.length || dupProgram}
                  className={btnPrimary}
                >
                  적용
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const CONFIDENCE_BADGE: Record<string, string> = {
  exact: badgeSuccess,
  strong: badgeNavy,
  weak: badgeWarning,
  none: badgeDanger,
};
const CONFIDENCE_LABEL: Record<string, string> = {
  exact: "자동 매칭",
  strong: "매칭(유사)",
  weak: "확인 필요",
  none: "매칭 실패",
};

function GroupCard({
  group,
  options,
  decision,
  disabled,
  onProgram,
  onCancelMissing,
}: {
  group: GroupPreview;
  options: { id: string; label: string }[];
  decision: Decision;
  disabled: boolean;
  onProgram: (id: string) => void;
  onCancelMissing: (v: boolean) => void;
}) {
  const [openExcluded, setOpenExcluded] = useState(false);
  const conf = group.match.confidence;
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">
            {group.baseName}
          </p>
          <p className="mt-0.5 text-[11px] text-ink-hint">
            파일 표기 &lsquo;{group.rawProgramName}&rsquo;
            {group.classTime && ` · 수업시간 ${group.classTime}`}
            {group.fileCapacity != null && ` · 파일상 정원 ${group.fileCapacity}`}
          </p>
        </div>
        <span className={CONFIDENCE_BADGE[conf] ?? badgeNeutral}>
          {CONFIDENCE_LABEL[conf] ?? conf}
        </span>
      </div>

      <div className="mt-2">
        <label className="block text-[11px] font-semibold text-navy">
          배정할 프로그램
        </label>
        <select
          value={decision.programId}
          onChange={(e) => onProgram(e.target.value)}
          disabled={disabled}
          className={inCls}
        >
          <option value="">— 이 그룹 건너뛰기 —</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        {conf !== "exact" && (
          <p className="mt-1 text-[11px] text-warning">{group.match.reason}</p>
        )}
        {group.duplicateProgram && (
          <p className="mt-1 text-[11px] text-stamp">
            다른 그룹과 같은 프로그램에 배정되었습니다.
          </p>
        )}
      </div>

      {/* 대조 결과 */}
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Mini label="반영 인원" value={`${group.fileCount}명`} tone="navy" />
        <Mini label="신규 추가" value={`${group.addedNames.length}명`} />
        <Mini label="기존 유지" value={`${group.keptNames.length}명`} />
        <Mini
          label="파일에서 사라짐"
          value={`${group.missing.length}명`}
          tone={group.missing.length > 0 ? "warn" : undefined}
        />
      </div>
      {group.restoredNames.length > 0 && (
        <p className="mt-1.5 text-[11px] text-ink-muted">
          취소였다가 다시 신청 {group.restoredNames.length}명 →{" "}
          {group.restoredNames.join(", ")}
        </p>
      )}
      {group.addedNames.length > 0 && (
        <p className="mt-1.5 text-[11px] text-ink-muted">
          신규 {group.addedNames.join(", ")}
        </p>
      )}

      {group.missing.length > 0 && decision.programId && (
        <label className="mt-2 flex items-start gap-2 rounded-md bg-warning-soft px-2.5 py-2 text-[11px] text-warning">
          <input
            type="checkbox"
            checked={decision.cancelMissing}
            onChange={(e) => onCancelMissing(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5"
          />
          <span>
            파일에 없는 기존 수강생 {group.missing.length}명(
            {group.missing.map((m) => m.student_name).join(", ")})을 취소 처리합니다.
            <br />
            체크하지 않으면 그대로 유지됩니다(기본).
          </span>
        </label>
      )}

      {group.excludedCount > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setOpenExcluded((v) => !v)}
            className="text-[11px] font-semibold text-ink-muted hover:underline"
          >
            제외된 신청 {group.excludedCount}건 {openExcluded ? "접기 ▲" : "보기 ▼"}
          </button>
          {openExcluded && (
            <p className="mt-1 text-[11px] text-ink-hint">
              {group.excludedNames.join(", ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Mini({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "navy" | "warn";
}) {
  return (
    <div
      className={`rounded-md border px-2 py-1.5 ${
        tone === "navy"
          ? "border-navy/30 bg-navy-soft/30"
          : tone === "warn"
            ? "border-warning/30 bg-warning-soft"
            : "border-line bg-surface/60"
      }`}
    >
      <p className="text-[10px] text-ink-muted">{label}</p>
      <p className="font-mono text-sm font-bold text-ink">{value}</p>
    </div>
  );
}

// =====================================================================
// 명단 상세 — 직원 화면(연락처 포함) + 수동 추가/수정/취소/복원/삭제
// =====================================================================
const EMPTY_INPUT: EnrollmentInput = {
  student_name: "",
  school: null,
  grade: null,
  birth_date: null,
  contact: null,
  emergency_contact: null,
};

// 생년월일 인라인 입력 — 158명을 연속으로 채워야 해서 행에서 고르면 바로 저장한다.
//   저장돼도 명단 전체를 다시 불러오지 않는다(입력 흐름이 끊기지 않게).
//   대신 onSaved 로 부모의 행만 갱신해 옆 칸 [학년]이 즉시 따라 바뀐다.
function BirthDateCell({
  row,
  onSaved,
  onError,
}: {
  row: EnrollmentRow;
  onSaved: (id: string, birth: string | null) => void;
  onError: (text: string) => void;
}) {
  const [value, setValue] = useState(row.birth_date ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [, start] = useTransition();

  function save(next: string) {
    setValue(next);
    setState("saving");
    start(async () => {
      const res = await updateEnrollmentBirthDate(row.id, next || null);
      if (!res.ok) {
        setValue(row.birth_date ?? ""); // 실패하면 화면을 되돌린다.
        setState("idle");
        onError(res.message);
        return;
      }
      setState("saved");
      onSaved(row.id, next || null);
    });
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="date"
        value={value}
        onChange={(e) => save(e.target.value)}
        className={`${inCls} w-36 px-1.5 py-1 text-xs`}
      />
      <span className="w-3 shrink-0 text-xs text-ink-hint">
        {state === "saving" ? "…" : state === "saved" ? "✓" : ""}
      </span>
    </div>
  );
}

function DetailModal({
  program,
  onClose,
  onChanged,
}: {
  program: EnrollmentOverviewRow;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const programId = program.programId;
  const [list, setList] = useState<EnrollmentRow[] | null>(null);
  const [editing, setEditing] = useState<EnrollmentRow | "new" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  // 변경 후 재조회(이벤트 핸들러 전용 — 효과에서는 아래 IIFE 를 쓴다).
  async function load() {
    try {
      setList(await listProgramEnrollments(programId));
    } catch (e) {
      setList([]);
      setMsg({
        ok: false,
        text: e instanceof Error ? e.message : "명단을 불러오지 못했습니다.",
      });
    }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await listProgramEnrollments(programId);
        if (alive) setList(r);
      } catch (e) {
        if (!alive) return;
        setList([]);
        setMsg({
          ok: false,
          text: e instanceof Error ? e.message : "명단을 불러오지 못했습니다.",
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [programId]);

  async function afterChange(text: string) {
    setEditing(null);
    setMsg({ ok: true, text });
    await load();
    await onChanged();
  }

  // 생년월일 인라인 저장 후 해당 행만 갱신(전체 재조회 없이 [학년]을 즉시 반영).
  function patchBirthDate(id: string, birth: string | null) {
    setList((cur) =>
      cur ? cur.map((r) => (r.id === id ? { ...r, birth_date: birth } : r)) : cur
    );
  }

  const active = (list ?? []).filter((e) => e.status === "active");
  const cancelled = (list ?? []).filter((e) => e.status !== "active");

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="my-4 w-full max-w-3xl rounded-xl border border-line bg-card p-5 shadow-lg">
        <div className="mb-1 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-ink">{program.programName}</h3>
            <p className="mt-0.5 text-xs text-ink-muted">
              {program.periodNo != null ? `${program.periodNo}교시` : "교시 미지정"}
              {program.timeStart &&
                ` ${hhmm(program.timeStart)}~${hhmm(program.timeEnd)}`}{" "}
              · 강사 {program.instructorName ?? "-"} · 정원{" "}
              {program.capacity ?? "-"} · 등록 {active.length}명
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-ink-muted hover:underline"
          >
            닫기
          </button>
        </div>
        <p className="mb-3 text-[11px] text-ink-hint">
          연락처·비상연락처는 직원만 보는 정보입니다. 강사 앱(동래샘들)에는 이름·학교·
          교급만 전달됩니다. [교급]은 ERP 대상구분(초등학생 등)이고, [학년]은
          생년월일로 자동 계산합니다 — 날짜를 고르면 바로 저장됩니다.
        </p>

        {msg && (
          <p className={`mb-3 ${msg.ok ? noticeSuccess : noticeError}`}>{msg.text}</p>
        )}

        <div className="mb-3 flex justify-end">
          <button
            type="button"
            onClick={() => {
              setMsg(null);
              setEditing("new");
            }}
            className={btnSecondary}
          >
            + 수강생 직접 추가
          </button>
        </div>

        {editing && (
          <EnrollmentForm
            programId={program.programId}
            row={editing === "new" ? null : editing}
            onCancel={() => setEditing(null)}
            onDone={afterChange}
            onError={(text) => setMsg({ ok: false, text })}
          />
        )}

        {list === null ? (
          <p className="py-8 text-center text-sm text-ink-hint">불러오는 중…</p>
        ) : list.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-hint">
            등록된 수강생이 없습니다. [명단 업로드]로 ERP 엑셀을 올리거나 직접
            추가하세요.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th className={`${thCls} w-10 text-right`}>순번</th>
                  <th className={thCls}>이름</th>
                  <th className={thCls}>학교</th>
                  <th className={thCls}>교급</th>
                  <th className={thCls}>생년월일</th>
                  <th className={thCls}>학년</th>
                  <th className={thCls}>연락처</th>
                  <th className={thCls}>비상연락처</th>
                  <th className={`${thCls} text-right`}>관리</th>
                </tr>
              </thead>
              <tbody>
                {[...active, ...cancelled].map((e) => {
                  const off = e.status !== "active";
                  const gradeInfo = calcGrade(e.birth_date);
                  return (
                    <tr
                      key={e.id}
                      className={`border-b border-line/60 ${off ? "opacity-55" : ""}`}
                    >
                      <td className={`${tdCls} text-right font-mono text-xs`}>
                        {e.seq_no ?? "-"}
                      </td>
                      <td className={`${tdCls} font-medium text-ink`}>
                        {e.student_name}
                        {off && <span className={`ml-1.5 ${badgeWarning}`}>취소</span>}
                        {!e.erp_no && (
                          <span className={`ml-1.5 ${badgeNavy}`} title="엑셀 없이 직접 추가">
                            수동
                          </span>
                        )}
                      </td>
                      <td className={tdCls}>{e.school ?? "-"}</td>
                      <td className={tdCls}>{e.grade ?? "-"}</td>
                      <td className={tdCls}>
                        <BirthDateCell
                          row={e}
                          onSaved={patchBirthDate}
                          onError={(text) => setMsg({ ok: false, text })}
                        />
                      </td>
                      <td className={tdCls}>
                        {gradeInfo.grade == null ? (
                          <span className="text-ink-hint">-</span>
                        ) : (
                          <span
                            className={
                              gradeInfo.grade >= 1 && gradeInfo.grade <= 6
                                ? "font-semibold text-ink"
                                : "text-ink-muted"
                            }
                          >
                            {gradeInfo.label}
                          </span>
                        )}
                      </td>
                      <td className={`${tdCls} font-mono text-xs`}>
                        {e.contact ?? "-"}
                      </td>
                      <td className={`${tdCls} font-mono text-xs`}>
                        {e.emergency_contact ?? "-"}
                      </td>
                      <td className={`${tdCls} text-right`}>
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setMsg(null);
                              setEditing(e);
                            }}
                            className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:bg-surface"
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              start(async () => {
                                const res = await setEnrollmentStatus(
                                  e.id,
                                  off ? "active" : "cancelled"
                                );
                                if (!res.ok)
                                  return setMsg({ ok: false, text: res.message });
                                await afterChange(
                                  off ? "복원했습니다." : "취소 처리했습니다."
                                );
                              })
                            }
                            className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:bg-surface"
                          >
                            {off ? "복원" : "취소"}
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => {
                              if (
                                !confirm(
                                  `${e.student_name} 수강생을 완전히 삭제할까요? (기록이 남지 않습니다)`
                                )
                              )
                                return;
                              start(async () => {
                                const res = await deleteEnrollment(e.id);
                                if (!res.ok)
                                  return setMsg({ ok: false, text: res.message });
                                await afterChange("삭제했습니다.");
                              });
                            }}
                            className="rounded border border-stamp px-2 py-1 text-xs text-stamp hover:bg-stamp-soft"
                          >
                            삭제
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className={btnSecondary}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

function EnrollmentForm({
  programId,
  row,
  onCancel,
  onDone,
  onError,
}: {
  programId: string;
  row: EnrollmentRow | null;
  onCancel: () => void;
  onDone: (text: string) => void | Promise<void>;
  onError: (text: string) => void;
}) {
  const [form, setForm] = useState<EnrollmentInput>(
    row
      ? {
          student_name: row.student_name,
          school: row.school,
          grade: row.grade,
          birth_date: row.birth_date,
          contact: row.contact,
          emergency_contact: row.emergency_contact,
        }
      : EMPTY_INPUT
  );
  const [pending, start] = useTransition();
  const set = (k: keyof EnrollmentInput, v: string) =>
    setForm((f) => ({ ...f, [k]: v.length ? v : null }));

  function submit() {
    if (!form.student_name.trim()) {
      onError("이름을 입력하세요.");
      return;
    }
    start(async () => {
      const res = row
        ? await updateEnrollment(row.id, form)
        : await addEnrollment(programId, form);
      if (!res.ok) return onError(res.message);
      await onDone(row ? "수정했습니다." : "추가했습니다.");
    });
  }

  return (
    <div className="mb-4 rounded-lg border border-navy/30 bg-navy-soft/20 p-3">
      <p className="mb-2 text-xs font-bold text-navy">
        {row ? `${row.student_name} 수정` : "수강생 직접 추가"}
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-6">
        <Field label="이름" required>
          <input
            value={form.student_name}
            onChange={(e) => setForm((f) => ({ ...f, student_name: e.target.value }))}
            className={inCls}
          />
        </Field>
        <Field label="학교">
          <input
            value={form.school ?? ""}
            onChange={(e) => set("school", e.target.value)}
            className={inCls}
          />
        </Field>
        <Field label="교급">
          <input
            value={form.grade ?? ""}
            onChange={(e) => set("grade", e.target.value)}
            placeholder="초등학생"
            className={inCls}
          />
        </Field>
        <Field label="생년월일">
          <input
            type="date"
            value={form.birth_date ?? ""}
            onChange={(e) => set("birth_date", e.target.value)}
            className={inCls}
          />
        </Field>
        <Field label="연락처">
          <input
            value={form.contact ?? ""}
            onChange={(e) => set("contact", e.target.value)}
            placeholder="010-0000-0000"
            className={inCls}
          />
        </Field>
        <Field label="비상연락처">
          <input
            value={form.emergency_contact ?? ""}
            onChange={(e) => set("emergency_contact", e.target.value)}
            placeholder="010-0000-0000"
            className={inCls}
          />
        </Field>
      </div>
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className={btnPrimary}
        >
          {row ? "저장" : "추가"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className={btnSecondary}
        >
          취소
        </button>
        {row && !row.erp_no && (
          <p className="self-center text-[11px] text-ink-hint">
            수동 추가 인원은 엑셀 재업로드 때 취소 대상이 되지 않습니다.
          </p>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-navy">
        {label}
        {required && <span className="text-stamp"> *</span>}
      </label>
      {children}
    </div>
  );
}
