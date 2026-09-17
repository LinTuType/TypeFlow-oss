/**
 * glyf 表解析与重建 — 阶段 1
 *
 * 只处理简单字形，与 manifest（复合/空字形排除）保持一致。
 *
 * 核心：字形坐标是相对增量编码（flags 决定 delta 长短）。我们要做的是
 * 「解码出绝对坐标 → 修改 x → 重新编码」。为保证写回后任何标准解析器
 * （fontTools/系统）读出的坐标与我们解码的一致，这里采用**简单但正确**
 * 的编码策略：丢弃原 flags 的压缩形式，逐点重编码为
 *   -0 / ±1字节(short) / ±2字节(long)
 * 语义等价、字节可能变大，但解码结果确定。
 *
 * ⚠️ 唯一不可以丢的是 flags.bit0 = on-curve —— 它决定一个点是「落在笔画上的
 * 实点」还是「把线条拉弯的控制点」。之前这里一律按实点重编码，结果是每个被
 * 位移的汉字轮廓都退化成折线（实测 196 个字形、28355 个控制点全部归零），
 * 而且不报错。故 onCurve 必须从解码一路带到重编码。
 */

/** glyph 轮廓数据（解码后） */
export interface GlyphData {
  numberOfContours: number; // 恒 >0（简单字形）
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  /** endPtsOfContours：每轮廓最后一个点的索引 */
  endPts: number[];
  /** hint 指令字节（原样保留） */
  instructions: Uint8Array;
  /** 逐点标志位（解码所得原始字节；重编码时不直接复用，但 bit0 必须带走） */
  flags: number[];
  /**
   * 逐点 on-curve 语义：true = 落在笔画上的实点，false = 用于把线条拉弯的控制点。
   * 必须原样带进重编码 —— 丢掉它，曲线会退化成控制点之间的直连折线，
   * 字形走样且全流程不报错。
   */
  onCurve: boolean[];
  coords: Array<{ x: number; y: number }>;
}

const ON_CURVE = 0x01;
const X_SHORT = 0x02;
const Y_SHORT = 0x04;
const REPEAT = 0x08;
const X_SAME = 0x10; // 短格式=正、长格式=0
const Y_SAME = 0x20;

const be16 = (d: Uint8Array, o: number) => ((d[o] << 8) | d[o + 1]) >>> 0;
const be16Signed = (d: Uint8Array, o: number) => {
  const v = ((d[o] << 8) | d[o + 1]) >>> 0;
  return v & 0x8000 ? v - 0x10000 : v;
};

/**
 * 解码单个简单字形区块（glyf 表内的 glyph data，不含 loca 处理）
 * @param d glyf 表数据（从 glyf 表起点开始的切片）
 * @param offset 该字形在 glyf 表内偏移
 * @returns 解码后的字形，或 null（数据越界/空）
 */
export function decodeSimpleGlyph(d: Uint8Array, offset: number): GlyphData | null {
  const cnt = be16Signed(d, offset);
  if (cnt <= 0) return null; // 空或复合
  const nc = cnt;
  // 字形头 + endPts + instruction 长度字段 必须落在数据内：nc 被伪造时下面的
  // 循环会一路读到数据外，把 undefined 当 0 用，静默产出损坏字形
  if (offset + 10 + nc * 2 + 2 > d.length) return null;

  const xMin = be16Signed(d, offset + 2);
  const yMin = be16Signed(d, offset + 4);
  const xMax = be16Signed(d, offset + 6);
  const yMax = be16Signed(d, offset + 8);

  let o = offset + 10;
  const endPts: number[] = [];
  for (let i = 0; i < nc; i++) {
    endPts.push(be16(d, o));
    o += 2;
  }
  const instrLen = be16(d, o);
  o += 2;
  const instructions = d.slice(o, o + instrLen);
  o += instrLen;

  const nPoints = endPts[nc - 1] + 1;

  // flags（含 repeat 展开）
  const flags: number[] = [];
  while (flags.length < nPoints) {
    const f = d[o++];
    flags.push(f);
    if ((f & REPEAT) !== 0) {
      const r = d[o++];
      for (let i = 0; i < r; i++) flags.push(f);
    }
  }

  // x 坐标（增量和）
  const xs: number[] = [];
  let x = 0;
  for (let i = 0; i < nPoints; i++) {
    const f = flags[i];
    if ((f & X_SHORT) !== 0) {
      const v = d[o++];
      x += (f & X_SAME) !== 0 ? v : -v;
    } else if ((f & X_SAME) !== 0) {
      x += 0;
    } else {
      x += be16Signed(d, o);
      o += 2;
    }
    xs.push(x);
  }

  // y 坐标
  const ys: number[] = [];
  let y = 0;
  for (let i = 0; i < nPoints; i++) {
    const f = flags[i];
    if ((f & Y_SHORT) !== 0) {
      const v = d[o++];
      y += (f & Y_SAME) !== 0 ? v : -v;
    } else if ((f & Y_SAME) !== 0) {
      y += 0;
    } else {
      y += be16Signed(d, o);
      o += 2;
    }
    ys.push(y);
  }

  const coords = xs.map((x, i) => ({ x, y: ys[i] }));
  return {
    numberOfContours: nc,
    xMin,
    yMin,
    xMax,
    yMax,
    endPts,
    instructions,
    flags,
    onCurve: flags.map((f) => (f & ON_CURVE) !== 0),
    coords,
  };
}

