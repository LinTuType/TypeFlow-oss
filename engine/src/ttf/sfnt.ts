/**
 * sfnt 组装 — **两条改写路径共用**（TTF 的 glyf 路径 / OTF 的 CFF 路径）
 *
 * 为什么单独一个文件：产品承诺"交付物 = 原版 + 一处水印位移"能成立，
 * 靠的就是这里的一条规则 —— **只替换该替换的表，其余表逐字节原样拷贝**。
 * 两条路共用同一份组装代码，才不会出现"某一条路偷偷重排了别的东西"。
 *
 * 覆盖：
 *   - assembleSfnt：重排表目录、重算每表 checksum、最后回填 head.checkSumAdjustment
 *   - rebuildHmtx：只改被位移字形的 lsb（`lsb += shift`），advance 不动
 *
 * ⚠️ hmtx.lsb 必须同步（不变量 D5）：
 *   - TrueType 侧：规范要求 `lsb == xMin`。不改时**按 `lsb − xMin` 定位轮廓的读取方**
 *     （fontTools 的 `ttGlyphSet` 就是这么读的）会把位移**抵消成 0**（实测）；
 *   - OTF/CFF 侧：规范要求 `lsb` 等于 `xMin`，改了才自洽。
 */

import { TtfParseError, type TtfRaw } from "./reader.js";

const be16 = (d: Uint8Array, o: number) => ((d[o] << 8) | d[o + 1]) >>> 0;

/** 写回结果 */
export interface EmbedOutput {
  bytes: Uint8Array;
  nModified: number;
}

/** 计算表 checksum（4 字节对齐求和） */
export function calcChecksum(bytes: Uint8Array): number {
  let sum = 0;
  const n = bytes.length;
  for (let i = 0; i < n; i += 4) {
    let v = 0;
    for (let j = 0; j < 4; j++) {
      v = (v << 8) | (i + j < n ? bytes[i + j] : 0);
    }
    sum = (sum + v) >>> 0;
  }
  return sum;
}

/** 拼接 Uint8Array 列表 */
export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function align4(n: number) {
  return (n + 3) & ~3;
}

function pad4(bytes: Uint8Array): Uint8Array {
  const rem = bytes.length % 4;
  if (rem === 0) return bytes;
  const out = new Uint8Array(bytes.length + (4 - rem));
  out.set(bytes, 0);
  return out;
}

/**
 * 组装新 sfnt：替换指定表，其余表**原样拷贝**；重排表目录、重算每表 checksum，
 * 最后写 head.checksumAdjustment。
 *
 * @param raw     原字体（parseSfnt 输出）
 * @param replace tag → 新表字节（不在 replace 里的表逐字节拷贝）
 * @param nModified 统计量，原样带回（与字体结构无关）
 */
export function assembleSfnt(
  raw: TtfRaw,
  replace: Record<string, Uint8Array>,
  nModified: number,
): EmbedOutput {
  // 未知 tag 必须报错：写错的表名会被静默忽略，产物看起来"成功"但实际没改。
  for (const tag of Object.keys(replace)) {
    if (!raw.tableOffsets.has(tag)) {
      throw new TtfParseError(`替换表 ${tag} 不存在于原字体`);
    }
  }
  const tags = new Set([...raw.tableOffsets.keys()]);
  const tableBytes: Array<{ tag: string; bytes: Uint8Array }> = [];
  for (const tag of tags) {
    const replaced = replace[tag];
    if (replaced) {
      tableBytes.push({ tag, bytes: replaced });
    } else {
      const off = raw.tableOffsets.get(tag)!;
      const len = raw.tableLengths.get(tag)!;
      tableBytes.push({ tag, bytes: raw.data.slice(off, off + len) });
    }
  }
  // 排序稳定（sfnt 表可任意序，按 tag 字母序更干净）
  tableBytes.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

  const directoryLen = 12 + tableBytes.length * 16;
  let bodyLen = 0;
  for (const t of tableBytes) bodyLen += align4(t.bytes.length);
  const out = new Uint8Array(directoryLen + bodyLen);

  // sfnt header：sfntVersion 从原文件复制（0x00010000 或 'OTTO'）
  out[0] = raw.data[0]; out[1] = raw.data[1]; out[2] = raw.data[2]; out[3] = raw.data[3];
  // numTables 与三个查找参数必须按规范算：此前三处恒写 0、表数只写低字节，
  // 严格校验器与部分平台加载器会因此拒载。
  // 规范：searchRange = 2^floor(log2 n) × 16；entrySelector = log2(searchRange/16)；
  //       rangeShift = n × 16 − searchRange
  const nTables = tableBytes.length;
  let pow2 = 1;
  while (pow2 * 2 <= nTables) pow2 *= 2;
  const searchRange = pow2 * 16;
  const entrySelector = Math.round(Math.log2(pow2));
  const rangeShift = nTables * 16 - searchRange;
  out[4] = (nTables >> 8) & 0xff; out[5] = nTables & 0xff;
  out[6] = (searchRange >> 8) & 0xff; out[7] = searchRange & 0xff;
  out[8] = (entrySelector >> 8) & 0xff; out[9] = entrySelector & 0xff;
  out[10] = (rangeShift >> 8) & 0xff; out[11] = rangeShift & 0xff;

  let cursor = directoryLen;
  const tableOffsets: Array<{ tag: string; off: number }> = [];
  for (let i = 0; i < tableBytes.length; i++) {
    const { tag, bytes } = tableBytes[i];
    const rec = 12 + i * 16;
    out[rec] = tag.charCodeAt(0); out[rec + 1] = tag.charCodeAt(1);
    out[rec + 2] = tag.charCodeAt(2); out[rec + 3] = tag.charCodeAt(3);
    const checksum = calcChecksum(pad4(bytes));
    out[rec + 4] = (checksum >>> 24) & 0xff;
    out[rec + 5] = (checksum >>> 16) & 0xff;
    out[rec + 6] = (checksum >>> 8) & 0xff;
    out[rec + 7] = checksum & 0xff;
    const off = cursor;
    out[rec + 8] = (off >>> 24) & 0xff; out[rec + 9] = (off >>> 16) & 0xff;
    out[rec + 10] = (off >>> 8) & 0xff; out[rec + 11] = off & 0xff;
    out[rec + 12] = (bytes.length >>> 24) & 0xff; out[rec + 13] = (bytes.length >>> 16) & 0xff;
    out[rec + 14] = (bytes.length >>> 8) & 0xff; out[rec + 15] = bytes.length & 0xff;
    out.set(bytes, off);
    tableOffsets.push({ tag, off });
    cursor += align4(bytes.length);
  }

  // head.checksumAdjustment：算 head 表 checksum 时该字段必须为 0，最后回填
  const headRec = tableOffsets.find((t) => t.tag === "head");
  if (!headRec) throw new TtfParseError("缺少 head 表，无法回填 checkSumAdjustment");
  out[headRec.off + 8] = 0; out[headRec.off + 9] = 0; out[headRec.off + 10] = 0; out[headRec.off + 11] = 0;
  const total = calcChecksum(out);
  const adjust = (0xb1b0afba - total) >>> 0;
  out[headRec.off + 8] = (adjust >>> 24) & 0xff;
  out[headRec.off + 9] = (adjust >>> 16) & 0xff;
  out[headRec.off + 10] = (adjust >>> 8) & 0xff;
  out[headRec.off + 11] = adjust & 0xff;

  return { bytes: out, nModified };
}

