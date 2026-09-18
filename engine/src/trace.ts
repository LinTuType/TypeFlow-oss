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

import { runSelection, ALGO_VERSION } from "./webv1.js";
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
import { ALGO_VERSION_CFF } from "./embed.js";

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
  /** 命中置信度 0..1 */
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

  anchors.forEach((cp, i) => {
    const og = origCmap.get(cp);
    const sg = suspCmap.get(cp);
    if (og === undefined || sg === undefined) {
      aDiffs.push(null);
      bDiffs.push(null);
      return;
    }
    // 通道 A 看 **xMax**（与桌面版 get_glyph_xmax 一致）
    const ox = orig.xMax(og);
    const sx = susp.xMax(sg);
    aDiffs.push(ox !== null && sx !== null ? sx - ox : null);

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

/**
 * 认领订单的最低置信度。
 *
 * 低于它只报判定、不点名订单。理由：候选循环里"分数最高者"必然存在——拿一份
 * 毫不相干的第三方字体来查，也会有一个候选排第一；不设门槛时，那份要交给法务看
 * 的鉴定书里就会写上一个真实客户的订单号。候选集越大，偶然命中的机会越高。
 *
 * 0.5 与阶段 2 攻击测试的判定口径一致（实测错误订单 0.175–0.20，正确订单 ≥0.98）。
 */
const TRACE_MATCH_MIN_CONFIDENCE = 0.5;

/**
 * 移植桌面版 compute_confidence（bits 路径，无相关检测器）：
 * 输入通道 A 观测与预期位，输出四级判定 + 标签 + 0-100 综合分。
 */
function computeVerdict(
  aDiffs: Array<number | null>,
  aBits: number[],
  expectedBits: number[],
  matchCount: number,
  bMatches: number,
  bTotal: number,
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

  // 双通道交叉验证：通道 B 方向一致率 ≥ 80%
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

  // 标签 3：信号质量
  const signalLabel =
    !offsetCorrected && checksumOk && voteAgreement >= VOTE_AGREEMENT_STRONG ? "信号清晰" :
    !offsetCorrected && voteAgreement >= VOTE_AGREEMENT_OK ? "信号正常" :
    offsetCorrected ? "信号偏弱" : "信号模糊";

  // 附加标签
  const extra: string[] = [checksumOk ? "校验通过" : "校验未通过"];
  if (offsetCorrected) extra.push("检测到均匀偏移干扰");
  if (nameRecordMissing) extra.push("Name 表缺失");
  if (voteAgreement >= VOTE_AGREEMENT_STRONG) extra.push("多重验证一致");
  if (spacingConfirmed) extra.push("双通道交叉验证 ✓");

  // 综合分（桌面版同权重）
  let score = Math.round(
    survivalRate * SCORE_WEIGHT_SURVIVAL +
    (matchCount / 20) * SCORE_WEIGHT_MATCH +
    voteAgreement * SCORE_WEIGHT_VOTE,
  );
  if (spacingConfirmed) score += SPACING_CONFIRM_BONUS;
  score = Math.max(0, Math.min(100, score));

  // 综合定级
  let level: TraceVerdict["level"];
  let levelLabel: string;
  if (survivalRate >= 0.8 && matchCount >= MATCH_COUNT_HIGH && !offsetCorrected && checksumOk) {
    level = "high"; levelLabel = "高度可信";
  } else if (
    survivalRate >= 0.6 && matchCount >= MATCH_COUNT_STRONG &&
    (signalLabel === "信号清晰" || signalLabel === "信号正常")
  ) {
    level = "trusted"; levelLabel = "可信";
  } else if (matchCount >= MATCH_COUNT_STRONG) {
    level = "suspicious"; levelLabel = "存疑";
  } else {
    level = "none"; levelLabel = "无法确认";
  }

  return {
    level,
    levelLabel,
    labels: [glyphLabel, matchLabel, signalLabel, ...extra],
    score,
    metrics: {
      survivalRate,
      matchCount,
      totalBits: 20,
      checksumOk,
      offsetCorrected,
      voteAgreement,
      spacingConfirmed,
    },
  };
}

/**
 * 运行本地追溯。
 * @returns 命中订单 + 双通道观测 + 置信度
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
  // 权威来源是 Name 256 里写的 `algo_version`（那是"签发当时"的事实）；
  // 没有它（例如水印记录被删）就按**原版字体**的容器推断：glyf → web-v1，CFF → web-v2。
  const algoVersion =
    nameAlgoVersion ?? (origReader.kind === "glyf" ? ALGO_VERSION : ALGO_VERSION_CFF);

  let best: TraceResult | null = null;
  for (const order of candidateOrders) {
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

    // 置信度：通道 A（投票后 20 位）与 20 bit 预期比对；通道 B 按 60 位方向一致率
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
      aDiffs, aBits, sel.bits, aBitsMatch, bMatches, bValid,
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