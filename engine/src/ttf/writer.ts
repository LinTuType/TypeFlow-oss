/**
 * TTF 写回：重建 glyf/loca/name/hmtx/head 并重算整个 sfnt 的 checksum。— 阶段 1
 *
 * 覆盖哪些表（其余如 cmap/GPOS/GSUB 原样拷贝）：
 *   - glyf：整体重建（坐标已变更）
 *   - loca：重建（长格式 indexToLocFormat=1，保证简单）
 *   - head：indexToLocFormat=1 + 全局 bounds 重算 + checksumAdjustment=0（等最后算）
 *   - hmtx：lsb 随 xMin 平移更新
 *   - name：追加 Name ID 256
 *
 * 说明：字形内 instruction 字节原样保留（与桌面版行为一致）。
 */

import {
  encodeGlyph,
  decodeSimpleGlyph,
  readLocaOffsets,
  type GlyphData,
} from "./glyf.js";
import {
  parseNameTable,
  buildNameTable,
  type NameRecord,
} from "./name.js";
import { TtfParseError, type TtfRaw } from "./reader.js";

const be16 = (d: Uint8Array, o: number) => ((d[o] << 8) | d[o + 1]) >>> 0;
const be32 = (d: Uint8Array, o: number) =>
  (((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0);

/** 输入：font 原始数据 + 每字形坐标位移映射（gid → shiftX） */
export interface GlyphShiftMap {
  /** key=glyph id, value=x 位移（0 表示不修改） */
  getShift(gid: number): number;
}

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

/**
 * 重建字体字节。
 * @param raw 原始字体（parseSfnt 输出，含原始字节）
 * @param shifts (gid) => x 位移：简单字形 x+shift；复合/空字形恒 0（显示 return 0）
 * @param nameId256 要写入 Name ID 256 的文本（null = 不写）
 */
export function rebuildFont(
  raw: TtfRaw,
  shifts: (gid: number) => number,
  nameId256: string | null,
): EmbedOutput {
  const data = raw.data;
  const glyfOff = raw.tableOffsets.get("glyf");
  const locaOff = raw.tableOffsets.get("loca");
  const headOff = raw.tableOffsets.get("head");
  const maxpOff = raw.tableOffsets.get("maxp");
  const hmtxOff = raw.tableOffsets.get("hmtx");
  const nameOff = raw.tableOffsets.get("name");
  const nameLen = raw.tableLengths.get("name");
  const cmapOff = raw.tableOffsets.get("cmap");
  for (const t of ["glyf", "loca", "head", "maxp", "hmtx", "name", "cmap"]) {
    if (!raw.tableOffsets.has(t)) throw new TtfParseError(`缺少 ${t} 表`);
  }

  const nGlyphs = be16(data, maxpOff! + 4);
  const indexToLocFormat = be16(data, headOff! + 50);

  // --- 1. 读原 glyph 数据（按 loca），应用位移，重编码 ---
  const origOffsets = readLocaOffsets(data, locaOff!, indexToLocFormat, nGlyphs);
  const glyphsOff = glyfOff!;
  const glyfBytes: Uint8Array[] = [];
  let nModified = 0;

  const hmtxLSBs: number[] = []; // 每字形原 lsb（用于冲量校准）
  // hmtx: numberOfHMetrics 由 hhea 表给出
  const hheaOff = raw.tableOffsets.get("hhea");
  const numberOfHMetrics = be16(data, hheaOff! + 34);

  // 读 hmtx：前 numberOfHMetrics 条有 advance+lsb，后面 lsb 只有
  const hmtxEntry = (gid: number): number => {
    // lsb 总是第 gid 条：前 n 条在第 4*gid+2 ~，超出部分在第 2*n + 2*(gid-n)
    if (gid < numberOfHMetrics) {
      return be16(data, hmtxOff! + gid * 4 + 2);
    }
    return be16(data, hmtxOff! + numberOfHMetrics * 4 + (gid - numberOfHMetrics) * 2);
  };
  // 重读现 lsb
  for (let g = 0; g < nGlyphs; g++) hmtxLSBs.push(hmtxEntry(g));

  for (let g = 0; g < nGlyphs; g++) {
    const p0 = origOffsets[g];
    const p1 = origOffsets[g + 1];
    if (p0 === p1) {
      // 空字形：无分区、不能位移
      glyfBytes.push(new Uint8Array());
      continue;
    }
    const shift = shifts(g);
    const decoded = decodeSimpleGlyph(data.slice(glyphsOff, glyphsOff + (raw.tableLengths.get("glyf") ?? p1)), p0);
    if (decoded === null) {
      // 复合或异常：原样拷贝分区
      glyfBytes.push(data.slice(glyphsOff + p0, glyphsOff + p1));
      continue;
    }
    if (shift === 0) {
      // 无位移也要按原样拷贝（保留原编码字节）
      glyfBytes.push(data.slice(glyphsOff + p0, glyphsOff + p1));
      continue;
    }
    // 有位移：坐标重建
    const gd: GlyphData = {
      ...decoded,
      coords: decoded.coords.map((c) => ({ x: c.x + shift, y: c.y })),
    };
    glyfBytes.push(encodeGlyph(gd));
    nModified++;
  }

  // --- 2. 拼 glyf 表 + 生成 loca（长格式） ---
  const glyphParts: Uint8Array[] = [];
  const offsets: number[] = [0];
  let acc = 0;
  for (const b of glyfBytes) {
    glyphParts.push(b);
    acc += b.length;
    // 对齐到 2 字节（glyf 子项按 2 对齐即可；loca long 以字节记）
    if (acc % 2 === 1) {
      glyphParts.push(new Uint8Array([0]));
      acc += 1;
    }
    offsets.push(acc);
  }
  const newGlyf = concatBytes(glyphParts);
  const newLoca = new Uint8Array((nGlyphs + 1) * 4);
  for (let g = 0; g <= nGlyphs; g++) {
    newLoca[g * 4] = (offsets[g] >>> 24) & 0xff;
    newLoca[g * 4 + 1] = (offsets[g] >>> 16) & 0xff;
    newLoca[g * 4 + 2] = (offsets[g] >>> 8) & 0xff;
    newLoca[g * 4 + 3] = offsets[g] & 0xff;
  }

  // --- 3. name 表（追加 Name 256） ---
  const newName = buildNameTable(
    parseNameTable(data, nameOff!, nameLen ?? 0),
    nameId256,
  );

  // --- 4. head 表：indexToLocFormat 恒 1 + 全局 bounds 重算 ---
  const newHead = data.slice(headOff!, headOff! + raw.tableLengths.get("head")!);
  newHead[50] = 0;
  newHead[51] = 1; // indexToLocFormat = 1
  // 全局 bounds：遍历所有简单字形坐标
  let gxMin = 32767, gyMin = 32767, gxMax = -32768, gyMax = -32768;
  for (let g = 0; g < nGlyphs; g++) {
    const p0 = offsets[g];
    const p1 = offsets[g + 1];
    if (p0 === p1) continue;
    const decoded = decodeSimpleGlyph(newGlyf, p0);
    if (!decoded) continue;
    if (decoded.xMin < gxMin) gxMin = decoded.xMin;
    if (decoded.yMin < gyMin) gyMin = decoded.yMin;
    if (decoded.xMax > gxMax) gxMax = decoded.xMax;
    if (decoded.yMax > gyMax) gyMax = decoded.yMax;
  }
  const setS16 = (off: number, v: number) => {
    newHead[off] = (v >> 8) & 0xff;
    newHead[off + 1] = v & 0xff;
  };
  setS16(36, gxMin); setS16(38, gyMin); setS16(40, gxMax); setS16(42, gyMax);

  // --- 5. hmtx：lsb 更新（= 原 lsb + shift；advance 不变） ---
  // 先读原 hmtx 总长
  const origHmtxLen = raw.tableLengths.get("hmtx")!;
  const newHmtx = new Uint8Array(origHmtxLen);
  newHmtx.set(data.slice(hmtxOff!, hmtxOff! + origHmtxLen), 0);
  const updateLSB = (gid: number, lsb: number) => {
    const b = (lsb & 0xffff);
    if (gid < numberOfHMetrics) {
      const o = gid * 4 + 2;
      newHmtx[o] = (b >> 8) & 0xff;
      newHmtx[o + 1] = b & 0xff;
    } else {
      const o = numberOfHMetrics * 4 + (gid - numberOfHMetrics) * 2;
      newHmtx[o] = (b >> 8) & 0xff;
      newHmtx[o + 1] = b & 0xff;
    }
  };
  for (let g = 0; g < nGlyphs; g++) {
    const shift = shifts(g);
    if (shift === 0) continue;
    updateLSB(g, hmtxLSBs[g] + shift);
  }

  // --- 6. 组装 sfnt：替换 4 张表 + 全 checksum ---
  return assembleSfnt(raw, {
    glyf: newGlyf,
    loca: newLoca,
    head: newHead,
    hmtx: newHmtx,
    name: newName,
  }, nModified);
}

/** 拼接 Uint8Array 列表 */
function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** 组装新 sfnt：重排表目录，重算每表 checksum，最后写 head.checksumAdjustment */
function assembleSfnt(
  raw: TtfRaw,
  replace: Record<string, Uint8Array>,
  nModified: number,
): EmbedOutput {
  const tags = new Set([...raw.tableOffsets.keys()]);
  // 确保所有表都在（原始表即使 replaced 也保留其余）
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

  // 表数据区（4 字节对齐整体开头）
  const directoryLen = 12 + tableBytes.length * 16;
  // 计算总长（含对齐）
  let bodyLen = 0;
  for (const t of tableBytes) bodyLen += align4(t.bytes.length);
  const out = new Uint8Array(directoryLen + bodyLen);
  let o = 0;

  // sfnt header
  // sfntVersion: 从原文件复制
  out[0] = raw.data[0]; out[1] = raw.data[1]; out[2] = raw.data[2]; out[3] = raw.data[3];
  out[4] = 0; out[5] = tableBytes.length; // numTables (≤255)
  out[6] = 0; out[7] = 0; // searchRange
  out[8] = 0; out[9] = 0;
  out[10] = 0; out[11] = 0;

  // 表记录
  let cursor = directoryLen;
  const tableOffsets: Array<{ tag: string; bytes: Uint8Array; off: number }> = [];
  for (let i = 0; i < tableBytes.length; i++) {
    const { tag, bytes } = tableBytes[i];
    const rec = 12 + i * 16;
    out[rec] = tag.charCodeAt(0); out[rec + 1] = tag.charCodeAt(1);
    out[rec + 2] = tag.charCodeAt(2); out[rec + 3] = tag.charCodeAt(3);
    // checksum 占位（最后统一写）
    const csOff = rec + 4;
    const padded = pad4(bytes);
    const checksum = calcChecksum(padded);
    out[csOff] = (checksum >>> 24) & 0xff;
    out[csOff + 1] = (checksum >>> 16) & 0xff;
    out[csOff + 2] = (checksum >>> 8) & 0xff;
    out[csOff + 3] = checksum & 0xff;
    const off = cursor;
    out[rec + 8] = (off >>> 24) & 0xff; out[rec + 9] = (off >>> 16) & 0xff;
    out[rec + 10] = (off >>> 8) & 0xff; out[rec + 11] = off & 0xff;
    out[rec + 12] = (bytes.length >>> 24) & 0xff; out[rec + 13] = (bytes.length >>> 16) & 0xff;
    out[rec + 14] = (bytes.length >>> 8) & 0xff; out[rec + 15] = bytes.length & 0xff;
    out.set(bytes, off);
    tableOffsets.push({ tag, bytes, off });
    cursor += align4(bytes.length);
  }

  // head.checksumAdjustment：head 表计算时 checksum 字段必须为 0，最后补
  const headRec = tableOffsets.find((t) => t.tag === "head")!;
  // 清空 head 内 checkSumAdjustment（offset 8-11 相对 head 表头）
  out[headRec.off + 8] = 0; out[headRec.off + 9] = 0; out[headRec.off + 10] = 0; out[headRec.off + 11] = 0;
  // 全文件 checksum + 0xB1B0AFBA
  let total = calcChecksum(out);
  const adjust = (0xb1b0afba - total) >>> 0;
  out[headRec.off + 8] = (adjust >>> 24) & 0xff;
  out[headRec.off + 9] = (adjust >>> 16) & 0xff;
  out[headRec.off + 10] = (adjust >>> 8) & 0xff;
  out[headRec.off + 11] = adjust & 0xff;

  return { bytes: out, nModified };
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