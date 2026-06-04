"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cardCls, badgeNavy, noticeError } from "@/lib/ui";
import {
  assignJudgeToPosting,
  unassignJudgeFromPosting,
} from "../actions";
import type { ExternalJudge, Judge } from "@/lib/supabase";

// 01012345678 → ***-****-5678 (뒷 4자리만 노출)
function maskPhone(phone: string): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  const last4 = digits.slice(-4);
  return `***-****-${last4 || "****"}`;
}

export default function JudgesAssignManager({
  slug,
  pool,
  judges,
}: {
  slug: string;
  pool: ExternalJudge[];
  judges: Judge[];
}) {
  // 활성 풀 위원만 노출.
  const activePool = useMemo(() => pool.filter((p) => p.is_active), [pool]);

  // external_pool_id → 본 공고에 배정된(활성) Judge.
  const assignedByPool = useMemo(() => {
    const m = new Map<string, Judge>();
    for (const j of judges) {
      if (j.judge_type === "external" && j.external_pool_id && j.is_active) {
        m.set(j.external_pool_id, j);
      }
    }
    return m;
  }, [judges]);

  const assignedCount = useMemo(
    () => activePool.filter((p) => assignedByPool.has(p.id)).length,
    [activePool, assignedByPool]
  );

  return (
    <div className="space-y-4">
      <section className={cardCls}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
          <h3 className="text-sm font-semibold text-ink">외부위원 배정</h3>
          <span className="text-xs font-medium text-ink-muted">
            배정된 위원{" "}
            <strong className="font-semibold text-navy">
              {assignedCount}명
            </strong>{" "}
            / 전체 {activePool.length}명
          </span>
        </div>

        {activePool.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-line bg-surface p-6 text-center text-sm text-ink-muted">
            활성화된 외부위원이 없습니다.{" "}
            <Link
              href="/hr/external-judges"
              className="font-semibold text-navy hover:underline"
            >
              외부 심사위원 명단
            </Link>
            에서 먼저 등록하세요.
          </p>
        ) : (
          <ul className="mt-1 divide-y divide-line">
            {activePool.map((p) => (
              <AssignRow
                key={p.id}
                slug={slug}
                pool={p}
                judge={assignedByPool.get(p.id) ?? null}
              />
            ))}
          </ul>
        )}
      </section>

      <p className="px-1 text-[11px] leading-relaxed text-ink-hint">
        토글을 켜면 이 공고에 외부위원으로 배정됩니다. 끄면 배정이 해제되며,
        이미 채점한 이력이 있어도 안전하게 비활성화됩니다(이력 보존).
      </p>
    </div>
  );
}

// =====================================================================
// 위원 한 줄 — 좌측 정보, 우측 배정 토글
// =====================================================================
function AssignRow({
  slug,
  pool,
  judge,
}: {
  slug: string;
  pool: ExternalJudge;
  judge: Judge | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const on = judge != null;

  function handleToggle() {
    setErr(null);
    startTransition(async () => {
      const res = on
        ? await unassignJudgeFromPosting(slug, judge!.id)
        : await assignJudgeToPosting(slug, pool.id);
      if (!res.ok) {
        setErr(res.message);
        return;
      }
      // force-dynamic 페이지를 다시 그려 토글/카운트를 서버 상태와 동기화.
      router.refresh();
    });
  }

  return (
    <li className="py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold text-ink">{pool.name}</span>
            {on && <span className={badgeNavy}>배정됨</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
            <span>{pool.affiliation || "소속 미상"}</span>
            <span className="text-ink-hint">·</span>
            <span className="font-mono">{maskPhone(pool.phone)}</span>
          </div>
          {err && <p className={`mt-2 ${noticeError}`}>{err}</p>}
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={`${pool.name} 위원 ${on ? "배정 해제" : "배정"}`}
          onClick={handleToggle}
          disabled={pending}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
            on ? "bg-navy" : "bg-line"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
              on ? "translate-x-[22px]" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
    </li>
  );
}
