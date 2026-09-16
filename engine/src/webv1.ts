/**
 * web-v1 确定性选择器 — TS 侧实现
 *
 * 与 reference/reference_webv1.py 的 run_selection 逐字段对齐。
 * 一致性通过 engine/tests/compare.ts 校验（同输入 → 同结果）。
 *
 * 依赖算法规则全部来自 manifest/algorithm-manifest.json，
 * 本模块不引入任何随机数（无 Math.random / 无 shuffle）。
 */

import { eligibleCodepoints, parseSfnt, type TtfRaw } from "./ttf/reader.js";
import type { CryptoProvider } from "./crypto.js";

/** 从 manifest 冻结的常量（与 reference 一致） */
export const ALGO_VERSION = "web-v1";
export const BIT_COUNT = 20;
export const REDUNDANCY = 3;
export const ANCHOR_COUNT = 60;
export const PAIR_COUNT = 60;
export const NOISE_COUNT = 100;

/** 选择结果（可 JSON 序列化，供一致性比对） */
export interface SelectionResult {
  manifest: string;
  font_sha256: string;
  canonical_context: string;
  order_root_hex: string;
  bits: number[];
  bits_hex: string;
  eligibles_total: number;
  anchors: number[];
  pairs: number[];
  noises: number[];
  noise_shifts: Record<string, number>;
}

/** HMAC-SHA256 助手（注入 provider） */
async function hmacSha256(
  provider: CryptoProvider,
  key: Uint8Array,
  msgStr: string,
): Promise<Uint8Array> {
  return provider.hmacSha256(key, new TextEncoder().encode(msgStr));
}

