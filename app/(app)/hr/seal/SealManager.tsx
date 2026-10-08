"use client";

import { useRef, useState, useTransition } from "react";
import { uploadOrgSeal } from "@/app/(app)/hr/seal/actions";
import { btnPrimary, cardCls, noticeError, noticeSuccess } from "@/lib/ui";

// 기관 직인 등록·교체 — 개인 도장 이미지 업로드(MyEmployeeProfileForm)와 같은 흐름.
export default function SealManager({ initialUrl }: { initialUrl: string | null }) {
  const [sealUrl, setSealUrl] = useState<string | null>(initialUrl);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function upload(file: File) {
    setErr(null);
    setDone(false);
    // 클라이언트 1차 검증(서버에서도 재검증).
    if (file.type !== "image/png" && file.type !== "image/jpeg") {
      setErr("직인 이미지는 PNG·JPG 만 가능합니다. (배경이 투명한 PNG 권장)");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setErr("직인 이미지 용량은 8MB 이하여야 합니다.");
      return;
    }
    start(async () => {
      const fd = new FormData();
      fd.set("seal_file", file);
      const res = await uploadOrgSeal(fd);
      if (res.ok) {
        setSealUrl(res.sealUrl);
        setDone(true);
      } else setErr(res.message);
    });
  }

  return (
    <section className={cardCls}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {/* 체크무늬 배경 — 투명 PNG 인지 눈으로 확인할 수 있게 */}
        <div
          className="flex h-40 w-40 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line"
          style={{
            backgroundColor: "#fff",
            backgroundImage:
              "linear-gradient(45deg,#e5e5e5 25%,transparent 25%),linear-gradient(-45deg,#e5e5e5 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e5e5e5 75%),linear-gradient(-45deg,transparent 75%,#e5e5e5 75%)",
            backgroundSize: "16px 16px",
            backgroundPosition: "0 0,0 8px,8px -8px,-8px 0",
          }}
        >
          {sealUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sealUrl} alt="기관 직인" className="h-full w-full object-contain p-2" />
          ) : (
            <span className="rounded bg-white px-2 py-1 text-xs text-ink-hint">직인 없음</span>
          )}
        </div>

        <div className="flex flex-col items-start gap-2">
          <p className="text-sm font-bold text-ink">
            기관 직인 {sealUrl ? <span className="text-success">· 등록됨</span> : <span className="text-stamp">· 미등록</span>}
          </p>
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-ink-muted">
            <li>
              <b>배경이 투명한 PNG</b>가 가장 좋습니다. 흰 배경 JPG 는 글자 위에 겹칠 때 흰 네모가 보입니다.
            </li>
            <li>직인만 꽉 차게 잘라서 올려주세요(여백이 크면 작게 찍힙니다). PNG·JPG · 8MB 이하.</li>
            <li>왼쪽 미리보기의 체크무늬가 직인 둘레에 보이면 투명 PNG 입니다.</li>
          </ul>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.target.value = ""; // 같은 파일 재선택 허용
            }}
          />
          <button
            type="button"
            className={btnPrimary}
            disabled={pending}
            onClick={() => {
              setErr(null);
              fileRef.current?.click();
            }}
          >
            {pending ? "올리는 중…" : sealUrl ? "직인 이미지 교체" : "직인 이미지 올리기"}
          </button>
          {done && <p className={noticeSuccess}>직인을 저장했습니다. 이후 발급·서명부터 새 직인이 찍힙니다.</p>}
          {err && <p className={noticeError}>{err}</p>}
        </div>
      </div>
    </section>
  );
}
