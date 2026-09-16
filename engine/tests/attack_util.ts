/**
 * 阶段 2 攻击生成工具集
 *
 * 所有攻击都是纯函数：输入字体字节 → 输出攻击后字节。
 * 目标是「模拟真实泄露场景」，不追求在理论层面打穿水印，
 * 而是量化两通道在常见攻击下的恢复率，决定是否需要加固。
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseSfnt, parseCmap, type TtfRaw } from "../src/ttf/reader.js";
import { rebuildFont } from "../src/ttf/writer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const OUT = join(__dirname, "out");
mkdirSync(OUT, { recursive: true });

/** 确定性 PRNG（种好于可复现测试；攻击侧用简单 LCG 足够） */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** 攻击 1：全局平移 —— 所有简单字形 x 坐标 +shift */
export function attackGlobalShift(bytes: Uint8Array, shift: number): Uint8Array {
  const raw = parseSfnt(bytes);
  return rebuildFont(raw, () => shift, null).bytes;
}

/** 攻击 2：随机污染 —— 对随机部分字形做坐标扰动（模拟坐标重排/清洗尝试） */
export function attackPollute(
  bytes: Uint8Array,
  ratio: number,
  amplitude: number,
  seed = 42,
): Uint8Array {
  const raw = parseSfnt(bytes);
  const rng = makeRng(seed);
  // 预生成 gid→shift（rebuildFont 对同一 gid 会多次调用 shifts，必须无状态）
  const shiftByGid = new Map<number, number>();
  return rebuildFont(raw, (gid) => {
    let s = shiftByGid.get(gid);
    if (s === undefined) {
      s = rng() < ratio ? Math.floor((rng() * 2 - 1) * amplitude) : 0;
      shiftByGid.set(gid, s);
    }
    return s;
  }, null).bytes;
}

/**
 * 攻击 3：子集化（仅保留部分 Unicode 码点）
 * 用 Python fontTools subset（真实子集化，与业界一致）。
 */
export function attackSubset(
  bytes: Uint8Array,
  keepRatio: number,
  seed = 7,
): { bytes: Uint8Array; kept: number } {
  const raw = parseSfnt(bytes);
  const cmap = parseCmap(raw);
  const allCps = [...cmap.map.keys()].sort((a, b) => a - b);
  const rng = makeRng(seed);
  // 决定保留哪些码点：随机保留 keepRatio 比例
  const keep = allCps.filter(() => rng() < keepRatio);
  if (keep.length < 10) keep.push(...allCps.slice(0, 10)); // 保底

  const tmpIn = join(OUT, `_subset_in_${seed}.ttf`);
  const tmpOut = join(OUT, `_subset_out_${seed}.ttf`);
  writeFileSync(tmpIn, bytes);
  const unicodes = keep.map((c) => `U+${c.toString(16).padStart(4, "0")}`).join(",");
  const res = spawnSync(
    "python3",
    [
      "-c",
      `
from fontTools import subset
font = subset.load_font(${JSON.stringify(tmpIn)}, subset.Options())
subsetter = subset.Subsetter()
subsetter.populate(text="", unicodes=[${keep.join(",")}])
subsetter.subset(font)
subset.save_font(font, ${JSON.stringify(tmpOut)}, subset.Options())
`,
    ],
    { encoding: "utf8" },
  );
  if (res.status !== 0) throw new Error(`subset 失败: ${res.stderr}`);
  const out = new Uint8Array(readFileSync(tmpOut));
  return { bytes: out, kept: keep.length };
}

/** 攻击 4：删 Name 表（不能删整个表否则读者崩溃；置空为格式0空表）——用 writer 走 nameId256=null 重建 */
export function attackStripName(bytes: Uint8Array): Uint8Array {
  const raw = parseSfnt(bytes);
  return rebuildFont(raw, () => 0, null).bytes;
}

/** 攻击 5：子集化 + 删 Name 组合（最真实泄露场景） */
export function attackSubsetStripName(
  bytes: Uint8Array,
  keepRatio: number,
  seed = 11,
): { bytes: Uint8Array; kept: number } {
  const s = attackSubset(bytes, keepRatio, seed);
  return { bytes: attackStripName(s.bytes), kept: s.kept };
}

/** 计算两个码点数组的重叠率（用于多订单交叉对比） */
export function overlapRatio(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const hit = a.filter((x) => setB.has(x)).length;
  return hit / Math.min(a.length, b.length);
}

/**
 * 攻击 6：子集化为「仅高频字版本」—— 用户场景：重打包常用字子集，
 * 移除所有非常用字。若锚定锁定常用字池，水印应存活；若全字形选取则会被移除。
 */
export function attackCommonCharsSubset(
  bytes: Uint8Array,
  seed = 13,
): { bytes: Uint8Array; kept: number } {
  const raw = parseSfnt(bytes);
  const cmap = parseCmap(raw);
  const allCps = [...cmap.map.keys()].sort((a, b) => a - b);
  // 模拟"只保留常用字"：保留码点 ≤ 0x4E00+常用字池内 或 ASCII——按池与字体交集
  const pool = JSON.parse(readFileSync(join(__dirname, "../../data/candidate_pool.json"), "utf8")) as {
    chars: string[];
  };
  const poolCps = new Set(pool.chars.filter((c) => c.codePointAt(0)! <= 0xffff).map((c) => c.codePointAt(0)!));
  const keep = allCps.filter((cp) => poolCps.has(cp));

  const tmpIn = join(OUT, `_common_in_${seed}.ttf`);
  const tmpOut = join(OUT, `_common_out_${seed}.ttf`);
  writeFileSync(tmpIn, bytes);
  const res = spawnSync(
    "python3",
    [
      "-c",
      `
from fontTools import subset
font = subset.load_font(${JSON.stringify(tmpIn)}, subset.Options())
subsetter = subset.Subsetter()
subsetter.populate(text="", unicodes=[${keep.join(",")}])
subsetter.subset(font)
subset.save_font(font, ${JSON.stringify(tmpOut)}, subset.Options())
`,
    ],
    { encoding: "utf8" },
  );
  if (res.status !== 0) throw new Error(`常用字子集失败: ${res.stderr}`);
  const out = new Uint8Array(readFileSync(tmpOut));
  return { bytes: out, kept: keep.length };
}