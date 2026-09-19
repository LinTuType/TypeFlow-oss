/**
 * web-v1 本地追溯引擎 — 阶段 1
 *
 * 双通道：
 *   通道 A：锚定字绝对位移。比较原版与可疑字体锚定字的 xMin（或任一 x 坐标）
 *           diff = susp - orig，bit=1 → +2，bit=0 → -2
 *   通道 B：字间配对相对间距。spacing = pair.xMin - anchor.xMin，
 *           比较原版与可疑的 spacing 差：bit=1 → 负，bit=0 → 正
 *
 * 流程：
 *   1. 有 Name ID 256 → 直接读出 order_id/algo_version → 用同一主密钥重算锚定/配对
 *   2. 无 Name ID → 候选订单恢复（传入候选 orders，逐个对比，取命中率最高者）
 *
 * 与桌面版最大差异：这里全部在本地决策，无云端参与（阶段 4 再接云端配方）。
 */

import { runSelection, ALGO_VERSION, ALGO_VERSION_LEGACY_TTF } from "./webv1.js";
import { loadAnchorPool } from "./pool.js";
import type { CryptoProvider } from "./crypto.js";
import {
  parseSfnt,
  parseCmap,
  assertSupportedFont,
  detectOutlineKind,
  type TtfRaw,
  type OutlineKind,
} from "./ttf/reader.js";
import { readGlyphRaw } from "./ttf/glyf.js";
import { parseNameTable, looksLikeWatermark, WATERMARK_NAME_ID } from "./ttf/name.js";
import { extractCffTable, parseCff } from "./cff/table.js";
import { cffEligibleCodepoints } from "./cff/token.js";
import { ALGO_VERSION_CFF, ALGO_VERSION_CFF_LEGACY } from "./embed.js";

export interface TraceInput {
  originalBytes: Uint8Array;
  suspiciousBytes: Uint8Array;
  masterKey?: Uint8Array;
  /** 云端派生的订单种子（配方模式）：提供后 masterKey 不再使用 */
  orderRoot?: Uint8Array;
  provider: CryptoProvider;
  tenantId: string;
  /** 当无可疑 Name 256 时，提供候选订单列表 */
  candidateOrders?: string[];
  bitsSuffix?: string;
}

export interface TraceResult {
  nameId256: string | null;
  matchedOrder: string | null;
  /** 通道 A：60 raw diff（null = 字形缺失） */
  channelA_diffs: Array<number | null>;
  /** 通道 A：多数投票后的 20 bit */
  channelA_bits: number[];
  /** 通道 A：与预期 20 bit 的命中数 / 有效位数 */
  channelA_matches: number;
  channelA_total: number;
  /** 通道 B：60 个 spacing diff / 方向 */
  channelB_diffs: Array<number | null>;
  /** 通道 B：方向与预期一致的采样数 / 有效采样数 */
  channelB_matches: number;
  channelB_total: number;
  /** 判定（对齐桌面版 compute_confidence：四级判定 + 标签 + 0-100 综合分） */
  verdict: TraceVerdict;
  /** 位与方向的一致率 0..1。⚠️ 不是"命中概率"——门户判命中看 `verdict.level`，不读这个数 */
  confidence: number;
  votes: number;
  total: number;
}

/** 追溯判定（文案与分级阈值对齐桌面版 trace_engine.compute_confidence） */
export interface TraceVerdict {
  /** high=高度可信 trusted=可信 suspicious=存疑 none=无法确认 */
  level: "high" | "trusted" | "suspicious" | "none";
  levelLabel: string;
  /** [字形完整性, 指纹吻合度, 信号质量, ...附加标签]，与桌面版 labels 同构 */
  labels: string[];
  /** 综合分 0..100（桌面版同权重：survival×30 + match/20×45 + vote×25 [+10 双通道]） */
  score: number;
  metrics: {
    survivalRate: number;
    matchCount: number;
    totalBits: number;
    checksumOk: boolean;
    offsetCorrected: boolean;
    voteAgreement: number;
    spacingConfirmed: boolean;
    /** 通道 A 的相关性（±20 扫描取最大 ρ）；与整体幅度解耦 */
    rhoA: number;
    /** 通道 B（字对间距）的相关性（去均值 Pearson） */
    rhoB: number;
    /** 判定实际采用的那个 ρ（决定定级）；null = ρ 路未启用（有效样本不足） */
    rhoUsed: number | null;
    /** 采用 ρ 的有效样本数 */
    rhoValid: number;
    /** 该 ρ 来自哪一通道 */
    rhoChannel: "A" | "B" | null;
    /** 该 ρ 是否需要先扣偏移才成立 */
    rhoOffsetApplied: boolean;
    /**
     * 位移幅度分布（只数**非空**的 60 个锚定字观察值）：
     * 满幅（\|d\| ≥ 1.5）/ 小幅度（0.5 ≤ \|d\| < 1.5）/ 归零（\|d\| < 0.5）。
     *
     * ⚠️ 这是**观察值**，不设阈值、不参与定级。用途只有一个：
     * 正常字体被改过的字形几乎都带满幅 ±2；**被"多副本取平均"过的字体**会出现大量 0 与小幅度
     * （实测 k=2 已可见、k=5 时多数锚定字形归零）⇒ 报告里能看出来「这不像是单份签发物」。
     */
    dispFull: number;
    dispSmall: number;
    dispZero: number;
  };
}

/**
 * 读取可疑字体 Name ID 256（若无返回 null）。
 *
 * ⚠️ 与 `embed.findExistingWatermark` 同一条纪律：**按内容判，不按编号判**。
 * Name ID 256 属于 OpenType 的"字体自定义"区间，可变字体的轴实例名正好从这里开始
 * （思源黑体 SC VF 的 `(3,1,1033,256)` = `Regular`）—— 按编号判会把实例名当成水印，
 * 追溯页会显示一串与订单无关的字，甚至拿它去当订单号。
 */
export function readNameId256(data: Uint8Array): string | null {
  const raw = parseSfnt(data);
  const off = raw.tableOffsets.get("name");
  const len = raw.tableLengths.get("name");
  if (off === undefined || len === undefined) return null;
  const r = parseNameTable(raw.data, off, len)
    .find((n) => n.nameID === WATERMARK_NAME_ID && looksLikeWatermark(n.value));
  return r ? r.value : null;
}

/** 移除可疑字体的 Name ID 256（阶段 1 通过 writer.rebuildFont(nameId256=null) 实现；此 helper 预留） */
export function stripNameId256(data: Uint8Array): Uint8Array {
  return data; // 占位：实际剥离在测试里经 writer 完成（避免重复实现 sfnt 重建）
}

