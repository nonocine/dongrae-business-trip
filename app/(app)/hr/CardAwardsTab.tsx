"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  listCardAwards,
  saveCardAward,
  deleteCardAward,
  getCardAwardAttachmentUrl,
  type CardAward,
  type CardAwardPerms,
} from "@/app/(app)/hr/awardActions";
import { AWARD_KINDS, AWARD_SOURCE_LABEL, fmtDotPlain, type AwardSource } from "@/lib/hrDiscipline";
import { blockCls, btnPrimary, btnSecondary, badgeNavy, badgeSuccess, inputCls, labelCls, noticeError, noticeSuccess } from "@/lib/ui";

// =====================================================================
// 인사기록카드 '수상·포상' 탭 — 관리자 카드·내 카드 공용(hr_awards).
//   외부 수상과 센터 포상을 구역으로 나눠 연도순으로 보여 줍니다.
//   무엇을 받는지는 서버(awardActions.listCardAwards)가 보는 사람에 따라 정합니다.
//   ⚠️ 관리자 카드에서는 이 탭이 인사기록카드 <form> 안에 있습니다. 편집 폼은 포털 모달로
//     띄워 폼이 겹치지 않게 하고, 제출 이벤트가 바깥 폼으로 번지지 않게 막습니다.
// =====================================================================

type Msg = { ok: boolean; text: string } | null;

export default function CardAwardsTab({ driverId }: { driverId: string }) {
  const [data, setData] = useState<{ awards: CardAward[]; perms: CardAwardPerms } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [edit, setEdit] = useState<CardAward | "new" | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    listCardAwards(driverId).then((r) => {
      if (!alive) return;
      if (r.ok) setData({ awards: r.awards, perms: r.perms });
      else setErr(r.message);
    });
    return () => {
      alive = false;
    };
  }, [driverId, reload]);

  if (err) return <p className={noticeError}>{err}</p>;
  if (!data) return <p className="py-4 text-sm text-ink-hint">불러오는 중…</p>;
  const { awards, perms } = data;
  const external = awards.filter((a) => a.award_source === "external");
  const internal = awards.filter((a) => a.award_source === "internal");
  const canAdd = perms.canEditExternal || perms.canAddInternal;

  function remove(a: CardAward) {
    if (!confirm(`'${a.title}' 기록을 삭제할까요?`)) return;
    start(async () => {
      const r = await deleteCardAward(a.id);
      if (!r.ok) return setMsg({ ok: false, text: r.message });
      setMsg({ ok: true, text: "삭제했습니다." });
      setReload((k) => k + 1);
    });
  }

  return (
    <div className="space-y-4" data-testid="card-awards">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">
          외부 수상은 본인 경력으로 본인·인사 담당이 함께 관리합니다. 센터 포상(운영규정 30조)은 인사고과 반영 대상이라
          관장·부장이 관리하고, 본인에게는 포상명·포상일만 보입니다.
        </p>
        {canAdd && !edit && (
          <button type="button" className={btnSecondary} onClick={() => setEdit("new")}>
            + 수상·포상 추가
          </button>
        )}
      </div>
      {perms.locked && <p className="text-xs text-ink-muted">🔒 인사기록카드가 잠겨 있어 외부 수상을 고칠 수 없습니다.</p>}
      {msg && <p className={msg.ok ? noticeSuccess : noticeError}>{msg.text}</p>}

      {edit && (
        <AwardEditor
          driverId={driverId}
          row={edit === "new" ? null : edit}
          perms={perms}
          onClose={() => setEdit(null)}
          onSaved={(text) => {
            setEdit(null);
            setMsg({ ok: true, text });
            setReload((k) => k + 1);
          }}
        />
      )}

      <Group
        title="외부 수상"
        badge={badgeNavy}
        rows={external}
        empty="외부 수상 기록이 없습니다."
        canEdit={perms.canEditExternal}
        pending={pending}
        onEdit={setEdit}
        onDelete={remove}
      />
      <Group
        title="센터 포상 (운영규정 30조)"
        badge={badgeSuccess}
        rows={internal}
        empty="센터 포상 기록이 없습니다."
        canEdit={perms.canEditInternal}
        pending={pending}
        onEdit={setEdit}
        onDelete={remove}
      />
    </div>
  );
}

