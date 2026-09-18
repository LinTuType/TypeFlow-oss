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

  // ── 产物结构自检：**画不出来就拒绝签发**，绝不把损坏的字体交给客户 ──
  //
  // 为什么必须守这道门（2026-09-18 用户报「签发能用、追溯不到」查出来的）：
  // 我们只换 CharStrings INDEX、其余结构逐字节照搬，所以唯一的风险是"序列化器有没有把
  // **绝对偏移**算对"。实测 fontkit 的 CFF 写出**对部分真实字体算不对**（带 local subrs 的
  // CID-keyed CFF，如 SourceHanSansCN-Regular.OTF）：独立实现 fontTools 复画时约**一半字形
  // 抛 `ValueError: not enough values to unpack`**，我们自己的读取器也大面积返回 null
  // ⇒ 追溯必然读不出字距位移，交付出去的字体也是坏的。
  // 这类字体在修好写出路径之前**一律拒绝**（用户能看到人话，而不是拿到坏字体或莫名其妙的"追溯不到"）。
  let sanity: { ok: boolean; inBadRate: number; outBadRate: number; sampled: number; internalError?: string };
  try {
    sanity = verifyOtfOutput(fontData, bytes);
  } catch (e) {
    // 自检自己跑不起来时**同样拒绝**（fail closed）：宁可让用户看到一句人话，
    // 也不要把「没验过」的产物当合格品交付出去。
    sanity = { ok: false, inBadRate: 0, outBadRate: 1, sampled: 0, internalError: String((e as Error).message) };
  }
  if (!sanity.ok) {
    throw new Error(
      sanity.internalError
        ? `这份 OTF 暂不支持签发：产物的结构自检没能完成（${sanity.internalError.slice(0, 60)}）。为避免交付损坏的字体，已中止签发。`
        : `这份 OTF 暂不支持签发：写出后约 ${(sanity.outBadRate * 100).toFixed(0)}% 的字形读不出轮廓`
          + `（原件只有 ${(sanity.inBadRate * 100).toFixed(0)}%），说明该字体的 CFF 结构我们还没能正确重建。`
          + "为避免交付损坏的字体，已中止签发；请改用同款 TTF，或把这款字体发给我们以支持它。",
    );
  }
  return { bytes, nModified, selection, nameId256, degraded: assigns.degraded };
}

/**
 * OTF 产物结构自检：抽样比"读不出轮廓"的字形比例。
 *
 * 判据用**相对恶化**而不是绝对值：有些字体本身就有一批空字形（读不出是正常的），
 * 只要产物没有比原件明显变差就算通过。
 */
export function verifyOtfOutput(
  inputBytes: Uint8Array,
  outputBytes: Uint8Array,
): { ok: boolean; inBadRate: number; outBadRate: number; sampled: number } {
  const a = openCff(parseSfnt(inputBytes)).font;
  const b = openCff(parseSfnt(outputBytes)).font;
  const n = Math.min(a.numGlyphs, b.numGlyphs);
  const step = Math.max(1, Math.floor(n / 400));   // 最多抽样 ~400 个字形
  let inBad = 0, outBad = 0, sampled = 0;
  for (let g = 1; g < n; g += step) {
    sampled++;
    if (a.glyphXMin(g) === null) inBad++;
    if (b.glyphXMin(g) === null) outBad++;
  }
  const inBadRate = inBad / Math.max(sampled, 1);
  const outBadRate = outBad / Math.max(sampled, 1);
  // 允许 5 个百分点的余量（重编码后个别字形判空属于正常波动）
  const ok = outBadRate <= Math.min(Math.max(inBadRate + 0.05, 0.10), 0.5);
  return { ok, inBadRate, outBadRate, sampled };
}