/**
 * 获取某字形当前 xMin（glyf 简单字形）—— **从实际坐标算，不读字形头里缓存的 bbox**。
 *
 * ⚠️ 这一条是 2026-09-18 用 111 份真实字体扫出来的（51 份追溯不到）：
 * 不少老中文字体（仿宋_GB2312、方正整套、思源黑体静态 OTF…）**字形头里的 bbox 字段是陈旧/错误的**
 * （实测见到 `xMin=0 yMin=-36 xMax=256 yMax=-36` 这种 yMin==yMax 的不可能值）。
 * 我们的**写回**会把该字段重算成正确的（`encodeGlyph` 里逐点重算），于是追溯端读缓存值时，
 * 「位移」= 重算值 − 陈旧值 = −26 / −53 这种随机数 ⇒ 位解码全错 ⇒ 判成「无法确认」。
 *
 * 桌面版从一开始就是按实际坐标算的（`watermark/name_table.py · get_glyph_xmin`，
 * 注释写着「从实际坐标计算，避免缓存值不准确」）—— web 这边漏了，两边不一致。
 */
function glyfBoundX(raw: TtfRaw, gid: number, which: "min" | "max"): number | null {
  // 入口已过 assertSupportedFont；这里仍防御式判空（此前是 ! 断言，OTF 会读到垃圾偏移）
  const glyfOff = raw.tableOffsets.get("glyf");
  const locaOff = raw.tableOffsets.get("loca");
  const headOff = raw.tableOffsets.get("head");
  const maxpOff = raw.tableOffsets.get("maxp");
  if (glyfOff === undefined || locaOff === undefined || headOff === undefined || maxpOff === undefined) {
    return null;
  }
  const i2l = ((raw.data[headOff + 50] << 8) | raw.data[headOff + 51]) >>> 0;
  const nGlyphs = ((raw.data[maxpOff + 4] << 8) | raw.data[maxpOff + 5]) >>> 0;
  if (gid >= nGlyphs) return null;
  const p0 =
    i2l === 0
      ? (((raw.data[locaOff + gid * 2] << 8) | raw.data[locaOff + gid * 2 + 1]) >>> 0) * 2
      : (((raw.data[locaOff + gid * 4] << 24) | (raw.data[locaOff + gid * 4 + 1] << 16) |
          (raw.data[locaOff + gid * 4 + 2] << 8) | raw.data[locaOff + gid * 4 + 3]) >>> 0);
  const d = raw.data.slice(glyfOff);
  const g = readGlyphRaw(d, p0);
  if (!g || g.absX.length === 0) return null;
  // 逐点取端点（与桌面版同一口径）；缓存字段 g.xMin / g.xMax 都不可信
  let v = g.absX[0];
  for (let i = 1; i < g.absX.length; i++) {
    if (which === "min" ? g.absX[i] < v : g.absX[i] > v) v = g.absX[i];
  }
  return v;
}

/** 逐字形轮廓读取器 —— **容器无关**：glyf 与 CFF/CFF2 都走同一接口 */
export interface GlyphReader {
  kind: OutlineKind;
  /**
   * 控制点 x 最小值；读不出返回 null（调用方按"字形缺失"处理，不参与投票）。
   * **通道 B（配对间距）用这个** —— 与桌面版 `pairing.py · extract_pair_spacing` 一致。
   */
  xMin(gid: number): number | null;
  /**
   * 控制点 x **最大值**；**通道 A（锚定位）用这个** —— 与桌面版
   * `services/watermark_service.py · decode_trace_bits`（走 `get_glyph_xmax`）一致。
   * 两个通道用不同端点不是笔误：这是 2026-09-18 与桌面版对齐时确认的口径。
   */
  xMax(gid: number): number | null;
  /** CFF/CFF2 才有：候选码点（与签发侧同一判据）。glyf 侧为 undefined ⇒ 由选择器按 glyf 口径现算 */
  eligible?: number[];
}

/**
 * 打开轮廓读取器。CFF 侧复用 `cff/table` 的容器句柄（内部用 vendor 的 charstring 解释器，
 * 见 `cff/glyph.ts`）—— 追溯要处理**客户转换过格式**的水印字体，所以读法必须与写侧同源。
 *
 * 顺带把候选集也算出来（同一份容器只解析一次），供选择器复用。
 */
export function openGlyphReader(raw: TtfRaw): GlyphReader {
  const kind = detectOutlineKind(raw);
  if (kind === null) throw new Error("不支持的轮廓容器");
  if (kind === "glyf") {
    return {
      kind,
      xMin: (gid: number) => glyfBoundX(raw, gid, "min"),
      xMax: (gid: number) => glyfBoundX(raw, gid, "max"),
    };
  }
  const table = extractCffTable(raw.data, raw.tableOffsets, raw.tableLengths);
  if (!table) throw new Error("缺少 CFF / CFF2 表");
  const cff = parseCff(table.bytes, table.isCFF2);
  const cmap = parseCmap(raw).map;
  return {
    kind,
    xMin: (gid: number) => cff.glyphXMin(gid),
    xMax: (gid: number) => cff.glyphXMax(gid),
    eligible: cffEligibleCodepoints(cmap, (gid) => cff.getCharString(gid), {
      isCFF2: cff.isCFF2,
      regionCount: (v) => cff.regionCount(v),
    }),
  };
}

/**
 * 对一个已知订单的预期位序列，比较原版 vs 可疑，产出双通道观测。
 */
