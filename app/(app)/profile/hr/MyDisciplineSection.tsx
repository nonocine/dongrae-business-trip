"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  submitMyAward,
  submitMyIncidentReport,
  type MyDisciplineReceipts,
} from "@/app/(app)/profile/hr/disciplineActions";
import { AWARD_KINDS } from "@/lib/hrDiscipline";
import {
  panelToneCls,
  sectionTitleCls,
  inputCls,
  labelCls,
  btnPrimary,
  btnSecondary,
  noticeError,
  noticeSuccess,
  noticeWarning,
} from "@/lib/ui";

// =====================================================================
// 마이페이지 '포상·경위서' — 본인은 등록·제출만 합니다.
//   · 포상: 내가 받은 상을 기록. 등록 뒤 수정·삭제는 관장·부장이 합니다.
//   · 경위서: 제출하면 본인도 내용을 다시 볼 수 없습니다(관장 지시). "제출함" 날짜만.
//   · 징계는 이 화면에 없습니다(본인에게 조회 경로 자체가 없음).
// =====================================================================

type Msg = { ok: boolean; text: string } | null;
const ymdOf = (iso: string) => new Date(Date.parse(iso) + 9 * 3600 * 1000).toISOString().slice(0, 10);

export default function MyDisciplineSection({ data }: { data: MyDisciplineReceipts }) {
  return (
    <div className="space-y-5" id="discipline">
      <IncidentPanel data={data} />
      <AwardPanel data={data} />
    </div>
  );
}

function AwardPanel({ data }: { data: MyDisciplineReceipts }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  return (
    <section className={panelToneCls("green")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={sectionTitleCls("green")}>포상 등록</h3>
        {!open && (
          <button type="button" className={btnSecondary} onClick={() => setOpen(true)}>
            포상 등록
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        받은 상을 직접 기록합니다. 등록한 내용의 열람·수정은 관장·부장이 합니다. 이 화면에는 등록한 날짜와 포상명만 남습니다.
      </p>
      {open && (
        <form
          ref={formRef}
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            setMsg(null);
            start(async () => {
              const res = await submitMyAward(fd);
              if (!res.ok) return setMsg({ ok: false, text: res.message });
              formRef.current?.reset();
              setOpen(false);
              setMsg({ ok: true, text: "포상을 등록했습니다." });
              router.refresh();
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>포상일 *</label>
              <input type="date" name="awardedOn" className={inputCls} required />
            </div>
            <div>
              <label className={labelCls}>종류</label>
              <select name="awardKind" className={inputCls} defaultValue="">
                <option value="">선택</option>
                {AWARD_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>포상명 *</label>
              <input name="title" className={inputCls} required placeholder="예: 청소년육성 유공 표창" />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>수여기관</label>
              <input name="awardingBody" className={inputCls} placeholder="예: 동래구청장" />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>공적 요약</label>
              <textarea name="meritSummary" className={inputCls} rows={3} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>증빙 첨부(PDF·JPG·PNG, 16MB 이하)</label>
              <input type="file" name="file" accept="application/pdf,image/jpeg,image/png" className="mt-1 text-xs" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className={btnPrimary} disabled={pending}>
              {pending ? "등록 중…" : "등록"}
            </button>
            <button type="button" className={btnSecondary} onClick={() => setOpen(false)}>
              취소
            </button>
          </div>
        </form>
      )}
      {msg && <p className={`mt-3 ${msg.ok ? noticeSuccess : noticeError}`}>{msg.text}</p>}
      {data.awards.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm" data-testid="my-award-receipts">
          {data.awards.map((a, i) => (
            <li key={i} className="text-ink-body">
              {ymdOf(a.created_at)} 등록함 — {a.title} <span className="text-xs text-ink-muted">({a.awarded_on})</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function IncidentPanel({ data }: { data: MyDisciplineReceipts }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(!!data.request);
  const [confirmed, setConfirmed] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  return (
    <section className={panelToneCls(data.request ? "red" : "navy")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={sectionTitleCls(data.request ? "red" : "navy")}>경위서</h3>
        {!open && (
          <button type="button" className={btnSecondary} onClick={() => setOpen(true)}>
            경위서 작성
          </button>
        )}
      </div>
      {data.request && (
        <p className={`mt-2 ${noticeWarning}`} data-testid="incident-request">
          경위서 제출 요청이 있습니다({ymdOf(data.request.at)}). 아래에서 작성해 제출해주세요.
        </p>
      )}
      <p className="mt-1 text-xs text-ink-muted">
        제출한 경위서는 관장·부장만 봅니다. <b>제출 후에는 본인도 내용을 다시 볼 수 없습니다</b> — 필요하면 제출 전에 따로 보관하세요.
      </p>
      {open && (
        <form
          ref={formRef}
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!confirmed) {
              setMsg({ ok: false, text: "제출 후 내용을 다시 볼 수 없다는 확인란에 체크해주세요." });
              return;
            }
            if (!window.confirm("경위서를 제출할까요? 제출하면 본인도 내용을 다시 볼 수 없습니다.")) return;
            const fd = new FormData(e.currentTarget);
            fd.set("confirmed", "1");
            setMsg(null);
            start(async () => {
              const res = await submitMyIncidentReport(fd);
              if (!res.ok) return setMsg({ ok: false, text: res.message });
              formRef.current?.reset();
              setConfirmed(false);
              setOpen(false);
              setMsg({ ok: true, text: `${ymdOf(res.submittedAt)} 제출했습니다.` });
              router.refresh();
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>사건일</label>
              <input type="date" name="occurredOn" className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>제목 *</label>
              <input name="subject" className={inputCls} required data-testid="incident-subject" />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>내용 *</label>
              <textarea name="content" className={inputCls} rows={8} required data-testid="incident-content" />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>첨부(PDF·JPG·PNG, 16MB 이하)</label>
              <input type="file" name="file" accept="application/pdf,image/jpeg,image/png" className="mt-1 text-xs" />
            </div>
          </div>
          <label className="flex items-start gap-2 text-sm text-ink-body">
            <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} data-testid="incident-confirm" />
            제출 후에는 본인도 내용을 다시 볼 수 없다는 것을 확인했습니다.
          </label>
          <div className="flex gap-2">
            <button type="submit" className={btnPrimary} disabled={pending || !confirmed}>
              {pending ? "제출 중…" : "제출"}
            </button>
            <button type="button" className={btnSecondary} onClick={() => setOpen(false)}>
              취소
            </button>
          </div>
        </form>
      )}
      {msg && <p className={`mt-3 ${msg.ok ? noticeSuccess : noticeError}`}>{msg.text}</p>}
      {data.reports.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm" data-testid="my-incident-receipts">
          {data.reports.map((r, i) => (
            <li key={i} className="text-ink-body">
              {ymdOf(r.submitted_at)} 제출함
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
