"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { btnPrimary, btnSecondary, inputCls, labelCls } from "@/lib/ui";
import {
  saveBusinessResult,
  type BusinessResult,
  type ProgramRegistry,
  type ReportRoom,
} from "./actions";
import RoomUsageSection, { type RoomCounts } from "./RoomUsageSection";

// 사업명 드롭다운에서 "직접 입력"을 고르면 등록 목록에 없는 임시 사업을 쓸 수 있습니다.
const CUSTOM = "__custom__";

const readOnlyCls =
  "mt-1 block w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink shadow-sm";

// 인원 입력 안내 — 폼 하단 도움말과 같은 문구를 코드에서도 단일 출처로 둡니다.
//   연인원·실인원 자동계산은 김혜지 요청으로 제거했습니다(실제 운영과 맞지 않음).
//   담당자가 직접 넣은 값이 그대로 저장됩니다.
export const HEADCOUNT_HELP =
  "연인원·실인원은 자동으로 계산하지 않습니다. 담당자가 실제 값을 직접 입력하세요 " +
  "(계 칸만 청소년+기타로 자동 합산).";

function NumberField({
  label,
  name,
  value,
  onChange,
}: {
  label: string;
  name?: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className={labelCls}>
      {label}
      <input
        name={name}
        type="number"
        min="0"
        className={inputCls}
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      />
    </label>
  );
}

function TotalField({ label, value }: { label: string; value: number }) {
  return (
    <label className={labelCls}>
      {label}
      <output className={readOnlyCls}>{value.toLocaleString("ko-KR")}</output>
    </label>
  );
}

// 연속 입력 시 다음 건으로 이어받는 값 — 매번 다시 고르지 않아도 되는 항목만.
export type CarryOver = {
  month: number;
  category: string;
  managerName: string;
};

