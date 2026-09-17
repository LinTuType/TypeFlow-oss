/**
 * 厂牌（授权方）—— 本机唯一来源
 *
 * 为什么单独一个文件：这几个键原先在 Settings.tsx / backup.ts / backupFolder.ts
 * 各有一份定义，而授权书的两处文书（屏幕预览、打印导出）又都不读它——结果是
 * 用户在设置里填了「某某字库」，签发出来的文书上仍然写死「文镇 TypeFlow」，
 * 印章也盖的是「文镇」。文书上出现平台名，等于拿平台的名义替用户授权。
 *
 * 所以这里定死三件事：
 *   ① 键名与读写只有一处实现，三处引用同一份；
 *   ② 抬头 / 落款 / 印章三处都从 readFoundry() 取；
 *   ③ **未填厂牌时给中性占位（「（未设置授权方）」），绝不回落成「文镇」**。
 *
 * 全部只存本机 localStorage，不上云；随本机段备份（backup.ts）一起搬运。
 * 本文件不依赖 DOM 之外的任何东西，保持可在 node 测试里被 import。
 */

/** 印章形状：圆 / 方 / 不盖 */
export type SealShape = "round" | "square" | "none";

export const FOUNDRY_KEYS = {
  name: "typeflow_foundry_name",
  short: "typeflow_foundry_short",
  site: "typeflow_foundry_site",
  seal: "typeflow_foundry_seal",
} as const;

export interface Foundry {
  /** 授权方全称（写进文书抬头与落款） */
  name: string;
  /** 授权方简称（印章文字） */
  short: string;
  /** 官网（抬头下方一行小字） */
  site: string;
  /** 印章形状 */
  seal: SealShape;
}

/** 未填时的中性占位（**不是**「文镇」——文书上不该出现平台名） */
export const LICENSOR_PLACEHOLDER = "（未设置授权方）";

export const EMPTY_FOUNDRY: Foundry = { name: "", short: "", site: "", seal: "round" };

function normSeal(v: string | null | undefined): SealShape {
  return v === "square" || v === "none" ? v : "round";
}

/** 读取厂牌（缺项回落空串 / 圆章；不抛错） */
export function readFoundry(): Foundry {
  if (typeof localStorage === "undefined") return { ...EMPTY_FOUNDRY };
  return {
    name: localStorage.getItem(FOUNDRY_KEYS.name) ?? "",
    short: localStorage.getItem(FOUNDRY_KEYS.short) ?? "",
    site: localStorage.getItem(FOUNDRY_KEYS.site) ?? "",
    seal: normSeal(localStorage.getItem(FOUNDRY_KEYS.seal)),
  };
}

/**
 * 写入厂牌。**局部更新语义**：只写传入的键，其余保持原值——
 * 旧备份（v1–v3 的 foundry 段只有 name/short/site）导入时不会把印章形状清掉。
 */
export function writeFoundry(f: Partial<Foundry>): void {
  if (typeof localStorage === "undefined") return;
  const put = (k: string, v: string | undefined) => {
    if (v === undefined) return;
    localStorage.setItem(k, v);
  };
  put(FOUNDRY_KEYS.name, f.name);
  put(FOUNDRY_KEYS.short, f.short);
  put(FOUNDRY_KEYS.site, f.site);
  if (f.seal !== undefined) localStorage.setItem(FOUNDRY_KEYS.seal, normSeal(f.seal));
}

/** 是否一个字段都没填（签发页据此提示「先设厂牌」） */
export function isFoundryEmpty(f: Foundry): boolean {
  return !f.name.trim() && !f.short.trim() && !f.site.trim();
}

/**
 * 清除厂牌（「清除本地数据」用）。
 * 走 FOUNDRY_KEYS 全量遍历，而不是手写四个 removeItem —— 将来加键不会再漏清。
 */
export function clearFoundry(): void {
  if (typeof localStorage === "undefined") return;
  for (const k of Object.values(FOUNDRY_KEYS)) localStorage.removeItem(k);
}

/** 文书抬头（授权方全称）；未填给中性占位，绝不回落「文镇」 */
export function licensorTitle(f: Foundry): string {
  return f.name.trim() || LICENSOR_PLACEHOLDER;
}

/**
 * 印章文字：优先简称；简称空但全称有值，取全称前两字（反正是用户自己的名号）；
 * 两者皆空 ⇒ 返回空串，调用方据此不渲染印章。
 */
export function sealText(f: Foundry): string {
  const s = f.short.trim();
  if (s) return s;
  return f.name.trim().slice(0, 2);
}

/**
 * 印章文字折行：≤2 字 → 上「简称」下「印」；3–4 字 → 均分两行（四字章不加「印」）。
 * 超过 4 字截前 4 字——印章本来就是缩写，不是用来放全称的。
 */
export function sealLines(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  if (t.length <= 2) return [t, "印"];
  const cut = t.slice(0, 4);
  const half = Math.ceil(cut.length / 2);
  return [cut.slice(0, half), cut.slice(half)];
}

/** 落款行（文书右下）：全称 + 官网（官网可选） */
export function signatureLine(f: Foundry): string {
  // 只写名称 —— 网址已在文书抬头的右上角出现过，署名再拼一遍是同一份信息出现两次
  return f.name.trim() || LICENSOR_PLACEHOLDER;
}