/** SHA-256 文件哈希（hex，小写）—— 供 Name 256 / 追溯地址复用 */
export async function fileSha256(
  provider: CryptoProvider,
  buf: Uint8Array,
): Promise<string> {
  const d = await provider.sha256(buf);
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 生成 20 bit 指纹：SHA256(order_id+suffix) 前19位 + 偶校验（与桌面版同构） */
export async function generateWatermarkBits(
  provider: CryptoProvider,
  orderId: string,
  suffix = "",
): Promise<number[]> {
  const seed = orderId + suffix;
  const digest = await provider.sha256(new TextEncoder().encode(seed));
  const bits: number[] = [];
  for (let i = 0; i < 19; i++) {
    const byteIdx = i >> 3;
    const bitIdx = 7 - (i % 8);
    const bit: number = (digest[byteIdx] & 0xff) >> bitIdx & 1;
    bits.push(bit);
  }
  const parity = bits.reduce<number>((a, b) => a + b, 0) % 2;
  bits.push(parity);
  // TS 5.9 会把 every(b===0) 的 true 分支窄化成 0[]，用标志位绕开
  let allZero = true;
  for (const b of bits) {
    if (b !== 0) { allZero = false; break; }
  }
  if (allZero) {
    bits[0] = 1;
    const rest = bits.slice(0, 19).reduce<number>((a, b) => a + b, 0);
    bits[19] = rest % 2;
  }
  return bits;
}

/** canonical_context：JSON 规范序列化（无空白、键序固定） */
export function canonicalContext(
  algoVersion: string,
  tenantId: string,
  orderId: string,
  fontSha256: string,
  bitsSuffix: string,
): string {
  return JSON.stringify([algoVersion, tenantId, orderId, fontSha256, bitsSuffix]);
}

/** 按 (score, codepoint) 升序排序取前 count（同分按码点，保证确定性） */
function selectTop(
  pool: number[],
  scores: Map<number, Uint8Array>,
  count: number,
): number[] {
  const scored: Array<[Uint8Array, number]> = pool.map((cp) => [scores.get(cp)!, cp]);
  scored.sort((a, b) => {
    // 字节字典序比较 score
    const x = a[0];
    const y = b[0];
    for (let i = 0; i < x.length; i++) {
      if (x[i] !== y[i]) return x[i] - y[i];
    }
    return a[1] - b[1]; // 同分按码点升序
  });
  return scored.slice(0, count).map(([, cp]) => cp);
}

/** 字节 → hex（小写）助手 */
export function bytesToHex(d: Uint8Array): string {
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 运行完整确定性选择（与 reference.run_selection 对齐）
 *
 * 两种调用形态：
 *   - 云端/测试：传 masterKey → 内部由 canonical_context 派生 order_root
 *   - 浏览器（配方模式）：传 orderRootOverride（= 云端派生的 order_root），
 *     不再需要 masterKey（密钥不落浏览器）
 * @param fontData TTF 原始字节
 * @param masterKey 32 字节主密钥（orderRootOverride 存在时可为空）
 * @param provider 密码学实现（Node / WebCrypto 均可，保证跨端一致）
 */
export async function runSelection(
  fontData: Uint8Array,
  masterKey: Uint8Array,
  provider: CryptoProvider,
  tenantId: string,
  orderId: string,
  bitsSuffix = "",
  anchorPool?: number[],
  orderRootOverride?: Uint8Array,
): Promise<SelectionResult> {
  const raw: TtfRaw = parseSfnt(fontData);
  const eligible = eligibleCodepoints(raw);

  // 锚定候选：优先显式传入（含高频池∩cmap），否则回退全合格字形
  let anchorEligible = eligible;
  if (anchorPool && anchorPool.length > 0) {
    const poolSet = new Set(anchorPool);
    anchorEligible = eligible.filter((cp) => poolSet.has(cp));
  }
  if (anchorEligible.length < ANCHOR_COUNT) {
    throw new Error(
      `锚定候选不足: 需要 ${ANCHOR_COUNT}, 实际 ${anchorEligible.length}` +
      (anchorPool ? "（高频字池∩字体）" : ""),
    );
  }

  const fontSha256 = await fileSha256(provider, fontData);
  const ctxStr = canonicalContext(ALGO_VERSION, tenantId, orderId, fontSha256, bitsSuffix);
  // 配方模式：直接用云端下发的 order_root；否则由主密钥派生
  const oroot = orderRootOverride && orderRootOverride.length === 32
    ? orderRootOverride
    : await hmacSha256(provider, masterKey, ctxStr);

  // 租户候选序（锚定空间，pool: 前缀 —— 由 order_root 派生，主密钥不直接参与）
  const poolScores = new Map<number, Uint8Array>();
  for (const cp of anchorEligible) {
    poolScores.set(cp, await hmacSha256(provider, oroot, `pool:${cp}`));
  }

  // 订单级锚定：在租户候选序上按 anchor_score 排序取 60
  const anchorScores = new Map<number, Uint8Array>();
  for (const cp of anchorEligible) {
    anchorScores.set(cp, await hmacSha256(provider, oroot, `anchor:${cp}`));
  }
  const anchors = selectTop(anchorEligible, anchorScores, ANCHOR_COUNT);
  const anchorSet = new Set(anchors);

  // 配对：非锚定（全字形空间）
  const pairPool = eligible.filter((cp) => !anchorSet.has(cp));
  if (pairPool.length < PAIR_COUNT) {
    throw new Error(`配对候选不足: 需要 ${PAIR_COUNT}, 实际 ${pairPool.length}`);
  }
  const pairScores = new Map<number, Uint8Array>();
  for (const cp of pairPool) pairScores.set(cp, await hmacSha256(provider, oroot, `pair:${cp}`));
  const pairs = selectTop(pairPool, pairScores, PAIR_COUNT);
  const pairSet = new Set(pairs);

  // 扰动：非锚定非配对
  const noisePool = eligible.filter((cp) => !anchorSet.has(cp) && !pairSet.has(cp));
  const noiseScores = new Map<number, Uint8Array>();
  for (const cp of noisePool) noiseScores.set(cp, await hmacSha256(provider, oroot, `noise:${cp}`));
  const noises = selectTop(noisePool, noiseScores, NOISE_COUNT);

  // 扰动位移：整个 32 字节 digest 视为大端大整数 % 5 - 2（与 Python int.from_bytes 对齐）
  const noiseShifts: Record<string, number> = {};
  for (const cp of noises) {
    const d = noiseScores.get(cp)!;
    const big = BigInt("0x" + bytesToHex(d));
    noiseShifts[String(cp)] = Number(big % 5n) - 2;
  }

  const bits = await generateWatermarkBits(provider, orderId, bitsSuffix);
  let bitsHex = "";
  for (let i = 0; i < bits.length; i += 4) {
    const nibble = bits.slice(i, i + 4).reduce((acc, b, j) => acc | (b << (3 - j)), 0);
    bitsHex += nibble.toString(16).toUpperCase();
  }

  return {
    manifest: ALGO_VERSION,
    font_sha256: fontSha256,
    canonical_context: ctxStr,
    order_root_hex: bytesToHex(oroot),
    bits,
    bits_hex: bitsHex,
    eligibles_total: eligible.length,
    anchors,
    pairs,
    noises,
    noise_shifts: noiseShifts,
  };
}