/** 单点数转为 +2 字节有符号 */
function s16(v: number, out: Uint8Array, oo: number) {
  out[oo] = (v >> 8) & 0xff;
  out[oo + 1] = v & 0xff;
}

/**
 * 按（简单但确定）策略重编码字形：flags + 相对 delta。
 * x/y 一律：0 → SAMES，|v|≤63 非0 → SHORT+符号，其余 → 2 字节长格式。
 * 返回编码字节（不含 header 与 endPts/instructions，调用方组装）。
 *
 * @param onCurve 逐点 on-curve 语义（解码所得）。该点为 false 时写控制点，
 *   其余写实点。**新增调用方必须传**：省略会退化成「全部实点」，
 *   即历史上那个「每个被水印的汉字都走样」的缺陷。
 */
export function encodePoints(
  coords: Array<{ x: number; y: number }>,
  onCurve?: boolean[],
): {
  flags: number[];
  flagBytes: number[];
  xBytes: number[];
  yBytes: number[];
  nBytes: number;
} {
  const n = coords.length;
  const flags: number[] = [];
  const xBytes: number[] = [];
  const yBytes: number[] = [];

  let px = 0;
  let py = 0;
  for (let i = 0; i < n; i++) {
    const dx = coords[i].x - px;
    const dy = coords[i].y - py;
    px = coords[i].x;
    py = coords[i].y;

    // bit0 = on-curve：沿用解码所得语义（控制点必须仍是控制点）
    let f = onCurve?.[i] === false ? 0 : ON_CURVE;
    // x
    if (dx === 0) f |= X_SAME;
    else if (dx >= -63 && dx <= 63) {
      f |= X_SHORT;
      if (dx > 0) f |= X_SAME;
      xBytes.push(Math.abs(dx));
    } else {
      // 2 字节有符号（写进 number[]：高位/低位）
      xBytes.push((dx >> 8) & 0xff, dx & 0xff);
    }
    // y
    if (dy === 0) f |= Y_SAME;
    else if (dy >= -63 && dy <= 63) {
      f |= Y_SHORT;
      if (dy > 0) f |= Y_SAME;
      yBytes.push(Math.abs(dy));
    } else {
      // 2 字节有符号
      yBytes.push((dy >> 8) & 0xff, dy & 0xff);
    }
    flags.push(f);
  }

  // flags 内联（不用 repeat，保持简单）
  const flagBytes = flags; // 每点 1 字节
  return { flags, flagBytes, xBytes, yBytes, nBytes: 0 };
}

/**
 * 将 GlyphData 编码为 glyf 表内完整字形字节（header + endPts + instr + flags + coords）
 */
