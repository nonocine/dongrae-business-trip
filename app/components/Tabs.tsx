"use client";

// =====================================================================
// 탭 — 앱의 모든 탭은 이 부품 하나로 그립니다. (2026-10 관장 지적)
//
//   "메뉴가 많아지면서 탭이 글자+밑줄뿐이라 상위·하위 탭 구분이 안 된다."
//   → 글자를 읽기 전에 '지금 어디 있는지'가 보이도록 두 단계로 나눴습니다.
//
//   variant="primary"  상위 탭 — 화면의 큰 갈래(방카: 공지·급식·일정·공결).
//                      아이콘+글자, 높이 40px. 선택 = 남색 채움·흰 글자.
//   variant="segment"  하위 탭 — 한 갈래 안의 보기 전환·필터(공결: 처리할/전체/대장).
//                      연한 회색 트랙 안 알약, 높이 32px. 선택 = 흰 알약이 떠 있음.
//
//   한 화면에 primary 는 한 줄만. primary 안에 또 primary 를 넣지 마세요 —
//   그 자리는 segment 입니다. 탭이 하나뿐이면 탭 줄을 그리지 마세요.
//
// 사용법
//   // ① 주소로 선택 상태를 남기는 화면 — href 를 주면 Link 로 그립니다.
//   <Tabs
//     ariaLabel="동래방카 콘텐츠"
//     value={current}                       // 지금 선택된 key
//     items={[
//       { key: "posts", label: "공지·알림장", icon: "megaphone", href: "/bangka/posts" },
//       { key: "absences", label: "공결", icon: "fileCheck", href: "/bangka/absences", badge: 3 },
//     ]}
//   />
//   // ② 화면 안 상태만 바꾸는 탭 — onChange 를 줍니다.
//   <Tabs variant="segment" ariaLabel="보기" value={view} onChange={setView}
//     items={[{ key: "source", label: "재원별" }, { key: "person", label: "사람별" }]} />
//
//   항목 옵션
//     icon   : primary 전용(app/components/TabIcon 의 이름). segment 에는 쓰지 않습니다.
//     badge  : '처리할 일' 수 — 작은 빨간 원. 0 이면 안 보이고 100 이상은 99+.
//              건수만 알려 주는 숫자(기자 12명 등)는 badge 가 아니라 count 입니다.
//     count  : 단순 건수 — 글자 옆 회색 숫자. 0 도 보입니다(hideZeroCount 로 숨김).
//     dot    : 분류 색 점(메일 분류처럼 색 자체가 뜻일 때만).
//   Tabs 옵션
//     idPrefix : 주면 탭 id=`${p}-tab-${key}`, aria-controls=`${p}-panel-${key}` 를 답니다.
//                패널 쪽에 role="tabpanel" id=`${p}-panel-${key}` 를 붙이세요.
//     stretch  : segment 를 가로 꽉 채움(칸 2~3개짜리 모드 전환).
//
// 동작 약속
//   · 선택 표시(남색 면·흰 알약)는 탭 사이를 180ms ease-out 으로 미끄러집니다.
//     '움직임 줄이기'(prefers-reduced-motion)면 움직이지 않습니다.
//   · 링크 탭은 누르는 즉시 표시가 옮겨 갑니다(서버 응답을 기다리지 않음).
//     같은 탭 줄이 페이지마다 새로 그려져도(레이아웃이 각자인 방카 콘텐츠) 직전 위치에서
//     출발하도록 위치를 기억해 둡니다.
//   · 넘치면 가로 스크롤(줄바꿈 없음), 선택 탭을 화면 안으로 자동 스크롤, 양끝 흐림.
//   · 키보드: ←/→ 이동, Home/End 처음·끝. 버튼 탭은 이동과 동시에 선택,
//     링크 탭은 포커스만 옮기고 Enter 로 이동(화살표마다 페이지가 바뀌지 않게).
// =====================================================================

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import TabIcon, { type TabIconName } from "@/app/components/TabIcon";

export type TabItem<K extends string = string> = {
  key: K;
  label: ReactNode;
  icon?: TabIconName;
  href?: string;
  badge?: number;
  count?: number;
  dot?: string;
  title?: string;
};

type Props<K extends string> = {
  items: TabItem<K>[];
  value: K;
  onChange?: (key: K) => void;
  variant?: "primary" | "segment";
  ariaLabel: string;
  idPrefix?: string;
  stretch?: boolean;
  hideZeroCount?: boolean;
  // Link 의 scroll — 기본 true(Next 기본값). 같은 페이지 안 보기 전환이면 false.
  linkScroll?: boolean;
  className?: string;
};