function compareWithOrder(
  orig: GlyphReader,
  susp: GlyphReader,
  origCmap: Map<number, number>,
  suspCmap: Map<number, number>,
  anchors: number[],
  pairs: number[],
  bits20: number[],
): { aDiffs: Array<number | null>; aBits: number[]; bDiffs: Array<number | null>; bestOffset: number } {
  const expanded: number[] = [];
  for (const b of bits20) expanded.push(b, b, b);

  const aDiffs: Array<number | null> = [];
  const bDiffs: Array<number | null> = [];
  /** 通道 A 的原始 xMax 对，供末尾的逆缩放校正使用（null = 该字形缺失） */
  const aXs: Array<{ ox: number; sx: number } | null> = [];

  anchors.forEach((cp, i) => {
    const og = origCmap.get(cp);
    const sg = suspCmap.get(cp);
    if (og === undefined || sg === undefined) {
      aDiffs.push(null);
      aXs.push(null);
      bDiffs.push(null);
      return;
    }
    // 通道 A 看 **xMax**（与桌面版 get_glyph_xmax 一致）
    const ox = orig.xMax(og);
    const sx = susp.xMax(sg);
    if (ox !== null && sx !== null) {
      aXs.push({ ox, sx });
      aDiffs.push(sx - ox);
    } else {
      aXs.push(null);
      aDiffs.push(null);
    }

    // 通道 B：配对字相对锚定字间距
    const pc = pairs[i];
    if (pc === undefined) {
      bDiffs.push(null);
      return;
    }
    const opg = origCmap.get(pc);
    const spg = suspCmap.get(pc);
    if (opg === undefined || spg === undefined) {
      bDiffs.push(null);
      return;
    }
    const opx = orig.xMin(opg);
    const osx = orig.xMin(og);
    const spx = susp.xMin(spg);
    const ssx = susp.xMin(sg);
    if (opx === null || osx === null || spx === null || ssx === null) {
      bDiffs.push(null);
      return;
    }
    const origSpacing = opx - osx;
    const suspSpacing = spx - ssx;
    bDiffs.push(suspSpacing - origSpacing);
  });

  // ── 逆缩放校正（移植桌面版 `services/watermark_service.py:136-162`）──
  //
  // 字体若被整体缩放 (s·x)，则 diff = (s−1)·orig + s·wm_shift —— 污染项 (s−1)·orig 可达数百，
  // **把 ±2 的水印整个淹没**（实测 upm 2048→1000 时，通道 A 只剩 10/20、ρ 掉到 0.012）。
  // 用**中位数比值**估 s（抗个别字形的异常），再把差值折回去。
  //
  // ⚠️ 与"upm 归一化"（B8）是两件事：这里只改**差值**，不碰字体本体、也不读 `unitsPerEm`。
  // ⚠️ 桌面版把这段写在 `decode_trace_bits` 内、只作用于通道 A，这里保持一致。
  // ⚠️ 闸门同桌面：至少 30 个比值、且 |s−1| > 0.01 才动手（正常字体的 s≈1.000，不会被误校正）。
  const ratios: number[] = [];
  for (const p of aXs) if (p && p.ox !== 0) ratios.push(p.sx / p.ox);
  if (ratios.length >= 30) {
    const sorted = [...ratios].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    const s = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    if (Math.abs(s - 1) > 0.01) {
      for (let i = 0; i < aDiffs.length; i++) {
        const p = aXs[i];
        if (!p) continue;
        aDiffs[i] = p.sx / s - p.ox;
      }
    }
  }

  // 通道 A：平移扫描（对抗全局平移 ±20）—— 仿桌面版 offset_scan_decode
  // 对每个候选 offset，把 diff+offset 后判位做多数投票，取与预期 20bit 匹配最多的 offset
  const bestOffset = scanBestOffset(aDiffs, bits20);
  const aBits: number[] = [];
  for (let b = 0; b < 20; b++) {
    const group = aDiffs.slice(b * 3, b * 3 + 3).filter((d): d is number => d !== null);
    const ones = group.filter((d) => d + bestOffset > 0).length;
    aBits.push(group.length > 0 && ones > group.length / 2 ? 1 : 0);
  }
  return { aDiffs, aBits, bDiffs, bestOffset };
}

/** 平移扫描：在 [-OFFSET_SCAN_WIDE, OFFSET_SCAN_WIDE] 内找最佳偏移 */
const OFFSET_SCAN_WIDE = 20;

function scanBestOffset(
  aDiffs: Array<number | null>,
  bits20: number[],
): number {
  const expanded: number[] = [];
  for (const b of bits20) expanded.push(b, b, b);

  let bestOffset = 0;
  let bestNum = -1;
  let bestDen = 1;
  for (let offset = -OFFSET_SCAN_WIDE; offset <= OFFSET_SCAN_WIDE; offset++) {
    let matches = 0;
    let valid = 0;
    for (let i = 0; i < aDiffs.length; i++) {
      const d = aDiffs[i];
      if (d === null) continue;
      const expect = expanded[i] ?? 0;
      // bit=1 → diff 预期为正（嵌入时 +2）
      const bit = d + offset > 0 ? 1 : 0;
      if (bit === expect) matches++;
      valid++;
    }
    if (valid === 0) continue;
    // 匹配率优先（整数交叉相乘避免浮点误差）；平手取 |offset| 更小者——
    // ±2 位移下 offset=-1/0/+1/+2 往往都能 100% 解码，必须归零优先，
    // 否则未动过的字体会被误判为"检测到均匀偏移干扰"
    const better = matches * bestDen > bestNum * valid;
    const tie = matches * bestDen === bestNum * valid;
    if (better || (tie && Math.abs(offset) < Math.abs(bestOffset))) {
      bestNum = matches;
      bestDen = valid;
      bestOffset = offset;
    }
  }
  return bestOffset;
}

// ── 相关检测器（ρ）—— 移植自桌面版；网页版此前**只搬了 bits 路径** ──────────────
//
// 桌面版是**三路并联**（`api/watermark_routes.py` 的 Pass 级联：bits 精确 / bits 平移校正 /
// 通道 A 的 ρ / 通道 A 的 ρ+平移扫描 / 通道 B 的间距 ρ），每个 Pass 只在前一路未命中时才跑
// ⇒ 效果是"任一成立即出结果"。网页版原先只有 bits 一路，所以同一批阈值下能扛的攻击小得多：
// 实测 35 格降级场景里，补上通道 A 的 ρ 路可一次翻回 30 格。

/** 预期方向序列（每 bit ×3）：bit=1 → +1，bit=0 → **−1**（bit=0 也要位移，所以不是 0） */
function expandDirs(bits20: number[]): number[] {
  const dirs: number[] = [];
  for (const b of bits20) {
    const d = b === 1 ? 1 : -1;
    dirs.push(d, d, d);
  }
  return dirs;
}

/**
 * 通道 A 的相关检测器 —— 口径逐行对齐桌面版 `compute_correlation`
 * （`services/watermark_service.py:190-228`）。
 *
 * ρ = Σ(d·dir) / √(Σd² × n)，dir = bit==1 ? +1 : −1。
 *
 * ⚠️ 这是"差值向量与预期方向向量的**余弦**"，**不是去均值的 Pearson** ——
 * 桌面版 docstring 里叫它 Pearson，实测公式是无均值版。两端必须用同一个，
 * 别"顺手改成真的 Pearson"（会让数值与阈值 0.35/0.45/0.50/0.67 全部失配）。
 * 好处是它与 diff 的整体幅度**解耦**：位移被整体放大/缩小都不改变 ρ。
 *
 * @param offset 要扣掉的全局平移量（桌面约定是 `d − offset`，注意与 `scanBestOffset` 相反）
 */
