/**
 * 追溯侧用：从 CFF/CFF2 容器里读某个字形的**控制点 x 最小值**（与 glyf 的 xMin 同语义）。
 *
 * 实现方式：借用 vendor 的 `CFFGlyph` —— 它的 charstring 解释器（subr bias、hintmask、
 * CFF2 的 blend、flex 系列）是上游长期使用过的实现，比自写一遍可靠得多。
 *
 * 两处替身（避免把整个 fontkit 运行时搬进引擎）：
 *  1. **基类** 用 `glyph-base.js` 的最小替身（上游基类会拖进 `unicode-properties` 与 `@cache` 装饰器）；
 *  2. **`_variationProcessor`** 用"零权重"替身 —— 上游在 `blend` 处对 null 直接抛错
 *     （`blend operator in non-variation font`）。我们要的是**默认实例**的轮廓：
 *     默认位置上每个区域的设计空间标量都是 0，所以让 `getBlendVector` 返回全 0、
 *     长度等于该 vsindex 的区域数 k 即可 —— 数值结果就是 blend 的默认值，与不叠加增量等价。
 *
 * 解析不出来时返回 null（例如 `seac` 复合字形、未知操作符）—— 调用方把它当"字形缺失"，
 * 而不是拿一个错值去投票。
 */

import { CFFGlyph } from "../../vendor/fontkit-cff/index.js";

/**
 * @param fontkitFont vendor `CFFFont` 实例
 * @param isCFF2 容器是 CFF2 吗（CFFGlyph 从 `_font.CFF2` / `_font['CFF ']` 取）
 * @param regionCount CFF2 才有：vsindex → 区域个数 k
 */
export function makeGlyphXMin(
  fontkitFont: unknown,
  isCFF2: boolean,
  regionCount?: (vsIndex: number) => number,
): (gid: number) => number | null {
  const zeroBlend = {
    // 默认实例：所有区域权重为 0
    getBlendVector: (_vstore: unknown, vsindex: number): number[] => {
      const k = regionCount ? regionCount(vsindex) : 0;
      return new Array(Math.max(0, k)).fill(0);
    },
  };

  // CFFGlyph._getPath() 读的是 `this._font.CFF2 || this._font['CFF ']`
  const duckFont = isCFF2
    ? { CFF2: fontkitFont, _variationProcessor: zeroBlend }
    : { "CFF ": fontkitFont, _variationProcessor: null };

  return (gid: number): number | null => {
    try {
      const glyph = new CFFGlyph(gid, [], duckFont) as unknown as {
        path: { cbox: { minX: number } };
      };
      const v = glyph.path.cbox.minX;
      return Number.isFinite(v) ? Math.round(v) : null;
    } catch {
      return null;
    }
  };
}