type Box = { x: number; y: number; w: number; h: number };

// 탭 줄이 다시 마운트돼도 직전 위치에서 미끄러지도록 — ariaLabel 별 마지막 위치.
const lastBox = new Map<string, Box>();

// 레이아웃 측정은 화면 그리기 전에(깜빡임 없음). 서버에서는 useEffect 로 대체.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function badgeText(n: number): string {
  return n > 99 ? "99+" : String(n);
}

export default function Tabs<K extends string>({
  items,
  value,
  onChange,
  variant = "primary",
  ariaLabel,
  idPrefix,
  stretch = false,
  hideZeroCount = false,
  linkScroll,
  className = "",
}: Props<K>) {
  const primary = variant === "primary";
  const memoKey = `${variant}:${ariaLabel}`;

  // 링크 탭을 누른 순간부터 응답이 올 때까지 표시를 먼저 옮겨 둡니다.
  //   value 가 바뀌면(이동 완료) 자연히 무효 — 누를 때의 value 를 같이 기억합니다.
  const [pending, setPending] = useState<{ key: K; from: K } | null>(null);
  const selected = pending && pending.from === value ? pending.key : value;

  const scrollerRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<K, HTMLElement>());
  const [box, setBox] = useState<(Box & { animate: boolean }) | null>(null);
  const [fade, setFade] = useState({ left: false, right: false });
  const firstRef = useRef(true);

  const measure = useCallback(
    (animate: boolean) => {
      const el = tabRefs.current.get(selected);
      if (!el) {
        setBox(null);
        return;
      }
      const next: Box = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
      const prev = lastBox.get(memoKey);
      const same = !!prev && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h;
      // 크기 감시(ResizeObserver)가 위치 변화 없이 불렀을 때 — 진행 중인 미끄러짐을 끊지 않게 그대로 둡니다.
      if (!firstRef.current && same) return;
      lastBox.set(memoKey, next);

      if (firstRef.current) {
        firstRef.current = false;
        // 새로 그려진 탭 줄 — 직전 위치가 있으면 거기서 출발해 한 프레임 뒤 이동.
        if (prev && (prev.x !== next.x || prev.w !== next.w)) {
          setBox({ ...prev, animate: false });
          requestAnimationFrame(() => setBox({ ...next, animate: true }));
        } else {
          setBox({ ...next, animate: false });
        }
      } else {
        setBox({ ...next, animate });
      }

      // 선택 탭이 잘려 있으면 보이는 곳으로(세로 페이지 스크롤은 건드리지 않음).
      const sc = scrollerRef.current;
      if (sc && sc.scrollWidth > sc.clientWidth) {
        const pad = 24;
        const left = next.x - pad;
        const right = next.x + next.w + pad - sc.clientWidth;
        let target: number | null = null;
        if (left < sc.scrollLeft) target = left;
        else if (right > sc.scrollLeft) target = right;
        if (target !== null) {
          const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          sc.scrollTo({ left: Math.max(0, target), behavior: animate && !reduce ? "smooth" : "auto" });
        }
      }
    },
    [selected, memoKey],
  );

  useIsoLayoutEffect(() => {
    measure(true);
  }, [measure, items.length]);

  // 글꼴 로딩·창 크기 변화 — 움직임 없이 위치만 맞춤.
  useEffect(() => {
    const sc = scrollerRef.current;
    if (!sc || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      measure(false);
      updateFade();
    });
    ro.observe(sc);
    if (sc.firstElementChild) ro.observe(sc.firstElementChild);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure]);

  function updateFade() {
    const sc = scrollerRef.current;
    if (!sc) return;
    const left = sc.scrollLeft > 1;
    const right = sc.scrollLeft + sc.clientWidth < sc.scrollWidth - 1;
    setFade((f) => (f.left === left && f.right === right ? f : { left, right }));
  }
  useEffect(updateFade, [items.length]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const keys = items.map((t) => t.key);
    const cur = keys.findIndex((k) => tabRefs.current.get(k) === document.activeElement);
    if (cur < 0) return;
    let next = cur;
    if (e.key === "ArrowRight") next = (cur + 1) % keys.length;
    else if (e.key === "ArrowLeft") next = (cur - 1 + keys.length) % keys.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = keys.length - 1;
    else return;
    e.preventDefault();
    const k = keys[next];
    tabRefs.current.get(k)?.focus();
    const item = items[next];
    if (!item.href && onChange) onChange(k);
  }

  const ready = box !== null;
  const fadeMask = (() => {
    if (!fade.left && !fade.right) return undefined;
    const l = fade.left ? "transparent 0, #000 28px" : "#000 0";
    const r = fade.right ? "#000 calc(100% - 28px), transparent 100%" : "#000 100%";
    const m = `linear-gradient(to right, ${l}, ${r})`;
    return { maskImage: m, WebkitMaskImage: m } as CSSProperties;
  })();

  // ---- 모양 ----
  const listCls = primary
    ? "relative flex w-max min-w-full gap-1 p-1"
    : `relative ${stretch ? "flex w-full" : "inline-flex w-max"} gap-0.5 rounded-[10px] bg-tab-track p-1`;
  const indicatorCls = primary
    ? "rounded-[10px] bg-navy shadow-[0_1px_2px_rgba(16,24,40,0.12)]"
    : "rounded-lg bg-card shadow-[0_1px_2px_rgba(16,24,40,0.08),0_1px_3px_rgba(16,24,40,0.06)]";
  const tabBase =
    "relative z-[1] inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap outline-none transition-colors duration-150 ease-out motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-navy";
  const tabShape = primary
    ? "h-10 gap-2 rounded-[10px] px-3.5 text-[15px] leading-none tracking-[-0.01em] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
    : `h-8 gap-1.5 rounded-lg px-3 text-sm leading-none tracking-[-0.005em] focus-visible:ring-offset-0 ${stretch ? "flex-1" : ""}`;
  function tabState(on: boolean): string {
    if (primary) {
      return on
        ? `font-semibold text-white ${ready ? "" : "bg-navy"}`
        : "font-normal text-ink-muted hover:bg-tab-hover hover:text-ink";
    }
    return on
      ? `font-semibold text-ink ${ready ? "" : "bg-card shadow-sm"}`
      : "font-normal text-tab-ink hover:text-ink";
  }

  return (
    <div className={`relative ${primary ? "-mx-1" : ""} ${className}`}>
      <div
        ref={scrollerRef}
        onScroll={updateFade}
        style={fadeMask}
        className={`overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
          primary ? "" : "-m-1 p-1"
        }`}
      >
        <div role="tablist" aria-label={ariaLabel} aria-orientation="horizontal" onKeyDown={onKeyDown} className={listCls}>
          {box && (
            <span
              aria-hidden
              className={`pointer-events-none absolute left-0 top-0 ${indicatorCls} ${
                box.animate
                  ? "transition-[transform,width,height] duration-[180ms] ease-out motion-reduce:transition-none"
                  : ""
              }`}
              style={{ width: box.w, height: box.h, transform: `translate(${box.x}px, ${box.y}px)` }}
            />
          )}
          {items.map((t) => {
            const on = t.key === selected;
            const showCount = typeof t.count === "number" && (!hideZeroCount || t.count > 0);
            const inner = (
              <>
                {primary && t.icon && <TabIcon name={t.icon} />}
                {t.dot && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: t.dot }} />}
                <span>{t.label}</span>
                {showCount && (
                  <span
                    className={`text-[13px] font-medium tabular-nums ${
                      primary ? (on ? "text-white/75" : "text-ink-hint") : on ? "text-ink-muted" : "text-tab-ink/80"
                    }`}
                  >
                    {t.count}
                  </span>
                )}
                {!!t.badge && t.badge > 0 && (
                  <span
                    aria-label={`처리할 일 ${t.badge}건`}
                    className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-stamp px-[5px] text-[11px] font-semibold leading-none text-white tabular-nums"
                  >
                    {badgeText(t.badge)}
                  </span>
                )}
              </>
            );
            const common = {
              ref: (el: HTMLElement | null) => {
                if (el) tabRefs.current.set(t.key, el);
                else tabRefs.current.delete(t.key);
              },
              role: "tab",
              "aria-selected": on,
              tabIndex: on ? 0 : -1,
              id: idPrefix ? `${idPrefix}-tab-${t.key}` : undefined,
              "aria-controls": idPrefix ? `${idPrefix}-panel-${t.key}` : undefined,
              title: t.title,
              className: `${tabBase} ${tabShape} ${tabState(on)}`,
            } as const;
            return t.href ? (
              <Link
                key={t.key}
                {...common}
                href={t.href}
                scroll={linkScroll}
                aria-current={on ? "page" : undefined}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  if (t.key !== value) setPending({ key: t.key, from: value });
                  onChange?.(t.key);
                }}
              >
                {inner}
              </Link>
            ) : (
              <button key={t.key} type="button" {...common} onClick={() => onChange?.(t.key)}>
                {inner}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
