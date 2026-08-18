"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import {
  listBusinessCards,
  scanBusinessCard,
  saveBusinessCard,
  deleteBusinessCard,
  setCardPrivate,
  getCardImageUrl,
} from "@/app/hr/cards/actions";
import {
  CARD_ACCEPT,
  CARD_FIELD_LABELS,
  EMPTY_FIELDS,
  cardDate,
  cardSearchText,
  type BusinessCard,
  type CardFields,
} from "@/lib/businessCards";
import { compressImageFile } from "@/lib/imageCompress";
import {
  cardCls,
  btnPrimary,
  btnSecondary,
  btnDanger,
  noticeError,
  noticeSuccess,
  badgeNeutral,
  badgeWarning,
} from "@/lib/ui";

// 명함첩 — 촬영/업로드 → AI 판독 → 확인·수정 → 저장, 그리고 목록·상세·수정·삭제.
//   * 이미지는 브라우저에서 압축(긴 변 1600px·JPEG)한 뒤에만 서버로 보냅니다.
//   * AI 판독이 실패해도 폼은 그대로 열려 있어 수기로 저장할 수 있습니다.
//   * 공개/비공개(isManager): 일반 직원에게는 비공개 명함이 서버에서 걸러져 애초에
//     내려오지 않습니다(원본 이미지 서명 URL 도 발급되지 않음). 여기 isManager
//     분기는 **배지·토글을 그릴지**만 정합니다. 실제 차단은 서버 액션이 합니다.

const inCls =
  "block w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm placeholder:text-ink-hint focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const lblCls = "block text-xs font-medium text-ink-muted";

