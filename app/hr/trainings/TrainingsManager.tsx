"use client";

import { Fragment, useMemo, useRef, useState, useTransition } from "react";
import {
  listTrainings,
  getTrainingMatrix,
  saveTraining,
  deleteTraining,
  copyTrainingsFromYear,
  adminUploadCertificate,
  adminGetCertificateUrl,
  adminDeleteCompletion,
  runTrainingReminderNow,
  type TrainingMatrix,
  type MatrixCompletion,
} from "@/app/hr/trainings/actions";
import type { MandatoryTraining } from "@/lib/trainings";
import {
  ddayLabel,
  cellKey,
  targetStateOn,
  targetReasonLabel,
  trainingBaseYmd,
  CERT_ACCEPT,
} from "@/lib/trainings";
import { fmtKstDate } from "@/lib/datetime";
import {
  cardCls,
  btnPrimary,
  btnSecondary,
  btnDanger,
  noticeError,
  noticeSuccess,
  badgeSuccess,
  badgeNeutral,
} from "@/lib/ui";

const inCls =
  "block w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm placeholder:text-ink-hint focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const lblCls = "block text-xs font-medium text-ink-muted";

// due_date → "YYYY.MM.DD" (없으면 "-").
function fmtDue(due: string | null): string {
  if (!due) return "-";
  return due.replaceAll("-", ".");
}

type EditFields = {
  name: string;
  held_on: string;
  due_date: string;
  site_url: string;
  note: string;
  display_order: string;
  is_active: boolean;
  location: string;
  organizer: string;
  hours: string;
};

