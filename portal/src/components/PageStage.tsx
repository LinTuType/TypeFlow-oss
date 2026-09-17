/**
 * 页面转场：错位翻页（离心汇聚）
 *
 * 此前全站只有一条 `page-enter 180ms` 挂在 .main-inner 整体上 —— 整页一块动，
 * 页面内部没有层次，而且 <Outlet/> 立即卸载 ⇒ 旧页面"啪"地消失，没有退出阶段。
 *
 * 这里补成三段：
 *   1. 退出：旧内容各单元**反序**（最后一块先走）沿「版心中心 → 自身中心」方向继续外扩并淡出
 *   2. 换场：重挂载（此时旧内容 opacity 已为 0，跳变不可见）
 *   3. 进入：新内容各单元**正序**从各自方向的延长线上汇聚落位
 *
 * 为什么必须用 useOutlet() 而不是 <Outlet/>：
 *   <Outlet/> 渲染的是实时 RouteContext，把它缓存下来仍然会渲染**新**路由；
 *   useOutlet() 返回的是已解析好的 element 快照，缓存它才能撑住退出阶段。
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { useOutlet } from "react-router-dom";

/* 节奏（标准档）：退出 130ms、进入 250ms；错位步长见 stepFor()。 */
const OUT_DUR = 130;
const OUT_STEP = 11;
const IN_DUR = 250;
const IN_STEP = 25;

/* 错位跨度上限与步长地板。单元少时用固定步长（先后感清楚），单元多时按数量压缩，
   避免 20 个单元排出 500ms 的长尾；地板保证最密也还能看出顺序。 */
const OUT_SPAN_CAP = 70;
const OUT_STEP_MIN = 5;
const IN_SPAN_CAP = 150;
const IN_STEP_MIN = 10;

/** 步长：n 个单元、基准步长 base、总跨度不超过 spanCap，且不小于 floor */
function stepFor(n: number, base: number, spanCap: number, floor: number): number {
  if (n < 2) return 0;
  return Math.max(floor, Math.min(base, spanCap / (n - 1)));
}

/** 离心位移总量（px）：起点落在「版心中心 → 该单元中心」方向的延长线上 */
const DIST = 20;
/** 退出位移 = 进入位移 × 该系数（继续向外散开，幅度略收，避免"炸开"） */
const OUT_SCALE = 0.72;

/**
 * 「整块文书」：内部不再下钻、整体作为一个单元，且方向不用离心向量而固定为**从下方**滑入。
 * 依据：授权书是一张纸，从下方浮上来更像"被放到桌面上"；拆成字段各自飞会散掉它的整体感。
 * 退出时走同一根轴反向（向下），即原路滑出 —— 不需要额外分支，因为退出位移 = 进入方向 × OUT_SCALE。
 */
const SOLID_SEL = ".paper";
const SOLID_TX = 0;
const SOLID_TY = DIST;

/** 下钻一层的容器：列表行 / 卡片 / 表单组 —— 让有内容的页面层次更丰富 */
const DRILL_SEL = [
  ".font-card", ".trow", ".recent-row", ".continue-row", ".issue-field",
  ".overview-grid > *", ".facts > div", ".trace-hrow", ".sublist > div", ".attack-cell",
].join(",");