export default function CardsManager({
  initialCards,
  scanAvailable,
  isManager,
}: {
  initialCards: BusinessCard[];
  scanAvailable: boolean;
  // M0·hr 여부. 비공개 배지·전환 토글의 노출만 결정합니다(차단은 서버).
  isManager: boolean;
}) {
  const [cards, setCards] = useState<BusinessCard[]>(initialCards);
  const [query, setQuery] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );
  const [busy, startBusy] = useTransition();
  const [scanning, startScan] = useTransition();

  // 등록·수정 폼 상태.
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fields, setFields] = useState<CardFields>({ ...EMPTY_FIELDS });
  const [memo, setMemo] = useState("");
  const [preview, setPreview] = useState<string | null>(null); // 새 이미지(dataUrl)
  const [previewNote, setPreviewNote] = useState("");
  const [ocrRaw, setOcrRaw] = useState<unknown>(null);
  const [hasStoredImage, setHasStoredImage] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);

  const [detail, setDetail] = useState<BusinessCard | null>(null);

  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((c) => cardSearchText(c).includes(q));
  }, [cards, query]);

  function resetForm() {
    setEditingId(null);
    setFields({ ...EMPTY_FIELDS });
    setMemo("");
    setPreview(null);
    setPreviewNote("");
    setOcrRaw(null);
    setHasStoredImage(false);
    setIsPrivate(false);
  }

  function openNew() {
    resetForm();
    setDetail(null);
    setFormOpen(true);
    setMsg(null);
  }

  function openEdit(card: BusinessCard) {
    setEditingId(card.id);
    setFields({
      company: card.company,
      department: card.department,
      title: card.title,
      person_name: card.person_name,
      mobile: card.mobile,
      phone: card.phone,
      fax: card.fax,
      email: card.email,
      address: card.address,
      website: card.website,
    });
    setMemo(card.memo);
    setPreview(null);
    setPreviewNote("");
    setOcrRaw(null);
    setHasStoredImage(!!card.image_path);
    setIsPrivate(card.is_private);
    setDetail(null);
    setFormOpen(true);
    setMsg(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function reload() {
    const rows = await listBusinessCards();
    setCards(rows);
  }

  // 촬영/업로드 — 브라우저에서 압축한 뒤 미리보기에 담습니다.
  async function pickImage(file: File | undefined) {
    if (!file) return;
    setMsg(null);
    try {
      const out = await compressImageFile(file);
      setPreview(out.dataUrl);
      setPreviewNote(
        `${out.width}×${out.height} · ${Math.round(out.bytes / 1024)}KB (압축본)`,
      );
    } catch (e) {
      setMsg({
        kind: "err",
        text: e instanceof Error ? e.message : "이미지를 처리하지 못했습니다.",
      });
    }
  }

  function runScan() {
    if (!preview) return;
    setMsg(null);
    startScan(async () => {
      const res = await scanBusinessCard(preview);
      if (!res.ok) {
        setMsg({ kind: "err", text: res.message });
        return;
      }
      // 사용자가 이미 입력한 값은 덮어쓰지 않고, 빈 칸만 채웁니다.
      setFields((cur) => {
        const next = { ...cur };
        for (const { key } of CARD_FIELD_LABELS) {
          if (!next[key] && res.fields[key]) next[key] = res.fields[key];
        }
        return next;
      });
      setOcrRaw(res.raw);
      setMsg({
        kind: "ok",
        text: "명함을 읽었습니다. 내용을 확인·수정한 뒤 저장하세요.",
      });
    });
  }

  function save() {
    setMsg(null);
    startBusy(async () => {
      const res = await saveBusinessCard({
        id: editingId,
        ...fields,
        memo,
        imageDataUrl: preview,
        ocrRaw,
        // 관리자가 아니면 서버가 무시합니다(보내지도 않습니다).
        isPrivate: isManager ? isPrivate : undefined,
      });
      if (!res.ok) {
        setMsg({ kind: "err", text: res.message });
        return;
      }
      await reload();
      resetForm();
      setFormOpen(false);
      setMsg({ kind: "ok", text: "명함을 저장했습니다." });
    });
  }

  function remove(card: BusinessCard) {
    const who = [card.company, card.person_name].filter(Boolean).join(" · ");
    if (!confirm(`'${who}' 명함을 삭제할까요?\n원본 이미지도 함께 삭제됩니다.`))
      return;
    setMsg(null);
    startBusy(async () => {
      const res = await deleteBusinessCard(card.id);
      if (!res.ok) {
        setMsg({ kind: "err", text: res.message });
        return;
      }
      await reload();
      if (detail?.id === card.id) setDetail(null);
      if (editingId === card.id) {
        resetForm();
        setFormOpen(false);
      }
      setMsg({ kind: "ok", text: "명함을 삭제했습니다." });
    });
  }

  // 공개 ↔ 비공개 전환 — 관리자만 호출합니다(서버에서 한 번 더 검증).
  function togglePrivate(card: BusinessCard) {
    const who = [card.company, card.person_name].filter(Boolean).join(" · ");
    const next = !card.is_private;
    if (
      next &&
      !confirm(
        `'${who}' 명함을 비공개로 전환할까요?\n` +
          "관장·부장·인사 담당자에게만 보이게 되고, 원본 이미지도 함께 가려집니다.",
      )
    )
      return;
    setMsg(null);
    startBusy(async () => {
      const res = await setCardPrivate(card.id, next);
      if (!res.ok) {
        setMsg({ kind: "err", text: res.message });
        return;
      }
      await reload();
      if (detail?.id === card.id) {
        setDetail({ ...detail, is_private: next });
      }
      setMsg({
        kind: "ok",
        text: next
          ? "비공개로 전환했습니다. 이제 관리자에게만 보입니다."
          : "공개로 전환했습니다. 전 직원이 볼 수 있습니다.",
      });
    });
  }

  function viewImage(card: BusinessCard) {
    startBusy(async () => {
      const url = await getCardImageUrl(card.id);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      else setMsg({ kind: "err", text: "저장된 원본 이미지가 없습니다." });
    });
  }

  return (
    <div className="space-y-4">
      {/* 검색 + 등록 */}
      <section className={cardCls}>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={`${inCls} max-w-xs flex-1`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="업체·이름·연락처 검색"
          />
          <span className="text-xs text-ink-muted">
            {filtered.length} / {cards.length}건
          </span>
          <div className="ml-auto">
            <button type="button" className={btnPrimary} onClick={openNew}>
              + 명함 등록
            </button>
          </div>
        </div>
      </section>

      {msg && (
        <p className={msg.kind === "ok" ? noticeSuccess : noticeError}>
          {msg.text}
        </p>
      )}

      {/* 등록 · 수정 폼 */}
      {formOpen && (
        <section className={cardCls}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold tracking-wide text-navy">
              {editingId ? "명함 수정" : "명함 등록"}
            </h3>
            <button
              type="button"
              className="text-xs text-ink-hint hover:underline"
              onClick={() => {
                resetForm();
                setFormOpen(false);
              }}
            >
              닫기 ✕
            </button>
          </div>

          {/* 1) 사진 */}
          <div className="mt-3 rounded-lg border border-dashed border-line bg-surface p-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={btnSecondary}
                onClick={() => cameraRef.current?.click()}
              >
                📷 사진 촬영
              </button>
              <button
                type="button"
                className={btnSecondary}
                onClick={() => fileRef.current?.click()}
              >
                🖼️ 파일 선택
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={!preview || scanning || !scanAvailable}
                onClick={runScan}
                title={
                  scanAvailable
                    ? "명함 사진을 AI 로 읽어 아래 칸을 채웁니다"
                    : "AI 판독이 설정되지 않았습니다(수기 입력은 가능)"
                }
              >
                {scanning ? "읽는 중…" : "🤖 AI로 읽기"}
              </button>
              {previewNote && (
                <span className="text-[11px] text-ink-hint">{previewNote}</span>
              )}
            </div>
            <input
              ref={cameraRef}
              type="file"
              accept={CARD_ACCEPT}
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                void pickImage(f);
              }}
            />
            <input
              ref={fileRef}
              type="file"
              accept={CARD_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                void pickImage(f);
              }}
            />
            {preview && (
              // 미리보기는 dataURL 이라 next/image 최적화 대상이 아닙니다.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt="명함 미리보기"
                className="mt-3 max-h-56 rounded-lg border border-line object-contain"
              />
            )}
            {!preview && hasStoredImage && (
              <p className="mt-2 text-[11px] text-ink-hint">
                기존에 저장된 원본 이미지가 있습니다. 새로 촬영·선택하면 교체됩니다.
              </p>
            )}
            {!scanAvailable && (
              <p className="mt-2 text-[11px] text-warning">
                AI 판독 키(ANTHROPIC_API_KEY)가 설정되지 않아 자동 읽기는 쓸 수
                없습니다. 아래 칸에 직접 입력해 저장하세요.
              </p>
            )}
          </div>

          {/* 2) 항목 */}
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {CARD_FIELD_LABELS.map(({ key, label }) => (
              <div key={key} className={key === "address" ? "sm:col-span-2" : ""}>
                <label className={lblCls} htmlFor={`card-${key}`}>
                  {label}
                </label>
                <input
                  id={`card-${key}`}
                  className={`${inCls} mt-1`}
                  value={fields[key]}
                  onChange={(e) =>
                    setFields({ ...fields, [key]: e.target.value })
                  }
                />
              </div>
            ))}
            <div className="sm:col-span-2">
              <label className={lblCls} htmlFor="card-memo">
                메모
              </label>
              <textarea
                id="card-memo"
                className={`${inCls} mt-1`}
                rows={2}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="만난 자리·용건 등"
              />
            </div>
            {/* 비공개 지정은 관리자만 — 일반 직원 화면엔 이 줄 자체가 없습니다. */}
            {isManager && (
              <label className="flex items-center gap-1.5 text-xs text-ink-muted sm:col-span-2">
                <input
                  type="checkbox"
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                />
                🔒 비공개 (관장·부장·인사 담당자에게만 보임 — 원본 이미지도 가려짐)
              </label>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={btnPrimary}
              disabled={busy}
              onClick={save}
            >
              {editingId ? "수정 저장" : "저장"}
            </button>
            <button
              type="button"
              className={btnSecondary}
              onClick={() => {
                resetForm();
                setFormOpen(false);
              }}
            >
              취소
            </button>
          </div>
        </section>
      )}

      {/* 상세 */}
      {detail && (
        <section className={cardCls}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="flex flex-wrap items-center gap-2 text-sm font-bold text-ink">
                {detail.company || "(업체 없음)"}
                {isManager && detail.is_private && (
                  <span className={badgeWarning}>🔒 비공개</span>
                )}
              </h3>
              <p className="mt-0.5 text-sm text-ink-body">
                {[detail.person_name, detail.title, detail.department]
                  .filter(Boolean)
                  .join(" · ") || "-"}
              </p>
            </div>
            <button
              type="button"
              className="text-xs text-ink-hint hover:underline"
              onClick={() => setDetail(null)}
            >
              닫기 ✕
            </button>
          </div>

          <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
            {CARD_FIELD_LABELS.map(({ key, label }) => (
              <div key={key} className="flex gap-2">
                <dt className="w-20 shrink-0 text-xs text-ink-muted">{label}</dt>
                <dd className="text-ink-body">
                  {detail[key] || <span className="text-ink-hint">-</span>}
                </dd>
              </div>
            ))}
            {detail.memo && (
              <div className="flex gap-2 sm:col-span-2">
                <dt className="w-20 shrink-0 text-xs text-ink-muted">메모</dt>
                <dd className="whitespace-pre-wrap text-ink-body">
                  {detail.memo}
                </dd>
              </div>
            )}
          </dl>

          <p className="mt-3 text-[11px] text-ink-hint">
            등록 {cardDate(detail.created_at)}
            {detail.registered_by ? ` · ${detail.registered_by}` : ""}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {detail.image_path && (
              <button
                type="button"
                className={`${btnSecondary} h-8 px-3 text-xs`}
                disabled={busy}
                onClick={() => viewImage(detail)}
              >
                원본 이미지 보기
              </button>
            )}
            <button
              type="button"
              className={`${btnSecondary} h-8 px-3 text-xs`}
              onClick={() => openEdit(detail)}
            >
              수정
            </button>
            {/* 공개↔비공개 전환은 관리자에게만 보입니다. */}
            {isManager && (
              <button
                type="button"
                className={`${btnSecondary} h-8 px-3 text-xs`}
                disabled={busy}
                onClick={() => togglePrivate(detail)}
                title={
                  detail.is_private
                    ? "전 직원이 볼 수 있게 바꿉니다"
                    : "관장·부장·인사 담당자에게만 보이게 바꿉니다"
                }
              >
                {detail.is_private ? "🔓 공개로 전환" : "🔒 비공개로 전환"}
              </button>
            )}
            <button
              type="button"
              className={`${btnDanger} h-8 px-3 text-xs`}
              disabled={busy}
              onClick={() => remove(detail)}
            >
              삭제
            </button>
          </div>
        </section>
      )}

      {/* 목록 */}
      <section className={cardCls}>
        <h3 className="mb-3 text-sm font-bold tracking-wide text-navy">
          명함 목록
        </h3>
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-hint">
            {cards.length === 0
              ? "등록된 명함이 없습니다. 위에서 명함을 등록하세요."
              : "검색 결과가 없습니다."}
          </p>
        ) : (
          <ul className="space-y-2">
            {filtered.map((card) => (
              <li
                key={card.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3 text-sm"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setDetail(card)}
                >
                  <strong className="text-ink">
                    {card.company || "(업체 없음)"}
                  </strong>
                  {card.image_path && (
                    <span className={`${badgeNeutral} ml-2`}>사진</span>
                  )}
                  {isManager && card.is_private && (
                    <span className={`${badgeWarning} ml-2`}>🔒 비공개</span>
                  )}
                  <p className="mt-0.5 truncate text-ink-muted">
                    {[card.person_name, card.title].filter(Boolean).join(" ") ||
                      "-"}
                    {card.mobile || card.phone
                      ? ` · ${card.mobile || card.phone}`
                      : ""}
                    {` · 등록 ${cardDate(card.created_at)}`}
                  </p>
                </button>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    className={`${btnSecondary} h-8 px-3 text-xs`}
                    onClick={() => openEdit(card)}
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    className={`${btnDanger} h-8 px-3 text-xs`}
                    disabled={busy}
                    onClick={() => remove(card)}
                  >
                    삭제
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
