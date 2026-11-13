"use client";

// =====================================================================
// 주소에 남는 탭 — 화면 탭 정리 표준 부품 (2026-11)
//
//   모양은 app/components/Tabs 그대로 쓰고, 그 위에 '선택 상태를 주소에 남기는'
//   동작만 얹었습니다. 새로 탭을 만드는 화면은 이 부품을 씁니다.
//
//   약속
//   · 선택한 탭 = 주소 ?tab=<키>(param 으로 이름 변경 가능). 새로 고침·링크로
//     들어와도 그 탭이 열리고, 탭을 누를 때마다 기록이 쌓여 뒤로가기로 이전 탭에
//     돌아갑니다. 기본 탭은 주소에서 지워 깔끔하게 둡니다(?tab= 없음 = 기본 탭).
//   · 옛 # 앵커(#duty-record 등)로 들어와도 동작 — hashMap 에 '앵커 → 탭'을 적으면
//     그 탭을 열고 해당 id 로 스크롤합니다. 같은 화면 안에서 # 링크를 눌러도 같습니다.
//   · 건수: count(회색 숫자) / badge(처리할 일, 빨간 원) — Tabs 와 같은 뜻.
//   · 권한 없는 탭: hidden: true 로 주면 줄에서 빠지고, 주소로 그 탭을 직접 불러도
//     기본 탭(없으면 첫 탭)이 열립니다. 서버에서도 데이터를 내려보내지 마세요 —
//     숨김은 화면 정리이지 보안이 아닙니다.
//   · 처음 열 때 불러오기: render 는 그 탭을 처음 열 때 한 번 그립니다. 그 뒤에는
//     다른 탭으로 가도 숨겨 둘 뿐 지우지 않아(입력 중인 값·불러온 목록 유지),
//     무거운 조회는 패널 컴포넌트 안에서 마운트 때 불러오면 됩니다.
//     keepMounted: false 면 떠날 때 지웁니다(매번 새로 불러와야 하는 탭).
//   · 휴대폰: 넘치면 가로 스크롤(Tabs 가 처리).
//
//   서버가 탭마다 다른 데이터를 그려야 하는 화면(서버 컴포넌트가 searchParams 로
//   분기)은 navigation="server" — router.push 로 서버를 다시 부릅니다. 기본
//   "client" 는 history.pushState 라 서버 왕복 없이 즉시 바뀝니다(Next 가
//   useSearchParams 와 연동 — node_modules/next/dist/docs 의 Native History API).
//
//   ⚠️ useSearchParams 를 쓰므로, 정적 렌더 페이지에 넣으면 <Suspense> 로 감싸야
//      합니다(동적 페이지는 그대로 됨).
//
// 사용법
//   <UrlTabs
//     ariaLabel="대관예약"
//     idPrefix="rental"                 // 탭·패널 id 연결(접근성)
//     defaultKey="list"
//     hashMap={{ "sync-status": "sync" }}
//     items={[
//       { key: "list", label: "예약 목록", count: 120, render: () => <List /> },
//       { key: "sync", label: "동기화", hidden: !canSync, render: () => <Sync /> },
//     ]}
//   />
// =====================================================================

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import Tabs, { type TabItem } from "@/app/components/Tabs";

export type UrlTabItem<K extends string = string> = Omit<TabItem<K>, "href"> & {
  // 권한 없는 탭 — 줄에서 빼고, 주소로 불러도 열지 않습니다.
  hidden?: boolean;
  // 패널 내용. 처음 열 때 한 번 호출합니다. 없으면 탭 줄만(패널은 바깥에서).
  render?: () => ReactNode;
  // 서버 컴포넌트(page.tsx)에서 바로 쓸 때 — 함수는 서버→클라이언트로 못 넘기므로
  //   미리 그린 내용을 줍니다. render 와 같이 처음 열 때 붙이고 그 뒤로 유지합니다.
  content?: ReactNode;
};

type Options<K extends string> = {
  keys: readonly K[]; // 보이는 탭 키(숨긴 탭 제외)
  defaultKey?: K;
  param?: string;
  hashMap?: Partial<Record<string, K>>;
  navigation?: "client" | "server";
};

