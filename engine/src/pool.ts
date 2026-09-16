/**
 * 高频中文候选池 — 浏览器安全处理区无 fs，池内联为本模块。
 * 源数据：data/candidate_pool.json（与 Python 参考实现同源，保证一致性）。
 * 锚定候选固定来自「池 ∩ 字体 cmap」，配对/扰动来自全字形。
 */

import { CHINESE_CANDIDATES } from "./pool.data.generated.js";

let _pool: number[] | null = null;

/** 高频字池 → Unicode 码点数组（惰性加载，浏览器/Node 通用） */
export function loadAnchorPool(): number[] {
  if (_pool) return _pool;
  // 只保留 BMP 内字符（码点 < 0x10000 与 cmap format 4 对齐）
  _pool = CHINESE_CANDIDATES
    .filter((c) => c.length === 1 && c.codePointAt(0)! <= 0xffff)
    .map((c) => c.codePointAt(0)!);
  return _pool;
}