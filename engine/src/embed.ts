/**
 * web-v1 双通道嵌入流水线 — 阶段 1（入口，按轮廓容器分派）
 *
 * ```
 *                 ┌─ glyf（TTF，静态或可变） → ttf/writer.rebuildFont
 * embedWatermark ─┤
 *                 └─ CFF / CFF2（OTF）      → cff/embed.embedWatermarkOtf
 * ```
 *
 * 两条路共用：
 *   - 选择规则（`webv1.runSelection`，唯一差别是 `algoVersion` 与候选集来源）
 *   - 码点→gid→位移与冲突检测（`shiftmap.buildShiftMap`）
 *   - "已带水印不能重复签发"的前置检查（`findExistingWatermark`，读 name 表，容器无关）
 *
 * ⚠️ 算法版本号：TTF（含可变）保持 `web-v1`，OTF 用 `web-v2`。
 *    `algo_version` 进 `canonical_context` ⇒ 进 `order_root` 派生。给 TTF 换版本号会让
 *    **已签发订单**的追溯上下文对不上；而 v1 清单已冻结声明 `out_of_scope.cff_otf`，
 *    OTF 是新能力 ⇒ 新版本号。
 */

import { runSelection, type SelectionResult, ALGO_VERSION } from "./webv1.js";
import { loadAnchorPool } from "./pool.js";
import type { CryptoProvider } from "./crypto.js";
import { parseSfnt, parseCmap, assertSupportedFont, type TtfRaw } from "./ttf/reader.js";
import { parseNameTable, looksLikeWatermark, orderIdOfWatermark, WATERMARK_NAME_ID } from "./ttf/name.js";
import { rebuildFont, type EmbedOutput } from "./ttf/writer.js";
import { buildShiftMap } from "./shiftmap.js";
import { embedWatermarkOtf } from "./cff/embed.js";

/** OTF/CFF 容器使用的算法版本号（TTF 侧仍为 web-v1，见文件头） */
export const ALGO_VERSION_CFF = "web-v2";

export interface EmbedParams {
  /** 字体原始字节 */
  fontData: Uint8Array;
  /** 32 字节主密钥（仅云端/测试用；配方模式传 orderRoot 时可省略） */
  masterKey?: Uint8Array;
  /** 云端派生的订单种子（配方模式）：提供后 masterKey 不再使用（密钥不落浏览器） */
  orderRoot?: Uint8Array;
  /** 密码学实现（Node / WebCrypto 均可） */
  provider: CryptoProvider;
  tenantId: string;
  orderId: string;
  bitsSuffix?: string;
}

export interface EmbedResult extends EmbedOutput {
  selection: SelectionResult;
  nameId256: string;
  /**
   * 因"多个码点 → 同一字形"而按优先级让位的角色（锚定 > 配对 > 扰动）。
   * CID 字体（中日文商业字库）里很常见；让位是安全的，但要能看见（见 `shiftmap.ts`）。
   */
  degraded?: string[];
}

/** Name ID 256 内容：单行 JSON（与 manifest nameid256 字段对齐） */
export function buildNameId256(
  algoVersion: string,
  orderId: string,
  fontSha256: string,
  bitsSuffix: string,
): string {
  return JSON.stringify({
    schema: "typeflow",
    algo_version: algoVersion,
    order_id: orderId,
    font_sha256: fontSha256,
    bits_suffix: bitsSuffix,
  });
}

/**
 * 探测字体里已有的水印记录（Name ID 256）。
 *
 * ⚠️ **必须按内容判，不能按编号判**（2026-09-18 实测）：Name ID 256 属于 OpenType 的
 * "字体自定义"区间，而**可变字体的轴实例名正好从这里开始** —— 实测思源黑体 SC VF 的
 * `(3,1,1033,256)` 就是默认实例名 `Regular`。早先按编号判 ⇒ 所有可变字体都被误判成
 * "已经带水印"，**一台都签不了**。这里扫**全部** nameID 256 记录，只认内容像我们水印的那条
 * （web 的 JSON 或桌面版的 `key=value`；见 `ttf/name.ts · looksLikeWatermark`）。
 *
 * @returns null = 没有水印；否则返回水印里记录的 order_id（解析不出时为 null）
 */
export function findExistingWatermark(fontData: Uint8Array): { orderId: string | null } | null {
  const raw = parseSfnt(fontData);
  const off = raw.tableOffsets.get("name");
  const len = raw.tableLengths.get("name");
  if (off === undefined || len === undefined) return null;
  const rec = parseNameTable(raw.data, off, len)
    .find((n) => n.nameID === WATERMARK_NAME_ID && looksLikeWatermark(n.value));
  if (!rec) return null;
  return { orderId: orderIdOfWatermark(rec.value) };
}

/**
 * 运行完整嵌入（按容器分派）。
 * @returns 新字体字节 + 统计 + 选择结果（供验证）
 */
export async function embedWatermark(params: EmbedParams): Promise<EmbedResult> {
  const { fontData } = params;

  const kind = assertSupportedFont(fontData);

  // 已经带水印的字体不能再签一次：新位移会叠加在旧位移上、Name 256 被后一单覆盖，
  // 结果是第一份订单彻底失去可追溯性 —— 而这个过程此前是静默成功的。
  // 「客户把收到的水印字体又导进字体库」是很容易发生的操作。
  const existing = findExistingWatermark(fontData);
  if (existing) {
    throw new Error(
      existing.orderId
        ? `这份字体已经带水印（订单 ${existing.orderId}），不能重复签发——请改用未经签发的原始字体。重复嵌入会让前一份订单失去可追溯性`
        : "这份字体已经带水印，不能重复签发——请改用未经签发的原始字体",
    );
  }

  if (kind !== "glyf") {
    return embedWatermarkOtf(params);
  }

  const raw: TtfRaw = parseSfnt(fontData);
  const cmap = parseCmap(raw).map;

  // 1. 确定性选择（锚定候选固定高频字池∩cmap；algoVersion 保持 web-v1）
  const selection = await runSelection(
    fontData,
    params.masterKey ?? new Uint8Array(0),
    params.provider,
    params.tenantId,
    params.orderId,
    params.bitsSuffix ?? "",
    loadAnchorPool(),
    params.orderRoot,
    { algoVersion: ALGO_VERSION },
  );

  // 2. 码点 → gid → 位移（与 OTF 路径共用同一份换算与冲突检测）
  const assigns = buildShiftMap(selection, cmap);
  if (assigns.fatal.length > 0) {
    throw new Error(`字体选择冲突: ${assigns.fatal.join(", ")}`);
  }

  // 3. Name ID 256
  const nameId256 = buildNameId256(
    selection.manifest,
    params.orderId,
    selection.font_sha256,
    params.bitsSuffix ?? "",
  );

  // 4. 重建字体（glyf 路径；可变字体也走这里，hmtx.lsb 由 rebuildHmtx 同步）
  const rebuilt = rebuildFont(raw, assigns.shifts, nameId256);

  return {
    bytes: rebuilt.bytes,
    nModified: rebuilt.nModified,
    selection,
    nameId256,
    degraded: assigns.degraded,
  };
}