export function encodeGlyph(g: GlyphData): Uint8Array {
  const { flagBytes, xBytes, yBytes } = encodePoints(g.coords, g.onCurve);
  const headerLen = 10;
  const endPtsLen = g.endPts.length * 2;
  const instrLen = 2 + g.instructions.length;

  const out = new Uint8Array(
    headerLen + endPtsLen + instrLen + flagBytes.length + xBytes.length + yBytes.length,
  );
  let o = 0;

  // 重算 bounds
  let xMin = 32767, yMin = 32767, xMax = -32768, yMax = -32768;
  for (const c of g.coords) {
    if (c.x < xMin) xMin = c.x;
    if (c.x > xMax) xMax = c.x;
    if (c.y < yMin) yMin = c.y;
    if (c.y > yMax) yMax = c.y;
  }
  s16(g.numberOfContours, out, o); o += 2;
  s16(xMin, out, o); o += 2;
  s16(yMin, out, o); o += 2;
  s16(xMax, out, o); o += 2;
  s16(yMax, out, o); o += 2;

  for (const e of g.endPts) {
    out[o] = (e >> 8) & 0xff; out[o + 1] = e & 0xff; o += 2;
  }
  const instrByteLen = g.instructions.length;
  out[o++] = (instrByteLen >> 8) & 0xff;
  out[o++] = instrByteLen & 0xff;
  out.set(g.instructions, o); o += instrByteLen;

  for (const f of flagBytes) out[o++] = f & 0xff;
  for (const b of xBytes) out[o++] = b & 0xff;
  for (const b of yBytes) out[o++] = b & 0xff;

  return out;
}

/**
 * 拷贝 n+1 个 loca 偏移（读）
 * @param raw 完整字体数据
 * @param locaOffset loca 表绝对偏移
 * @param indexToLocFormat 0=short 1=long
 * @param nGlyphs 字形数
 */
export function readLocaOffsets(
  raw: Uint8Array,
  locaOffset: number,
  indexToLocFormat: number,
  nGlyphs: number,
): number[] {
  const out: number[] = [];
  for (let g = 0; g <= nGlyphs; g++) {
    out.push(
      indexToLocFormat === 0
        ? be16(raw, locaOffset + g * 2) * 2
        : be32(raw, locaOffset + g * 4),
    );
  }
  return out;
}

const be32 = (d: Uint8Array, o: number) =>
  (((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0);

/**
 * 读原始字形分区（不改坐标时用于提取 xMin 等，trace 侧用）
 */
export function readGlyphRaw(d: Uint8Array, offset: number): {
  nc: number;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  absX: number[];
  absY: number[];
} | null {
  const nc = be16Signed(d, offset);
  if (nc <= 0) return null;
  if (offset + 10 + nc * 2 + 2 > d.length) return null; // endPts 越界（伪造 nc）
  const xMin = be16Signed(d, offset + 2);
  const yMin = be16Signed(d, offset + 4);
  const xMax = be16Signed(d, offset + 6);
  const yMax = be16Signed(d, offset + 8);
  let o = offset + 10;
  const endPts: number[] = [];
  for (let i = 0; i < nc; i++) {
    endPts.push(be16(d, o));
    o += 2;
  }
  const instrLen = be16(d, o);
  o += 2 + instrLen;
  const nPoints = endPts[nc - 1] + 1;

  const flags: number[] = [];
  while (flags.length < nPoints) {
    const f = d[o++];
    flags.push(f);
    if ((f & REPEAT) !== 0) {
      const r = d[o++];
      for (let i = 0; i < r; i++) flags.push(f);
    }
  }
  const absX: number[] = [];
  let x = 0;
  for (let i = 0; i < nPoints; i++) {
    const f = flags[i];
    if ((f & X_SHORT) !== 0) {
      const v = d[o++];
      x += (f & X_SAME) !== 0 ? v : -v;
    } else if ((f & X_SAME) === 0) {
      x += be16Signed(d, o);
      o += 2;
    }
    absX.push(x);
  }
  const absY: number[] = [];
  let y = 0;
  for (let i = 0; i < nPoints; i++) {
    const f = flags[i];
    if ((f & Y_SHORT) !== 0) {
      const v = d[o++];
      y += (f & Y_SAME) !== 0 ? v : -v;
    } else if ((f & Y_SAME) === 0) {
      y += be16Signed(d, o);
      o += 2;
    }
    absY.push(y);
  }
  return { nc, xMin, yMin, xMax, yMax, absX, absY };
}