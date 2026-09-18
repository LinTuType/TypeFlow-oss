/**
 * OTF/CFF 侧的候选滤取（决定点 D4）。
 *
 * TTF 侧的判据是「简单字形」（`glyf` 的 numberOfContours > 0）；
 * CFF 侧没有 numberOfContours，等价判据是 **非空（有移动操作符）且首个移动带 x**。
 *
 * 为什么等价：一个字形的"内容"在 glyf 里由轮廓点定义、在 CFF 里由 charstring 的移动操作符定义，
 * 两者都只有"有内容"才可能承载位移。实测：汉字 100% 满足；只有框线 `╯`、竖排标点 `︳`
 * 这类"纯竖笔起笔"的符号会被排除（它们本来也进不了高频字池）。
 *
 * ⚠️ 不可补丁的字形**直接不进候选**（与"空字形不进候选"同一机制），而不是报错 ——
 *    这样它们连扰动通道也不会被分配到，绝不会出现"被改了但改错"。
 */

import { parseCmap, type TtfRaw } from "../ttf/reader.js";
import { extractCffTable, parseCff, type CffFont } from "./table.js";
import { cffEligibleCodepoints } from "./token.js";

export interface CffContext {
  /** 容器读写句柄 */
  font: CffFont;
  /** 码点 → gid（用我们自己的 cmap 解析，容器无关，没必要引第二份实现） */
  cmap: Map<number, number>;
  /** 候选码点（升序） */
  eligible: number[];
}

/** 打开一份字体里的 CFF/CFF2 容器，并算好候选集 */
export function openCff(raw: TtfRaw): CffContext {
  const table = extractCffTable(raw.data, raw.tableOffsets, raw.tableLengths);
  if (!table) throw new Error("字体里没有 CFF / CFF2 表");
  const font = parseCff(table.bytes, table.isCFF2);
  const cmap = parseCmap(raw).map;
  const eligible = cffEligibleCodepoints(cmap, (gid) => font.getCharString(gid), {
    isCFF2: font.isCFF2,
    regionCount: (v) => font.regionCount(v),
  });
  return { font, cmap, eligible };
}