function channelARho(
  diffs: Array<number | null>,
  bits20: number[],
  offset: number,
): { rho: number; valid: number } {
  const dirs = expandDirs(bits20);
  let num = 0;
  let sumSq = 0;
  let n = 0;
  const len = Math.min(diffs.length, dirs.length);
  for (let i = 0; i < len; i++) {
    const raw = diffs[i];
    if (raw === null || raw === undefined) continue;
    const d = raw - offset;
    num += d * dirs[i];
    sumSq += d * d;
    n++;
  }
  const den = Math.sqrt(sumSq * n);
  return { rho: den > 0 ? num / den : 0, valid: n };
}

/**
 * 通道 B（字对间距）的相关检测器 —— 口径逐行对齐桌面版 `compute_pair_correlation`
 * （`core/typeflow_core/watermark/pairing.py:198-234`）。
 *
 * ⚠️ **与通道 A 不是同一个函数**：这一路是**去均值的真 Pearson**，并且
 * 跳过 `|sd| < 0.1`、要求 `valid >= 3`、方向取反（bit=1 → −1）使"正 ρ = 信号正确"。
 * 别用一份实现套两处。
 */
function channelBRho(
  diffs: Array<number | null>,
  bits20: number[],
  offset: number,
): { rho: number; valid: number } {
  const dirs = expandDirs(bits20);
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sx2 = 0;
  let sy2 = 0;
  let n = 0;
  const len = Math.min(diffs.length, dirs.length);
  for (let i = 0; i < len; i++) {
    const raw = diffs[i];
    if (raw === null || raw === undefined) continue;
    const sd = raw - offset;
    if (Math.abs(sd) < 0.1) continue;
    const dir = -dirs[i];
    sx += sd;
    sy += dir;
    sxy += sd * dir;
    sx2 += sd * sd;
    sy2 += dir * dir;
    n++;
  }
  if (n < 3) return { rho: 0, valid: n };
  const num = n * sxy - sx * sy;
  const den = Math.sqrt((n * sx2 - sx * sx) * (n * sy2 - sy * sy));
  return { rho: den > 0 ? num / den : 0, valid: n };
}

/**
 * ρ 专用的偏移扫描：在 ±OFFSET_SCAN_WIDE 内挑**让 ρ 最大**的那一个。
 *
 * ⚠️ **不能复用 `scanBestOffset`**：那个的目标函数是"位命中数最大"，与"ρ 最大"不保证同一个解。
 * 实测（`.local/probe-offset-objective.ts`，385 格）：两 offset 在原档位 97 格里 30 格不同、
 * 加密后 159 格不同；复用会让 ρ 系统性偏低（最大低 0.117），最重的一格会把候选压到 0.35 之下
 * ⇒ **订单直接查不出来**。另外两者符号约定相反（这里是桌面约定 `d − offset`）。
 */
function bestRhoScan(
  diffs: Array<number | null>,
  bits20: number[],
  fn: (d: Array<number | null>, b: number[], off: number) => { rho: number; valid: number },
): { rho: number; valid: number; offset: number } {
  let best = { rho: -2, valid: 0, offset: 0 };
  for (let off = -OFFSET_SCAN_WIDE; off <= OFFSET_SCAN_WIDE; off++) {
    const r = fn(diffs, bits20, off);
    if (r.rho > best.rho) best = { rho: r.rho, valid: r.valid, offset: off };
  }
  return best;
}

// ── 判定分级（阈值与文案对齐桌面版 core/typeflow_core：config.py + trace_engine.py） ──

const GLYPH_SURVIVAL_INTACT = 0.9;
const GLYPH_SURVIVAL_SLIGHT_DAMAGE = 0.7;
const GLYPH_SURVIVAL_DAMAGED = 0.4;
const MATCH_COUNT_PERFECT = 20;
const MATCH_COUNT_HIGH = 19;
const MATCH_COUNT_STRONG = 18;
const MATCH_COUNT_PARTIAL = 15;
const VOTE_AGREEMENT_STRONG = 0.8;
const VOTE_AGREEMENT_OK = 0.6;
const SCORE_WEIGHT_SURVIVAL = 30;
const SCORE_WEIGHT_MATCH = 45;
const SCORE_WEIGHT_VOTE = 25;
const SPACING_CONFIRM_BONUS = 10;

// ── 相关检测器阈值（逐条对齐桌面版 config.py:15 / :288-290）──
const RHO_CORRELATION_MIN = 0.35; // 桌面 CORRELATION_THRESHOLD —— 低于它整条候选被丢弃
const RHO_HIGH = 0.67; // 桌面 config.py:288
const RHO_OFFSET_TRUSTED = 0.45; // 桌面 config.py:289，correlation_offset 支路专用
export const RHO_TRUSTED = 0.50; // 桌面 config.py:290 —— 也用作"稳稳过线"的门槛（见唯一性校验）

/**
 * ρ 路的**最低有效样本数** —— ⚠️ 网页版新增的覆盖闸，**桌面版没有**。
 *
 * 桌面版有个 `PEARSON_VALID_MIN = 3`，但**全仓零引用（死代码）** ⇒ 它的 ρ 路在样本极少时
 * 照样给高档位。而 `0.35` 只在 n=60 时才等于 2.7 个标准差：n=20 → 1.6σ、n=10 → 1.1σ、n=3 → 0.6σ
 * ⇒ **样本越少，同一个 0.35 越是更松的门槛**，会误报。
 * 网页版的面子就是误报纪律，所以这里要求有效样本 ≥ 20 才启用 ρ 路。
 */
const RHO_MIN_VALID = 20;

