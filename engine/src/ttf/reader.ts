/**
 * 轻量 TTF 解析器 — 阶段 0 只做「选择」所需的最小读取
 *
 * 解析范围（对齐 algorithm-manifest.json out_of_scope）：
 *   - 读：sfnt 目录、cmap（format 4/12）、glyf（简单/复合/空判定）
 *   - 不写：轮廓位移、checksum 属于阶段 1
 *
 * 设计动机：与参考实现 reference_webv1.py 逐字段对齐，
 * 任何边界差异都会在 compare.ts 一致性测试中暴露。
 */

/** 字体宽读模式：只加载头部与表目录，不解析全表 */
export interface TtfRaw {
  /** sfnt 版本（0x00010000 = TrueType，0x4F54544F = 'OTTO'） */
  sfntVersion: number;
  tableOffsets: Map<string, number>;
  tableLengths: Map<string, number>;
  data: Uint8Array;
}

/** cmap 结果：已按 manifest 优先级选定的子表映射 */
export interface CmapMapping {
  format: number;
  /** unicode 码点 → glyph name / glyph index 未知时用索引 */
  map: Map<number, number>;
}

/** 声明式异常：字体结构异常统一抛此类型 */
export class TtfParseError extends Error {
  constructor(msg: string) {
    super(`TTF 解析失败: ${msg}`);
    this.name = "TtfParseError";
  }
}

/** readUint32 等字节序助手（TrueType 网络字节序 = 大端） */
const be32 = (d: Uint8Array, o: number): number =>
  ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;

const be16 = (d: Uint8Array, o: number): number =>
  ((d[o] << 8) | d[o + 1]) >>> 0;

const be16Signed = (d: Uint8Array, o: number): number => {
  const v = ((d[o] << 8) | d[o + 1]) >>> 0;
  // JS 位运算为 32 位有符号，0xffff 会被读成 65535；
  // 手动转回有符号 int16（numberOfContours 的负值表示复合字形）
  return v & 0x8000 ? v - 0x10000 : v;
};

/**
 * 解析 sfnt 目录（头部 + 4 字节对齐的表目录）
 * @param buf 字体原始字节
 */
export function parseSfnt(buf: Uint8Array): TtfRaw {
  if (buf.length < 12) throw new TtfParseError("文件过短(<12 字节)");
  const sfntVersion = be32(buf, 0);
  const numTables = be16(buf, 4);
  const tableOffsets = new Map<string, number>();
  const tableLengths = new Map<string, number>();
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    const tag =
      String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
    const offset = be32(buf, o + 8);
    const length = be32(buf, o + 12);
    tableOffsets.set(tag, offset);
    tableLengths.set(tag, length);
  }
  return { sfntVersion, tableOffsets, tableLengths, data: buf };
}

/**
 * 读取 4 字节 table tag（用于判读表名）
 */
export function tableName(buf: Uint8Array, o: number): string {
  return String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
}

/**
 * 选择并解析 cmap：
 *  - 优先 format 4；无则 format 12；取首个 unicode 全表（与 manifest 一致）
 *  - 只保留 unicode → (glyphId, glyphName 由调用方解析) 的映射
 */
