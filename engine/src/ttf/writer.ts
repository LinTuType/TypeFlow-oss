/**
 * TTF（glyf 轮廓）写回：重建 glyf/loca/name/hmtx/head，并交给 `sfnt.ts` 组装。— 阶段 1
 *
 * 覆盖哪些表（其余如 cmap/GPOS/GSUB 原样拷贝）：
 *   - glyf：整体重建（坐标已变更）
 *   - loca：重建（长格式 indexToLocFormat=1，保证简单）
 *   - head：indexToLocFormat=1 + 全局 bounds 重算 + checksumAdjustment=0（等最后算）
 *   - hmtx：lsb 随 xMin 平移更新（`sfnt.ts · rebuildHmtx`）
 *   - name：追加 Name ID 256
 *
 * 说明：字形内 instruction 字节原样保留（与桌面版行为一致）。
 * ⚠️ 可变字体（fvar/gvar）走的也是这条路：gvar 的增量叠加在**默认轮廓**上，
 *    默认轮廓整体平移 ⇒ 每个实例都整体平移，增量不需要重算。
 *    前提是 hmtx.lsb 必须同步（`sfnt.ts` 已保证）。
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
} from "./name.js";
import { TtfParseError, type TtfRaw } from "./reader.js";
import {
  assembleSfnt,
  rebuildHmtx,
  calcChecksum,
  type EmbedOutput,
} from "./sfnt.js";

export { calcChecksum };
export type { EmbedOutput };

const be16 = (d: Uint8Array, o: number) => ((d[o] << 8) | d[o + 1]) >>> 0;

/** 输入：font 原始数据 + 每字形坐标位移映射（gid → shiftX） */
export interface GlyphShiftMap {
  /** key=glyph id, value=x 位移（0 表示不修改） */
  getShift(gid: number): number;
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
  for (const t of ["glyf", "loca", "head", "maxp", "hmtx", "name", "cmap"]) {
    if (!raw.tableOffsets.has(t)) throw new TtfParseError(`不是受支持的 TTF 字体（缺少 ${t} 表）`);
  }

  const nGlyphs = be16(data, maxpOff! + 4);
  const indexToLocFormat = be16(data, headOff! + 50);

  // --- 1. 读原 glyph 数据（按 loca），应用位移，重编码 ---
  const origOffsets = readLocaOffsets(data, locaOff!, indexToLocFormat, nGlyphs);
  const glyphsOff = glyfOff!;
  const glyphBytes: Uint8Array[] = [];
  let nModified = 0;

  for (let g = 0; g < nGlyphs; g++) {
    const p0 = origOffsets[g];
    const p1 = origOffsets[g + 1];
    if (p0 === p1) {
      // 空字形：无分区、不能位移
      glyphBytes.push(new Uint8Array());
      continue;
    }
    const shift = shifts(g);
    const decoded = decodeSimpleGlyph(data.slice(glyphsOff, glyphsOff + (raw.tableLengths.get("glyf") ?? p1)), p0);
    if (decoded === null) {
      // 复合或异常：原样拷贝分区
      glyphBytes.push(data.slice(glyphsOff + p0, glyphsOff + p1));
      continue;
    }
    if (shift === 0) {
      // 无位移也要按原样拷贝（保留原编码字节）
      glyphBytes.push(data.slice(glyphsOff + p0, glyphsOff + p1));
      continue;
    }
    // 有位移：坐标重建
    const gd: GlyphData = {
      ...decoded,
      coords: decoded.coords.map((c) => ({ x: c.x + shift, y: c.y })),
    };
    glyphBytes.push(encodeGlyph(gd));
    nModified++;
  }

  // --- 2. 拼 glyf 表 + 生成 loca（长格式） ---
  const glyphParts: Uint8Array[] = [];
  const offsets: number[] = [0];
  let acc = 0;
  for (const b of glyphBytes) {
    glyphParts.push(b);
    acc += b.length;
    // 对齐到 2 字节（glyf 子项按 2 对齐即可；loca long 以字节记）
    if (acc % 2 === 1) {
      glyphParts.push(new Uint8Array([0]));
      acc += 1;
    }
    offsets.push(acc);
  }
  const total = glyphParts.reduce((a, b) => a + b.length, 0);
  const newGlyf = new Uint8Array(total);
  {
    let o = 0;
    for (const p of glyphParts) { newGlyf.set(p, o); o += p.length; }
  }
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
  // checkSumAdjustment 必须先归零再往下走：sfnt 规范要求 head 表的 tableChecksum
  // 按该字段为 0 计算。assembleSfnt 里也会再清一次并回填。
  newHead[8] = 0; newHead[9] = 0; newHead[10] = 0; newHead[11] = 0;

  // --- 5. hmtx：lsb 更新（= 原 lsb + shift；advance 不变） ---
  const newHmtx = rebuildHmtx(raw, shifts, nGlyphs);

  // --- 6. 组装 sfnt：替换 5 张表 + 全 checksum ---
  return assembleSfnt(raw, {
    glyf: newGlyf,
    loca: newLoca,
    head: newHead,
    hmtx: newHmtx,
    name: newName,
  }, nModified);
}