/**
 * ⚠️ **信号幅度门的历史与现状**（这条是"漏搬"与"故意不照搬"的记录，别搞混）。
 *
 * 1. 桌面版有 `config.py:19 SIGNAL_AMPLITUDE_MIN = 1.0`（平均 |差值| < 1.0 ⇒ 该通道不参与 ρ）。
 *    目的：**全零差值**（例如嫌疑字体就是未加水印的原件）在"±20 取 max ρ"的扫描里会被凑出
 *    `ρ = |1的个数 − 0的个数| / 20` 这个**闭式解**（实测逐一吻合）——于是 20 bit 里 1 的个数 ≥16
 *    的订单（约占订单号的 1%）在**完全没加水印**的字体上也能拿到 ρ ≥ 0.6 ⇒ trusted ⇒ 假命中。
 *    2026-09-18 我搬 ρ 时漏了这道门，实测扫 4000 个订单号占 **0.97%**；补上后归零。
 *
 * 2. ⚠️ **2026-09-19 起，网页版的门改用「非零证据占比」（见下）—— 与桌面版不同口径。**
 *    原因：平均幅度会把"幅度被稀释但方向还在"的信号一并挡掉，而共谋 k≥5 的平均字体正是这种
 *    （均|d| 0.4~1.0，但通道 B 的 ρ 仍有 0.83~0.95）⇒ 用户明确要求"工具给嫌疑、别替设计师藏名字"。
 *    ⇒ **桌面版若要跟，改同一处**（`_trace_match_correlation` 的 signal_gate）。
 */

/**
 * **非零证据占比**门槛（选项 B，2026-09-19）。
 *
 * 取代"平均 |差值| ≥ 1.0"当**门**：平均幅度会把"幅度被稀释但方向还在"的信号一并挡掉 ——
 * 共谋 k≥5 的平均字体正是这种（均|d| 0.4~1.0，但通道 B 的 ρ 仍有 0.83~0.95）。
 *
 * 标定（60 个锚定字里 \|d\| ≥ 0.5 的比例）：
 *   · 零信号（未加水印的原件）：**0%** ⇒ 仍被拦（那道假阳性修复不会重开）
 *   · k=10：≈15% ⇒ 拦（信号已 85% 被打掉）
 *   · **k=5：≈33% ⇒ 放行**（这是要保住的档）
 *   · k=2：≈77% · 正常单份：**100%**
 * ⇒ 取 25%，落在 15% 与 33% 之间。
 */
const MIN_NONZERO_FRAC = 0.25;

/**
 * ⚠️ **方向偏置门**（桌面 `config.py:310 PASS3_DIRECTION_BIAS_RATIO`，此前漏搬）。
 *
 * **只作用于"不扣偏移"那条候选**：超过 75% 的差值同向 ⇒ 这是整体平移、不是水印，不参与。
 * （桌面同样只在 Pass 3 用它，Pass 4 带偏移扫描故不用 —— 扫描之后整体平移已被扣掉。）
 */
const DIRECTION_BIAS_RATIO = 0.75;

/**
 * **唯一性校验的差距阈值**（桌面 `config.py:311 CORRELATION_UNIQUENESS_DELTA`）。
 *
 * 最佳相关性必须**明显高于次优**（差距 ≥ 0.03），否则说明"相关信号不足以唯一确定订单"⇒ **拒绝点名**。
 *
 * 桌面版在 Pass 3/4 里做这件事（`watermark_routes.py:1066,1087`，含「最佳 ρ=x，次优 y」的告警）。
 * ⚠️ 网页版**必须在门户侧做**：门户是"一个订单一次"地调引擎（`candidateOrders: [orderId]`），
 * 只有门户能看到全部候选 ⇒ 这个常量在这里定义、门户 import 使用。
 *
 * 它同时是**「多副本取平均」这个攻击的天然判词位置**：k 份平均时那 k 个候选的相关性本就接近，
 * 于是"不唯一"这个结论正好把它描述成「多个订单同时接近」而不是"命中了 k 次"。
 */
export const CORRELATION_UNIQUENESS_DELTA = 0.03;

/** 「多个订单同时接近」的判词（桌面用「相关信号不足以唯一确定订单」；门户面向文书，措辞更直白） */
export const COLLUSION_SUSPECT_LABEL = "多个订单同时接近，疑似多副本取平均";

/**
 * **位移幅度异常**的提示阈值：60 个锚定字里有这么多个"归零"就加一条提示标签。
 *
 * 标定（4 字体实测，`|d| < 0.5` 计为零）：
 *   · 正常单份字体：**0 / 60**
 *   · k=2 平均：14 / 60（23%）
 *   · k=5 平均：约 40 / 60（67%，由"锚定字归零 150/223"折算）
 * ⇒ 取 20（1/3）落在中间。
 *
 * ⚠️ 它只加**提示标签**，**不定级、不降级** —— 同样的形态也会出现在"坐标被工具量化"
 * 这类非共谋情形里，拿它当硬判据会误杀。真正的"不点名"由唯一性校验（ρ 挨得太近）负责。
 */
const ANCHOR_ZERO_HINT = 20;
/** 位移幅度异常的提示标签（与判词分开：这条是观察，不改变结论） */
export const AMPLITUDE_ANOMALY_LABEL = "位移幅度异常（疑似多副本平均或坐标量化）";

/**
 * 认领订单的最低一致率。低于它只报判定、不点名订单。
 *
 * ⚠️ **这是死闸：门户不读 `matchedOrder`**（`grep -rn matchedOrder portal/src` 零命中）。
 * 产品实际判命中看 `verdict.level === "high" || "trusted"`（`portal/src/lib/trace.ts`）。
 * 保留它是为了引擎单测，以及"候选循环里分数最高者必然存在"这层兜底。
 *
 * ⚠️ 它的零假设**正好是 0.5**（两通道各约 50% 命中）⇒ **毫无余量**。
 * 实测：拿第三方字体当可疑时一致率可达 0.541–0.683，会越过这条线并拿到真实订单号；
 * **真正拦住误报的是 `verdict.level` 的"20 位里 ≥18 位"那条**（零假设约 2×10⁻⁴/候选）。
 *
 * ⚠️ 那个「实测错误订单 0.175–0.20」是**全量字体**的数字。CI 跑的 fixtures 是子集字体
 * （锚定空间小、与订单 A 重叠率高）⇒ 同一场景会给到 0.463–0.525（已越线）。
 * **别拿全量字体的余量给 CI 样本背书。**
 */
const TRACE_MATCH_MIN_CONFIDENCE = 0.5;

/**
 * 判定：**bits 路径 + 相关检测器（ρ）两路并联**，取更高的那一档。
 *
 * 桌面版是 Pass 级联（bits 先跑、ρ 后跑，先命中者胜）；这里取"两路的最高档" ——
 * 语义等价于"任一检测器成立即出结果"，也正是这套判据本来的用意。
 * ⚠️ 以本函数原先的注释为准会误以为"无相关检测器"：补上 ρ 是 2026-09-18 的事。
 */
