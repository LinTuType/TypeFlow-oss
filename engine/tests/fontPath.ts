/**
 * 测试字体的统一解析 —— 让同一套测试在本机与 CI 都能跑。
 *
 * 背景：这些测试原本各自硬编码父仓库 TypeFlow/tests/ 下的样本路径。
 * CI 的干净 checkout 里没有它们（xingyun 4.1 MB / HYBuDai 20.8 MB），
 * 于是「引擎一致性」这个项目最核心的不变量长期只能在本机验证 ——
 * 2026-09-17 就因此漏过一轮回归（worker:integration 坏了而 CI 全绿）。
 *
 * 解析优先级：
 *   1) TF_FONT_SUBSET=1   —— 强制用仓库内子集样本（CI 与本地复现 CI 都用它）
 *   2) TF_FONT_DIR        —— 指向含真实样本的目录（本机可显式指定）
 *   3) 父仓库 tests/      —— 本机开发的默认（全量样本，测试更真实）
 *   4) engine/tests/fixtures/ —— 兜底：仓库内子集样本
 *
 * 子集样本由候选池前 400 字 + basic Latin 生成（见各文件的字形数说明），
 * 满足 ANCHOR_COUNT 60 + PAIR_COUNT 60 + NOISE_COUNT 100 = 220 个合格字形。
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

/** 本机开发的默认样本目录（父仓库） */
const LOCAL_FULL_DIR =
  "/Users/junzhong/Documents/AI Programs/font_watermark_tool/TypeFlow/tests";

/** 仓库内小样本目录（CI 靠它） */
export const FIXTURES_DIR = join(ROOT, "engine", "tests", "fixtures");

/** 真样本文件名 → 仓库内子集样本文件名 */
const SUBSET_MAP: Record<string, string> = {
  "xingyun-Regular.ttf": "xingyun-subset.ttf",
  "HYBuDaiXiongBasicW.ttf": "hybudai-subset.ttf",
};

/** 测试用到的两个样本字体（真名，喂给 resolveFont） */
export const FONT_XINGYUN = "xingyun-Regular.ttf";
export const FONT_HYBUDAI = "HYBuDaiXiongBasicW.ttf";

/**
 * 解析某个样本字体的实际路径。
 * 找不到时**抛错而不是回落到别的字体** —— 静默用错字体产生的"绿"毫无意义。
 */
export function resolveFont(filename: string): string {
  // CI 场景：显式要求用仓库内子集样本（比拼 TF_FONT_DIR 路径省事，
  // 也让我们能在本机复现「CI 用子集样本」这条路 —— 否则它永远跑不到）
  if (process.env.TF_FONT_SUBSET === "1") {
    const subset = SUBSET_MAP[filename];
    if (subset) {
      const p = join(FIXTURES_DIR, subset);
      if (existsSync(p)) return p;
    }
  }

  const dir = process.env.TF_FONT_DIR;
  if (dir) {
    const p = join(dir, filename);
    if (existsSync(p)) return p;
  }

  const local = join(LOCAL_FULL_DIR, filename);
  if (existsSync(local)) return local;

  const subset = SUBSET_MAP[filename];
  if (subset) {
    const p = join(FIXTURES_DIR, subset);
    if (existsSync(p)) return p;
  }

  throw new Error(
    `找不到测试字体 ${filename}。已尝试：` +
      `${dir ? `TF_FONT_DIR=${dir}、` : ""}${LOCAL_FULL_DIR}、` +
      `${FIXTURES_DIR}/${subset ?? "(无对应子集)"}。` +
      `本机请确认父仓库样本在位，或设 TF_FONT_DIR 指向样本目录。`,
  );
}

/** 当前解析到的样本来源，供测试打印（CI 日志里一眼看出用的哪份） */
export function fontSourceLabel(path: string): string {
  if (path.startsWith(FIXTURES_DIR)) return "仓库内子集样本";
  if (path.startsWith(LOCAL_FULL_DIR)) return "本机全量样本";
  return "TF_FONT_DIR 指定";
}
