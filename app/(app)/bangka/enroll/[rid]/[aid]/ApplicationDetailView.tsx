"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  acceptApplication,
  confirmFile,
  requestFileFix,
  requestSectionFix,
  revealSensitive,
  saveStaffMemo,
  setApplicationStatus,
  setFamilyCheck,
  setRrnChecked,
  type ApplicationDetail,
  type FileRow,
  type RecruitmentRow,
} from "@/app/(app)/bangka/enroll/actions";
import {
  allergySymptomsText,
  APP_STATUS_BADGE,
  FILE_STATUS_BADGE,
  FILE_STATUS_LABEL,
} from "@/app/(app)/bangka/enroll/badges";
import {
  APP_STATUS_LABEL,
  CONSENTS,
  DOC_KINDS,
  FAMILY_CHECK_TYPES,
  FIX_ITEM_LABEL,
  GUARDIAN_RELATION_LABEL,
  PLEDGE_ITEMS,
  docKindLabel,
  docKindsFor,
  fixItemLabel,
  priorityLabel,
  recommendReasonLabel,
  returnMethodLabel,
  type AllergyInfo,
} from "@/lib/bangkaEnroll";
import { BK_ALLERGENS } from "@/lib/bangkaMenuParse";
import { BK_CLASS_CODES, BK_CLASS_LABEL, formatBkPhone } from "@/lib/bangka";
import { fmtKstDate, fmtKstDateTime } from "@/lib/datetime";
import {
  badgeDanger,
  badgeNeutral,
  badgeSuccess,
  badgeWarning,
  blockCls,
  btnDanger,
  btnPrimary,
  btnSecondary,
  inputCls,
  labelCls,
  linkCls,
  noticeError,
  noticeSuccess,
  noticeWarning,
  panelToneCls,
  sectionTitleCls,
  tableHeadCls,
  tableRowCls,
} from "@/lib/ui";

// =====================================================================
// 신청서 상세(직원)
//   · 서류는 종류별로 묶어 파일마다 [확인]·[보완요청]. [확인]은 '주민번호 뒷자리 가림 확인' 표시 뒤에만.
//   · 민감 서류(장애 증빙)·알레르기 상세는 [민감정보 보기]를 눌러야 서버가 내려줌(누를 때마다 기록).
//   · 파일·사진·서명은 서버 라우트가 5분 서명 URL 로 넘겨줌(열 때마다 기록).
// =====================================================================

const ACTION_LABEL: Record<string, string> = {
  view_file: "파일 열람",
  download_file: "파일 다운로드",
  view_sensitive: "민감정보 열람",
  status_change: "상태 변경",
  file_check: "서류 확인",
  family_check: "가족관계 확인",
  fix_request: "보완요청",
  accept: "합격 처리",
  export: "엑셀 내보내기",
  purge: "보관기간 삭제",
  submit: "제출",
  resubmit: "다시 제출",
};
const ROLE_LABEL: Record<string, string> = { guardian: "보호자", youth: "청소년", recommender: "추천자" };
const CONSENT_LABEL: Record<string, string> = {
  guardian_pledge: "보호자 동의서(5개 항목)",
  youth_signature: "청소년 서명",
  recommender_privacy: "추천자 개인정보",
  ...Object.fromEntries(CONSENTS.map((c) => [c.key, c.title])),
};
const ACTOR_LABEL: Record<string, string> = { staff: "직원", guardian: "보호자", recommender: "추천자", system: "자동" };

const SENSITIVE_KEYS = DOC_KINDS.filter((d) => d.sensitive).map((d) => d.key);

function fileSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(n / 1024))}KB`;
}
const yn = (v: boolean | null | undefined) => (v == null ? "-" : v ? "예" : "아니오");

type Res = { ok: true } | { ok: false; message: string };

export default function ApplicationDetailView({
  app,
  recruitment,
  todayYmd,
}: {
  app: ApplicationDetail;
  recruitment: RecruitmentRow;
  todayYmd: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [sensitive, setSensitive] = useState<{ allergy: AllergyInfo | null; files: FileRow[] } | null>(null);
  const [memo, setMemo] = useState(app.staff_memo ?? "");
  const [fixItems, setFixItems] = useState<string[]>([]);
  const [fixReason, setFixReason] = useState("");
  const [fixSms, setFixSms] = useState(true);
  const [classCode, setClassCode] = useState<string>("");
  const [enrolledOn, setEnrolledOn] = useState(todayYmd);

  const d = app.data;
  const y = d.youth;
  const stops = recruitment.shuttle_stops;
  const stop = d.ret.stop_seq != null ? stops.find((s) => s.seq === d.ret.stop_seq) : null;
  const purged = !!app.purged_at;
  const media = (kind: string, q = "") => `/bangka/enroll/media/${app.id}/${kind}${q}`;

  function run<T extends Res>(fn: () => Promise<T>, after?: (r: Extract<T, { ok: true }>) => void) {
    setErr(null);
    setInfo(null);
    setWarn(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setErr((r as { message: string }).message);
        return;
      }
      after?.(r as Extract<T, { ok: true }>);
      router.refresh();
    });
  }

  // 민감 서류는 화면 상태로만 들고 있으므로 처리 결과를 여기서 바로 고칩니다(다시 불러오면 열람 기록이 또 남음).
  function patchSensitiveFile(fid: string, patch: Partial<FileRow>) {
    setSensitive((s) => (s ? { ...s, files: s.files.map((f) => (f.id === fid ? { ...f, ...patch } : f)) } : s));
  }

  // 종류별 묶음 — 고른 유형의 서류 칸 + 파일이 있는 칸.
  const kinds = [
    ...new Set([
      ...docKindsFor(d.priority).map((k) => k.key),
      ...app.files.map((f) => f.doc_kind),
      ...app.sensitiveKindsWithFiles,
    ]),
  ];

  const canDecide = ["submitted", "docs_ok", "waitlisted"].includes(app.status);
  const canFix = ["submitted", "needs_fix", "docs_ok"].includes(app.status);
  const canDocsOk = app.status === "submitted" && app.allFilesConfirmed && !app.anyFileNeedsFix;
  // 가족관계증명서로 확인할 유형(고른 것만) — [서류확인] 조건은 아니고 옆에 경고로만.
  const familyTypes = FAMILY_CHECK_TYPES.filter((t) => d.priority.includes(t.key));
  const familyUnchecked = familyTypes.filter((t) => !app.familyChecks[t.key]?.checked);

  return (
    <div className="space-y-4">
      {/* 머리 */}
      <section className={panelToneCls("blue")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex gap-4">
            {app.has_photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={media("photo")} alt="청소년 사진" className="h-28 w-24 rounded-lg border border-rule object-cover" />
            ) : (
              <div className="flex h-28 w-24 items-center justify-center rounded-lg border border-rule text-xs text-ink-hint">
                {purged ? "삭제됨" : "사진 없음"}
              </div>
            )}
            <div>
              <p className="text-xs text-ink-muted">접수번호 {app.app_no ?? "(아직 없음)"}</p>
              <h3 className="text-xl font-bold text-ink">
                {y.name || "(이름 없음)"}{" "}
                <span className={APP_STATUS_BADGE[app.status]}>{APP_STATUS_LABEL[app.status]}</span>
              </h3>
              <p className="mt-0.5 text-sm text-ink-body">
                {[y.school, y.grade, y.class_no && `${y.class_no.replace(/반\s*$/, "")}반`].filter(Boolean).join(" ")}
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                제출 {app.submitted_at ? fmtKstDateTime(app.submitted_at) : "-"}
                {app.resubmitted_at && ` · 다시 제출 ${fmtKstDateTime(app.resubmitted_at)}`}
                {app.decided_at && ` · 결정 ${fmtKstDateTime(app.decided_at)}(${app.decided_by ?? ""})`}
              </p>
              {app.has_photo && (
                <a href={media("photo", "?download=1")} className={`text-xs ${linkCls}`}>
                  사진 내려받기
                </a>
              )}
            </div>
          </div>
          <div className="text-right text-xs text-ink-muted">
            <p>보관기한 {app.retention_until ? fmtKstDate(app.retention_until) : "아직 정해지지 않음"}</p>
            {purged && <p className="text-stamp">보관기간이 지나 {fmtKstDate(app.purged_at)}에 서류를 삭제했습니다.</p>}
            {app.student_id && (
              <p className="mt-1">
                <a href="/bangka/members" className={linkCls}>
                  학생 명단에 등록됨 →
                </a>
              </p>
            )}
          </div>
        </div>
        {app.status === "needs_fix" && (
          <div className={`mt-3 ${noticeWarning}`}>
            보완요청 중({app.fix_requested_at ? fmtKstDateTime(app.fix_requested_at) : ""} {app.fix_requested_by ?? ""}):{" "}
            {app.fix_items.map(fixItemLabel).join(", ")} — 사유: {app.fix_reason}
          </div>
        )}
        {err && <p className={`mt-3 ${noticeError}`}>{err}</p>}
        {warn && <p className={`mt-3 ${noticeWarning}`}>{warn}</p>}
        {info && <p className={`mt-3 ${noticeSuccess}`}>{info}</p>}
      </section>

      {/* 입력 내용 */}
      <section className={panelToneCls("navy")}>
        <h3 className={sectionTitleCls("navy")}>신청 내용</h3>
        <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className={blockCls}>
            <p className="mb-2 text-sm font-semibold text-ink">청소년</p>
            <dl className="grid grid-cols-[7rem_1fr] gap-y-1 text-sm">
              <Dt>이름</Dt><Dd>{y.name}</Dd>
              <Dt>성별</Dt><Dd>{y.gender === "M" ? "남" : y.gender === "F" ? "여" : "-"}</Dd>
              <Dt>생년월일</Dt><Dd>{y.birth || "-"}</Dd>
              <Dt>주소</Dt><Dd>{[y.zip && `(${y.zip})`, y.addr1, y.addr2].filter(Boolean).join(" ") || "-"}</Dd>
              <Dt>전화</Dt><Dd>{y.tel || "-"}</Dd>
              <Dt>휴대전화</Dt><Dd>{y.mobile || "-"}</Dd>
              <Dt>이메일</Dt><Dd>{y.email || "-"}</Dd>
              <Dt>학교·학년·반</Dt><Dd>{[y.school, y.grade, y.class_no].filter(Boolean).join(" / ") || "-"}</Dd>
              <Dt>담임</Dt><Dd>{y.teacher || "-"}</Dd>
              <Dt>신청 동기</Dt><Dd><span className="whitespace-pre-wrap">{y.motive || "-"}</span></Dd>
            </dl>
          </div>
          <div className="space-y-4">
            <div className={blockCls}>
              <p className="mb-2 text-sm font-semibold text-ink">보호자</p>
              <dl className="grid grid-cols-[7rem_1fr] gap-y-1 text-sm">
                <Dt>성명</Dt><Dd>{d.guardian.name || "-"}</Dd>
                <Dt>관계</Dt><Dd>{GUARDIAN_RELATION_LABEL[d.guardian.relation] ?? "-"}</Dd>
                <Dt>휴대전화(인증)</Dt><Dd>{formatBkPhone(app.guardian_phone)}</Dd>
                <Dt>이메일</Dt><Dd>{d.guardian.email || "-"}</Dd>
              </dl>
            </div>
            <div className={blockCls}>
              <p className="mb-2 text-sm font-semibold text-ink">우선지원 유형</p>
              <p className="text-sm">{d.priority.length ? d.priority.map(priorityLabel).join(", ") : "-"}</p>
            </div>
            <div className={blockCls}>
              <p className="mb-2 text-sm font-semibold text-ink">귀가·알레르기</p>
              <dl className="grid grid-cols-[7rem_1fr] gap-y-1 text-sm">
                <Dt>귀가 방법</Dt>
                <Dd>
                  {returnMethodLabel(d.ret.method) || "-"}
                  {d.ret.method === "other" && d.ret.other ? ` (${d.ret.other})` : ""}
                </Dd>
                {d.ret.method === "shuttle" && (
                  <>
                    <Dt>하차 장소</Dt>
                    <Dd>{stop ? `${stop.seq}. ${stop.time ? `${stop.time} ` : ""}${stop.place}` : d.ret.stop_seq != null ? `${d.ret.stop_seq}번(회차에 없음)` : "-"}</Dd>
                  </>
                )}
                <Dt>식품 알레르기</Dt>
                <Dd>{yn(app.has_allergy)} {app.has_allergy && <span className="text-xs text-ink-hint">(상세는 [민감정보 보기])</span>}</Dd>
              </dl>
            </div>
          </div>
        </div>

        <div className={`mt-4 ${blockCls}`}>
          <p className="mb-2 text-sm font-semibold text-ink">동의</p>
          <ul className="space-y-0.5 text-sm">
            <li>
              보호자 동의서 5개 항목: {d.consent.pledge.every(Boolean) ? "모두 동의" : `${d.consent.pledge.filter(Boolean).length}/${PLEDGE_ITEMS.length} 동의`}
            </li>
            {CONSENTS.map((c) => (
              <li key={c.key}>
                {c.title}:{" "}
                <span className={d.consent.answers[c.key] ? "text-success" : d.consent.answers[c.key] === false ? "text-stamp" : "text-ink-hint"}>
                  {d.consent.answers[c.key] == null ? "응답 없음" : d.consent.answers[c.key] ? "예" : "아니오"}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Signature label="보호자 서명" has={app.has_guardian_signature} src={media("guardian_signature")} />
          <Signature label="청소년 서명" has={app.has_youth_signature} src={media("youth_signature")} />
        </div>
      </section>

      {/* 민감정보 */}
      <section className={panelToneCls("red")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className={sectionTitleCls("red")}>민감정보(알레르기 상세·장애 증빙)</h3>
          {!sensitive && (
            <button
              type="button"
              className={btnSecondary}
              disabled={pending}
              onClick={() => run(() => revealSensitive(app.id), (r) => setSensitive({ allergy: r.allergy, files: r.files }))}
            >
              민감정보 보기
            </button>
          )}
          {sensitive && (
            <button type="button" className={btnSecondary} onClick={() => setSensitive(null)}>
              가리기
            </button>
          )}
        </div>
        {!sensitive ? (
          <p className="mt-2 text-sm text-ink-muted">
            누를 때마다 열람 기록이 남습니다. {app.sensitiveFileCount > 0 && `민감 서류 ${app.sensitiveFileCount}장. `}
            {!app.has_sensitive && "저장된 알레르기 상세가 없습니다(보관기간 삭제 또는 미입력)."}
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            <AllergyBlock a={sensitive.allergy} />
          </div>
        )}
      </section>

      {/* 가족관계증명서로 확인 */}
      {familyTypes.length > 0 && (
        <section className={panelToneCls("yellow")}>
          <h3 className={sectionTitleCls("yellow")}>가족관계증명서로 확인</h3>
          <p className="mt-1 text-xs text-ink-muted">따로 증빙 서류가 없는 유형입니다. 가족관계증명서(또는 주민등록등본)를 보고 맞으면 표시하세요.</p>
          <ul className="mt-2 space-y-1.5">
            {familyTypes.map((t) => {
              const c = app.familyChecks[t.key];
              return (
                <li key={t.key} className="flex flex-wrap items-center gap-2 text-sm">
                  <label className="inline-flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={!!c?.checked}
                      disabled={pending}
                      onChange={(e) => run(() => setFamilyCheck({ aid: app.id, type: t.key, checked: e.target.checked }))}
                    />
                    {t.label} — 가족관계증명서로 확인
                  </label>
                  {c && (
                    <span className="text-xs text-ink-hint">
                      {c.checked ? "확인" : "해제"} {c.by ?? ""} {fmtKstDateTime(c.at)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* 서류 */}
      <section className={panelToneCls("yellow")}>
        <h3 className={sectionTitleCls("yellow")}>증빙 서류</h3>
        <p className="mt-1 text-xs text-ink-muted">
          주민번호 뒷자리가 가려졌는지 보고 표시한 뒤 [확인]하세요. 모든 서류를 확인하면 [서류확인]으로 바꿀 수 있습니다.
        </p>
        <div className="mt-3 space-y-3">
          {kinds.map((k) => {
            const isSensitive = SENSITIVE_KEYS.includes(k);
            const def = DOC_KINDS.find((x) => x.key === k);
            const files = isSensitive ? sensitive?.files.filter((f) => f.doc_kind === k) ?? null : app.files.filter((f) => f.doc_kind === k);
            return (
              <div key={k} className={blockCls}>
                <p className="text-sm font-semibold text-ink">
                  {docKindLabel(k)}
                  {!def ? (
                    <span className="ml-1 text-xs font-normal text-ink-hint">(지금 양식에 없는 서류 칸: {k})</span>
                  ) : def.required ? (
                    ""
                  ) : (
                    <span className="ml-1 text-xs font-normal text-ink-hint">(선택)</span>
                  )}
                  {isSensitive && <span className={`ml-2 ${badgeDanger}`}>민감</span>}
                </p>
                {files == null ? (
                  <p className="mt-1 text-sm text-ink-muted">[민감정보 보기]를 눌러야 보입니다.</p>
                ) : files.length === 0 ? (
                  <p className="mt-1 text-sm text-ink-hint">올린 파일 없음</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {files.map((f) => (
                      <FileItem
                        key={f.id}
                        f={f}
                        disabled={pending}
                        canFix={canFix}
                        onRrn={(checked) =>
                          run(() => setRrnChecked({ fid: f.id, checked }), () => {
                            if (isSensitive) patchSensitiveFile(f.id, { rrn_masked_checked: checked });
                          })
                        }
                        onConfirm={() =>
                          run(() => confirmFile(f.id), () => {
                            if (isSensitive) patchSensitiveFile(f.id, { status: "confirmed", fix_reason: null });
                          })
                        }
                        onFix={(reason, sms) =>
                          run(() => requestFileFix({ fid: f.id, reason, sendSms: sms }), (r) => {
                            if (isSensitive) patchSensitiveFile(f.id, { status: "needs_fix", fix_reason: reason });
                            if (r.smsError) setWarn(r.smsError);
                            else setInfo(sms ? "보완요청을 저장하고 보호자에게 문자를 보냈습니다." : "보완요청을 저장했습니다.");
                          })
                        }
                      />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* 추천서 */}
      {(d.priority.includes("recommended") || app.recommendations.length > 0) && (
        <section className={panelToneCls("navy")}>
          <h3 className={sectionTitleCls("navy")}>추천서</h3>
          {app.recommendations.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">추천자가 지정되지 않았습니다.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {app.recommendations.map((r) => (
                <div key={r.id} className={blockCls}>
                  <p className="text-sm">
                    <b>{r.recommender_name}</b> {formatBkPhone(r.recommender_phone)}{" "}
                    <span
                      className={
                        r.state === "submitted" ? badgeSuccess : r.state === "pending" ? badgeNeutral : badgeWarning
                      }
                    >
                      {r.state === "submitted" ? "제출" : r.state === "pending" ? "미제출" : r.state === "expired" ? "만료" : "취소됨"}
                    </span>
                    <span className="ml-2 text-xs text-ink-hint">
                      요청 {fmtKstDateTime(r.created_at)} · 기한 {fmtKstDateTime(r.expires_at)}
                    </span>
                  </p>
                  {r.state === "submitted" && (
                    <dl className="mt-2 grid grid-cols-[7rem_1fr] gap-y-1 text-sm sm:grid-cols-[13rem_1fr]">
                      <Dt>소속·직위</Dt><Dd>{[r.org, r.position].filter(Boolean).join(" / ") || "-"}</Dd>
                      <Dt>작성자</Dt><Dd>{[r.writer_name, r.writer_phone && formatBkPhone(r.writer_phone)].filter(Boolean).join(" ") || "-"}</Dd>
                      <Dt>추천 사유</Dt><Dd>{r.reasons.map(recommendReasonLabel).join(", ") || "-"}</Dd>
                      {(r.reasons.includes("other") || r.opinion) && (
                        <>
                          <Dt>기타 사유</Dt><Dd><span className="whitespace-pre-wrap">{r.opinion || "-"}</span></Dd>
                        </>
                      )}
                      <Dt>특이사항(추천사유 구체적 작성)</Dt><Dd><span className="whitespace-pre-wrap">{r.notes || "-"}</span></Dd>
                      <Dt>제출</Dt><Dd>{fmtKstDateTime(r.submitted_at)}</Dd>
                      <Dt>서명</Dt>
                      <Dd>
                        {r.has_signature ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={media("recommendation", `?rec=${r.id}`)} alt="추천자 서명" className="h-20 rounded border border-rule bg-white" />
                        ) : (
                          "-"
                        )}
                      </Dd>
                    </dl>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 보완요청(항목) */}
      {canFix && (
        <section className={panelToneCls("yellow")}>
          <h3 className={sectionTitleCls("yellow")}>항목 보완요청</h3>
          <p className="mt-1 text-xs text-ink-muted">고른 항목만 보호자에게 다시 열립니다. 서류 한 장만 고칠 때는 위 서류의 [보완요청]을 쓰세요.</p>
          <div className="mt-2 flex flex-wrap gap-3">
            {Object.keys(FIX_ITEM_LABEL).map((k) => (
              <label key={k} className="inline-flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={fixItems.includes(k)}
                  onChange={(e) => setFixItems(e.target.checked ? [...fixItems, k] : fixItems.filter((x) => x !== k))}
                />
                {FIX_ITEM_LABEL[k]}
              </label>
            ))}
          </div>
          <label className="mt-3 block">
            <span className={labelCls}>사유(문자에 그대로 들어갑니다)</span>
            <input className={inputCls} value={fixReason} maxLength={300} onChange={(e) => setFixReason(e.target.value)} />
          </label>
          <label className="mt-2 inline-flex items-center gap-1 text-sm">
            <input type="checkbox" checked={fixSms} onChange={(e) => setFixSms(e.target.checked)} />
            보호자에게 문자 보내기
          </label>
          <div className="mt-3">
            <button
              type="button"
              className={btnPrimary}
              disabled={pending || fixItems.length === 0 || !fixReason.trim()}
              onClick={() =>
                run(() => requestSectionFix({ aid: app.id, items: fixItems, reason: fixReason, sendSms: fixSms }), (r) => {
                  setFixItems([]);
                  setFixReason("");
                  if (r.smsError) setWarn(r.smsError);
                  else setInfo(fixSms ? "보완요청을 저장하고 보호자에게 문자를 보냈습니다." : "보완요청을 저장했습니다.");
                })
              }
            >
              보완요청 보내기
            </button>
          </div>
        </section>
      )}

      {/* 결정 */}
      <section className={panelToneCls("green")}>
        <h3 className={sectionTitleCls("green")}>결정</h3>
        {app.status === "accepted" ? (
          <p className="mt-2 text-sm text-ink-body">합격 처리되었습니다. 학생·보호자는 학생·보호자 관리에서 관리합니다.</p>
        ) : app.status === "rejected" ? (
          <p className="mt-2 text-sm text-ink-body">불합격으로 결정되었습니다.</p>
        ) : app.status === "draft" ? (
          <p className="mt-2 text-sm text-ink-muted">보호자가 아직 제출하지 않았습니다.</p>
        ) : null}
        <div className="mt-3 flex flex-wrap items-end gap-2">
          {app.status === "submitted" && (
            <button
              type="button"
              className={btnSecondary}
              disabled={pending || !canDocsOk}
              title={canDocsOk ? "" : "모든 서류를 [확인]해야 합니다"}
              onClick={() => run(() => setApplicationStatus({ aid: app.id, to: "docs_ok" }))}
            >
              서류확인
            </button>
          )}
          {app.status === "submitted" && familyUnchecked.length > 0 && (
            <span className="text-xs text-warning">
              가족관계증명서 확인 안 함: {familyUnchecked.map((t) => t.label).join(", ")}
            </span>
          )}
          {["submitted", "docs_ok"].includes(app.status) && (
            <button
              type="button"
              className={btnSecondary}
              disabled={pending}
              onClick={() => {
                if (confirm("대기로 결정할까요?")) run(() => setApplicationStatus({ aid: app.id, to: "waitlisted" }));
              }}
            >
              대기
            </button>
          )}
          {canDecide && (
            <button
              type="button"
              className={btnDanger}
              disabled={pending}
              onClick={() => {
                if (confirm("불합격으로 결정할까요?")) run(() => setApplicationStatus({ aid: app.id, to: "rejected" }));
              }}
            >
              불합격
            </button>
          )}
        </div>
        {canDecide && (
          <div className={`mt-4 ${blockCls}`}>
            <p className="text-sm font-semibold text-ink">합격 처리</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              학생 명단에 등록하고, 보호자 번호로 동래방카 계정을 찾아 연결합니다(없으면 새로 만들고 가입 초대 문자).
            </p>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <label>
                <span className={labelCls}>반</span>
                <select className={inputCls} value={classCode} onChange={(e) => setClassCode(e.target.value)}>
                  <option value="">고르세요</option>
                  {BK_CLASS_CODES.map((c) => (
                    <option key={c} value={c}>
                      {BK_CLASS_LABEL[c]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className={labelCls}>입소일</span>
                <input type="date" className={inputCls} value={enrolledOn} onChange={(e) => setEnrolledOn(e.target.value)} />
              </label>
              <button
                type="button"
                className={btnPrimary}
                disabled={pending || !classCode}
                onClick={() => {
                  if (!confirm(`${y.name}을(를) ${BK_CLASS_LABEL[classCode as "ieum"]}에 합격 처리할까요? 보호자에게 문자가 갑니다.`)) return;
                  run(() => acceptApplication({ aid: app.id, classCode, enrolledOn }), (r) => {
                    if (r.smsError) setWarn(`${r.smsError}${r.inviteUrl ? ` · 가입 링크: ${r.inviteUrl}` : ""}`);
                    else setInfo(r.newGuardian ? "합격 처리하고 보호자에게 가입 초대 문자를 보냈습니다." : "합격 처리하고 기존 보호자 계정에 연결했습니다(문자 보냄).");
                  });
                }}
              >
                합격
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 직원 메모 */}
      <section className={panelToneCls("navy")}>
        <h3 className={sectionTitleCls("navy")}>직원 메모</h3>
        <textarea className={`${inputCls} min-h-[80px]`} value={memo} maxLength={2000} onChange={(e) => setMemo(e.target.value)} />
        <div className="mt-2">
          <button
            type="button"
            className={btnSecondary}
            disabled={pending || memo === (app.staff_memo ?? "")}
            onClick={() => run(() => saveStaffMemo({ aid: app.id, memo }), () => setInfo("메모를 저장했습니다."))}
          >
            메모 저장
          </button>
        </div>
      </section>

      {/* 동의 기록 */}
      <section className={panelToneCls("navy")}>
        <h3 className={sectionTitleCls("navy")}>동의 기록</h3>
        {app.consents.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">기록 없음(제출할 때 남습니다).</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead>
                <tr className={tableHeadCls}>
                  <th className="py-1.5 pr-2">시각</th>
                  <th className="py-1.5 pr-2">누가</th>
                  <th className="py-1.5 pr-2">항목</th>
                  <th className="py-1.5 pr-2">동의</th>
                  <th className="py-1.5">버전</th>
                </tr>
              </thead>
              <tbody>
                {app.consents.map((c) => (
                  <tr key={c.id} className={tableRowCls}>
                    <td className="py-1.5 pr-2 text-xs">{fmtKstDateTime(c.agreed_at)}</td>
                    <td className="py-1.5 pr-2 text-xs">
                      {ROLE_LABEL[c.person_role] ?? c.person_role} {c.person_name ?? ""}
                      {c.phone_last4 ? ` (…${c.phone_last4})` : ""}
                    </td>
                    <td className="py-1.5 pr-2">{CONSENT_LABEL[c.consent_key] ?? c.consent_key}</td>
                    <td className="py-1.5 pr-2">
                      <span className={c.agreed ? badgeSuccess : badgeDanger}>{c.agreed ? "동의" : "동의 안 함"}</span>
                    </td>
                    <td className="py-1.5 text-xs">{c.doc_version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 열람 기록 */}
      <section className={panelToneCls("navy")}>
        <h3 className={sectionTitleCls("navy")}>열람·변경 기록(최근 50건)</h3>
        {app.logs.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">기록 없음</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead>
                <tr className={tableHeadCls}>
                  <th className="py-1.5 pr-2">시각</th>
                  <th className="py-1.5 pr-2">누가</th>
                  <th className="py-1.5 pr-2">무엇을</th>
                  <th className="py-1.5">내용</th>
                </tr>
              </thead>
              <tbody>
                {app.logs.map((l) => (
                  <tr key={l.id} className={tableRowCls}>
                    <td className="py-1.5 pr-2 text-xs">{fmtKstDateTime(l.created_at)}</td>
                    <td className="py-1.5 pr-2 text-xs">
                      {ACTOR_LABEL[l.actor_type] ?? l.actor_type} {l.actor_name ?? ""}
                    </td>
                    <td className="py-1.5 pr-2">{ACTION_LABEL[l.action] ?? l.action}</td>
                    <td className="py-1.5 text-xs text-ink-muted">{logDetail(l.action, l.target, l.detail)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function logDetail(action: string, target: string | null, detail: Record<string, unknown> | null): string {
  const dt = detail ?? {};
  if (action === "status_change") {
    const from = APP_STATUS_LABEL[dt.from as keyof typeof APP_STATUS_LABEL] ?? String(dt.from ?? "");
    const to = APP_STATUS_LABEL[dt.to as keyof typeof APP_STATUS_LABEL] ?? String(dt.to ?? "");
    return `${from} → ${to}`;
  }
  if (action === "fix_request") {
    const items = Array.isArray(dt.items) ? (dt.items as string[]).map(fixItemLabel).join(", ") : target ?? "";
    return `${items} — ${String(dt.reason ?? "")}`;
  }
  if (action === "view_file" || action === "download_file" || action === "file_check")
    return [dt.doc_kind ? docKindLabel(String(dt.doc_kind)) : dt.kind ? docKindLabel(String(dt.kind)) : "", dt.to ? `→ ${FILE_STATUS_LABEL[String(dt.to)] ?? dt.to}` : "", dt.rrn_masked_checked != null ? `주민번호 가림 ${dt.rrn_masked_checked ? "확인" : "해제"}` : ""]
      .filter(Boolean)
      .join(" ");
  if (action === "accept") return `${dt.new_guardian ? "새 보호자" : "기존 보호자 연결"} · ${BK_CLASS_LABEL[dt.class_code as "ieum"] ?? ""}`;
  if (action === "family_check")
    return `${FAMILY_CHECK_TYPES.find((t) => t.key === target)?.label ?? target ?? ""} ${dt.checked ? "확인" : "해제"}`;
  if (action === "export") return dt.sensitive ? "민감정보 포함" : "민감정보 제외";
  return target ?? "";
}

function Dt({ children }: { children: React.ReactNode }) {
  return <dt className="text-ink-muted">{children}</dt>;
}
function Dd({ children }: { children: React.ReactNode }) {
  return <dd className="text-ink-body">{children}</dd>;
}

function Signature({ label, has, src }: { label: string; has: boolean; src: string }) {
  return (
    <div className={blockCls}>
      <p className="mb-1 text-sm font-semibold text-ink">{label}</p>
      {has ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={label} className="h-24 rounded border border-rule bg-white" />
      ) : (
        <p className="text-sm text-ink-hint">없음</p>
      )}
    </div>
  );
}

function AllergyBlock({ a }: { a: AllergyInfo | null }) {
  if (!a) return <p className="text-sm text-ink-muted">저장된 알레르기 상세가 없습니다.</p>;
  return (
    <div className={blockCls}>
      <p className="mb-2 text-sm font-semibold text-ink">식품 알레르기</p>
      <dl className="grid grid-cols-[9rem_1fr] gap-y-1 text-sm">
        <Dt>있음</Dt><Dd>{yn(a.has)}</Dd>
        {a.has && (
          <>
            <Dt>원인 식품</Dt>
            <Dd>{[...a.foods.map((n) => `${n}.${BK_ALLERGENS[n] ?? ""}`), a.other].filter(Boolean).join(", ") || "-"}</Dd>
            <Dt>증상</Dt><Dd>{allergySymptomsText(a) || "-"}</Dd>
            <Dt>진료 받고 있음</Dt><Dd>{yn(a.treated)}</Dd>
            <Dt>스스로 구분</Dt><Dd>{yn(a.self_aware)}</Dd>
          </>
        )}
      </dl>
    </div>
  );
}

function FileItem({
  f,
  disabled,
  canFix,
  onRrn,
  onConfirm,
  onFix,
}: {
  f: FileRow;
  disabled: boolean;
  canFix: boolean;
  onRrn: (checked: boolean) => void;
  onConfirm: () => void;
  onFix: (reason: string, sms: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [sms, setSms] = useState(true);
  const href = `/bangka/enroll/file/${f.id}`;
  if (f.purged_at)
    return (
      <li className="text-sm text-ink-hint">
        {f.name ?? "파일"} — 보관기간이 지나 {fmtKstDate(f.purged_at)}에 삭제됨
      </li>
    );
  return (
    <li className="rounded-md border border-rule/70 p-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="min-w-0 break-all">{f.name ?? "파일"}</span>
        <span className="text-xs text-ink-hint">
          {fileSize(f.size)} · {fmtKstDateTime(f.uploaded_at)}
        </span>
        <span className={FILE_STATUS_BADGE[f.status] ?? badgeNeutral}>{FILE_STATUS_LABEL[f.status] ?? f.status}</span>
        <a href={href} target="_blank" rel="noopener noreferrer" className={linkCls}>
          보기
        </a>
        <a href={`${href}?download=1`} className={linkCls}>
          내려받기
        </a>
      </div>
      {f.status === "needs_fix" && f.fix_reason && <p className="mt-1 text-xs text-warning">보완 사유: {f.fix_reason}</p>}
      {f.checked_by && <p className="mt-0.5 text-xs text-ink-hint">확인 {f.checked_by} {fmtKstDateTime(f.checked_at)}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-1 text-sm">
          <input type="checkbox" checked={f.rrn_masked_checked} disabled={disabled} onChange={(e) => onRrn(e.target.checked)} />
          주민번호 뒷자리 가림 확인
        </label>
        <button
          type="button"
          className={btnSecondary}
          disabled={disabled || !f.rrn_masked_checked || f.status === "confirmed"}
          title={f.rrn_masked_checked ? "" : "주민번호 뒷자리 가림 확인을 먼저 표시하세요"}
          onClick={onConfirm}
        >
          확인
        </button>
        {canFix && (
          <button type="button" className={btnSecondary} disabled={disabled} onClick={() => setOpen((v) => !v)}>
            보완요청
          </button>
        )}
      </div>
      {open && canFix && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1">
            <span className={labelCls}>보완 사유(문자에 그대로 들어갑니다)</span>
            <input className={inputCls} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="예: 주민번호 뒷자리가 가려지지 않았습니다" />
          </label>
          <label className="inline-flex items-center gap-1 text-sm">
            <input type="checkbox" checked={sms} onChange={(e) => setSms(e.target.checked)} />
            문자 보내기
          </label>
          <button
            type="button"
            className={btnPrimary}
            disabled={disabled || !reason.trim()}
            onClick={() => {
              onFix(reason.trim(), sms);
              setOpen(false);
              setReason("");
            }}
          >
            보완요청 보내기
          </button>
        </div>
      )}
    </li>
  );
}