function computeVerdict(
  aDiffs: Array<number | null>,
  aBits: number[],
  expectedBits: number[],
  matchCount: number,
  bMatches: number,
  bTotal: number,
  bDiffs: Array<number | null>,
  offsetCorrected: boolean,
  nameRecordMissing: boolean,
): TraceVerdict {
  // 字形存活率（非空 raw diff 占比）
  const survived = aDiffs.filter((d) => d !== null).length;
  const survivalRate = survived / Math.max(aDiffs.length, 1);

  // 冗余投票一致性（每组 3 raw 至少 2 个有效且方向全一致）
  let agreements = 0;
  for (let i = 0; i < 20; i++) {
    const group = aDiffs.slice(i * 3, i * 3 + 3).filter((d): d is number => d !== null);
    if (group.length >= 2 && group.every((d) => (d > 0) === (group[0] > 0))) agreements++;
  }
  const voteAgreement = agreements / 20;

  // 校验位：web-v1 第 20 位为偶校验（要求该组有有效字形才判）
  const parityGroup = aDiffs.slice(19 * 3, 19 * 3 + 3).filter((d): d is number => d !== null);
  const checksumOk = parityGroup.length > 0 && aBits[19] === expectedBits[19];

  // ── 相关检测器（ρ）：两通道各算"不扣偏移"与"±20 扫描取最大"，取最好的那个 ──
  const aRho0 = channelARho(aDiffs, expectedBits, 0);
  const aRhoScan = bestRhoScan(aDiffs, expectedBits, channelARho);
  const bRho0 = channelBRho(bDiffs, expectedBits, 0);
  const bRhoScan = bestRhoScan(bDiffs, expectedBits, channelBRho);

  type RhoCand = { rho: number; valid: number; channel: "A" | "B"; offsetApplied: boolean };
  // 两道门（桌面 `_trace_match_correlation` 的 signal_gate / direction_bias —— 搬 ρ 时漏了）：
  //   · 信号幅度门：平均 |差值| < 1.0 ⇒ 该通道没有信息，不参与
  //   · 方向偏置门：>75% 同向 ⇒ 是整体平移、不是水印；**只挡"不扣偏移"那条**（扫描那条交给幅度门）
  /** 非零证据占比（\|d\| ≥ 0.5 算"带着位移"）—— 见 MIN_NONZERO_FRAC 的标定 */
  const nonzeroFrac = (arr: Array<number | null>): number => {
    const v = arr.filter((d): d is number => d !== null && d !== undefined);
    if (v.length === 0) return 0;
    return v.filter((d) => Math.abs(d) >= 0.5).length / v.length;
  };
  const directionBiased = (arr: Array<number | null>): boolean => {
    const n = Math.max(arr.length, 1);
    const pos = arr.filter((d) => d !== null && d > 0).length / n;
    const neg = arr.filter((d) => d !== null && d < 0).length / n;
    return pos >= DIRECTION_BIAS_RATIO || neg >= DIRECTION_BIAS_RATIO;
  };

  // ⚠️ **信号存在性**：通道 A 的平均 |差值| ≥ 1.0 才算"真的动过"。
  //
  // 为什么位路径也必须过这道门（2026-09-18 实测查出）：**差值全为 0 时，偏移扫描会选 offset=+1**，
  // 于是每个 bit 都被判成 1 ⇒ **位命中 = 该订单 20 bit 里"1 的个数"**。
  // 那么"1 的个数 ≥18（或 ≤2）"的订单（约占订单号 0.04%）在**完全没加水印的原件**上
  // 也能拿到 matchCount ≥ 18 ⇒ 高度可信/可信 ⇒ 门户判命中。
  //
  // 这条以前是被 `offsetCorrected ⇒ 信号偏弱` 那条降级**遮住**的（2026-09-18 去掉降级后才露出来）。
  // 正确的做法不是恢复降级（那会误杀正牌字体），而是**直接判定信号在不在**：幅度门本来是桌面版
  // 用在 ρ 路上的做法，这里把它补到位路径上。
  //
  // 代价可控：真实水印字体的 60 个锚定字差值是 ±2（均值 2.0），留足余量；
  // 只有"位移基本已被抹平"的字体才会被拦住 —— 而那本来就该是「无法确认」。
  const signalPresent = nonzeroFrac(aDiffs) >= MIN_NONZERO_FRAC;

  const rhoCands: RhoCand[] = [];
  if (nonzeroFrac(aDiffs) >= MIN_NONZERO_FRAC) {
    if (!directionBiased(aDiffs)) {
      rhoCands.push({ rho: aRho0.rho, valid: aRho0.valid, channel: "A", offsetApplied: false });
    }
    rhoCands.push({ rho: aRhoScan.rho, valid: aRhoScan.valid, channel: "A", offsetApplied: aRhoScan.offset !== 0 });
  }
  if (nonzeroFrac(bDiffs) >= MIN_NONZERO_FRAC) {
    if (!directionBiased(bDiffs)) {
      rhoCands.push({ rho: bRho0.rho, valid: bRho0.valid, channel: "B", offsetApplied: false });
    }
    rhoCands.push({ rho: bRhoScan.rho, valid: bRhoScan.valid, channel: "B", offsetApplied: bRhoScan.offset !== 0 });
  }
  // 覆盖闸：有效样本不足的候选不参与（桌面版缺这道闸，见 RHO_MIN_VALID 的注释）
  const rhoEligible = rhoCands.filter((c) => c.valid >= RHO_MIN_VALID);
  const rhoBest: RhoCand | null = rhoEligible.length > 0
    ? rhoEligible.reduce((a, b) => (b.rho > a.rho ? b : a))
    : null;

  // ρ 路的档位（支路与阈值逐条对齐桌面版 trace_engine.py:143-155）
  let rhoLevel: TraceVerdict["level"] = "none";
  let rhoLabel = "";
  if (rhoBest && rhoBest.rho >= RHO_CORRELATION_MIN) {
    if (rhoBest.rho >= RHO_HIGH) {
      rhoLevel = "high";
      rhoLabel = "高度可信";
    } else if (rhoBest.offsetApplied && rhoBest.rho >= RHO_OFFSET_TRUSTED) {
      rhoLevel = "trusted";
      rhoLabel = "可信 · 检测到干扰";
    } else if (rhoBest.rho >= RHO_TRUSTED) {
      rhoLevel = "trusted";
      rhoLabel = "可信";
    } else if (rhoBest.offsetApplied) {
      rhoLevel = "suspicious";
      rhoLabel = "存疑 · 检测到干扰";
    } else {
      rhoLevel = "suspicious";
      rhoLabel = "存疑";
    }
  }

  // 通道 B 方向一致率 ≥ 80%。⚠️ 只作标签与分数加成，**不参与 level 定级**
  // （computeVerdict 不引用 bMatches/bTotal）；桌面版通道 B 是独立检测器，网页版尚未接入
  const spacingConfirmed = bTotal > 0 && bMatches / bTotal >= 0.8;

  // 标签 1：字形完整性
  const glyphLabel =
    survivalRate >= GLYPH_SURVIVAL_INTACT ? "字体完整" :
    survivalRate >= GLYPH_SURVIVAL_SLIGHT_DAMAGE ? "字体轻微缺损" :
    survivalRate >= GLYPH_SURVIVAL_DAMAGED ? "字体有损" : "字体严重缺损";

  // 标签 2：指纹吻合度
  const matchLabel =
    matchCount >= MATCH_COUNT_PERFECT ? "指纹完全吻合" :
    matchCount >= MATCH_COUNT_HIGH ? "指纹高度吻合" :
    matchCount >= MATCH_COUNT_STRONG ? "指纹吻合" :
    matchCount >= MATCH_COUNT_PARTIAL ? "指纹部分匹配" : "指纹匹配度低";

  // 标签 3：信号清晰度
  // ⚠️ 只看信号**自身是否自洽**（校验位 + 冗余投票一致性）。
  // 「是否需要扣偏移」不参与这里，也不参与下面的定级 —— 见定级处的说明。
  const signalLabel =
    checksumOk && voteAgreement >= VOTE_AGREEMENT_STRONG ? "信号清晰" :
    voteAgreement >= VOTE_AGREEMENT_OK ? "信号正常" :
    "信号模糊";

  // 附加标签
  const extra: string[] = [checksumOk ? "校验通过" : "校验未通过"];
  if (offsetCorrected) extra.push("检测到均匀偏移干扰");
  if (nameRecordMissing) extra.push("Name 表缺失");
  if (voteAgreement >= VOTE_AGREEMENT_STRONG) extra.push("多重验证一致");
  if (spacingConfirmed) extra.push("通道 B 一致率 ≥ 80%");

  // 综合分（桌面版同权重）
  let score = Math.round(
    survivalRate * SCORE_WEIGHT_SURVIVAL +
    (matchCount / 20) * SCORE_WEIGHT_MATCH +
    voteAgreement * SCORE_WEIGHT_VOTE,
  );
  if (spacingConfirmed) score += SPACING_CONFIRM_BONUS;
  score = Math.max(0, Math.min(100, score));

  // 综合定级
  //
  // ⚠️ `offsetCorrected` **不参与定级**，只作标签（「检测到均匀偏移干扰」）。
  //
  // 原先的写法是「一旦扫出非零偏移 ⇒ 信号偏弱 ⇒ 高度可信/可信双双失效 ⇒ 掉存疑」。
  // 实测（stage2，判据改为门户口径后）：全局平移 +5/+10、随机污染 10%/50% 这四类攻击
  // 全都**位命中 80/80、置信度 1.000，却被判「存疑」⇒ 门户视为未命中**。
  // 而"需要扣偏移"本身不是篡改证据：字体被重排、被工具重存都会整体位移；
  // 真该看的是**扣掉偏移之后信号是否仍然自洽** —— 那由 checksumOk 与 voteAgreement 回答。
  //
  // ⚠️ 这里去掉的不是"检测偏移"这件事，只是"据此降级"。
  // 去掉后不会放宽误报：无关字体的一致性远够不到 matchCount ≥ 18（实测第三方字体 7–14/20）。
  // ⚠️ `signalPresent` 是硬前提：差值基本被抹平的字体，任何"位命中"都是偏移扫描从零里凑出来的
  //    （见上面 signalPresent 的注释）。此时最高只能到「存疑」，绝不点名。
  let level: TraceVerdict["level"];
  let levelLabel: string;
  if (signalPresent && survivalRate >= 0.8 && matchCount >= MATCH_COUNT_HIGH && checksumOk) {
    level = "high"; levelLabel = "高度可信";
  } else if (
    signalPresent && survivalRate >= 0.6 && matchCount >= MATCH_COUNT_STRONG &&
    (signalLabel === "信号清晰" || signalLabel === "信号正常")
  ) {
    level = "trusted"; levelLabel = "可信";
  } else if (matchCount >= MATCH_COUNT_STRONG) {
    level = "suspicious"; levelLabel = "存疑";
  } else {
    level = "none"; levelLabel = "无法确认";
  }

  // 两路取更高的一档（tier 序：none < suspicious < trusted < high）
  const TIER: Record<TraceVerdict["level"], number> = { none: 0, suspicious: 1, trusted: 2, high: 3 };
  const rhoDriven = TIER[rhoLevel] > TIER[level];
  if (rhoDriven) {
    level = rhoLevel;
    levelLabel = rhoLabel;
  }

  const labels = [glyphLabel, matchLabel, signalLabel, ...extra];
  if (rhoDriven && rhoBest) {
    labels.push(`相关检测命中 ρ=${rhoBest.rho.toFixed(2)}（通道 ${rhoBest.channel}）`);
  }

  // 位移幅度分布：只数非空的 60 个锚定字观察值（见 metrics 的注释）
  let dispFull = 0;
  let dispSmall = 0;
  let dispZero = 0;
  for (const d of aDiffs) {
    if (d === null || d === undefined) continue;
    const a = Math.abs(d);
    if (a < 0.5) dispZero++;
    else if (a < 1.5) dispSmall++;
    else dispFull++;
  }
  // 位移幅度异常（观察值，只加提示标签、不定级）：见 ANCHOR_ZERO_HINT 的标定
  if (dispZero >= ANCHOR_ZERO_HINT) labels.push(AMPLITUDE_ANOMALY_LABEL);

  return {
    level,
    levelLabel,
    labels,
    score,
    metrics: {
      survivalRate,
      matchCount,
      totalBits: 20,
      checksumOk,
      offsetCorrected,
      voteAgreement,
      spacingConfirmed,
      rhoA: aRhoScan.rho,
      rhoB: bRhoScan.rho,
      rhoUsed: rhoBest ? rhoBest.rho : null,
      rhoValid: rhoBest ? rhoBest.valid : 0,
      rhoChannel: rhoBest ? rhoBest.channel : null,
      rhoOffsetApplied: rhoBest ? rhoBest.offsetApplied : false,
      dispFull,
      dispSmall,
      dispZero,
    },
  };
}