/**
 * 重建 hmtx：只改被位移字形的 lsb，advance 不变，其余字节原样。
 *
 * 字形数取 `maxp.numGlyphs`；`numberOfHMetrics` 取 `hhea` 第 34-35 字节
 * （前 n 条是 4 字节 advance+lsb，其后 lsb 各占 2 字节）。
 *
 * @param shifts (gid) => x 位移（0 = 不动）
 * @param nGlyphs 字形总数
 */
export function rebuildHmtx(
  raw: TtfRaw,
  shifts: (gid: number) => number,
  nGlyphs: number,
): Uint8Array {
  const hmtxOff = raw.tableOffsets.get("hmtx");
  const hheaOff = raw.tableOffsets.get("hhea");
  if (hmtxOff === undefined || hheaOff === undefined) {
    throw new TtfParseError("缺少 hmtx / hhea 表");
  }
  const data = raw.data;
  const origHmtxLen = raw.tableLengths.get("hmtx")!;
  const numberOfHMetrics = be16(data, hheaOff + 34);

  const newHmtx = new Uint8Array(origHmtxLen);
  newHmtx.set(data.slice(hmtxOff, hmtxOff + origHmtxLen), 0);

  const readLSB = (gid: number): number =>
    gid < numberOfHMetrics
      ? be16(data, hmtxOff + gid * 4 + 2)
      : be16(data, hmtxOff + numberOfHMetrics * 4 + (gid - numberOfHMetrics) * 2);

  const writeLSB = (gid: number, lsb: number) => {
    const b = lsb & 0xffff;
    const o = gid < numberOfHMetrics
      ? gid * 4 + 2
      : numberOfHMetrics * 4 + (gid - numberOfHMetrics) * 2;
    newHmtx[o] = (b >> 8) & 0xff;
    newHmtx[o + 1] = b & 0xff;
  };

  for (let g = 0; g < nGlyphs; g++) {
    const shift = shifts(g);
    if (shift === 0) continue;
    writeLSB(g, readLSB(g) + shift);
  }
  return newHmtx;
}

/** 读 maxp.numGlyphs（TTF 与 OTF 同构，偏移相同） */
export function numGlyphsOf(raw: TtfRaw): number {
  const maxpOff = raw.tableOffsets.get("maxp");
  if (maxpOff === undefined) throw new TtfParseError("缺少 maxp 表");
  return be16(raw.data, maxpOff + 4);
}

/** 读 head.unitsPerEm（供追溯侧把位移阈值换算成字体单位） */
export function unitsPerEmOf(raw: TtfRaw): number {
  const headOff = raw.tableOffsets.get("head");
  if (headOff === undefined) throw new TtfParseError("缺少 head 表");
  return be16(raw.data, headOff + 18);
}

/** 读 sfnt 目录里某张表的原始字节（供调试与测试） */
export function rawTableBytes(raw: TtfRaw, tag: string): Uint8Array | null {
  const off = raw.tableOffsets.get(tag);
  const len = raw.tableLengths.get(tag);
  if (off === undefined || len === undefined) return null;
  return raw.data.slice(off, off + len);
}
