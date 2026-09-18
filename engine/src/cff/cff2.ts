/**
 * CFF2 表的读与写。
 *
 * ## 为什么与 CFF1 走同一条（全量重编）路径
 * 最初设想的"字节级拼接：只换 CharStrings、其余原样拷贝"在 CFF2 上**不成立**：
 * `FDArray` 里每个 FontDict 的 `Private` 操作数是**绝对偏移**、Private 里的 `Subrs` 也是，
 * 而这些数据都排在 CharStrings INDEX 之后 ⇒ 只要 CharStrings 的字节数变了，整条链都得平移。
 * 想原地保住它们，就得让新 INDEX 与旧 INDEX **字节数完全相同**，而补丁本身就可能让
 * charstring 变长（操作数编码跨到更宽的档），做不到一般性保证。
 *
 * ⇒ 结论：和 CFF1 一样，交给一个**全量重编**的序列化器，让它把所有绝对偏移算对。
 * 也就是 vendor 的 `CFFTop.toBuffer`（见 `../../vendor/SOURCES.md` 的「第三方修补」——
 * CFF2 的 INDEX 计数位宽上游写错，是本仓库唯一一处对 vendor 的语义修补）。
 *
 * ## CFF2 特有的两件小事
 * 1. `CFFTop` 版本 2 的头部有 `topDictLength`（uint16）= Top DICT 自身的字节长度，
 *    只能先算出 DICT 长度再回填 ⇒ **两遍**（第一遍 `CFF2TopDict.size(..., false)` 取长度）。
 * 2. `blend` 折叠需要「当前 vsindex 用几个区域」⇒ 从 `vstore` 里取，见 `regionCount`。
 */

import { CFFFont, CFFTop } from "../../vendor/fontkit-cff/index.js";
import { DecodeStream } from "../../vendor/restructure/index.js";
import { makeGlyphXMin } from "./glyph.js";

interface CffDictLike {
  CharStrings: unknown;
  vstore?: unknown;
  [key: string]: unknown;
}

interface DecodedCff2 {
  version: number;
  hdrSize: number;
  length: number;
  topDict: CffDictLike;
  globalSubrIndex: unknown;
  getCharString(gid: number): Uint8Array;
}

/** Top DICT 的字节长度（不含它指向的数据）：必须靠 CFFTop 内部的结构定义来算 */
function topDictByteLength(topDict: CffDictLike): number {
  const versions = (CFFTop as unknown as { versions: Record<number, { topDict: { size(v: unknown, ctx: unknown, includePointers: boolean): number } }> }).versions;
  const dict = versions[2]?.topDict;
  if (!dict) throw new Error("CFFTop 缺少版本 2 的 Top DICT 定义");
  // startOffset 只影响"指针操作数用几个字节"，而 CFFPointer 恒用 5 字节（forceLarge），
  // 所以这里给 5（= CFF2 头部长度）即可。
  return dict.size(topDict, { startOffset: 5 }, false);
}

export interface Cff2Font {
  /** 字形数 */
  numGlyphs: number;
  /** gid → charstring 原始字节 */
  getCharString(gid: number): Uint8Array;
  /** 某个 vsindex 使用的区域个数 k；查不到返回 -1 ⇒ 该字形不进候选 */
  regionCount(vsIndex: number): number;
  /** 追溯侧用：该字形轮廓的控制点 x 最小值（解析不出来返回 null） */
  glyphXMin(gid: number): number | null;
  /** 用新的 charstring 数组重建整份 CFF2 表 */
  rebuild(charStrings: Uint8Array[]): Uint8Array;
}

export function parseCff2(table: Uint8Array): Cff2Font {
  const font = CFFFont.decode(new DecodeStream(table)) as unknown as DecodedCff2;
  if (font.version !== 2) throw new Error(`不是 CFF2（version=${font.version}）`);
  const topDict = font.topDict;
  const charStrings = topDict.CharStrings as Array<{ offset: number; length: number }>;
  if (!Array.isArray(charStrings) || charStrings.length === 0) {
    throw new Error("CFF2 的 CharStrings 为空");
  }
  const count = charStrings.length;

  // vstore → { uint16 length, ItemVariationStore }；区域个数在 itemVariationData[vsindex].regionIndexCount
  const ivs = (topDict.vstore as { itemVariationStore?: { itemVariationData?: unknown } } | null | undefined)?.itemVariationStore;
  const dataList = Array.isArray(ivs?.itemVariationData) ? (ivs!.itemVariationData as Array<{ regionIndexCount?: number }>) : null;
  const regionCountOf = (vsIndex: number): number => {
    if (!dataList || vsIndex < 0 || vsIndex >= dataList.length) return -1;
    const k = dataList[vsIndex]?.regionIndexCount;
    return typeof k === "number" && k > 0 ? k : -1;
  };
  const xMinOf = makeGlyphXMin(font, true, regionCountOf);

  return {
    numGlyphs: count,
    getCharString(gid: number): Uint8Array {
      if (gid < 0 || gid >= count) throw new Error(`gid ${gid} 越界`);
      return font.getCharString(gid);
    },
    glyphXMin: (gid: number) => (gid >= 0 && gid < count ? xMinOf(gid) : null),
    regionCount(vsIndex: number): number {
      return regionCountOf(vsIndex);
    },
    rebuild(charStrings: Uint8Array[]): Uint8Array {
      if (charStrings.length !== count) {
        throw new Error(`charstring 个数 ${charStrings.length} ≠ 字形数 ${count}`);
      }
      const newTopDict: CffDictLike = { ...topDict, CharStrings: charStrings };
      const length = topDictByteLength(newTopDict);
      return CFFTop.toBuffer({
        version: 2,
        hdrSize: font.hdrSize,
        length,
        topDict: newTopDict,
        globalSubrIndex: font.globalSubrIndex,
      }) as unknown as Uint8Array;
    },
  };
}