/**
 * 运行本地追溯。
 * @returns 命中订单 + 双通道观测 + 一致率
 */
export async function traceWatermark(input: TraceInput): Promise<TraceResult> {
  const { originalBytes, suspiciousBytes, masterKey, orderRoot, provider, tenantId, bitsSuffix = "" } = input;

  // 入口校验：返回轮廓容器类型（glyf / cff / cff2）。TTC、WOFF、未知 sfnt 在这里被明确拒绝，
  // 而不是让后面的 glyf 读取拿到垃圾偏移、给出无意义判定。
  assertSupportedFont(originalBytes);
  assertSupportedFont(suspiciousBytes);

  const nameId256 = readNameId256(suspiciousBytes);

  // 候选订单：优先从 Name 256 读取，否则用入参
  let candidateOrders: string[] = input.candidateOrders ?? [];
  let nameAlgoVersion: string | null = null;
  if (nameId256) {
    try {
      const meta = JSON.parse(nameId256);
      if (meta.order_id && candidateOrders.length === 0) {
        candidateOrders = [String(meta.order_id)];
      }
      if (typeof meta.algo_version === "string") nameAlgoVersion = meta.algo_version;
    } catch {
      // Name 256 非 JSON（旧记录）：忽略，走候选
    }
  }

  const origRaw = parseSfnt(originalBytes);
  const suspRaw = parseSfnt(suspiciousBytes);
  const origCmap = parseCmap(origRaw).map;
  const suspCmap = parseCmap(suspRaw).map;
  const origReader = openGlyphReader(origRaw);
  const suspReader = openGlyphReader(suspRaw);

  // 算法版本号进 canonical_context ⇒ 进 order_root 派生；取错版本会让锚定/配对整体错位。
  // 权威来源是 Name 256 里写的 `algo_version`（那是"签发当时"的事实）。
  //
  // 没有它（例如水印记录被删）时分三种情形：
  //   · 云端给了 `orderRoot` ⇒ 版本号**不参与派生**（root 直接用配方里的那个），取当前值即可，不必猜；
  //   · 没有 root、但知道容器 ⇒ **不知道签发年代**，按容器把两代都试一遍再取最优。
  //     （2026-09-19 升版本号 web-v1/v2 → web-v3/v4 时补：只试当前版本会让
  //      "旧单 + 水印记录被删"这条路径 derive 出错的 order_root，静默查不出来。）
  const versions: string[] = nameAlgoVersion
    ? [nameAlgoVersion]
    : orderRoot && orderRoot.length === 32
      ? [origReader.kind === "glyf" ? ALGO_VERSION : ALGO_VERSION_CFF]
      : origReader.kind === "glyf"
        ? [ALGO_VERSION, ALGO_VERSION_LEGACY_TTF]
        : [ALGO_VERSION_CFF, ALGO_VERSION_CFF_LEGACY];

  // 展开成"版本 × 候选订单"的待试清单（正常情形版本只有一个，这里只是把它拍平，
  // 免得为了两代版本把下面 60 行比对逻辑再嵌一层缩进）。
  const attempts: Array<{ algoVersion: string; order: string }> = [];
  for (const algoVersion of versions) {
    for (const order of candidateOrders) attempts.push({ algoVersion, order });
  }

  let best: TraceResult | null = null;
  for (const { algoVersion, order } of attempts) {
    // 用原版字体重算锚定/配对（与原版 hash 同 key）
    const sel = await runSelection(
      originalBytes,
      masterKey ?? new Uint8Array(0),
      provider,
      tenantId,
      order,
      bitsSuffix,
      loadAnchorPool(),
      orderRoot,
      { algoVersion, eligible: origReader.eligible },
    );
    const { aDiffs, aBits, bDiffs, bestOffset } = compareWithOrder(
      origReader, suspReader, origCmap, suspCmap,
      sel.anchors, sel.pairs, sel.bits,
    );

    // 一致率：通道 A（投票后 20 位）与 20 bit 预期比对；通道 B 按 60 位方向一致率
    const expanded: number[] = [];
    for (const b of sel.bits) expanded.push(b, b, b);
    // 通道 A：每组（3 个原始 diff）至少 1 个有效字形才算有效位，最多 20
    let aValid = 0;
    const aBitsMatch = aBits.reduce<number>((acc, b, i) => {
      const group = aDiffs.slice(i * 3, i * 3 + 3);
      if (group.some((d) => d !== null)) {
        aValid++;
        return acc + (b === sel.bits[i] ? 1 : 0);
      }
      return acc;
    }, 0);
    let bMatches = 0, bValid = 0;
    bDiffs.forEach((d, i) => {
      if (d === null || d === undefined) return;
      bValid++;
      const expect = expanded[i] ?? 0;
      const dir = d < 0 ? 1 : d > 0 ? 0 : -1;
      if (dir === expect) bMatches++;
    });

    const total = aValid + bValid;
    const score = total > 0 ? (aBitsMatch + bMatches) / total : 0;
    const verdict = computeVerdict(
      aDiffs, aBits, sel.bits, aBitsMatch, bMatches, bValid, bDiffs,
      bestOffset !== 0, nameId256 === null,
    );
    if (!best || score > best.confidence) {
      best = {
        nameId256,
        matchedOrder: order,
        channelA_diffs: aDiffs,
        channelA_bits: aBits,
        channelA_matches: aBitsMatch,
        channelA_total: aValid,
        channelB_diffs: bDiffs,
        channelB_matches: bMatches,
        channelB_total: bValid,
        verdict,
        confidence: score,
        votes: aBitsMatch + bMatches,
        total,
      };
    }
  }

  if (!best) {
    return {
      nameId256,
      matchedOrder: null,
      channelA_diffs: [],
      channelA_bits: [],
      channelA_matches: 0,
      channelA_total: 0,
      channelB_diffs: [],
      channelB_matches: 0,
      channelB_total: 0,
      verdict: {
        level: "none",
        levelLabel: "无法确认",
        labels: ["水印无法识别"],
        score: 0,
        metrics: {
          survivalRate: 0, matchCount: 0, totalBits: 20,
          checksumOk: false, offsetCorrected: false, voteAgreement: 0, spacingConfirmed: false,
          rhoA: 0, rhoB: 0, rhoUsed: null, rhoValid: 0, rhoChannel: null, rhoOffsetApplied: false,
          dispFull: 0, dispSmall: 0, dispZero: 0,
        },
      },
      confidence: 0,
      votes: 0,
      total: 0,
    };
  }
  // 门槛：分数不够就不认领订单（候选与判定照常返回，界面据此呈现「存疑／无法确认」）
  if (best.confidence < TRACE_MATCH_MIN_CONFIDENCE) {
    return { ...best, matchedOrder: null };
  }
  return best;
}