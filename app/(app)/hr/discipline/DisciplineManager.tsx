"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  getEmployeeRecord,
  saveDiscipline,
  deleteDiscipline,
  saveAwardAdmin,
  deleteAward,
  reviewIncident,
  deleteIncident,
  requestIncidentReport,
  cancelIncidentRequest,
  saveCommittee,
  deleteCommittee,
  getAttachmentUrl,
  type DisciplineBoard,
  type DisciplineEmployee,
  type EmployeeRecord,
} from "@/app/(app)/hr/discipline/actions";
import {
  AWARD_KINDS,
  AWARD_SOURCE_LABEL,
  COMMITTEE_AGENDAS,
  DISCIPLINE_KINDS,
  DISCIPLINE_LABEL,
  WARNING_THRESHOLD,
  appealDueOn,
  fmtDotPlain,
  isYmd,
  promotionBlockUntil,
  validateDiscipline,
  type AwardRow,
  type CommitteeRow,
  type DisciplineKind,
  type DisciplineRow,
  type IncidentRow,
} from "@/lib/hrDiscipline";
import {
  panelToneCls,
  sectionTitleCls,
  tableHeadCls,
  tableRowCls,
  tabBarCls,
  tabNavCls,
  tabItemCls,
  inputCls,
  labelCls,
  btnPrimary,
  btnSecondary,
  btnDanger,
  badgeDanger,
  badgeNavy,
  badgeNeutral,
  badgeSuccess,
  badgeWarning,
  noticeError,
  noticeSuccess,
  noticeWarning,
} from "@/lib/ui";

// =====================================================================
// 상벌·인사위원회 — 관장·부장 전용 화면(/hr/discipline).
//   탭: 상벌(직원별 포상·징계 시간순 + 자동 계산) / 경위서 / 인사위원회(기록용).
//   서버 액션이 모두 M0 를 다시 확인합니다(이 화면 진입도 page 에서 막음).
// =====================================================================

type Msg = { ok: boolean; text: string } | null;
type TabKey = "records" | "incidents" | "committees";

const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const ymdOf = (iso: string | null | undefined) => (iso ? new Date(Date.parse(iso) + 9 * 3600 * 1000).toISOString().slice(0, 10) : "");

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-xl bg-card p-4 shadow-lg sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-base font-bold text-ink">{title}</p>
          <button type="button" onClick={onClose} className={btnSecondary}>
            닫기
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children, full }: { label: string; children: ReactNode; full?: boolean }) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  );
}

function AttachLink({ table, id }: { table: "hr_awards" | "hr_disciplines" | "hr_incident_reports" | "hr_committees"; id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className="text-xs text-navy underline-offset-2 hover:underline"
      onClick={() =>
        start(async () => {
          const res = await getAttachmentUrl(table, id);
          if (res.ok) window.open(res.url, "_blank", "noopener");
          else alert(res.message);
        })
      }
    >
      첨부 보기
    </button>
  );
}

