"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createRentalLink,
  deleteRentalLink,
  updateRentalLink,
  type RentalProgramOption,
} from "./actions";
import type { RentalLink } from "@/lib/businessRentalSync";
import {
  badgeNeutral,
  badgeSuccess,
  btnPrimary,
  noticeError,
  noticeSuccess,
} from "@/lib/ui";

// 사업 한 건의 "홈페이지 대관 연결" — 사업 등록 관리(관리자) 안에서 펼쳐집니다.
//   연결된 대관 프로그램의 확정 예약을 매일 새벽 이 사업의 월 실적으로 채웁니다
//   (lib/businessRentalSync). 대관 프로그램명은 오타 방지를 위해 최근 6개월
//   예약 목록에서만 고릅니다.
const inCls =
  "block w-full rounded-md border border-line bg-card px-2.5 py-1.5 text-sm text-ink-body shadow-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";
const rowBtn =
  "rounded border border-line px-2 py-1 text-xs text-ink-muted hover:bg-surface disabled:opacity-50";

const COUNT_MODE_LABELS = {
  date: "일자별(운영일 = 횟수)",
  session: "회차별(예약 1건 = 1회)",
};
const AUDIENCE_LABELS = { youth: "청소년", other: "기타" };

function thisMonth() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 7);
}

export default function RentalLinkPanel({
  programId,
  links,
  options,
  optionsError,
}: {
  programId: string;
  links: RentalLink[];
  options: RentalProgramOption[] | null; // null = 불러오는 중
  optionsError: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [name, setName] = useState("");
  const [space, setSpace] = useState("");
  const [countMode, setCountMode] = useState<"date" | "session">("date");
  const [audience, setAudience] = useState<"youth" | "other">("youth");
  const [startMonth, setStartMonth] = useState(thisMonth());

  const spaces = options?.find((o) => o.name === name)?.spaces ?? [];

  function run(
    task: () => Promise<{ ok: boolean; message?: string }>,
    okText: string,
    after?: () => void,
  ) {
    setMsg(null);
    start(async () => {
      const res = await task();
      if (!res.ok) {
        setMsg({ ok: false, text: res.message ?? "처리하지 못했습니다." });
        return;
      }
      after?.();
      setMsg({ ok: true, text: okText });
      router.refresh();
    });
  }

  return (
    <div className="mt-1 mb-2 ml-10 rounded-lg border border-dashed border-line bg-surface p-3">
      <p className="text-[11px] font-semibold text-navy">홈페이지 대관 연결</p>
      <p className="mt-0.5 text-xs text-ink-muted">
        연결한 대관 프로그램의 확정 예약이 매일 새벽 이 사업의 월 실적으로
        채워집니다 (시작 월부터). 담당자가 고친 값과 제출된 실적은 덮지
        않습니다.
      </p>
      {msg && (
        <p className={`mt-2 ${msg.ok ? noticeSuccess : noticeError}`}>
          {msg.text}
        </p>
      )}

      {links.length > 0 ? (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead className="text-left text-ink-muted">
              <tr>
                <th className="py-1 pr-2 font-semibold">대관 프로그램명</th>
                <th className="py-1 pr-2 font-semibold">공간</th>
                <th className="py-1 pr-2 font-semibold">집계 방식</th>
                <th className="py-1 pr-2 font-semibold">인원 기본 구분</th>
                <th className="py-1 pr-2 font-semibold">시작 월</th>
                <th className="py-1 pr-2 font-semibold">사용</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {links.map((l) => (
                <tr key={l.id} className="border-t border-line/60">
                  <td className="py-1.5 pr-2 text-ink-body">
                    {l.rental_program_name}
                  </td>
                  <td className="py-1.5 pr-2 text-ink-body">
                    {l.rental_space_name || "전체"}
                  </td>
                  <td className="py-1.5 pr-2 text-ink-body">
                    {COUNT_MODE_LABELS[l.count_mode]}
                  </td>
                  <td className="py-1.5 pr-2 text-ink-body">
                    {AUDIENCE_LABELS[l.default_audience]}
                  </td>
                  <td className="py-1.5 pr-2 text-ink-body">
                    {l.start_month.slice(0, 7)}
                  </td>
                  <td className="py-1.5 pr-2">
                    <span className={l.is_active ? badgeSuccess : badgeNeutral}>
                      {l.is_active ? "사용" : "중지"}
                    </span>
                  </td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    <button
                      type="button"
                      className={rowBtn}
                      disabled={pending}
                      onClick={() =>
                        run(
                          () =>
                            updateRentalLink(l.id, { is_active: !l.is_active }),
                          l.is_active
                            ? "연결을 중지했습니다."
                            : "연결을 다시 사용합니다.",
                        )
                      }
                    >
                      {l.is_active ? "중지" : "사용"}
                    </button>{" "}
                    <button
                      type="button"
                      className={rowBtn}
                      disabled={pending}
                      onClick={() => {
                        if (
                          !confirm(
                            `'${l.rental_program_name}' 연결을 삭제할까요?\n이미 만들어진 실적은 남고, 더 이상 자동으로 갱신되지 않습니다.`,
                          )
                        )
                          return;
                        run(
                          () => deleteRentalLink(l.id),
                          "연결을 삭제했습니다.",
                        );
                      }}
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-2 text-xs text-ink-hint">
          연결된 대관 프로그램이 없습니다.
        </p>
      )}

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_1.3fr_.8fr_1fr_auto]">
        <select
          className={inCls}
          value={name}
          disabled={!options}
          onChange={(e) => {
            setName(e.target.value);
            setSpace("");
          }}
        >
          <option value="">
            {options ? "대관 프로그램 선택 (최근 6개월)" : "목록 불러오는 중…"}
          </option>
          {(options ?? []).map((o) => (
            <option key={o.name} value={o.name}>
              {o.name} ({o.count}건)
            </option>
          ))}
        </select>
        <select
          className={inCls}
          value={space}
          disabled={!name}
          onChange={(e) => setSpace(e.target.value)}
        >
          <option value="">공간 전체</option>
          {spaces.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name} ({s.count}건)
            </option>
          ))}
        </select>
        <select
          className={inCls}
          value={countMode}
          onChange={(e) => setCountMode(e.target.value as "date" | "session")}
        >
          <option value="date">{COUNT_MODE_LABELS.date}</option>
          <option value="session">{COUNT_MODE_LABELS.session}</option>
        </select>
        <select
          className={inCls}
          value={audience}
          onChange={(e) => setAudience(e.target.value as "youth" | "other")}
        >
          <option value="youth">청소년</option>
          <option value="other">기타</option>
        </select>
        <input
          type="month"
          className={inCls}
          value={startMonth}
          onChange={(e) => setStartMonth(e.target.value)}
          title="이 달 1일부터 자동 실적을 만듭니다"
        />
        <button
          type="button"
          className={btnPrimary}
          disabled={pending || !name || !startMonth}
          onClick={() =>
            run(
              () =>
                createRentalLink({
                  program_id: programId,
                  rental_program_name: name,
                  rental_space_name: space || null,
                  count_mode: countMode,
                  default_audience: audience,
                  start_month: startMonth,
                }),
              `'${name}' 대관을 연결했습니다.`,
              () => {
                setName("");
                setSpace("");
              },
            )
          }
        >
          연결 추가
        </button>
      </div>
      {optionsError && <p className={`mt-2 ${noticeError}`}>{optionsError}</p>}
    </div>
  );
}