// 주소 ↔ 선택 탭. 탭 줄 없이 상태만 필요할 때(다른 부품에서 탭을 바꾸는 버튼 등)
//   이 훅을 직접 씁니다. select 는 기록을 쌓고(push), 옛 # 앵커 정리는 replace 합니다.
export function useUrlTab<K extends string>({
  keys,
  defaultKey,
  param = "tab",
  hashMap,
  navigation = "client",
}: Options<K>) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const fallback = (
    defaultKey && keys.includes(defaultKey) ? defaultKey : keys[0]
  ) as K;

  // 뒤로가기 보정 — 새로 고침 '전'에 pushState 로 쌓인 기록으로 돌아가면 Next 가
  //   useSearchParams 를 갱신하지 않습니다(실측: 주소만 바뀌고 탭은 그대로).
  //   그래서 popstate 때의 실제 주소를 따로 들고 있다가, Next 쪽 값이 바뀌면 버립니다.
  const [popSearch, setPopSearch] = useState<string | null>(null);
  const spString = searchParams?.toString() ?? "";
  const [seenSp, setSeenSp] = useState(spString);
  if (seenSp !== spString) {
    setSeenSp(spString);
    setPopSearch(null);
  }
  useEffect(() => {
    const onPop = () => setPopSearch(window.location.search);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const raw = new URLSearchParams(popSearch ?? spString).get(param) ?? "";
  const value = (keys.includes(raw as K) ? raw : fallback) as K;

  const urlFor = useCallback(
    (key: K, hash = "") => {
      // 지금 주소창 기준 — 다른 필터(?month= 등)를 그대로 살립니다.
      const q = new URLSearchParams(
        typeof window === "undefined" ? spString : window.location.search,
      );
      if (key === fallback) q.delete(param);
      else q.set(param, key);
      // 서버 화면의 페이지 번호는 탭이 바뀌면 의미가 없습니다(다른 목록).
      if (navigation === "server") q.delete("page");
      const qs = q.toString();
      return `${pathname}${qs ? `?${qs}` : ""}${hash}`;
    },
    [spString, fallback, param, pathname, navigation],
  );

  const go = useCallback(
    (key: K, mode: "push" | "replace", hash = "") => {
      const url = urlFor(key, hash);
      if (navigation === "server") {
        startTransition(() => {
          if (mode === "push") router.push(url, { scroll: false });
          else router.replace(url, { scroll: false });
        });
      } else {
        if (mode === "push") window.history.pushState(null, "", url);
        else window.history.replaceState(null, "", url);
        // Next 가 갱신해 주면 위 보정이 지우고, 안 해 줘도(뒤로가기 뒤) 이 값으로 맞습니다.
        setPopSearch(window.location.search);
      }
    },
    [urlFor, navigation, router],
  );

  const select = useCallback(
    (key: K) => {
      if (key === value || !keys.includes(key)) return;
      go(key, "push");
    },
    [value, keys, go],
  );

  // 옛 # 앵커 — 들어올 때와 같은 화면 안 # 링크(hashchange) 둘 다.
  const [scrollTo, setScrollTo] = useState<string | null>(null);
  useEffect(() => {
    if (!hashMap) return;
    const apply = () => {
      const id = decodeURIComponent(window.location.hash.replace(/^#/, ""));
      if (!id) return;
      const key = hashMap[id];
      if (!key || !keys.includes(key)) return;
      if (key !== value) go(key, "replace", `#${encodeURIComponent(id)}`);
      setScrollTo(id);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
    // 들어올 때 한 번 + 이후 hashchange — value 변화로 다시 돌 필요는 없습니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 패널이 그려진 뒤 그 위치로.
  useEffect(() => {
    if (!scrollTo) return;
    const t = window.setTimeout(() => {
      document.getElementById(scrollTo)?.scrollIntoView({ block: "start" });
      setScrollTo(null);
    }, 0);
    return () => window.clearTimeout(t);
  }, [scrollTo, value]);

  return { value, select, pending, urlFor };
}

type Props<K extends string> = {
  items: UrlTabItem<K>[];
  ariaLabel: string;
  defaultKey?: K;
  param?: string;
  hashMap?: Partial<Record<string, K>>;
  navigation?: "client" | "server";
  variant?: "primary" | "segment";
  idPrefix?: string;
  stretch?: boolean;
  hideZeroCount?: boolean;
  keepMounted?: boolean;
  className?: string; // 탭 줄
  panelClassName?: string; // 각 패널
  // 탭 줄과 패널 사이에 끼울 것(모든 탭 공통 필터 등).
  between?: ReactNode;
};

export default function UrlTabs<K extends string>({
  items,
  ariaLabel,
  defaultKey,
  param,
  hashMap,
  navigation,
  variant = "primary",
  idPrefix,
  stretch,
  hideZeroCount,
  keepMounted = true,
  className = "",
  panelClassName = "",
  between,
}: Props<K>) {
  const visible = useMemo(() => items.filter((t) => !t.hidden), [items]);
  const keys = useMemo(() => visible.map((t) => t.key), [visible]);
  const { value, select } = useUrlTab({
    keys,
    defaultKey,
    param,
    hashMap,
    navigation,
  });

  // 한 번이라도 연 탭 — 처음 열 때 그리고, 그 뒤에는 숨겨 둡니다.
  const [opened, setOpened] = useState<Set<K>>(() => new Set([value]));
  if (!opened.has(value)) setOpened(new Set(opened).add(value));

  if (visible.length === 0) return null;
  const hasPanels = visible.some((t) => t.render || t.content !== undefined);
  const tabItems: TabItem<K>[] = visible.map((t) => ({
    key: t.key,
    label: t.label,
    icon: t.icon,
    badge: t.badge,
    count: t.count,
    dot: t.dot,
    title: t.title,
  }));

  return (
    <>
      {/* 탭이 하나뿐이면 줄을 그리지 않습니다(Tabs 약속). */}
      {visible.length > 1 && (
        <Tabs
          items={tabItems}
          value={value}
          onChange={select}
          variant={variant}
          ariaLabel={ariaLabel}
          idPrefix={idPrefix}
          stretch={stretch}
          hideZeroCount={hideZeroCount}
          className={className}
        />
      )}
      {between}
      {hasPanels &&
        visible.map((t) => {
          if (!t.render && t.content === undefined) return null;
          const on = t.key === value;
          if (!on && (!keepMounted || !opened.has(t.key))) return null;
          return (
            <div
              key={t.key}
              role={visible.length > 1 ? "tabpanel" : undefined}
              id={idPrefix ? `${idPrefix}-panel-${t.key}` : undefined}
              aria-labelledby={
                idPrefix && visible.length > 1
                  ? `${idPrefix}-tab-${t.key}`
                  : undefined
              }
              hidden={!on}
              className={panelClassName}
            >
              {t.render ? t.render() : t.content}
            </div>
          );
        })}
    </>
  );
}
