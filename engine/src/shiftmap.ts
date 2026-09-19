/**
 * 选择结果 → 逐字形位移映射（**两条容器路径共用**）
 *
 * 从 `embed.ts` 抽出来，是为了让 TTF 与 OTF 两条路走**完全同一套**码点→gid→位移的换算与冲突检测：
 * 只要这里只有一份实现，"两种字体签出来的水印语义一致"才是结构性成立的，而不是靠两边小心对齐。
 *
 * 通道约定（与 webv1 的选择规则配对；`A` = `selection.shift_amplitude`）：
 *   通道 A（锚定，60 位）：bit=1 → +A，bit=0 → −A
 *   通道 B（配对，60 位）：反向 —— bit=1 → −A，bit=0 → +A
 *   扰动（100 位）：noise_shifts[码点]（值域 [−A, +A]，可能为 0 → 该字形不动）
 *
 * ⚠️ **A 不是常量**：它由字体 `head.unitsPerEm` 决定（见 `amplitude.ts`）。
 *    这里刻意**只读 `selection.shift_amplitude`** —— 不让调用方各自传一个数进来，
 *    否则"锚定用 4、扰动还用 2"这种不自洽会在产物里静默发生（锚定字一眼可挑）。
 */

import type { SelectionResult } from "./webv1.js";

export interface ShiftAssignment {
  /** gid → bit（通道 A） */
  anchorGid: Map<number, number>;
  /** gid → bit（通道 B） */
  pairGid: Map<number, number>;
  /** gid → 位移（扰动） */
  noiseGid: Map<number, number>;
  /** gid → 位移量；未命中返回 0 */
  shifts: (gid: number) => number;
  /**
   * **致命**冲突（非空 ⇒ 调用方必须拒绝签发）。
   * 只可能是锚定之间撞同一个字形且 bit 不同 —— 那是真的无法同时满足。
   */
  fatal: string[];
  /**
   * **已按优先级让位**的冲突（可签发，但要能看见）。
   *
   * 为什么会出现：CID 字体（中文/日文商业字库的常态）里**多个码点常常映射到同一个字形**
   * （半角/全角、兼容字、异体字）。选择是按**码点**做的（v1 已冻结，改不了），
   * 于是同一个 gid 可能既被配对码点命中、又被扰动码点命中。
   *
   * 处置：按 锚定 > 配对 > 扰动 让位。让位是安全的 ——
   *   - 锚定位（决定 20 bit）永远优先，不受影响；
   *   - 配对通道（通道 B）本来就是"按方向一致率投票"，个别样本被覆盖不影响判定；
   *   - 扰动是装饰性的（只是让位移看起来不整齐），少一个完全没有语义损失。
   * 早先的实现在这类字体上**直接抛错**，等于真实中日文 OTF 一台都签不了。
   */
  degraded: string[];
}

export function buildShiftMap(
  selection: SelectionResult,
  cmap: Map<number, number>,
): ShiftAssignment {
  const anchorGid = new Map<number, number>();
  const pairGid = new Map<number, number>();
  const noiseGid = new Map<number, number>();
  const fatal: string[] = [];
  const degraded: string[] = [];

  const bits = selection.bits;
  const expanded: number[] = [];
  for (const b of bits) expanded.push(b, b, b); // 20 bit 展开成 60 位（每位 3 个字形冗余）

  // 位移幅度：**只认选择结果里的这一个值**（由字体 upm 推导，见 amplitude.ts）。
  // 三个通道共用它 —— 只用在一处会让信号与噪声幅度不一致。
  const amp = selection.shift_amplitude;
  if (!Number.isInteger(amp) || amp < 1) {
    // fail closed：拿不到幅度就不签 —— 猜一个值会静默产出"锚定与扰动不同强度"的字形
    throw new Error(`位移幅度非法: shift_amplitude=${String(amp)}（应由字体 unitsPerEm 推导，最小 1）`);
  }

  // ① 锚定：唯一的致命冲突来源
  selection.anchors.forEach((cp, i) => {
    const gid = cmap.get(cp);
    if (gid === undefined) return;
    const bit = expanded[i] ?? 0;
    const prev = anchorGid.get(gid);
    if (prev !== undefined && prev !== bit) {
      fatal.push(`gid${gid}:anchor(${prev})+anchor(${bit})`);
      return;
    }
    anchorGid.set(gid, bit);
  });

  // ② 配对：撞到锚定就让位；两条配对撞同一 gid 时后者也记一笔（通道 B 容忍）
  selection.pairs.forEach((cp, i) => {
    const gid = cmap.get(cp);
    if (gid === undefined) return;
    if (anchorGid.has(gid)) { degraded.push(`gid${gid}:pair→anchor`); return; }
    const bit = expanded[i] ?? 0;
    const prev = pairGid.get(gid);
    if (prev !== undefined && prev !== bit) degraded.push(`gid${gid}:pair(${prev})+pair(${bit})`);
    pairGid.set(gid, bit);
  });

  // ③ 扰动：撞到锚定或配对就让位
  for (const cp of selection.noises) {
    const gid = cmap.get(cp);
    if (gid === undefined) continue;
    if (anchorGid.has(gid)) { degraded.push(`gid${gid}:noise→anchor`); continue; }
    if (pairGid.has(gid)) { degraded.push(`gid${gid}:noise→pair`); continue; }
    noiseGid.set(gid, selection.noise_shifts[String(cp)] ?? 0);
  }

  const shifts = (gid: number): number => {
    const a = anchorGid.get(gid);
    if (a !== undefined) return a === 1 ? amp : -amp; // 通道 A 正/负
    const p = pairGid.get(gid);
    if (p !== undefined) return p === 1 ? -amp : amp; // 通道 B 反向
    return noiseGid.get(gid) ?? 0;
  };

  return { anchorGid, pairGid, noiseGid, shifts, fatal, degraded };
}