export function parseCmap(raw: TtfRaw): CmapMapping {
  const offset = raw.tableOffsets.get("cmap");
  const length = raw.tableLengths.get("cmap");
  if (offset === undefined || length === undefined) {
    throw new TtfParseError("缺少 cmap 表");
  }
  const d = raw.data;
  const nTables = be16(d, offset + 2);

  let chosenFormat = 0;
  let chosenOffset = -1;
  for (let i = 0; i < nTables; i++) {
    const rec = offset + 4 + i * 8;
    const platform = be16(d, rec);
    const encoding = be16(d, rec + 2);
    // 优先 Windows Unicode BMP (3,1)，其次 Unicode (0,1)/(0,3)/(3,10)
    const isUnicode =
      (platform === 3 && (encoding === 1 || encoding === 10)) ||
      (platform === 0 && (encoding === 1 || encoding === 3 || encoding === 4));
    if (!isUnicode) continue;
    const subOff = offset + be32(d, rec + 4);
    const fmt = be16(d, subOff);
    if (fmt === 4 && chosenFormat !== 4) {
      chosenFormat = 4;
      chosenOffset = subOff;
      break; // format 4 优先级最高
    }
    if (fmt === 12 && chosenFormat !== 4 && chosenFormat !== 12) {
      chosenFormat = 12;
      chosenOffset = subOff;
    }
  }
  if (chosenFormat === 0 || chosenOffset < 0) {
    throw new TtfParseError("未找到支持的 cmap 子表 (format 4/12)");
  }

  const map = new Map<number, number>();
  if (chosenFormat === 4) {
    const segCountX2 = be16(d, chosenOffset + 6);
    const segCount = segCountX2 >> 1;
    const endCodes = chosenOffset + 14;
    const startCodes = endCodes + segCountX2 + 2; // + reservedPad
    const idDeltaOffset = startCodes + segCountX2;
    const idRangeOffsetOffset = idDeltaOffset + segCountX2;
    const glyphIdArrayOffset = idRangeOffsetOffset + segCountX2;
    for (let s = 0; s < segCount; s++) {
      const end = be16(d, endCodes + s * 2);
      const start = be16(d, startCodes + s * 2);
      const idDelta = be16Signed(d, idDeltaOffset + s * 2);
      const idRangeOffset = be16(d, idRangeOffsetOffset + s * 2);
      if (end === 0xffff && start === 0xffff) continue; // 哨兵段
      for (let cp = start; cp <= end; cp++) {
        if (cp > 0xffff) break;
        let gid: number;
        if (idRangeOffset === 0) {
          gid = (cp + idDelta) & 0xffff;
        } else {
          const idx =
            idRangeOffsetOffset + s * 2 + idRangeOffset + (cp - start) * 2;
          if (idx + 2 > offset + length) continue;
          const v = be16(d, idx);
          gid = v === 0 ? 0 : (v + idDelta) & 0xffff;
        }
        if (gid !== 0) map.set(cp, gid);
      }
    }
  } else {
    // format 12：groups 数组
    const nGroups = be32(d, chosenOffset + 12);
    const groupsBase = chosenOffset + 16;
    for (let g = 0; g < nGroups; g++) {
      const o = groupsBase + g * 12;
      const startChar = be32(d, o);
      const endChar = be32(d, o + 4);
      const startGid = be32(d, o + 8);
      for (let cp = startChar, gid = startGid; cp <= endChar && cp <= 0x10ffff; cp++, gid++) {
        if (gid !== 0) map.set(cp, gid);
      }
    }
  }
  return { format: chosenFormat, map };
}

/**
 * 判定字形是否「简单字形」（用于合格候选过滤）
 *
 * glyf 表的 glyph 数据：首 2 字节是有符号 numberOfContours
 *   > 0  简单字形
 *   < 0  复合字形
 *   == 0 空字形
 * @returns 1=简单 0=空 -1=复合 -2=不存在
 */
export function glyphContourKind(raw: TtfRaw, gid: number): number {
  const glyfOffset = raw.tableOffsets.get("glyf");
  const locaOffset = raw.tableOffsets.get("loca");
  const headOffset = raw.tableOffsets.get("head");
  if (glyfOffset === undefined || locaOffset === undefined || headOffset === undefined) {
    return -2;
  }
  const d = raw.data;
  // head 表 indexToLocFormat 在第 50-51 字节（head 起始 + 50）
  const indexToLocFormat = be16(d, headOffset + 50);
  const nGlyphs = be16(d, (raw.tableOffsets.get("maxp") ?? 0) + 4);
  if (gid >= nGlyphs) return -2;

  const glyfLength: number = raw.tableLengths.get("glyf") ?? 0;
  const loca = locaOffset;
  const p0 = indexToLocFormat === 0 ? be16(d, loca + gid * 2) * 2 : be32(d, loca + gid * 4);
  const p1 =
    indexToLocFormat === 0
      ? be16(d, loca + (gid + 1) * 2) * 2
      : be32(d, loca + (gid + 1) * 4);
  if (p0 === p1) return 0; // 空
  if (p0 + 2 > glyfLength) return -2;
  const contours = be16Signed(d, glyfOffset + p0);
  return contours > 0 ? 1 : contours < 0 ? -1 : 0;
}

/**
 * 组合：读取 cmap 全部合格码点（→gid，且字形为简单字形）
 * 返回值按码点升序排列（与 reference 的 eligible_codepoints 一致）
 */
export function eligibleCodepoints(raw: TtfRaw): number[] {
  const cmap = parseCmap(raw);
  const out: number[] = [];
  for (const [cp, gid] of cmap.map) {
    if (glyphContourKind(raw, gid) === 1) out.push(cp);
  }
  return out.sort((a, b) => a - b);
}