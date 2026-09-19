/**
 * 页面数据缓存（模块级，会话内有效）
 *
 * 为什么要有它：门户是单页应用，侧栏切换只换组件 —— 组件一挂载就 `useEffect` 拉一遍
 * 数据。于是「概览 ↔ 字体库 ↔ 订单 ↔ 客户」来回点，每次都要重新发一遍 `/api/orders`、
 * `/api/fonts`，还要把本机 IndexedDB 整个读一遍（`listLocalFonts` 的 `getAll` 会把
 * 每份字体的二进制一起反序列化，只为了取元数据）。表现就是每次切页都闪一下骨架。
 *
 * 两层，各管一件事：
 *
 *  1. **数据层**（`readThrough`）—— 包在真正的取数函数外面（`api/*` 与 `lib/local*`）。
 *     新鲜期内直接给上次的结果，不发请求；并发的同名读取共用同一个 Promise
 *     （概览里 `apiDashboard.stats()` 与 `apiOrders.list()` 撞车就是这么消掉的）。
 *  2. **快照层**（`remember` / `peek`）—— 页面把「上次渲染用的那一整套状态」整个存下来。
 *     下次进这一页直接拿它做 `useState` 初值 ⇒ 首帧就是内容，没有骨架闪一下。
 *     只存页面自己算好的产物，不参与取数逻辑。
 *
 * ⚠️ **写操作必须让缓存失效**，否则用户改完东西看不到自己的改动。
 * 失效点一律放在**写函数内部**（`local*` 的三个写函数、`api/client.ts` 的各 mutation），
 * 不放调用方 —— 调用方有七八处，漏一处就是一个查不出来的脏读 bug。
 *
 * ⚠️ 缓存是**模块级**的：整页刷新（F5 / 直接输网址）会重建 JS 上下文 ⇒ 缓存天然清空。
 * 这是刻意的 —— 刷新页面永远拿到最新数据，也是 E2E 每次 `page.goto` 都不受影响的依据。
 */

/** 取数缓存的键。集中在这里，避免各处手写字符串拼错 */
export const CACHE_KEYS = {
  /** 云端订单列表（`GET /api/orders`） */
  orders: "cloud:orders",
  /** 云端字体登记（`GET /api/fonts`） */
  fonts: "cloud:fonts",
  /** 云端操作台账（`GET /api/audit`） */
  audit: "cloud:audit",
  /** 本机字体库元数据（IndexedDB fonts，不含字体本体） */
  localFonts: "local:fonts",
  /** 本机客户库（IndexedDB customers） */
  localCustomers: "local:customers",
  /** 本机订单关联（IndexedDB orders） */
  localOrderNotes: "local:orders",
  /** 本机追溯历史（IndexedDB traces） */
  localTraces: "local:traces",
} as const;

/**
 * 页面快照的键（`rememberPage` / `peekPage`）。
 *
 * 快照 = 这一页上次渲染用的整套 state。下次进这一页直接拿它当 `useState` 初值，
 * 首帧就是内容 ⇒ 不再闪骨架。**它比数据层缓存更"重"也更容易过期**，
 * 所以用「自上次写入以来没被写过」这个条件来卡（见 `peekPage`）。
 */
export const PAGE_KEYS = {
  overview: "page:overview",
  fonts: "page:fonts",
  orders: "page:orders",
  clients: "page:clients",
  settings: "page:settings",
  issue: "page:issue",
  trace: "page:trace",
} as const;

/**
 * 新鲜期。期内**不发任何请求**；过期后照常去取新值（页面用快照顶着，不会闪骨架）。
 *
 * 30 秒的理由：门户里所有会改变数据的动作都走本机、且都会主动失效缓存，
 * 这个时间只是兜底 —— 覆盖「另一台设备/另一个标签页改了云端数据」这种情况。
 * 用户的操作永远立刻可见（靠失效），所以调大也没关系，调小只是多几次无用请求。
 */
export const CACHE_MAX_AGE = 30_000;

interface Entry {
  value: unknown;
  at: number;
  /** 存下来时的失效代数；仅页面快照用它做有效性判定 */
  epoch?: number;
}

const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

/**
 * 失效代数。任何一次失效都 +1，两个用途：
 *  1. 取数开始时记下当前代数，回来时代数变了就**不写回缓存**
 *     （说明这次读的过程中有人写了数据，它拿到的结果已经旧了）；
 *  2. 页面快照用它判断"存下来之后有没有被写过"。
 * 用一个全局计数器而不是每个键一个，是为了不可能漏判。
 */
let epoch = 0;

/** 读缓存（同步，忽略新鲜期）。页面用它取 `useState` 初值 */
export function peek<T>(key: string): T | undefined {
  return entries.get(key)?.value as T | undefined;
}

/** 写缓存。页面把渲染用的整套状态存下来，供下次进入本页时立即出内容 */
export function remember<T>(key: string, value: T): void {
  entries.set(key, { value, at: Date.now() });
}

/**
 * 存页面快照。与 `remember` 的区别：**任何一次写入都会让它作废**。
 *
 * 为什么这么严：快照里装的是"上次这一页长什么样"，一旦有写操作发生，本机上别的
 * 页面的快照就可能是错的（比如刚加完字体，概览里的字体数已经不对了）。
 * 与其维护"哪个快照依赖哪份数据"的映射，不如让写入把快照全清掉 ——
 * 写操作是用户主动动作、频率低，代价只是那一瞬间少省一次取数。
 */
export function rememberPage<T>(key: string, value: T): void {
  entries.set(key, { value, at: Date.now(), epoch });
}

/**
 * 读页面快照 —— **只在"自它存下来之后没有任何写入"时才返回**，否则返回 undefined
 * （调用方回落到正常的取数路径，也就是那一页会短暂显示载入态）。
 */
export function peekPage<T>(key: string): T | undefined {
  const e = entries.get(key);
  if (!e || e.epoch !== epoch) return undefined;
  return e.value as T;
}

/** 清掉若干键（含页面的快照键）。写函数成功后调用 */
export function invalidate(...keys: string[]): void {
  for (const k of keys) entries.delete(k);
  epoch++;
}

/** 全清。换账号、恢复备份、导入数据这类「整库都变了」的场合用 */
export function invalidateAll(): void {
  entries.clear();
  epoch++;
}

/**
 * 带缓存的取数。
 *
 * - 新鲜期内直接返回上次结果（**不发请求**）
 * - 同一键的并发调用共用同一个 Promise（一次进多个页面也只发一次）
 * - 取数期间有人写数据 ⇒ 结果不写回缓存（下次读会重新取）
 *
 * @param key     `CACHE_KEYS` 里的键
 * @param fetcher 真正去取数的函数；抛错就原样抛给调用方，不缓存失败结果
 */
export async function readThrough<T>(
  key: string,
  fetcher: () => Promise<T>,
  maxAgeMs: number = CACHE_MAX_AGE,
): Promise<T> {
  const hit = entries.get(key);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.value as T;

  const flying = inflight.get(key);
  if (flying) return flying as Promise<T>;

  const started = epoch;
  const p = (async () => {
    try {
      const value = await fetcher();
      if (epoch === started) remember(key, value);
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** 仅供测试：清空全部缓存与在途记录 */
export function resetCache(): void {
  entries.clear();
  inflight.clear();
  epoch++;
}
