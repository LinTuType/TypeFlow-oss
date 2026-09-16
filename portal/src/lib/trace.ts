/**
 * 完整追溯工具库（方案 B）
 *
 * 从「上传可疑字体 → 云端候选 → 本地双通道比对 → 命中订单 + 置信度」的完整闭环。
 * 关键区别于旧逻辑：旧逻辑只按原版哈希查候选然后让用户手动复制配方；
 * 这里直接把每个候选订单的云端配方(order_root)拉下来，交给本地引擎
 * traceWatermark 做真实的字形位移比对（通道 A 锚定 + 通道 B 配对 + 平移扫描），
 * 产出命中订单与置信度——用户不再需要任何手动步骤。
 *
 * 输入：
 *   originalBytes  原版字体（对标基准；形状基准与锚定重建都靠它）
 *   suspiciousBytes 可疑/泄漏的字体（待验证对象）
 * 输出：
 *   每个候选订单的比对结果，按置信度降序；matched 标记命中。
 */

import { apiOrders, apiTrace } from "../api/client";
import { traceWatermark, readNameId256, type TraceResult } from "@engine/trace";
import { createWebCryptoProvider } from "@engine/crypto";

const provider = createWebCryptoProvider();

/** 单候选订单比对结果 */
export interface TraceCandidateResult {
  orderId: string;
  fontSha256: string;
  result: TraceResult;
  matched: boolean;
  /** 可疑字体 Name256 里自带的订单 id（若有），可作旁证 */
  selfOrderId: string | null;
}

export interface FullTraceOutcome {
  candidates: TraceCandidateResult[];
  best: TraceCandidateResult | null;
  /** 若可疑字体自带 Name256（自证订单），倾向性提示 */
  selfClaimOrder: string | null;
  error?: string;
}

/** hex → bytes */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * 完整追溯：原版 + 可疑 → 命中订单
 *
 * 流程：
 *   1. 读可疑字体原版哈希所对应的云端订单候选（按原版哈希查）
 *   2. 逐个取配方（order_root），本地 traceWatermark 比对
 *   3. 置信度排序；>0.85 视为命中
 */
export async function fullTrace(
  originalBytes: Uint8Array,
  suspiciousBytes: Uint8Array,
): Promise<FullTraceOutcome> {
  // 0. 预检：可疑字体自带 Name256 里的 order_id（旁证，不单独作结论）
  let selfClaimOrder: string | null = null;
  try {
    const name = readNameId256(suspiciousBytes);
    if (name) {
      const meta = JSON.parse(name) as { order_id?: string };
      if (typeof meta.order_id === "string") selfClaimOrder = meta.order_id;
    }
  } catch { /* 忽略 */ }

  // 1. 云端候选：按【原版】字体哈希查（订单登记的原版哈希）
  const sha256hex = await sha256Hex(originalBytes);
  const candRes = await apiTrace.candidates(sha256hex);
  const ordered = candRes.candidates ?? [];
  if (ordered.length === 0) {
    return { candidates: [], best: null, selfClaimOrder, error: "原版哈希没有对应历史订单" };
  }

  // 2. 逐个订单拉配方 + 本地比对
  const results: TraceCandidateResult[] = [];
  for (const c of ordered) {
    let recipe: { order_root_hex?: string; order_id?: string } | null = null;
    try {
      const r = await apiTrace.orderRecipe(c.order_id);
      recipe = r.recipe ?? r;
    } catch {
      continue; // 取配方失败跳过（可能未签发）
    }
    const orderRootHex = recipe?.order_root_hex;
    if (!orderRootHex) continue;

    const tr = await traceWatermark({
      originalBytes,
      suspiciousBytes,
      provider,
      tenantId: "portal-local",
      candidateOrders: [c.order_id],       // 锁定本订单
      orderRoot: hexToBytes(orderRootHex), // 用云端配方种子重算选区
    });
    results.push({
      orderId: c.order_id,
      fontSha256: c.font_sha256,
      result: tr,
      // 命中判定对齐桌面版：高度可信 / 可信 视为命中，存疑 / 无法确认 不命中
      matched: tr.verdict.level === "high" || tr.verdict.level === "trusted",
      selfOrderId: selfClaimOrder,
    });
  }

  // 3. 置信度降序
  results.sort((a, b) => b.result.confidence - a.result.confidence);
  const best = results[0] ?? null;
  return { candidates: results, best, selfClaimOrder };
}

/** 计算 Uint8Array 的 SHA-256 hex（WebCrypto） */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 读可疑字体是否自带 Name256 自证（快速预检） */
export function readSelfClaim(bytes: Uint8Array): string | null {
  try {
    const name = readNameId256(bytes);
    if (!name) return null;
    const meta = JSON.parse(name) as { order_id?: string };
    return typeof meta.order_id === "string" ? meta.order_id : null;
  } catch {
    return null;
  }
}