function prefersReduced(): boolean {
  return typeof window !== "undefined"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 整块文书：本身匹配、被它包含、或包含它，三种都算（单元通常是 .paper-stick，.paper 在其中） */
function isSolid(el: HTMLElement): boolean {
  return el.matches(SOLID_SEL) || el.closest(SOLID_SEL) !== null || el.querySelector(SOLID_SEL) !== null;
}

/**
 * 收集动效单元：一级块 + 下钻命中，只保留「最内层命中」。
 * 去掉外层是必须的 —— 否则父块和子块同时位移，幅度叠加会翻倍。
 */
function collectUnits(host: HTMLElement): HTMLElement[] {
  const cand = new Set<HTMLElement>();
  for (const el of Array.from(host.children) as HTMLElement[]) cand.add(el);
  for (const el of Array.from(host.querySelectorAll<HTMLElement>(DRILL_SEL))) {
    if (el.closest(SOLID_SEL)) continue;   // 整块文书内部不下钻，交给它自己整体滑入
    cand.add(el);
  }

  const all = Array.from(cand);
  // 极端长列表（几百行）不做下钻，避免一次性写几百条内联动画
  if (all.length > 300) return Array.from(host.children) as HTMLElement[];

  const inner = all.filter((el) => !all.some((o) => o !== el && el.contains(o)));

  // 被下钻的容器，其「既不是命中元素、也不包含命中元素」的直接子元素仍要参与 ——
  // 否则像签发页底部的动作行 / 网络日志，会因为左列被下钻成 .issue-field 而彻底不动，
  // 表现为"下方内容比上方先出现"。容器要从命中元素沿父链往上收：中间层
  // （如 .issue-form）既不是一级块也不是命中元素，只按 all 遍历会漏掉它。
  const containers = new Set<HTMLElement>();
  for (const el of inner) {
    for (let p = el.parentElement; p && p !== host; p = p.parentElement) containers.add(p);
  }
  for (const anc of containers) {
    for (const kid of Array.from(anc.children) as HTMLElement[]) {
      if (inner.includes(kid) || inner.some((o) => kid.contains(o))) continue;
      inner.push(kid);
    }
  }

  const rows = inner
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ el, r }) => {
      if (el.hidden) return false;
      const cs = getComputedStyle(el);
      return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 1 && r.height > 1;
    });

  // 视觉位置排序（自上而下、同行自左而右）；行判定给 8px 容差，避免基线抖动打乱顺序
  rows.sort((a, b) => {
    const dy = a.r.top - b.r.top;
    return Math.abs(dy) > 8 ? dy : a.r.left - b.r.left;
  });
  return rows.map((x) => x.el);
}

/** 把方向与动画落到单元上。phase = "out" 用反序 + 外扩，phase = "in" 用正序 + 汇聚。
 *  onlyFresh：只处理还没有动画的单元（异步页面数据到达后的补播，别把已落位的元素再弹一次）。
 *  delayBase：补播时接着第一批往后排，避免两批同时起飞、层次糊成一片。
 *  返回值：下一批的起始延迟（ms）。 */
function playStage(host: HTMLElement, phase: "in" | "out", onlyFresh = false, delayBase = 0): number {
  if (prefersReduced()) return 0;   // 降低动效偏好：直接到位，不播

  const units = collectUnits(host);
  if (!units.length) return 0;

  // 补播前先复位：上一轮是一级单元、这一轮因有子元素成为单元而被替换掉的容器，
  // 必须清掉自己的动画并归位 —— 否则父子的位移会叠成双倍。
  if (onlyFresh) {
    const keep = new Set(units);
    for (const el of Array.from(host.children) as HTMLElement[]) {
      if (el.style.animation && !keep.has(el)) {
        el.style.animation = "none";
        el.style.removeProperty("--tx");
        el.style.removeProperty("--ty");
      }
    }
  }

  const fresh = onlyFresh ? units.filter((u) => !u.style.animation) : units;
  if (!fresh.length) return 0;

  const hr = host.getBoundingClientRect();
  const cs = getComputedStyle(host);
  const px = (v: string) => parseFloat(v) || 0;
  const cx = (hr.left + px(cs.paddingLeft) + hr.right - px(cs.paddingRight)) / 2;
  const cy = (hr.top + px(cs.paddingTop) + hr.bottom - px(cs.paddingBottom)) / 2;

  // 先读后写：方向一次算完，再统一落 style，避免读写交替触发多次回流
  const vec = fresh.map((u) => {
    if (isSolid(u)) return { tx: SOLID_TX, ty: SOLID_TY };   // 整块文书：固定从下方
    const r = u.getBoundingClientRect();
    const dx = r.left + r.width / 2 - cx;
    const dy = r.top + r.height / 2 - cy;
    const len = Math.hypot(dx, dy) || 1;
    return { tx: (dx / len) * DIST, ty: (dy / len) * DIST };
  });

  // 先清掉旧动画并强制回流：否则同名动画不会被重播（StrictMode 双跑时尤其明显）
  fresh.forEach((u) => { u.style.animation = "none"; });
  void host.offsetWidth;

  const step = phase === "in"
    ? stepFor(fresh.length, IN_STEP, IN_SPAN_CAP, IN_STEP_MIN)
    : stepFor(fresh.length, OUT_STEP, OUT_SPAN_CAP, OUT_STEP_MIN);

  fresh.forEach((u, i) => {
    const { tx, ty } = vec[i];
    if (phase === "in") {
      u.style.setProperty("--tx", `${tx.toFixed(2)}px`);
      u.style.setProperty("--ty", `${ty.toFixed(2)}px`);
      u.style.animation =
        `pg-in ${IN_DUR}ms cubic-bezier(.16,1,.3,1) ${delayBase + i * step}ms both`;
    } else {
      // 退出反序：最后一块先走
      u.style.setProperty("--ox", `${(tx * OUT_SCALE).toFixed(2)}px`);
      u.style.setProperty("--oy", `${(ty * OUT_SCALE).toFixed(2)}px`);
      const d = (fresh.length - 1 - i) * step;
      u.style.animation = `pg-out ${OUT_DUR}ms cubic-bezier(.4,0,1,1) ${d}ms both`;
    }
  });

  // 返回「下一批可以从此开始」的延迟：补播接着第一批往后排
  return delayBase + fresh.length * step;
}

