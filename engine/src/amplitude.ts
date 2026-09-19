/**
 * 水印位移幅度 —— 按字体的 em 归一化。
 *
 * ## 为什么需要它
 *
 * 位移的「可见性」和「信噪比」都取决于它**占 em 的比例**，而不是绝对单位数。
 * 固定 ±2 在 upm=1000 的中文字体上是 0.20% em；换到 upm=2048 的拉丁字体上只剩 0.10% em
 * —— 信号强度直接减半（实测 upm 2048→1000 时通道 A 只剩 10/20、ρ 掉到 0.012）。
 * 反过来，upm=512 或 256 的字体上同一个 ±2 又偏强、可能肉眼可见。
 *
 * ## 公式
 *
 * ```
 * amplitude = max(1, round(upm × 0.002))
 * ```
 *
 * | upm | 1000 | 2000 | 2048 | 512 | 256 |
 * |---|---|---|---|---|---|
 * | amplitude | **2** | 4 | 4 | 1 | 1 |
 *
 * upm=1000 → 2，与 web-v1 / web-v2 的固定 ±2 **逐字节一致** ⇒ 那两类字体产物不变。
 *
 * ## 两条纪律
 *
 * ⚠️ **扰动幅度必须用同一个 `amplitude`**（`webv1.runSelection` 生成 `noise_shifts`、
 * `shiftmap.buildShiftMap` 施加锚定/配对）。只用在一处会让"信号幅度"与"噪声幅度"不一致，
 * 锚定字在产物里一眼可挑 —— 那正是这套方案最怕的事（锚定字集合被定位）。
 *
 * ⚠️ **取整规则两端必须逐字一致**：JS 用 `Math.round`（半数向上），
 * Python 侧必须写 `math.floor(x + 0.5)`。Python 内置 `round` 是**半数取偶**
 * （`round(0.5)==0` 而 `round(1.5)==2`）⇒ 在 upm=250/750/1250 这类正好落在半数的取值上
 * 会与 JS 分叉。**别用内置 round。**（两端各有一份同式实现，改一处必须改另一处。）
 */

/** 位移幅度占 em 的比例（0.2% em） */
export const AMPLITUDE_EM_RATIO = 0.002;

/** 幅度下限：再小的字体也至少位移 1 个单位，否则等于不嵌 */
export const AMPLITUDE_MIN = 1;

/**
 * 由 `head.unitsPerEm` 得到这次签发使用的位移幅度（单位：字体坐标单位 / FUnit）。
 *
 * 读侧（追溯）**不需要**知道这个值：相关性 ρ 是归一化量、位路径只看符号
 * ⇒ 存量订单不会因为强度改变而失效。这里只在**写侧**（签发）使用。
 */
export function shiftAmplitude(unitsPerEm: number): number {
  return Math.max(AMPLITUDE_MIN, Math.round(unitsPerEm * AMPLITUDE_EM_RATIO));
}