export default function DisciplineManager({
  employees,
  board,
  initialDriverId,
  initialTab,
}: {
  employees: DisciplineEmployee[];
  board: DisciplineBoard;
  initialDriverId: string;
  initialTab: TabKey;
}) {
  const [tab, setTab] = useState<TabKey>(initialTab);
  const TABS: { key: TabKey; label: string }[] = [
    { key: "records", label: "상벌" },
    { key: "incidents", label: `경위서 (${board.incidents.length})` },
    { key: "committees", label: `인사위원회 (${board.committees.length})` },
  ];
  return (
    <div className="space-y-5">
      <p className={noticeWarning}>
        이 화면의 내용(징계·포상·경위서·인사위원회)은 관장·부장만 봅니다. 직원 본인은 포상 등록과 경위서 제출만 하고,
        제출한 내용은 볼 수 없습니다.
      </p>
      <div className={tabBarCls}>
        <nav className={tabNavCls} role="tablist" aria-label="상벌·인사위원회">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={t.key === tab} onClick={() => setTab(t.key)} className={tabItemCls(t.key === tab)}>
              {t.label}
            </button>
          ))}
        </nav>
      </div>
      {tab === "records" && <RecordsTab employees={employees} board={board} initialDriverId={initialDriverId} />}
      {tab === "incidents" && <IncidentsTab board={board} employees={employees} />}
      {tab === "committees" && <CommitteesTab board={board} employees={employees} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 상벌(직원별)
// ---------------------------------------------------------------------------
function RecordsTab({
  employees,
  board,
  initialDriverId,
}: {
  employees: DisciplineEmployee[];
  board: DisciplineBoard;
  initialDriverId: string;
}) {
  const router = useRouter();
  const [driverId, setDriverId] = useState(initialDriverId);
  const [loaded, setLoaded] = useState<{ driverId: string; record: EmployeeRecord } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const record = loaded && loaded.driverId === driverId ? loaded.record : null;
  const [editDiscipline, setEditDiscipline] = useState<DisciplineRow | "new" | null>(null);
  const [editAward, setEditAward] = useState<AwardRow | "new" | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const name = employees.find((e) => e.driverId === driverId)?.name ?? "";
  const myIncidents = board.incidents.filter((i) => i.driver_id === driverId);

  useEffect(() => {
    if (!driverId) return;
    let alive = true;
    getEmployeeRecord(driverId).then((res) => {
      if (!alive) return;
      if (res.ok) setLoaded({ driverId, record: res.record });
      else setMsg({ ok: false, text: res.message });
    });
    return () => {
      alive = false;
    };
  }, [driverId, reloadKey]);

  function done(text: string) {
    setMsg({ ok: true, text });
    setEditAward(null);
    setEditDiscipline(null);
    setRequestOpen(false);
    setReloadKey((k) => k + 1);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {board.alerts.length > 0 && (
        <section className={panelToneCls("red")}>
          <h3 className={sectionTitleCls("red")}>살펴볼 사람</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {board.alerts.map((a) => (
              <li key={a.driverId}>
                <button type="button" className="font-semibold text-navy hover:underline" onClick={() => setDriverId(a.driverId)}>
                  {a.name}
                </button>
                {a.warnings >= WARNING_THRESHOLD && <span className={`ml-2 ${badgeDanger}`}>경고 {a.warnings}회 — 견책 처리 검토 대상</span>}
                {a.blockUntil && <span className={`ml-2 ${badgeWarning}`}>{fmtDotPlain(a.blockUntil)}까지 승진제한</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={panelToneCls("blue")}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px]">
            <label className={labelCls}>직원</label>
            <select className={inputCls} value={driverId} onChange={(e) => setDriverId(e.target.value)} data-testid="discipline-employee">
              <option value="">— 직원 선택 —</option>
              {employees.map((e) => (
                <option key={e.driverId} value={e.driverId}>
                  {e.name}
                  {e.resigned ? " (퇴사)" : ""}
                </option>
              ))}
            </select>
          </div>
          {driverId && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btnPrimary} onClick={() => setEditDiscipline("new")} disabled={pending}>
                징계 등록
              </button>
              <button type="button" className={btnSecondary} onClick={() => setEditAward("new")} disabled={pending}>
                포상 등록(대리)
              </button>
              <button type="button" className={btnSecondary} onClick={() => setRequestOpen(true)} disabled={pending}>
                경위서 제출 요청
              </button>
            </div>
          )}
        </div>
        {msg && <p className={`mt-3 ${msg.ok ? noticeSuccess : noticeError}`}>{msg.text}</p>}
      </section>

      {driverId && record && (
        <section className={panelToneCls("green")} data-testid="discipline-record">
          <h3 className={sectionTitleCls("green")}>{name} — 상벌 기록</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {record.promotionBlockUntil ? (
              <span className={badgeWarning} data-testid="promotion-block">
                {fmtDotPlain(record.promotionBlockUntil)}까지 승진제한
              </span>
            ) : (
              <span className={badgeNeutral}>승진제한 없음</span>
            )}
            <span className={record.warnings.reached ? badgeDanger : badgeNeutral}>경고 {record.warnings.count}회</span>
          </div>
          {record.warnings.reached && (
            <p className={`mt-2 ${noticeError}`} data-testid="warning-alert">
              경고 {record.warnings.count}회 — 견책 처리 검토 대상(운영규정 40조 3항). 자동으로 견책을 만들지 않습니다. 판단 후 [징계 등록]에서
              처리하세요.
            </p>
          )}
          {record.timeline.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-hint">포상·징계 기록이 없습니다.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className={tableHeadCls}>
                    <th className="px-2 py-2">날짜</th>
                    <th className="px-2 py-2">구분</th>
                    <th className="px-2 py-2">내용</th>
                    <th className="px-2 py-2">비고</th>
                    <th className="px-2 py-2 text-right">작업</th>
                  </tr>
                </thead>
                <tbody>
                  {record.timeline.map((t) =>
                    t.type === "award" ? (
                      <tr key={`a-${t.award.id}`} className={tableRowCls}>
                        <td className="px-2 py-2 text-xs">{fmtDotPlain(t.date)}</td>
                        <td className="px-2 py-2">
                          <span className={t.award.award_source === "internal" ? badgeSuccess : badgeNeutral}>
                            {AWARD_SOURCE_LABEL[t.award.award_source]}
                            {t.award.award_kind ? `·${t.award.award_kind}` : ""}
                          </span>
                        </td>
                        <td className="px-2 py-2">
                          <p className="font-medium text-ink">{t.award.title}</p>
                          {t.award.awarding_body && <p className="text-xs text-ink-muted">{t.award.awarding_body}</p>}
                          {t.award.merit_summary && <p className="text-xs text-ink-muted">{t.award.merit_summary}</p>}
                        </td>
                        <td className="px-2 py-2 text-xs text-ink-muted">
                          {t.award.created_by ? `등록 ${t.award.created_by}` : ""}
                          {t.award.has_attachment && (
                            <span className="ml-2">
                              <AttachLink table="hr_awards" id={t.award.id} />
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <RowButtons onEdit={() => setEditAward(t.award)} onDelete={() => start(async () => {
                            if (!confirm("이 포상 기록을 삭제할까요?")) return;
                            const r = await deleteAward(t.award.id);
                            if (r.ok) done("포상 기록을 삭제했습니다.");
                            else setMsg({ ok: false, text: r.message });
                          })} />
                        </td>
                      </tr>
                    ) : (
                      <tr key={`d-${t.discipline.id}`} className={tableRowCls}>
                        <td className="px-2 py-2 text-xs">{fmtDotPlain(t.date)}</td>
                        <td className="px-2 py-2">
                          <span className={t.discipline.kind === "warning" ? badgeNavy : badgeDanger}>{DISCIPLINE_LABEL[t.discipline.kind]}</span>
                        </td>
                        <td className="px-2 py-2">
                          <p className="text-ink">{t.discipline.reason}</p>
                          {t.discipline.rule_basis && <p className="text-xs text-ink-muted">근거: {t.discipline.rule_basis}</p>}
                          {(t.discipline.effective_start || t.discipline.effective_end) && (
                            <p className="text-xs text-ink-muted">
                              집행 {fmtDotPlain(t.discipline.effective_start)} ~ {fmtDotPlain(t.discipline.effective_end)}
                            </p>
                          )}
                        </td>
                        <td className="px-2 py-2 text-xs text-ink-muted">
                          {t.discipline.promotion_block_until && <p>승진제한 ~{fmtDotPlain(t.discipline.promotion_block_until)}</p>}
                          {t.discipline.appeal_due_on && (
                            <p>
                              재심 기한 {fmtDotPlain(t.discipline.appeal_due_on)}
                              {t.discipline.appeal_filed_on ? ` · 청구 ${fmtDotPlain(t.discipline.appeal_filed_on)}` : ""}
                            </p>
                          )}
                          <p>{t.discipline.notified_on ? `통보 ${fmtDotPlain(t.discipline.notified_on)}` : "통보 미기록"}</p>
                          {t.discipline.has_attachment && <AttachLink table="hr_disciplines" id={t.discipline.id} />}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <RowButtons onEdit={() => setEditDiscipline(t.discipline)} onDelete={() => start(async () => {
                            if (!confirm("이 징계 기록을 삭제할까요? 연결된 경위서의 연결도 풀립니다.")) return;
                            const r = await deleteDiscipline(t.discipline.id);
                            if (r.ok) done("징계 기록을 삭제했습니다.");
                            else setMsg({ ok: false, text: r.message });
                          })} />
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {editDiscipline && (
        <DisciplineForm
          driverId={driverId}
          name={name}
          row={editDiscipline === "new" ? null : editDiscipline}
          committees={board.committees}
          incidents={myIncidents}
          onClose={() => setEditDiscipline(null)}
          onDone={done}
        />
      )}
      {editAward && (
        <AwardForm driverId={driverId} name={name} row={editAward === "new" ? null : editAward} onClose={() => setEditAward(null)} onDone={done} />
      )}
      {requestOpen && <RequestForm driverId={driverId} name={name} onClose={() => setRequestOpen(false)} onDone={done} />}
    </div>
  );
}

function RowButtons({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex justify-end gap-1">
      <button type="button" onClick={onEdit} className="rounded-md border border-line bg-card px-2 py-1 text-xs hover:bg-surface">
        수정
      </button>
      <button type="button" onClick={onDelete} className="rounded-md border border-stamp bg-card px-2 py-1 text-xs text-stamp hover:bg-stamp-soft">
        삭제
      </button>
    </div>
  );
}

function DisciplineForm({
  driverId,
  name,
  row,
  committees,
  incidents,
  onClose,
  onDone,
}: {
  driverId: string;
  name: string;
  row: DisciplineRow | null;
  committees: CommitteeRow[];
  incidents: IncidentRow[];
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [kind, setKind] = useState<DisciplineKind>(row?.kind ?? "warning");
  const [decidedOn, setDecidedOn] = useState(row?.decided_on ?? kstToday());
  const [start, setStart] = useState(row?.effective_start ?? "");
  const [end, setEnd] = useState(row?.effective_end ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [pending, startT] = useTransition();
  const linkedIncident = incidents.find((i) => i.discipline_id && i.discipline_id === row?.id)?.id ?? "";

  const core = { kind, decided_on: decidedOn, effective_start: start || null, effective_end: end || null };
  const invalid = isYmd(decidedOn) ? validateDiscipline(core) : "처분일을 확인해주세요.";
  const block = !invalid ? promotionBlockUntil(core) : null;
  const due = isYmd(decidedOn) ? appealDueOn(decidedOn) : null;
  const note = DISCIPLINE_KINDS.find((k) => k.value === kind)?.note;

  return (
    <Modal title={`${row ? "징계 수정" : "징계 등록"} — ${name}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          fd.set("driverId", driverId);
          if (row) fd.set("id", row.id);
          setErr(null);
          startT(async () => {
            const res = await saveDiscipline(fd);
            if (!res.ok) return setErr(res.message);
            onDone(
              `${DISCIPLINE_LABEL[kind]}을(를) 저장했습니다.` +
                (res.promotionBlockUntil ? ` 승진제한 ${fmtDotPlain(res.promotionBlockUntil)}까지.` : "") +
                ` 재심청구 기한 ${fmtDotPlain(res.appealDueOn)}.`
            );
          });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="징계 종류 *">
            <select name="kind" className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as DisciplineKind)} data-testid="discipline-kind">
              {DISCIPLINE_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="처분일 *">
            <input type="date" name="decidedOn" className={inputCls} value={decidedOn} onChange={(e) => setDecidedOn(e.target.value)} />
          </Field>
          {note && <p className="text-xs text-ink-muted sm:col-span-2">{note}</p>}
          <Field label="집행 시작일">
            <input type="date" name="effectiveStart" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="집행 종료일 (감봉·정직)">
            <input type="date" name="effectiveEnd" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} data-testid="discipline-end" />
          </Field>
          <div className="sm:col-span-2 rounded-lg border border-rule px-3 py-2 text-xs" data-testid="discipline-auto">
            <p>
              <b>자동 계산</b> — 승진제한(운영규정 32조):{" "}
              {invalid ? <span className="text-stamp">{invalid}</span> : block ? `${fmtDotPlain(block)}까지` : "없음(경고·해고)"}
            </p>
            <p>재심청구 기한(운영규정 41조, 처분일 + 7일, 1회): {due ? fmtDotPlain(due) : "-"}</p>
          </div>
          <Field label="징계 사유 *" full>
            <textarea name="reason" className={inputCls} rows={3} defaultValue={row?.reason ?? ""} />
          </Field>
          <Field label="근거 규정" full>
            <input name="ruleBasis" className={inputCls} defaultValue={row?.rule_basis ?? ""} placeholder="예: 취업규칙 52조 1호" />
          </Field>
          <Field label="인사위원회">
            <select name="committeeId" className={inputCls} defaultValue={row?.committee_id ?? ""}>
              <option value="">연결 안 함</option>
              {committees.map((c) => (
                <option key={c.id} value={c.id}>
                  {fmtDotPlain(c.held_on)} {c.subject}
                </option>
              ))}
            </select>
          </Field>
          <Field label="경위서 연결">
            <select name="incidentId" className={inputCls} defaultValue={linkedIncident}>
              <option value="">연결 안 함</option>
              {incidents.map((i) => (
                <option key={i.id} value={i.id}>
                  {ymdOf(i.submitted_at)} {i.subject}
                </option>
              ))}
            </select>
          </Field>
          <Field label="통보일(징계처분사유 설명서, 취업규칙 55조)">
            <input type="date" name="notifiedOn" className={inputCls} defaultValue={row?.notified_on ?? ""} />
          </Field>
          <Field label="재심 청구일">
            <input type="date" name="appealFiledOn" className={inputCls} defaultValue={row?.appeal_filed_on ?? ""} />
          </Field>
          <Field label="재심 결과" full>
            <input name="appealResult" className={inputCls} defaultValue={row?.appeal_result ?? ""} />
          </Field>
          <Field label="첨부(PDF·JPG·PNG)" full>
            <input type="file" name="file" accept="application/pdf,image/jpeg,image/png" className="mt-1 text-xs" />
          </Field>
        </div>
        {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}
        <div className="mt-4 flex gap-2">
          <button type="submit" className={btnPrimary} disabled={pending || !!invalid} data-testid="discipline-save">
            {pending ? "저장 중…" : "저장"}
          </button>
          <button type="button" className={btnSecondary} onClick={onClose}>
            취소
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AwardForm({
  driverId,
  name,
  row,
  onClose,
  onDone,
}: {
  driverId: string;
  name: string;
  row: AwardRow | null;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Modal title={`${row ? "포상 수정" : "포상 등록"} — ${name}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          fd.set("driverId", driverId);
          if (row) fd.set("id", row.id);
          setErr(null);
          start(async () => {
            const res = await saveAwardAdmin(fd);
            if (!res.ok) return setErr(res.message);
            onDone("포상을 저장했습니다.");
          });
        }}
      >
        <AwardFields row={row} />
        {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}
        <div className="mt-4 flex gap-2">
          <button type="submit" className={btnPrimary} disabled={pending}>
            {pending ? "저장 중…" : "저장"}
          </button>
          <button type="button" className={btnSecondary} onClick={onClose}>
            취소
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function AwardFields({ row }: { row?: AwardRow | null }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="출처 *">
        <select name="awardSource" className={inputCls} defaultValue={row?.award_source ?? "external"}>
          <option value="external">외부 수상</option>
          <option value="internal">센터 포상(운영규정 30조)</option>
        </select>
      </Field>
      <Field label="포상일 *">
        <input type="date" name="awardedOn" className={inputCls} defaultValue={row?.awarded_on ?? ""} />
      </Field>
      <Field label="종류(센터 포상만)">
        <select name="awardKind" className={inputCls} defaultValue={row?.award_kind ?? ""}>
          <option value="">선택</option>
          {AWARD_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </Field>
      <Field label="포상명 *" full>
        <input name="title" className={inputCls} defaultValue={row?.title ?? ""} placeholder="예: 청소년육성 유공 표창" />
      </Field>
      <Field label="수여기관" full>
        <input name="awardingBody" className={inputCls} defaultValue={row?.awarding_body ?? ""} placeholder="예: 동래구청장" />
      </Field>
      <Field label="공적 요약" full>
        <textarea name="meritSummary" className={inputCls} rows={3} defaultValue={row?.merit_summary ?? ""} />
      </Field>
      <Field label="증빙 첨부(PDF·JPG·PNG, 16MB 이하)" full>
        <input type="file" name="file" accept="application/pdf,image/jpeg,image/png" className="mt-1 text-xs" />
      </Field>
    </div>
  );
}

function RequestForm({ driverId, name, onClose, onDone }: { driverId: string; name: string; onClose: () => void; onDone: (t: string) => void }) {
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Modal title={`경위서 제출 요청 — ${name}`} onClose={onClose}>
      <p className="text-xs text-ink-muted">
        본인 마이페이지에 &ldquo;경위서 제출 요청이 있습니다&rdquo;가 뜨고 슬랙 DM 이 갑니다(DM 엔 요청 사실만 — 사유는 넣지 않음). 메모는
        관장·부장만 봅니다.
      </p>
      <label className={`mt-3 ${labelCls}`}>메모(관리용)</label>
      <textarea className={inputCls} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          className={btnPrimary}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await requestIncidentReport(driverId, note);
              if (!res.ok) return setErr(res.message);
              onDone(`${name} 님에게 경위서 제출을 요청했습니다.` + (res.dmFailed ? ` (슬랙 알림 실패 — ${res.dmFailed})` : ""));
            })
          }
        >
          요청 보내기
        </button>
        <button type="button" className={btnSecondary} onClick={onClose}>
          취소
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// 경위서
// ---------------------------------------------------------------------------
function IncidentsTab({ board, employees }: { board: DisciplineBoard; employees: DisciplineEmployee[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<IncidentRow | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  void employees;
  return (
    <div className="space-y-5">
      {board.pendingRequests.length > 0 && (
        <section className={panelToneCls("yellow")}>
          <h3 className={sectionTitleCls("yellow")}>제출 요청 대기</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {board.pendingRequests.map((p) => (
              <li key={p.driverId} className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink">{p.name}</span>
                <span className="text-xs text-ink-muted">
                  {ymdOf(p.at)} 요청 · {p.by}
                  {p.note ? ` · ${p.note}` : ""}
                </span>
                <button
                  type="button"
                  className="text-xs text-stamp hover:underline"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await cancelIncidentRequest(p.driverId);
                      if (r.ok) router.refresh();
                      else setMsg({ ok: false, text: r.message });
                    })
                  }
                >
                  요청 취소
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className={panelToneCls("green")}>
        <h3 className={sectionTitleCls("green")}>제출된 경위서</h3>
        {msg && <p className={`mt-2 ${msg.ok ? noticeSuccess : noticeError}`}>{msg.text}</p>}
        {board.incidents.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-hint">제출된 경위서가 없습니다.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead>
                <tr className={tableHeadCls}>
                  <th className="px-2 py-2">제출일</th>
                  <th className="px-2 py-2">작성자</th>
                  <th className="px-2 py-2">사건일</th>
                  <th className="px-2 py-2">제목</th>
                  <th className="px-2 py-2">검토</th>
                  <th className="px-2 py-2 text-right" />
                </tr>
              </thead>
              <tbody>
                {board.incidents.map((i) => (
                  <tr key={i.id} className={tableRowCls}>
                    <td className="px-2 py-2 text-xs">{ymdOf(i.submitted_at)}</td>
                    <td className="px-2 py-2 font-medium text-ink">{i.driver_name}</td>
                    <td className="px-2 py-2 text-xs">{fmtDotPlain(i.occurred_on) || "-"}</td>
                    <td className="px-2 py-2">{i.subject}</td>
                    <td className="px-2 py-2">
                      {i.reviewed_at ? <span className={badgeSuccess}>검토함</span> : <span className={badgeWarning}>미검토</span>}
                      {i.discipline_id && <span className={`ml-1 ${badgeDanger}`}>징계 연결</span>}
                      {i.requested_by && <span className={`ml-1 ${badgeNeutral}`}>요청 {i.requested_by}</span>}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button type="button" className="rounded-md border border-line bg-card px-2 py-1 text-xs hover:bg-surface" onClick={() => setOpen(i)}>
                        열기
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {open && (
        <IncidentDetail
          row={open}
          onClose={() => setOpen(null)}
          onDone={(text) => {
            setOpen(null);
            setMsg({ ok: true, text });
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function IncidentDetail({ row, onClose, onDone }: { row: IncidentRow; onClose: () => void; onDone: (t: string) => void }) {
  const [note, setNote] = useState(row.review_note ?? "");
  const [disciplineId, setDisciplineId] = useState(row.discipline_id ?? "");
  const [options, setOptions] = useState<DisciplineRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    getEmployeeRecord(row.driver_id).then((r) => {
      if (r.ok) setOptions(r.record.disciplines);
    });
  }, [row.driver_id]);
  return (
    <Modal title={`경위서 — ${row.driver_name}`} onClose={onClose}>
      <dl className="grid grid-cols-[80px_1fr] gap-y-1 text-sm">
        <dt className="text-ink-muted">제출</dt>
        <dd>{ymdOf(row.submitted_at)}</dd>
        <dt className="text-ink-muted">사건일</dt>
        <dd>{fmtDotPlain(row.occurred_on) || "-"}</dd>
        <dt className="text-ink-muted">제목</dt>
        <dd className="font-medium text-ink">{row.subject}</dd>
      </dl>
      <div className="mt-3 whitespace-pre-wrap rounded-md border border-rule bg-white p-3 text-sm text-ink-body">{row.content}</div>
      {row.has_attachment && (
        <p className="mt-2">
          <AttachLink table="hr_incident_reports" id={row.id} />
        </p>
      )}
      <label className={`mt-4 ${labelCls}`}>검토의견 (관장·부장만 봅니다)</label>
      <textarea className={inputCls} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      <label className={`mt-3 ${labelCls}`}>징계로 이어진 경우 연결</label>
      <select className={inputCls} value={disciplineId} onChange={(e) => setDisciplineId(e.target.value)}>
        <option value="">연결 안 함</option>
        {options.map((d) => (
          <option key={d.id} value={d.id}>
            {fmtDotPlain(d.decided_on)} {DISCIPLINE_LABEL[d.kind]} — {d.reason.slice(0, 30)}
          </option>
        ))}
      </select>
      {row.reviewed_at && <p className="mt-2 text-xs text-ink-muted">마지막 검토 {ymdOf(row.reviewed_at)} · {row.reviewed_by}</p>}
      {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className={btnPrimary}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await reviewIncident({ id: row.id, reviewNote: note, disciplineId: disciplineId || null });
              if (!r.ok) return setErr(r.message);
              onDone("검토의견을 저장했습니다.");
            })
          }
        >
          검토 저장
        </button>
        <button
          type="button"
          className={btnDanger}
          disabled={pending}
          onClick={() =>
            start(async () => {
              if (!confirm("이 경위서를 삭제할까요?")) return;
              const r = await deleteIncident(row.id);
              if (!r.ok) return setErr(r.message);
              onDone("경위서를 삭제했습니다.");
            })
          }
        >
          삭제
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// 인사위원회(기록용)
// ---------------------------------------------------------------------------
function CommitteesTab({ board, employees }: { board: DisciplineBoard; employees: DisciplineEmployee[] }) {
  const router = useRouter();
  const [edit, setEdit] = useState<CommitteeRow | "new" | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-5">
      <section className={panelToneCls("navy")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className={sectionTitleCls("navy")}>인사위원회 기록</h3>
          <button type="button" className={btnPrimary} onClick={() => setEdit("new")}>
            기록 추가
          </button>
        </div>
        <p className="mt-1 text-xs text-ink-muted">기록용입니다. 출석통지·의결서 서식 같은 절차는 아직 없습니다. 징계 등록 때 여기 기록을 골라 연결할 수 있습니다.</p>
        {msg && <p className={`mt-2 ${msg.ok ? noticeSuccess : noticeError}`}>{msg.text}</p>}
        {board.committees.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-hint">기록이 없습니다.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className={tableHeadCls}>
                  <th className="px-2 py-2">개최일</th>
                  <th className="px-2 py-2">안건</th>
                  <th className="px-2 py-2">심의대상</th>
                  <th className="px-2 py-2">참석위원</th>
                  <th className="px-2 py-2">의결주문</th>
                  <th className="px-2 py-2 text-right" />
                </tr>
              </thead>
              <tbody>
                {board.committees.map((c) => (
                  <tr key={c.id} className={tableRowCls}>
                    <td className="px-2 py-2 text-xs">{fmtDotPlain(c.held_on)}</td>
                    <td className="px-2 py-2">
                      {c.agenda_type && <span className={`mr-1 ${badgeNavy}`}>{c.agenda_type}</span>}
                      {c.subject}
                    </td>
                    <td className="px-2 py-2">{c.target_name ?? "-"}</td>
                    <td className="px-2 py-2 text-xs">{c.members.join(", ") || "-"}</td>
                    <td className="px-2 py-2 text-xs">
                      {c.resolution ?? "-"}
                      {c.has_attachment && (
                        <span className="ml-2">
                          <AttachLink table="hr_committees" id={c.id} />
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <RowButtons
                        onEdit={() => setEdit(c)}
                        onDelete={() =>
                          start(async () => {
                            if (!confirm("이 인사위원회 기록을 삭제할까요? 연결된 징계의 연결도 풀립니다.")) return;
                            const r = await deleteCommittee(c.id);
                            if (r.ok) {
                              setMsg({ ok: true, text: "삭제했습니다." });
                              router.refresh();
                            } else setMsg({ ok: false, text: r.message });
                          })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pending && <p className="mt-2 text-xs text-ink-hint">처리 중…</p>}
      </section>
      {edit && (
        <CommitteeForm
          row={edit === "new" ? null : edit}
          employees={employees}
          onClose={() => setEdit(null)}
          onDone={(t) => {
            setEdit(null);
            setMsg({ ok: true, text: t });
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function CommitteeForm({
  row,
  employees,
  onClose,
  onDone,
}: {
  row: CommitteeRow | null;
  employees: DisciplineEmployee[];
  onClose: () => void;
  onDone: (t: string) => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const active = useMemo(() => employees.filter((e) => !e.resigned || e.driverId === row?.target_driver_id), [employees, row]);
  return (
    <Modal title={row ? "인사위원회 기록 수정" : "인사위원회 기록 추가"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          if (row) fd.set("id", row.id);
          setErr(null);
          start(async () => {
            const r = await saveCommittee(fd);
            if (!r.ok) return setErr(r.message);
            onDone("인사위원회 기록을 저장했습니다.");
          });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="개최일 *">
            <input type="date" name="heldOn" className={inputCls} defaultValue={row?.held_on ?? ""} />
          </Field>
          <Field label="안건유형">
            <select name="agendaType" className={inputCls} defaultValue={row?.agenda_type ?? ""}>
              <option value="">선택</option>
              {COMMITTEE_AGENDAS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </Field>
          <Field label="안건명 *" full>
            <input name="subject" className={inputCls} defaultValue={row?.subject ?? ""} />
          </Field>
          <Field label="심의대상자">
            <select name="targetDriverId" className={inputCls} defaultValue={row?.target_driver_id ?? ""}>
              <option value="">없음</option>
              {active.map((e) => (
                <option key={e.driverId} value={e.driverId}>
                  {e.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="참석위원 (쉼표·줄바꿈으로 구분)">
            <textarea name="members" className={inputCls} rows={2} defaultValue={row?.members.join(", ") ?? ""} />
          </Field>
          <Field label="의결주문" full>
            <textarea name="resolution" className={inputCls} rows={2} defaultValue={row?.resolution ?? ""} />
          </Field>
          <Field label="비고" full>
            <textarea name="note" className={inputCls} rows={2} defaultValue={row?.note ?? ""} />
          </Field>
          <Field label="첨부(PDF·JPG·PNG)" full>
            <input type="file" name="file" accept="application/pdf,image/jpeg,image/png" className="mt-1 text-xs" />
          </Field>
        </div>
        {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}
        <div className="mt-4 flex gap-2">
          <button type="submit" className={btnPrimary} disabled={pending}>
            {pending ? "저장 중…" : "저장"}
          </button>
          <button type="button" className={btnSecondary} onClick={onClose}>
            취소
          </button>
        </div>
      </form>
    </Modal>
  );
}