export default function PageStage({ routeKey }: { routeKey: string }) {
  const outlet = useOutlet();
  const [shown, setShown] = useState(() => ({ key: routeKey, node: outlet as ReactElement | null }));
  const [phase, setPhase] = useState<"in" | "out">("in");
  const hostRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ key: routeKey, node: outlet as ReactElement | null });
  const played = useRef("");
  const jumped = useRef(false);

  latest.current = { key: routeKey, node: outlet as ReactElement | null };

  // 阶段一：旧内容反序退场 → 等退场走完再换场（转场途中再点导航会用最新的目标）
  useEffect(() => {
    if (routeKey === shown.key) return;
    setPhase("out");
    const host = hostRef.current;
    const n = host ? collectUnits(host).length : 1;
    const wait = (n - 1) * stepFor(n, OUT_STEP, OUT_SPAN_CAP, OUT_STEP_MIN) + OUT_DUR;
    const timer = window.setTimeout(() => {
      jumped.current = true;
      setShown({ ...latest.current });
      setPhase("in");
    }, wait);
    return () => window.clearTimeout(timer);
  }, [routeKey, shown.key]);

  // 阶段二：按当前 phase 铺开动画（新内容刚挂载 / 旧内容开始退场）
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // 换场后回顶：react-router 默认不重置滚动，长页面互切会落在新页中部。
    // 放在 paint 前执行，用户看不到旧页滚动。
    if (jumped.current) {
      jumped.current = false;
      window.scrollTo(0, 0);
    }
    const sig = `${shown.key}|${phase}`;
    if (played.current === sig) return;   // StrictMode 双跑保护
    played.current = sig;
    const next = playStage(host, phase);

    // 异步页面（概览 / 订单 / 字体库 / 客户 / 追溯）挂载首帧还停在 loading 骨架，
    // 甚至像 .overview-grid 这种容器是空的 —— 数据到达后新内容若不补播就只会硬切，
    // 前半段动画等于白做。这里在换场后开一个短窗口观察一次 DOM 变化，
    // 只给「还没播过动画的单元」补一次进入动画，并接着第一批的节奏往后排。
    if (phase !== "in") return;
    const mo = new MutationObserver(() => {
      mo.disconnect();          // 只补一次：Promise.all 型加载是一批 setState，一次变化就够
      playStage(host, "in", true, next);
    });
    mo.observe(host, { childList: true, subtree: true });
    const stop = window.setTimeout(() => mo.disconnect(), 1500);
    return () => { mo.disconnect(); window.clearTimeout(stop); };
  }, [shown.key, phase]);

  return (
    <div className="pg-stage" ref={hostRef} key={shown.key}>
      {shown.node}
    </div>
  );
}