export default function ProgramResultForm({
  year,
  month,
  editing,
  registry,
  rooms,
  roomsConfigured,
  initialRoomCounts,
  carryOver,
  onCancel,
  onSaved,
  onSavedAndNext,
}: {
  year: number;
  month: number;
  editing: BusinessResult | null;
  registry: ProgramRegistry;
  rooms: ReportRoom[];
  roomsConfigured: boolean;
  initialRoomCounts: RoomCounts;
  carryOver: CarryOver | null;
  onCancel: () => void;
  onSaved: (message: string) => void;
  onSavedAndNext: (carry: CarryOver) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  const activeCategories = useMemo(
    () => registry.categories.filter((c) => c.is_active),
    [registry.categories],
  );
  // 수정 모드에서 과거 분야 문자열이 목록에 없으면 옵션으로 함께 표시합니다.
  const categoryNames = useMemo(() => {
    const names = activeCategories.map((c) => c.name);
    if (editing && editing.category && !names.includes(editing.category))
      return [editing.category, ...names];
    return names;
  }, [activeCategories, editing]);

  const [category, setCategory] = useState(
    editing?.category ?? carryOver?.category ?? categoryNames[0] ?? "",
  );
  const categoryId = useMemo(
    () => registry.categories.find((c) => c.name === category)?.id ?? "",
    [registry.categories, category],
  );
  const programOptions = useMemo(
    () =>
      registry.programs.filter(
        (p) => p.category_id === categoryId && (p.is_active || p.id === editing?.program_id),
      ),
    [registry.programs, categoryId, editing?.program_id],
  );

  const [programChoice, setProgramChoice] = useState(
    editing?.program_id ?? (editing ? CUSTOM : ""),
  );
  const [customName, setCustomName] = useState(
    editing && !editing.program_id ? editing.program_name : "",
  );

  const [sessions, setSessions] = useState(editing?.sessions ?? 0);
  const [operatingDays, setOperatingDays] = useState(
    editing?.operating_days ?? 0,
  );
  const [participantsYouth, setParticipantsYouth] = useState(
    editing?.participants_youth ?? 0,
  );
  const [participantsOther, setParticipantsOther] = useState(
    editing?.participants_other ?? 0,
  );
  const [attendanceYouth, setAttendanceYouth] = useState(
    editing?.attendance_youth ?? 0,
  );
  const [attendanceOther, setAttendanceOther] = useState(
    editing?.attendance_other ?? 0,
  );
  const [youthUses, setYouthUses] = useState(editing?.youth_uses ?? 0);
  const [otherUses, setOtherUses] = useState(editing?.other_uses ?? 0);

  // 실별 사용인원 — 실별이용 보고(business_result_rooms)용 입력입니다.
  //   실인원 칸에는 더 이상 자동 반영하지 않고, 아래에 참고용 합계만 보여줍니다.
  const [roomCounts, setRoomCounts] = useState<RoomCounts>(initialRoomCounts);
  const useRooms = roomsConfigured && rooms.length > 0;
  const roomTotals = useMemo(
    () =>
      Object.values(roomCounts).reduce(
        (a, v) => ({ youth: a.youth + v.youth, other: a.other + v.other }),
        { youth: 0, other: 0 },
      ),
    [roomCounts],
  );

  const resolvedName =
    programChoice && programChoice !== CUSTOM
      ? (registry.programs.find((p) => p.id === programChoice)?.name ?? "")
      : customName;
  const useRegistry = registry.configured && activeCategories.length > 0;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    // 누른 버튼(submit / continue)의 name·value 는 submitter 를 함께 넘겨야
    // FormData 에 실립니다. new FormData(form) 만으로는 버튼이 빠집니다.
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const fd = new FormData(
      form,
      submitter instanceof HTMLElement ? submitter : null,
    );
    const keepGoing = fd.get("continue") === "true";
    setError("");
    start(async () => {
      try {
        await saveBusinessResult(fd);
        if (keepGoing) {
          onSavedAndNext({
            month: Number(fd.get("month")) || month,
            category,
            managerName: String(fd.get("manager_name") ?? ""),
          });
        } else {
          onSaved("저장했습니다.");
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "저장하지 못했습니다.");
      }
    });
  }

  return (
    <form className="mt-4 grid gap-3 md:grid-cols-3" onSubmit={onSubmit}>
      <input type="hidden" name="id" value={editing?.id ?? ""} />
      <input type="hidden" name="year" value={year} />
      <input
        type="hidden"
        name="program_id"
        value={programChoice === CUSTOM ? "" : programChoice}
      />
      <input type="hidden" name="program_name" value={resolvedName} />

      <label className={labelCls}>
        실적 월
        <select
          name="month"
          className={inputCls}
          defaultValue={editing?.report_month ?? carryOver?.month ?? month}
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((v) => (
            <option key={v} value={v}>
              {v}월
            </option>
          ))}
        </select>
      </label>

      <label className={labelCls}>
        분야
        {useRegistry ? (
          <select
            name="category"
            className={inputCls}
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setProgramChoice("");
            }}
          >
            {categoryNames.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        ) : (
          <input
            name="category"
            className={inputCls}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="예: 지역사회 연계"
          />
        )}
      </label>

      <label className={labelCls}>
        사업명
        {useRegistry ? (
          <select
            className={inputCls}
            value={programChoice}
            onChange={(e) => setProgramChoice(e.target.value)}
          >
            <option value="">선택하세요</option>
            {programOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value={CUSTOM}>직접 입력</option>
          </select>
        ) : (
          <input
            className={inputCls}
            required
            value={customName}
            onChange={(e) => {
              setCustomName(e.target.value);
              setProgramChoice(CUSTOM);
            }}
          />
        )}
      </label>

      {useRegistry && programChoice === CUSTOM && (
        <label className={`${labelCls} md:col-span-3`}>
          사업명 직접 입력
          <input
            className={inputCls}
            required
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="등록 목록에 없는 임시 사업명"
          />
        </label>
      )}

      <label className={labelCls}>
        담당자
        <input
          name="manager_name"
          className={inputCls}
          defaultValue={editing?.manager_name ?? carryOver?.managerName ?? ""}
          placeholder="예: 김혜지"
        />
      </label>
      <NumberField
        label="운영 횟수"
        name="sessions"
        value={sessions}
        onChange={setSessions}
      />
      <NumberField
        label="운영일수"
        name="operating_days"
        value={operatingDays}
        onChange={setOperatingDays}
      />

      <NumberField
        label="참가인원 (청소년)"
        name="participants_youth"
        value={participantsYouth}
        onChange={setParticipantsYouth}
      />
      <NumberField
        label="참가인원 (기타)"
        name="participants_other"
        value={participantsOther}
        onChange={setParticipantsOther}
      />
      <TotalField
        label="참가인원 (계)"
        value={participantsYouth + participantsOther}
      />

      <NumberField
        label="연인원 (청소년)"
        name="attendance_youth"
        value={attendanceYouth}
        onChange={setAttendanceYouth}
      />
      <NumberField
        label="연인원 (기타)"
        name="attendance_other"
        value={attendanceOther}
        onChange={setAttendanceOther}
      />
      <TotalField label="연인원 (계)" value={attendanceYouth + attendanceOther} />

      <NumberField
        label="실인원 (청소년)"
        name="youth_uses"
        value={youthUses}
        onChange={setYouthUses}
      />
      <NumberField
        label="실인원 (기타)"
        name="other_uses"
        value={otherUses}
        onChange={setOtherUses}
      />
      <TotalField label="실인원 (계)" value={youthUses + otherUses} />

      <p className="rounded-lg bg-surface px-3 py-2 text-xs leading-5 text-ink-muted md:col-span-3">
        {HEADCOUNT_HELP}
        {useRooms && (
          <>
            <br />
            아래 실별 사용인원 합계는 참고용입니다 — 청소년{" "}
            {roomTotals.youth.toLocaleString("ko-KR")} · 기타{" "}
            {roomTotals.other.toLocaleString("ko-KR")} · 계{" "}
            {(roomTotals.youth + roomTotals.other).toLocaleString("ko-KR")}
            (실인원 칸에 자동으로 넣지 않습니다.)
          </>
        )}
      </p>

      {useRooms && (
        <RoomUsageSection
          rooms={rooms}
          values={roomCounts}
          onChange={setRoomCounts}
        />
      )}

      {!editing && (
        <p className="rounded-lg bg-surface px-3 py-2 text-xs leading-5 text-ink-muted md:col-span-3">
          세부 실적(일자/회차별)은 저장 후 수정 화면에서 입력합니다.
        </p>
      )}

      <label className={`${labelCls} md:col-span-3`}>
        주요 내용
        <textarea
          name="summary"
          rows={3}
          className={inputCls}
          defaultValue={editing?.summary ?? ""}
        />
      </label>
      <label className={`${labelCls} md:col-span-3`}>
        평가·향후 계획
        <textarea
          name="evaluation"
          rows={3}
          className={inputCls}
          defaultValue={editing?.evaluation ?? ""}
        />
      </label>

      {error && (
        <p className="rounded-lg bg-stamp-soft px-3 py-2 text-xs text-stamp md:col-span-3">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2 md:col-span-3">
        <button disabled={pending} className={btnPrimary}>
          {editing ? "수정 후 임시저장" : "임시저장"}
        </button>
        <button
          disabled={pending}
          name="submit"
          value="true"
          className={btnPrimary}
        >
          {editing ? "수정 후 제출" : "제출"}
        </button>
        {/* 여러 건 연속 입력 — 저장 후 빈 폼을 다시 엽니다(월·분야·담당자는 이어받음). */}
        <button
          disabled={pending}
          name="continue"
          value="true"
          className={btnSecondary}
          title="저장한 뒤 빈 입력칸을 다시 열어 다음 사업을 이어서 작성합니다"
        >
          + 저장 후 다음 실적 추가
        </button>
        {editing && (
          <button
            type="button"
            className="text-sm font-semibold text-ink-muted hover:underline"
            onClick={onCancel}
          >
            수정 취소
          </button>
        )}
      </div>
    </form>
  );
}