export default function TrainingsManager({
  initialYear,
  thisYear,
  years,
  trainings: initialTrainings,
  matrix: initialMatrix,
  isM0,
}: {
  initialYear: number;
  thisYear: number;
  years: number[];
  trainings: MandatoryTraining[];
  matrix: TrainingMatrix;
  isM0: boolean;
}) {
  const [year, setYear] = useState<number>(initialYear);
  const [trainings, setTrainings] =
    useState<MandatoryTraining[]>(initialTrainings);
  const [matrix, setMatrix] = useState<TrainingMatrix>(initialMatrix);
  const [loading, startLoad] = useTransition();
  const [busy, startBusy] = useTransition();

  const [msg, setMsg] = useState<
    { kind: "ok" | "err"; text: string } | null
  >(null);

  // 신규 등록 폼.
  const [addName, setAddName] = useState("");
  const [addHeld, setAddHeld] = useState("");
  const [addDue, setAddDue] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const [addNote, setAddNote] = useState("");
  // 종사자 교육 실적 반입용 — 선택 입력.
  const [addLocation, setAddLocation] = useState("");
  const [addOrganizer, setAddOrganizer] = useState("");
  const [addHours, setAddHours] = useState("");

  // 수정 중인 교육.
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditFields | null>(null);

  // 현황판 선택 셀.
  const [sel, setSel] = useState<{
    trainingId: string;
    driverId: string;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // D-7 독촉 수동 실행(M0).
  const [reminding, startRemind] = useTransition();
  function runReminderNow() {
    if (
      !confirm(
        "마감 D-7 이내 미이수자에게 슬랙 독촉 DM을 지금 보낼까요? (관리자 요약도 함께 발송)"
      )
    )
      return;
    setMsg(null);
    startRemind(async () => {
      const res = await runTrainingReminderNow();
      if (!res.ok) {
        setMsg({ kind: "err", text: res.message });
        return;
      }
      const s = res.summary;
      // 성범죄경력조회 만료(SA-14)·상조회(MU-3) 알림은 의무교육 대상이 없어도
      // 같은 Cron 에 얹혀 별도로 발송된다.
      const crimeTail =
        s.crimeCheckTargets > 0
          ? ` · 성범죄경력조회 갱신 필요 ${s.crimeCheckTargets}명 알림`
          : "";
      const mutualTail =
        (s.mutualBirthdays > 0
          ? ` · 상조회 생일 ${s.mutualBirthdays}명 알림`
          : "") + (s.mutualBonusProposed ? " · 연말상여 제안" : "");
      if (s.targetEmployees === 0) {
        setMsg({
          kind: "ok",
          text: `독촉 대상이 없습니다. (D-7 이내 미이수 없음)${crimeTail}${mutualTail}`,
        });
        return;
      }
      const tail =
        s.unreachable.length > 0
          ? ` · 미연결 ${s.unreachable.length}명(${s.unreachable.join(", ")})`
          : "";
      setMsg({
        kind: "ok",
        text: `DM ${s.dmSent}건 발송 / 미연결 ${s.dmFailed}명${tail} · 관리자 요약 발송${crimeTail}${mutualTail}`,
      });
    });
  }

  // 연도 선택지 — 기존 연도 ∪ (작년·올해·내년) ∪ 현재 선택.
  const yearOptions = useMemo(() => {
    const s = new Set<number>([
      ...years,
      thisYear - 1,
      thisYear,
      thisYear + 1,
      year,
    ]);
    return Array.from(s).sort((a, b) => b - a);
  }, [years, thisYear, year]);

  // 셀 좌표 → 이수 정보.
  const compMap = useMemo(() => {
    const m = new Map<string, MatrixCompletion>();
    for (const c of matrix.completions)
      m.set(cellKey(c.training_id, c.driver_id), c);
    return m;
  }, [matrix.completions]);

  // 셀별 대상 여부 — 판정은 서버(대시보드·D-7)와 같은 lib/trainings 함수로.
  //   대상 아닌 셀은 "미이수"로 세지 않고 표에서도 "—" 로 표시합니다.
  const targetMap = useMemo(() => {
    const m = new Map<string, ReturnType<typeof targetStateOn>>();
    for (const t of matrix.trainings) {
      const base = trainingBaseYmd(t);
      for (const e of matrix.employees)
        m.set(cellKey(t.id, e.driver_id), targetStateOn(e, base));
    }
    return m;
  }, [matrix.trainings, matrix.employees]);

  // 교육별 대상 인원 / 미이수 인원.
  const statsByTraining = useMemo(() => {
    const m = new Map<string, { target: number; notMet: number }>();
    for (const t of matrix.trainings) {
      let target = 0;
      let notMet = 0;
      for (const e of matrix.employees) {
        const key = cellKey(t.id, e.driver_id);
        if (!targetMap.get(key)?.isTarget) continue;
        target += 1;
        if (!compMap.has(key)) notMet += 1;
      }
      m.set(t.id, { target, notMet });
    }
    return m;
  }, [matrix.trainings, matrix.employees, targetMap, compMap]);

  const totalNotMet = useMemo(
    () =>
      Array.from(statsByTraining.values()).reduce((a, s) => a + s.notMet, 0),
    [statsByTraining]
  );

  // 입사일 미기재 직원 — 대상으로 유지하되 인사기록 보완이 필요합니다.
  const missingJoinDate = useMemo(
    () => matrix.employees.filter((e) => !e.joinDate).map((e) => e.name),
    [matrix.employees]
  );

  function reload(y: number) {
    setMsg(null);
    setSel(null);
    startLoad(async () => {
      const [t, m] = await Promise.all([listTrainings(y), getTrainingMatrix(y)]);
      setTrainings(t);
      setMatrix(m);
      setYear(y);
    });
  }

  function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!addName.trim()) {
      setMsg({ kind: "err", text: "교육명을 입력해주세요." });
      return;
    }
    startBusy(async () => {
      const res = await saveTraining({
        year,
        name: addName,
        held_on: addHeld || null,
        due_date: addDue || null,
        site_url: addUrl || null,
        note: addNote || null,
        display_order: null,
        is_active: true,
        location: addLocation || null,
        organizer: addOrganizer || null,
        hours: addHours || null,
      });
      if (!res.ok) {
        setMsg({ kind: "err", text: res.message });
        return;
      }
      setAddName("");
      setAddHeld("");
      setAddDue("");
      setAddUrl("");
      setAddNote("");
      setAddLocation("");
      setAddOrganizer("");
      setAddHours("");
      setMsg({ kind: "ok", text: "교육을 등록했습니다." });
      reload(year);
    });
  }

  function startEdit(t: MandatoryTraining) {
    setEditId(t.id);
    setEdit({
      name: t.name,
      held_on: t.held_on ?? "",
      due_date: t.due_date ?? "",
      site_url: t.site_url ?? "",
      note: t.note ?? "",
      display_order: String(t.display_order),
      is_active: t.is_active,
      location: t.location ?? "",
      organizer: t.organizer ?? "",
      hours: t.hours ?? "",
    });
  }

  function onSaveEdit() {
    if (!editId || !edit) return;
    if (!edit.name.trim()) {
      setMsg({ kind: "err", text: "교육명을 입력해주세요." });
      return;
    }
    startBusy(async () => {
      const res = await saveTraining({
        id: editId,
        year,
        name: edit.name,
        held_on: edit.held_on || null,
        due_date: edit.due_date || null,
        site_url: edit.site_url || null,
        note: edit.note || null,
        display_order: edit.display_order ? Number(edit.display_order) : null,
        is_active: edit.is_active,
        location: edit.location || null,
        organizer: edit.organizer || null,
        hours: edit.hours || null,
      });
      if (!res.ok) {
        setMsg({ kind: "err", text: res.message });
        return;
      }
      setEditId(null);
      setEdit(null);
      setMsg({ kind: "ok", text: "교육을 수정했습니다." });
      reload(year);
    });
  }

  function onDelete(t: MandatoryTraining) {
    if (
      !confirm(
        `"${t.name}" 교육을 삭제할까요?\n관련 이수기록·수료증도 함께 삭제됩니다.`
      )
    )
      return;
    startBusy(async () => {
      const res = await deleteTraining(t.id);
      if (!res.ok) {
        setMsg({ kind: "err", text: res.message });
        return;
      }
      setMsg({ kind: "ok", text: "교육을 삭제했습니다." });
      reload(year);
    });
  }

  function onCopyPrevYear() {
    const from = year - 1;
    if (
      !confirm(
        `${from}년 교육 목록을 ${year}년으로 복사할까요?\n(이수 기록은 복사되지 않고, 교육 목록만 추가됩니다)`
      )
    )
      return;
    startBusy(async () => {
      const res = await copyTrainingsFromYear(from, year);
      if (!res.ok) {
        setMsg({ kind: "err", text: res.message });
        return;
      }
      setMsg({ kind: "ok", text: `${res.copied}개 교육을 복사했습니다.` });
      reload(year);
    });
  }

  // --- 현황판 셀 동작 ---
  function viewCert(trainingId: string, driverId: string) {
    startBusy(async () => {
      const url = await adminGetCertificateUrl(trainingId, driverId);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      else setMsg({ kind: "err", text: "수료증을 찾을 수 없습니다." });
    });
  }

  function upsertCompletionState(next: MatrixCompletion) {
    setMatrix((m) => {
      const rest = m.completions.filter(
        (c) =>
          !(c.training_id === next.training_id && c.driver_id === next.driver_id)
      );
      return { ...m, completions: [...rest, next] };
    });
  }

  function doUpload(trainingId: string, driverId: string, file: File) {
    startBusy(async () => {
      const fd = new FormData();
      fd.set("training_id", trainingId);
      fd.set("driver_id", driverId);
      fd.set("file", file);
      const res = await adminUploadCertificate(fd);
      if (!res.ok) {
        setMsg({ kind: "err", text: res.message });
        return;
      }
      upsertCompletionState({
        training_id: trainingId,
        driver_id: driverId,
        completed_at: new Date().toISOString(),
        has_cert: true,
      });
      setMsg({ kind: "ok", text: "수료증을 등록했습니다(이수 처리)." });
    });
  }

  function onCancelCompletion(trainingId: string, driverId: string) {
    if (!confirm("이 직원의 이수(수료증)를 취소할까요?")) return;
    startBusy(async () => {
      const res = await adminDeleteCompletion(trainingId, driverId);
      if (!res.ok) {
        setMsg({ kind: "err", text: res.message });
        return;
      }
      setMatrix((m) => ({
        ...m,
        completions: m.completions.filter(
          (c) => !(c.training_id === trainingId && c.driver_id === driverId)
        ),
      }));
      setMsg({ kind: "ok", text: "이수를 취소했습니다." });
    });
  }

  const selTraining = sel
    ? matrix.trainings.find((t) => t.id === sel.trainingId) ?? null
    : null;
  const selEmployee = sel
    ? matrix.employees.find((e) => e.driver_id === sel.driverId) ?? null
    : null;
  const selComp =
    sel && compMap.get(cellKey(sel.trainingId, sel.driverId))
      ? compMap.get(cellKey(sel.trainingId, sel.driverId))!
      : null;

  return (
    <div className="space-y-4">
      {/* 연도 + 복사 */}
      <section className={cardCls}>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className={lblCls}>연도</label>
            <select
              className={`${inCls} mt-1 w-32`}
              value={year}
              disabled={loading || busy}
              onChange={(e) => reload(Number(e.target.value))}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}년
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className={btnSecondary}
            disabled={loading || busy}
            onClick={onCopyPrevYear}
          >
            {year - 1}년 목록 복사
          </button>
          {loading && (
            <span className="text-xs text-ink-hint">불러오는 중…</span>
          )}
        </div>
        <p className="mt-2 text-xs text-ink-hint">
          내년 세팅 시 “{year - 1}년 목록 복사”로 교육 목록만 가져온 뒤 기한만
          고치면 됩니다(이수 기록은 복사되지 않습니다).
        </p>
      </section>

      {msg && (
        <p className={msg.kind === "ok" ? noticeSuccess : noticeError}>
          {msg.text}
        </p>
      )}

      {/* 교육 등록/관리 */}
      <section className={cardCls}>
        <h3 className="mb-3 text-sm font-bold tracking-wide text-navy">
          교육 등록 · 관리 ({year}년)
        </h3>

        {/* 신규 등록 폼 */}
        <form
          onSubmit={onAdd}
          className="grid grid-cols-1 gap-2 rounded-lg border border-dashed border-line bg-surface p-3 sm:grid-cols-12"
        >
          <div className="sm:col-span-4">
            <label className={lblCls}>교육명 *</label>
            <input
              className={`${inCls} mt-1`}
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder="예) 성희롱 예방교육"
            />
          </div>
          <div className="sm:col-span-2">
            <label className={lblCls}>실시일</label>
            <input
              type="date"
              className={`${inCls} mt-1`}
              value={addHeld}
              onChange={(e) => setAddHeld(e.target.value)}
              title="대상자 판정 기준일. 비우면 이수기한을 기준으로 씁니다."
            />
          </div>
          <div className="sm:col-span-2">
            <label className={lblCls}>이수기한</label>
            <input
              type="date"
              className={`${inCls} mt-1`}
              value={addDue}
              onChange={(e) => setAddDue(e.target.value)}
            />
          </div>
          <div className="sm:col-span-3">
            <label className={lblCls}>교육 사이트 URL</label>
            <input
              className={`${inCls} mt-1`}
              value={addUrl}
              onChange={(e) => setAddUrl(e.target.value)}
              placeholder="https://"
            />
          </div>
          <div className="flex items-end sm:col-span-1">
            <button type="submit" className={`${btnPrimary} w-full`} disabled={busy}>
              추가
            </button>
          </div>
          <div className="sm:col-span-4">
            <label className={lblCls}>비고</label>
            <input
              className={`${inCls} mt-1`}
              value={addNote}
              onChange={(e) => setAddNote(e.target.value)}
            />
          </div>
          <p className="text-[11px] leading-5 text-ink-hint sm:col-span-12">
            <b>실시일</b>은 대상자 자동 판정 기준입니다 — 실시일에 재직 중이던
            직원만 그 교육의 대상이 됩니다(입사 전 교육은 미이수로 잡히지
            않습니다). 비워두면 <b>이수기한</b>을 기준일로 씁니다.
          </p>
          {/* 종사자 교육 실적 반입용 — 채워두면 반입 행에 자동으로 들어갑니다. */}
          <div className="sm:col-span-4">
            <label className={lblCls}>장소</label>
            <input
              className={`${inCls} mt-1`}
              value={addLocation}
              onChange={(e) => setAddLocation(e.target.value)}
              placeholder="예) 온라인"
            />
          </div>
          <div className="sm:col-span-4">
            <label className={lblCls}>주최</label>
            <input
              className={`${inCls} mt-1`}
              value={addOrganizer}
              onChange={(e) => setAddOrganizer(e.target.value)}
              placeholder="예) 여성가족부"
            />
          </div>
          <div className="sm:col-span-4">
            <label className={lblCls}>수료시간</label>
            <input
              className={`${inCls} mt-1`}
              value={addHours}
              onChange={(e) => setAddHours(e.target.value)}
              placeholder="예) 1시간"
            />
          </div>
        </form>

        {/* 교육 목록 */}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-navy">
                <th className="w-10 px-2 py-2 font-semibold">순서</th>
                <th className="px-2 py-2 font-semibold">교육명</th>
                <th className="px-2 py-2 font-semibold">실시일</th>
                <th className="px-2 py-2 font-semibold">이수기한</th>
                <th className="px-2 py-2 font-semibold">사이트</th>
                <th className="px-2 py-2 font-semibold">비고</th>
                <th className="px-2 py-2 font-semibold">상태</th>
                <th className="w-28 px-2 py-2 font-semibold">관리</th>
              </tr>
            </thead>
            <tbody>
              {trainings.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-2 py-6 text-center text-sm text-ink-hint"
                  >
                    등록된 교육이 없습니다. 위에서 교육을 추가하세요.
                  </td>
                </tr>
              )}
              {trainings.map((t) =>
                editId === t.id && edit ? (
                  <Fragment key={t.id}>
                  <tr className="border-b border-line bg-navy-soft/30">
                    <td className="px-2 py-2 align-top">
                      <input
                        className={`${inCls} w-14`}
                        value={edit.display_order}
                        onChange={(e) =>
                          setEdit({ ...edit, display_order: e.target.value })
                        }
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <input
                        className={inCls}
                        value={edit.name}
                        onChange={(e) =>
                          setEdit({ ...edit, name: e.target.value })
                        }
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <input
                        type="date"
                        className={inCls}
                        value={edit.held_on}
                        onChange={(e) =>
                          setEdit({ ...edit, held_on: e.target.value })
                        }
                        title="대상자 판정 기준일. 비우면 이수기한을 기준으로 씁니다."
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <input
                        type="date"
                        className={inCls}
                        value={edit.due_date}
                        onChange={(e) =>
                          setEdit({ ...edit, due_date: e.target.value })
                        }
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <input
                        className={inCls}
                        value={edit.site_url}
                        onChange={(e) =>
                          setEdit({ ...edit, site_url: e.target.value })
                        }
                        placeholder="https://"
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <input
                        className={inCls}
                        value={edit.note}
                        onChange={(e) =>
                          setEdit({ ...edit, note: e.target.value })
                        }
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <label className="flex items-center gap-1.5 text-xs text-ink-body">
                        <input
                          type="checkbox"
                          checked={edit.is_active}
                          onChange={(e) =>
                            setEdit({ ...edit, is_active: e.target.checked })
                          }
                        />
                        활성
                      </label>
                    </td>
                    <td className="px-2 py-2 align-top">
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          className={`${btnPrimary} h-8 px-2 text-xs`}
                          disabled={busy}
                          onClick={onSaveEdit}
                        >
                          저장
                        </button>
                        <button
                          type="button"
                          className={`${btnSecondary} h-8 px-2 text-xs`}
                          onClick={() => {
                            setEditId(null);
                            setEdit(null);
                          }}
                        >
                          취소
                        </button>
                      </div>
                    </td>
                  </tr>
                  {/* 종사자 교육 반입용 3필드 — 열이 많아 별도 행으로 둡니다. */}
                  <tr className="border-b border-line bg-navy-soft/30">
                    <td />
                    <td colSpan={7} className="px-2 pb-2">
                      <div className="grid gap-2 sm:grid-cols-3">
                        {(
                          [
                            ["location", "장소", "예) 온라인"],
                            ["organizer", "주최", "예) 여성가족부"],
                            ["hours", "수료시간", "예) 1시간"],
                          ] as const
                        ).map(([field, label, ph]) => (
                          <div key={field}>
                            <label className={lblCls}>{label}</label>
                            <input
                              className={`${inCls} mt-1`}
                              value={edit[field]}
                              placeholder={ph}
                              onChange={(e) =>
                                setEdit({ ...edit, [field]: e.target.value })
                              }
                            />
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                  </Fragment>
                ) : (
                  <tr
                    key={t.id}
                    className={`border-b border-line/70 ${
                      t.is_active ? "" : "opacity-50"
                    }`}
                  >
                    <td className="px-2 py-2 text-ink-muted">
                      {t.display_order}
                    </td>
                    <td className="px-2 py-2 font-medium text-ink-body">
                      {t.name}
                    </td>
                    <td className="px-2 py-2 text-ink-body">
                      {t.held_on ? (
                        fmtDue(t.held_on)
                      ) : (
                        <span
                          className="text-ink-hint"
                          title="실시일 미입력 — 이수기한을 대상 판정 기준일로 씁니다."
                        >
                          기한 기준
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-ink-body">
                      {fmtDue(t.due_date)}
                    </td>
                    <td className="px-2 py-2">
                      {t.site_url ? (
                        <a
                          href={t.site_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-brand-blue hover:underline"
                        >
                          링크 →
                        </a>
                      ) : (
                        <span className="text-ink-hint">-</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-ink-muted">
                      {t.note || <span className="text-ink-hint">-</span>}
                      {(t.location || t.organizer || t.hours) && (
                        <span className="mt-0.5 block text-[11px] text-ink-hint">
                          {[t.location, t.organizer, t.hours]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <span className={t.is_active ? badgeSuccess : badgeNeutral}>
                        {t.is_active ? "활성" : "비활성"}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className={`${btnSecondary} h-8 px-2 text-xs`}
                          onClick={() => startEdit(t)}
                        >
                          수정
                        </button>
                        <button
                          type="button"
                          className={`${btnDanger} h-8 px-2 text-xs`}
                          disabled={busy}
                          onClick={() => onDelete(t)}
                        >
                          삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 현황판 */}
      <section className={cardCls}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold tracking-wide text-navy">
            이수 현황판 ({year}년)
          </h3>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-ink-muted">
              재직 {matrix.employees.length}명 · 활성 교육{" "}
              {matrix.trainings.length}종 · 미이수 총{" "}
              <b className={totalNotMet > 0 ? "text-stamp" : "text-success"}>
                {totalNotMet}건
              </b>
              <span className="ml-1 text-ink-hint">(대상자 기준)</span>
            </span>
            {isM0 && (
              <button
                type="button"
                onClick={runReminderNow}
                disabled={reminding}
                className="inline-flex h-[38px] items-center justify-center gap-1.5 rounded-lg border border-transparent bg-[#800020] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#66001a] disabled:opacity-60"
                title="마감 D-7 이내 미이수자에게 슬랙 독촉 DM + 관리자 요약을 즉시 발송"
              >
                {reminding ? "발송 중…" : "지금 독촉 보내기"}
              </button>
            )}
          </div>
        </div>

        {matrix.trainings.length === 0 || matrix.employees.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-hint">
            {matrix.trainings.length === 0
              ? "활성 교육이 없습니다. 위에서 교육을 등록하세요."
              : "재직 중인 직원이 없습니다."}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="border-collapse text-xs">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 min-w-[96px] border-b border-line bg-card px-2 py-2 text-left text-navy">
                      직원
                    </th>
                    {matrix.trainings.map((t) => {
                      const overdue = t.dday != null && t.dday < 0;
                      const stat = statsByTraining.get(t.id);
                      const notMet = stat?.notMet ?? 0;
                      return (
                        <th
                          key={t.id}
                          className="min-w-[92px] border-b border-l border-line bg-card px-1.5 py-2 align-bottom"
                        >
                          <div className="flex flex-col gap-0.5">
                            <span className="line-clamp-2 font-semibold text-ink-body">
                              {t.name}
                            </span>
                            <span className="text-[10px] text-ink-hint">
                              {fmtDue(t.due_date)}
                            </span>
                            <span
                              className="text-[10px] text-ink-hint"
                              title={`대상 판정 기준일 ${trainingBaseYmd(t) ?? "없음"}`}
                            >
                              대상 {stat?.target ?? 0}명
                            </span>
                            <span
                              className={`text-[10px] font-semibold ${
                                overdue ? "text-stamp" : "text-ink-muted"
                              }`}
                            >
                              {ddayLabel(t.dday)}
                            </span>
                            <span
                              className={`text-[10px] ${
                                notMet > 0 ? "text-stamp" : "text-success"
                              }`}
                            >
                              미이수 {notMet}
                            </span>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {matrix.employees.map((emp) => (
                    <tr key={emp.driver_id}>
                      <th className="sticky left-0 z-10 border-b border-line bg-card px-2 py-1.5 text-left font-medium text-ink-body">
                        {emp.name}
                        {emp.rank && (
                          <span className="ml-1 text-[10px] text-ink-hint">
                            {emp.rank}
                          </span>
                        )}
                      </th>
                      {matrix.trainings.map((t) => {
                        const key = cellKey(t.id, emp.driver_id);
                        const done = compMap.get(key);
                        const state = targetMap.get(key);
                        const baseYmd = trainingBaseYmd(t);
                        // 대상 아님 — 입사 전·퇴사 후 교육. 미이수로 세지 않고
                        //   대리 업로드도 막습니다(대상 아닌데 이수 처리 방지).
                        //   단 이미 이수 기록이 있으면 ✓ 를 남겨 열람·취소는 되게
                        //   합니다(기존 기록이 화면에서 사라지지 않도록).
                        if (state && !state.isTarget && !done) {
                          return (
                            <td
                              key={t.id}
                              className="border-b border-l border-line/70 bg-surface/60 p-0 text-center"
                            >
                              <div
                                className="flex h-8 w-full items-center justify-center text-ink-hint"
                                title={targetReasonLabel(state.reason, baseYmd)}
                              >
                                —
                              </div>
                            </td>
                          );
                        }
                        const overdue = t.dday != null && t.dday < 0;
                        const isSel =
                          sel?.trainingId === t.id &&
                          sel?.driverId === emp.driver_id;
                        const bg = done
                          ? "bg-success-soft hover:bg-success-soft/80"
                          : overdue
                            ? "bg-stamp-soft hover:bg-stamp-soft/80"
                            : "hover:bg-surface";
                        return (
                          <td
                            key={t.id}
                            className="border-b border-l border-line/70 p-0 text-center"
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setSel({
                                  trainingId: t.id,
                                  driverId: emp.driver_id,
                                })
                              }
                              className={`h-8 w-full ${bg} ${
                                isSel ? "ring-2 ring-inset ring-navy" : ""
                              }`}
                              title={
                                done
                                  ? `이수 (${fmtKstDate(done.completed_at)})${
                                      state && !state.isTarget
                                        ? " · 대상 아님(기록 보존)"
                                        : ""
                                    }`
                                  : state && state.reason !== "target"
                                    ? targetReasonLabel(state.reason, baseYmd)
                                    : "미이수 — 클릭해 수료증 업로드"
                              }
                            >
                              {done ? (
                                <span className="font-bold text-success">✓</span>
                              ) : (
                                <span className="text-ink-hint">·</span>
                              )}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-ink-hint">
              ✓ 클릭 → 상세(수료증 열람/재업로드/취소), 빈 칸 클릭 → 대리 업로드.
              붉은 칸은 기한이 지난 미이수입니다. <b>—</b> 는 교육 실시일에 재직
              중이 아니어서 <b>대상이 아닌</b> 칸입니다(입사 전·퇴사 후 — 미이수로
              세지 않고 업로드도 막습니다).
            </p>
            {missingJoinDate.length > 0 && (
              <p className="mt-1 text-[11px] text-warning">
                입사일 미기재 {missingJoinDate.length}명(
                {missingJoinDate.join(", ")}) — 판정할 수 없어 모든 교육의 대상으로
                둡니다. 인사기록에서 입사일을 채워주세요.
              </p>
            )}
          </>
        )}

        {/* 선택 셀 상세 */}
        {sel && selTraining && selEmployee && (
          <div className="mt-3 rounded-lg border border-navy/30 bg-navy-soft/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm">
                <b className="text-ink">{selEmployee.name}</b>
                <span className="mx-1.5 text-ink-hint">·</span>
                <span className="text-ink-body">{selTraining.name}</span>
                <span className="ml-2">
                  {selComp ? (
                    <span className={badgeSuccess}>
                      이수 {fmtKstDate(selComp.completed_at)}
                    </span>
                  ) : (
                    <span className={badgeNeutral}>미이수</span>
                  )}
                </span>
              </div>
              <button
                type="button"
                className="text-xs text-ink-hint hover:underline"
                onClick={() => setSel(null)}
              >
                닫기 ✕
              </button>
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              {selComp?.has_cert && (
                <button
                  type="button"
                  className={`${btnSecondary} h-8 px-3 text-xs`}
                  disabled={busy}
                  onClick={() => viewCert(sel.trainingId, sel.driverId)}
                >
                  수료증 열람
                </button>
              )}
              <button
                type="button"
                className={`${btnPrimary} h-8 px-3 text-xs`}
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                {selComp ? "수료증 재업로드" : "수료증 대리 업로드"}
              </button>
              {selComp && (
                <button
                  type="button"
                  className={`${btnDanger} h-8 px-3 text-xs`}
                  disabled={busy}
                  onClick={() =>
                    onCancelCompletion(sel.trainingId, sel.driverId)
                  }
                >
                  이수 취소
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept={CERT_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f && sel) doUpload(sel.trainingId, sel.driverId, f);
                }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-ink-hint">
              PDF·JPG·PNG, 16MB 이하. 업로드하면 즉시 이수로 처리됩니다.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
