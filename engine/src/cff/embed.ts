/**
 * OTF（CFF / CFF2）嵌入流程。
 *
 * 与 TTF 路径的区别只有三处，其余全部共用：
 *   1. 候选集来自 `cff/eligible.openCff`（判据等价：非空 + 首个移动带 x）
 *   2. 逐字形改写的是 **charstring 里的一个操作数**，不是坐标数组
 *   3. 组装时替换的表是 `CFF `/`CFF2` + `hmtx` + `name`（TTF 换的是 glyf/loca/head/hmtx/name）
 *
 * ⚠️ `name` 表必须同样写 Name 256（评审 A.2.2）：少了它第二通道缺失，更要紧的是
 *    `findExistingWatermark` 会失效 ⇒ 同一份 OTF 能被重复签发、两套位移互相污染。
 *
 * ⚠️ 算法版本号用 `web-v2`（见 `../embed.ts` 文件头）。
 */

import { runSelection } from "../webv1.js";
import { loadAnchorPool } from "../pool.js";
import { parseSfnt } from "../ttf/reader.js";
import { parseNameTable, buildNameTable } from "../ttf/name.js";
import { assembleSfnt, rebuildHmtx, numGlyphsOf } from "../ttf/sfnt.js";
import { buildShiftMap } from "../shiftmap.js";
import { buildNameId256, ALGO_VERSION_CFF, type EmbedParams, type EmbedResult } from "../embed.js";
import { openCff } from "./eligible.js";
import { patchCharString } from "./token.js";

export async function embedWatermarkOtf(params: EmbedParams): Promise<EmbedResult> {
  const { fontData, provider, tenantId, orderId, bitsSuffix = "" } = params;

  const raw = parseSfnt(fontData);
  const { font: cff, cmap, eligible } = openCff(raw);

  // 1. 选择：规则与 TTF 侧完全一致，只有 algoVersion 与候选集来源不同
  const selection = await runSelection(
    fontData,
    params.masterKey ?? new Uint8Array(0),
    provider,
    tenantId,
    orderId,
    bitsSuffix,
    loadAnchorPool(),
    params.orderRoot,
    { algoVersion: ALGO_VERSION_CFF, eligible },
  );

  // 2. 码点 → gid → 位移（共用换算与冲突检测）
  const assigns = buildShiftMap(selection, cmap);
  if (assigns.fatal.length > 0) {
    throw new Error(`字体选择冲突: ${assigns.fatal.join(", ")}`);
  }

  // 3. 逐字形补丁。未改的字形**必须保持原字节**（不重编 ⇒ hint/subr 全留）
  const patchOpts = {
    isCFF2: cff.isCFF2,
    regionCount: (v: number) => cff.regionCount(v),
  };
  const charStrings: Uint8Array[] = [];
  let nModified = 0;
  for (let gid = 0; gid < cff.numGlyphs; gid++) {
    const orig = cff.getCharString(gid);
    const s = assigns.shifts(gid);
    if (s === 0) {
      charStrings.push(orig);
      continue;
    }
    const r = patchCharString(orig, s, patchOpts);
    if (r.ok) {
      charStrings.push(r.bytes!);
      nModified++;
    } else {
      // 不可补丁 ⇒ 该字形不动。它本来也不会进候选（见 cff/eligible），
      // 所以走到这里意味着候选集与补丁器判定不一致 —— 宁可报错也不要静默漏改。
      throw new Error(`字形 gid${gid} 被选中但无法打补丁：${r.why ?? "未知原因"}`);
    }
  }

  // 4. 重建容器表 + hmtx.lsb + name（其余表逐字节原样）
  const nameId256 = buildNameId256(ALGO_VERSION_CFF, orderId, selection.font_sha256, bitsSuffix);
  const nameOff = raw.tableOffsets.get("name");
  const nameLen = raw.tableLengths.get("name");
  if (nameOff === undefined || nameLen === undefined) {
    throw new Error("字体缺少 name 表，无法写入水印记录");
  }
  const newName = buildNameTable(parseNameTable(raw.data, nameOff, nameLen), nameId256);

  const tableTag = cff.isCFF2 ? "CFF2" : "CFF ";
  const bytes = assembleSfnt(raw, {
    [tableTag]: cff.rebuild(charStrings),
    hmtx: rebuildHmtx(raw, assigns.shifts, numGlyphsOf(raw)),
    name: newName,
  }, nModified).bytes;

  return { bytes, nModified, selection, nameId256, degraded: assigns.degraded };
}
