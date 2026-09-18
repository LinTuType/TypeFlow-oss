/**
 * CFF / CFF2 容器的统一入口 —— 两条实现共用一个接口。
 *
 * | 容器 | 读 | 写 |
 * |---|---|---|
 * | CFF1（`CFF ` 表） | vendor fontkit `CFFFont.decode`（上游长期使用、可信） | vendor `CFFTop.toBuffer`（上游子集器走同一条路，已实测产物可被 fontTools 解析） |
 * | CFF2（`CFF2` 表） | **自写** `cff2.ts` | **自写**（vendor 的 CFF2 写出路径上游从未使用过，实测回读即崩，见 `cff2.ts` 头部说明） |
 *
 * 两条路都不使用 fontkit 的 `CFFSubset`：它会重建 stringIndex ⇒ 把 CID 字体的 `ROS` 改写成
 * `Adobe/Identity`、charset 重排成身份映射、FDArray 重排并删 `FontName`（实测确认）。
 * 我们**原样保留** stringIndex / charset / FDArray / FDSelect / Private / globalSubrIndex，
 * 只把 CharStrings 换成改过的字节 —— 这是"结构同构"的全部秘密。
 */

import { CFFFont, CFFTop } from "../../vendor/fontkit-cff/index.js";
import { DecodeStream } from "../../vendor/restructure/index.js";
import { parseCff2, type Cff2Font } from "./cff2.js";
import { makeGlyphXMin } from "./glyph.js";

export interface CffFont {
  isCFF2: boolean;
  /** 字形数 */
  numGlyphs: number;
  /** gid → charstring 原始字节（未改的必须是原字节） */
  getCharString(gid: number): Uint8Array;
  /** CFF2 的 `blend` 需要：vsindex → 区域个数；不适用时返回 -1 */
  regionCount(vsIndex: number): number;
  /** 用与 gid 顺序一一对应的 charstring 数组重建容器表 */
  rebuild(charStrings: Uint8Array[]): Uint8Array;
  /**
   * 追溯侧用：该字形轮廓的**控制点 x 最小值**（与 glyf 的 xMin 同语义）。
   * 解析不出来（`seac`、未知操作符等）返回 null —— 追溯会把它当"字形缺失"处理，
   * 而不是拿一个错值去投票。
   */
  glyphXMin(gid: number): number | null;
}

/**
 * 解析 CFF / CFF2 表。
 * @param table 表字节（从 sfnt 目录里切出来的独立一段）
 * @param isCFF2 由调用方按表 tag 判定（`CFF2` vs `CFF `）
 */
export function parseCff(table: Uint8Array, isCFF2: boolean): CffFont {
  if (isCFF2) return wrapCff2(parseCff2(table));

  const font = CFFFont.decode(new DecodeStream(table)) as unknown as {
    version: number;
    hdrSize: number;
    offSize: number;
    nameIndex: unknown;
    topDictIndex: Array<Record<string, unknown>>;
    topDict: Record<string, unknown>;
    stringIndex: unknown;
    globalSubrIndex: unknown;
    getCharString(gid: number): Uint8Array;
  };
  if (font.version !== 1) {
    throw new Error(`CFF 版本 ${font.version} 与容器不符（CFF2 应走 CFF2 分支）`);
  }
  const topDict = font.topDictIndex[0];
  const count = (topDict.CharStrings as Array<{ offset: number; length: number }>).length;
  const xMinOf = makeGlyphXMin(font, false);

  return {
    isCFF2: false,
    numGlyphs: count,
    getCharString(gid: number): Uint8Array {
      if (gid < 0 || gid >= count) throw new Error(`gid ${gid} 越界`);
      return font.getCharString(gid);
    },
    regionCount: () => -1,
    glyphXMin: (gid: number) => (gid >= 0 && gid < count ? xMinOf(gid) : null),
    rebuild(charStrings: Uint8Array[]): Uint8Array {
      if (charStrings.length !== count) {
        throw new Error(`charstring 个数 ${charStrings.length} ≠ 字形数 ${count}`);
      }
      // 只换 CharStrings，其余（stringIndex / charset / FDArray / FDSelect / Private /
      // globalSubrIndex）原样传回去 —— 这是结构同构的关键。
      const newTopDict = { ...topDict, CharStrings: charStrings.map((b) => b) };
      return CFFTop.toBuffer({
        version: font.version,
        hdrSize: font.hdrSize,
        offSize: font.offSize,
        nameIndex: font.nameIndex,
        topDictIndex: [newTopDict],
        stringIndex: font.stringIndex,
        globalSubrIndex: font.globalSubrIndex,
      }) as unknown as Uint8Array;
    },
  };
}

function wrapCff2(f: Cff2Font): CffFont {
  return {
    isCFF2: true,
    numGlyphs: f.numGlyphs,
    getCharString: (gid: number) => f.getCharString(gid),
    regionCount: (vsIndex: number) => f.regionCount(vsIndex),
    rebuild: (charStrings: Uint8Array[]) => f.rebuild(charStrings),
    glyphXMin: (gid: number) => f.glyphXMin(gid),
  };
}

/** 从 sfnt 目录里切出 CFF / CFF2 表字节；两者都没有则返回 null */
export function extractCffTable(
  data: Uint8Array,
  tableOffsets: Map<string, number>,
  tableLengths: Map<string, number>,
): { bytes: Uint8Array; tag: "CFF " | "CFF2"; isCFF2: boolean } | null {
  for (const tag of ["CFF ", "CFF2"] as const) {
    const off = tableOffsets.get(tag);
    const len = tableLengths.get(tag);
    if (off !== undefined && len !== undefined) {
      return { bytes: data.slice(off, off + len), tag, isCFF2: tag === "CFF2" };
    }
  }
  return null;
}
