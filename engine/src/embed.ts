/**
 * web-v1 双通道嵌入流水线 — 阶段 1
 *
 * 把「确定性选择（webv1.ts，阶段0）」与「坐标位移 + 写回（writer.ts）」串起来：
 *
 *   1. runSelection → 60 锚定码点 / 60 配对码点 / 100 扰动位移
 *   2. 码点 → glyph id（经 cmap）
 *   3. 通道 A：锚定字 bit=1 → +2，bit=0 → -2
 *      通道 B：配对字 bit=1 → -2，bit=0 → +2（反向）
 *      扰动字：noise_shifts[码点]（可能为 0 → 跳过）
 *   4. 写 Name ID 256（schema/algo_version/order_id/font_sha256/bits_suffix）
 *   5. rebuildFont → 新字体字节
 */

import { runSelection, type SelectionResult } from "./webv1.js";
import { loadAnchorPool } from "./pool.js";
import type { CryptoProvider } from "./crypto.js";
import { parseSfnt, parseCmap, assertSupportedTtf, type TtfRaw } from "./ttf/reader.js";
import { parseNameTable } from "./ttf/name.js";
import { rebuildFont, type EmbedOutput } from "./ttf/writer.js";

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
 * 探测字体里已有的 web-v1 水印记录（Name ID 256）。
 *
 * @returns null = 没有水印；否则返回水印里记录的 order_id（解析不出时为 null）
 */
export function findExistingWatermark(fontData: Uint8Array): { orderId: string | null } | null {
  const raw = parseSfnt(fontData);
  const off = raw.tableOffsets.get("name");
  const len = raw.tableLengths.get("name");
  if (off === undefined || len === undefined) return null;
  const rec = parseNameTable(raw.data, off, len)
    .find((n) => n.nameID === 256 && n.platformID === 3);
  if (!rec) return null;
  try {
    const meta = JSON.parse(rec.value) as { order_id?: unknown };
    return { orderId: typeof meta.order_id === "string" ? meta.order_id : null };
  } catch {
    // 非 JSON 的旧记录：仍然是水印，只是读不出订单号
    return { orderId: null };
  }
}

/**
 * 运行完整 web-v1 嵌入。
 * @returns 新字体字节 + 统计 + 选择结果（供验证）
 */
export async function embedWatermark(params: EmbedParams): Promise<EmbedResult> {
  const { fontData, masterKey, orderRoot, provider, tenantId, orderId, bitsSuffix = "" } = params;

  assertSupportedTtf(fontData);          // OTF/CFF 入口即拒绝（产品化文案）

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

  const raw: TtfRaw = parseSfnt(fontData);
  const cmap = parseCmap(raw);

  // 1. 确定性选择（阶段 0 验证过的同一逻辑；锚定候选固定高频字池∩cmap）
  const selection = await runSelection(
    fontData, masterKey ?? new Uint8Array(0), provider, tenantId, orderId, bitsSuffix, loadAnchorPool(), orderRoot,
  );

  // 2. 码点 → gid 映射；同一 gid 可能被多码点命中 → 冲突记录
  const anchorGid = new Map<number, number>(); // gid -> bit
  const pairGid = new Map<number, number>();
  const noiseGid = new Map<number, number>();

  const bits = selection.bits;
  const expanded: number[] = [];
  for (const b of bits) expanded.push(b, b, b); // 60 bit（已由 20×3 展开）

  selection.anchors.forEach((cp, i) => {
    const gid = cmap.map.get(cp);
    if (gid === undefined) return;
    anchorGid.set(gid, expanded[i] ?? 0);
  });

  selection.pairs.forEach((cp, i) => {
    const gid = cmap.map.get(cp);
    if (gid === undefined) return;
    pairGid.set(gid, expanded[i] ?? 0);
  });

  for (const cp of selection.noises) {
    const gid = cmap.map.get(cp);
    if (gid === undefined) continue;
    noiseGid.set(gid, selection.noise_shifts[String(cp)] ?? 0);
  }

  // 冲突处理：锚定 > 配对 > 扰动（同一 gid 多角色时锚定优先，理论上罕见）
  const conflicts: string[] = [];
  for (const gid of anchorGid.keys()) {
    if (pairGid.has(gid)) conflicts.push(`gid${gid}:anchor+pair`);
    if (noiseGid.has(gid)) conflicts.push(`gid${gid}:anchor+noise`);
  }
  for (const gid of pairGid.keys()) {
    if (!anchorGid.has(gid) && noiseGid.has(gid)) conflicts.push(`gid${gid}:pair+noise`);
  }
  if (conflicts.length > 0) {
    throw new Error(`字体选择冲突: ${conflicts.join(", ")}`);
  }

  // 3. 位移函数（gid → shiftX）
  const shifts = (gid: number): number => {
    const a = anchorGid.get(gid);
    if (a !== undefined) return a === 1 ? 2 : -2; // 通道 A 正/负
    const p = pairGid.get(gid);
    if (p !== undefined) return p === 1 ? -2 : 2; // 通道 B 反向
    return noiseGid.get(gid) ?? 0;
  };

  // 4. Name ID 256
  const nameId256 = buildNameId256(
    selection.manifest,
    orderId,
    selection.font_sha256,
    bitsSuffix,
  );

  // 5. 重建字体
  const rebuilt = rebuildFont(raw, shifts, nameId256);

  return {
    bytes: rebuilt.bytes,
    nModified: rebuilt.nModified,
    selection,
    nameId256,
  };
}