function Group({
  title,
  badge,
  rows,
  empty,
  canEdit,
  pending,
  onEdit,
  onDelete,
}: {
  title: string;
  badge: string;
  rows: CardAward[];
  empty: string;
  canEdit: boolean;
  pending: boolean;
  onEdit: (a: CardAward) => void;
  onDelete: (a: CardAward) => void;
}) {
  return (
    <section className={blockCls}>
      <p className="text-sm font-bold text-ink">
        {title} <span className="text-xs font-normal text-ink-muted">({rows.length})</span>
      </p>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-ink-hint">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-rule">
          {rows.map((a) => (
            <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 py-2" data-testid="card-award-row">
              <div className="min-w-0">
                <p className="text-sm text-ink">
                  <span className="mr-1 text-xs text-ink-muted">{fmtDotPlain(a.awarded_on)}</span>
                  <span className={badge}>{AWARD_SOURCE_LABEL[a.award_source]}</span>{" "}
                  <span className="font-medium">{a.title}</span>
                  {a.award_kind && <span className="ml-1 text-xs text-ink-muted">· {a.award_kind}</span>}
                </p>
                {a.limited ? (
                  <p className="text-xs text-ink-hint">세부 내용은 관장·부장이 관리합니다.</p>
                ) : (
                  <>
                    {a.awarding_body && <p className="text-xs text-ink-muted">{a.awarding_body}</p>}
                    {a.merit_summary && <p className="whitespace-pre-wrap text-xs text-ink-muted">{a.merit_summary}</p>}
                    {a.has_attachment && <AttachLink id={a.id} />}
                  </>
                )}
              </div>
              {canEdit && !a.limited && (
                <div className="flex shrink-0 gap-1">
                  <button type="button" className="rounded-md border border-line bg-card px-2 py-1 text-xs hover:bg-surface" onClick={() => onEdit(a)} disabled={pending}>
                    수정
                  </button>
                  <button type="button" className="rounded-md border border-stamp bg-card px-2 py-1 text-xs text-stamp hover:bg-stamp-soft" onClick={() => onDelete(a)} disabled={pending}>
                    삭제
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AttachLink({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className="text-xs text-navy underline-offset-2 hover:underline"
      onClick={() =>
        start(async () => {
          const r = await getCardAwardAttachmentUrl(id);
          if (r.ok) window.open(r.url, "_blank", "noopener");
          else alert(r.message);
        })
      }
    >
      증빙 보기
    </button>
  );
}

function AwardEditor({
  driverId,
  row,
  perms,
  onClose,
  onSaved,
}: {
  driverId: string;
  row: CardAward | null;
  perms: CardAwardPerms;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  // 기본값은 외부 수상. 고를 수 있는 출처는 권한에 따릅니다.
  const canExternal = perms.canEditExternal;
  const canInternal = row ? perms.canEditInternal : perms.canAddInternal;
  const [source, setSource] = useState<AwardSource>(row?.award_source ?? (canExternal ? "external" : "internal"));
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="수상·포상" className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
    <form
      className="max-h-[92vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-xl bg-card p-4 shadow-lg"
      data-testid="card-award-form"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const fd = new FormData(e.currentTarget);
        fd.set("driverId", driverId);
        fd.set("source", source);
        if (row) fd.set("id", row.id);
        setErr(null);
        start(async () => {
          const r = await saveCardAward(fd);
          if (!r.ok) return setErr(r.message);
          onSaved(row ? "수정했습니다." : "추가했습니다.");
        });
      }}
    >
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="출처">
        {(["external", "internal"] as const).map((src) => {
          const enabled = src === "external" ? canExternal : canInternal;
          return (
            <label key={src} className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm ${source === src ? "border-navy bg-navy-soft" : "border-line"} ${enabled ? "" : "opacity-50"}`}>
              <input type="radio" name="sourcePick" checked={source === src} disabled={!enabled} onChange={() => setSource(src)} />
              {src === "external" ? "외부 수상" : "센터 포상"}
            </label>
          );
        })}
      </div>
      {source === "internal" && !perms.canEditInternal && (
        <p className="text-xs text-warning">센터 포상은 등록 후 관장·부장이 관리합니다. 본인 화면에는 포상명·포상일만 남습니다.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls}>{source === "internal" ? "포상일 *" : "수상일 *"}</label>
          <input type="date" name="awardedOn" className={inputCls} defaultValue={row?.awarded_on ?? ""} required />
        </div>
        {source === "internal" ? (
          <div>
            <label className={labelCls}>포상 종류(운영규정 30조)</label>
            <select name="awardKind" className={inputCls} defaultValue={row?.award_kind ?? ""}>
              <option value="">선택</option>
              {AWARD_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div />
        )}
        <div className="sm:col-span-2">
          <label className={labelCls}>{source === "internal" ? "포상명 *" : "수상명 *"}</label>
          <input name="title" className={inputCls} defaultValue={row?.title ?? ""} required />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>수여기관</label>
          <input
            name="awardingBody"
            className={inputCls}
            defaultValue={row?.awarding_body ?? (source === "internal" ? "동래구청소년센터" : "")}
            placeholder={source === "internal" ? "동래구청소년센터" : "예: 부산광역시"}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>공적 요약·비고</label>
          <textarea name="meritSummary" className={inputCls} rows={2} defaultValue={row?.merit_summary ?? ""} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>증빙(PDF·JPG·PNG, 16MB 이하)</label>
          <input type="file" name="file" accept="application/pdf,image/jpeg,image/png" className="mt-1 text-xs" />
        </div>
      </div>
      {err && <p className={noticeError}>{err}</p>}
      <div className="flex gap-2">
        <button type="submit" className={btnPrimary} disabled={pending} data-testid="card-award-save">
          {pending ? "저장 중…" : "저장"}
        </button>
        <button type="button" className={btnSecondary} onClick={onClose}>
          취소
        </button>
      </div>
    </form>
    </div>,
    document.body
  );
}
