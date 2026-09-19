/**
 * 完整追溯工具库（方案 B）
 *
 * 从「上传可疑字体 → 云端候选 → 本地双通道比对 → 命中订单 + 信号质量」的完整闭环。
 * 关键区别于旧逻辑：旧逻辑只按原版哈希查候选然后让用户手动复制配方；
 * 这里直接把每个候选订单的云端配方(order_root)拉下来，交给本地引擎
 * traceWatermark 做真实的字形位移比对（通道 A 锚定 + 通道 B 配对 + 平移扫描），
 * 产出命中订单与信号质量——用户不再需要任何手动步骤。
 *
 * 输入：
 *   originalBytes  原版字体（对标基准；形状基准与锚定重建都靠它）
 *   suspiciousBytes 可疑/泄漏的字体（待验证对象）
 * 输出：
 *   每个候选订单的比对结果，按信号质量降序；matched 标记命中。
 */

import { apiOrders, apiTrace } from "../api/client";
import { traceWatermark, readNameId256, CORRELATION_UNIQUENESS_DELTA, COLLUSION_SUSPECT_LABEL, RHO_TRUSTED, type TraceResult } from "@engine/trace";
import { createWebCryptoProvider } from "@engine/crypto";

const provider = createWebCryptoProvider();

/**
 * 唯一性判定的三态（见 `applyUniquenessCheck`）：
 * `single` 单一来源 / `multi` 多个订单都参与过 / `ambiguous` 分不清是谁。
 */
export type UniquenessVerdict = "single" | "multi" | "ambiguous";

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
  /**
   * 唯一性判定：`single` 单一来源 / `multi` 多个订单都参与过（**都点出来**）/ `ambiguous` 分不清（不点名）。
   * 见 `applyUniquenessCheck` 的三态表。
   */
  uniqueness: UniquenessVerdict;
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
 *   3. 按信号质量降序；**命中以 verdict.level ∈ {high, trusted} 为准**（不按分数阈值）
 */
/**
 * 追溯阶段 —— 供文书右上角的过程槽逐行显示。
 * 四步都对应真实的计算/请求，不是装饰性文案。
 */
export type TracePhase = "selfclaim" | "hash" | "candidates" | "compare";

/**
 * 唯一性判定（C′，2026-09-19）—— 三态，因为"接近"有两种完全不同的含义。
 *
 * 触发前提（对齐桌面版 `CORRELATION_UNIQUENESS_DELTA = 0.03`）：最佳相关性未明显高于次优。
 * 但**触发之后要看的是绝对高度**：
 *
 * | 形态 | 含义 | 处置 |
 * |---|---|---|
 * | `single` | 最佳明显高于次优 | 正常，点它 |
 * | `multi` | **多个候选都 ≥ 可信门槛且接近** ⇒ 这些订单**都参与过** | ✅ **全都点出来** + 判词，不降级 |
 * | `ambiguous` | 最佳只是勉强过线、次优也接近 ⇒ 真分不清 | ⛔ 不点名（+ 判词） |
 *
 * ⚠️ 为什么要分：这条规则**本意是"防点名错人"**（分不清就不说），但共谋场景下
 * "两个都高且接近"**不是歧义、是证据** —— 规则直接套上来就语义反转了。
 * 实测：k=2 的两个候选是 0.951 / 0.932（都稳稳过线 ⇒ multi）；
 * 而非共谋候选实测只有 0.20~0.25 ⇒ 不必担心"随便两个都过线"。
 *
 * 📌 产品口径（用户 2026-09-19 定）：**这个追溯是给设计师找嫌疑的，最后追不追责由设计师衡量**
 * ⇒ 工具不替用户藏名字。所以 `multi` 一律点名，`multi` 与 `ambiguous` 的区别只在"说不说得清"。
 *
 * 只有一个候选、或只有一个候选算出 ρ 时返回 `single`（无从比较）。
 * ⚠️ **调用方须先按信号质量降序** —— 它取 `results[0]` 当"最佳"。
 */
export function applyUniquenessCheck(results: TraceCandidateResult[]): UniquenessVerdict {
  const best = results[0];
  if (!best) return "single";
  const ranked = results
    .map((r) => r.result.verdict.metrics.rhoUsed)
    .filter((v): v is number => typeof v === "number")
    .sort((a, b) => b - a);
  if (ranked.length < 2 || ranked[0] - ranked[1] >= CORRELATION_UNIQUENESS_DELTA) return "single";

  const v = best.result.verdict;
  const addLabel = () => {
    if (!v.labels.includes(COLLUSION_SUSPECT_LABEL)) v.labels = [...v.labels, COLLUSION_SUSPECT_LABEL];
  };

  // 判据是"**有几个候选独立达标**"（`matched` = level ∈ {high, trusted}，门户自己的命中口径），
  // 而不是再硬编码一个 ρ 阈值 —— 达标 ≥2 个 ⇒ 不是歧义，是"都参与过" ⇒ **都点出来**，档位不动。
  const qualified = results.filter((r) => r.matched).length;
  if (qualified >= 2) {
    addLabel();
    return "multi";
  }

  // 只有一个达标、但次优的 ρ 挨得很近 ⇒ 真分不清 ⇒ 不点名（判据落在 level 上，门户只看 level）
  addLabel();
  if (v.level === "high" || v.level === "trusted") {
    v.level = "suspicious";
    v.levelLabel = "存疑";
  }
  best.matched = false;
  return "ambiguous";
}

export async function fullTrace(
  originalBytes: Uint8Array,
  suspiciousBytes: Uint8Array,
  onPhase?: (phase: TracePhase) => void,
): Promise<FullTraceOutcome> {
  // 0. 预检：可疑字体自带 Name256 里的 order_id（旁证，不单独作结论）
  onPhase?.("selfclaim");
  let selfClaimOrder: string | null = null;
  try {
    const name = readNameId256(suspiciousBytes);
    if (name) {
      const meta = JSON.parse(name) as { order_id?: string };
      if (typeof meta.order_id === "string") selfClaimOrder = meta.order_id;
    }
  } catch { /* 忽略 */ }

  // 1. 云端候选：按【原版】字体哈希查（订单登记的原版哈希）
  onPhase?.("hash");
  const sha256hex = await sha256Hex(originalBytes);
  onPhase?.("candidates");
  const candRes = await apiTrace.candidates(sha256hex);
  const ordered = candRes.candidates ?? [];
  if (ordered.length === 0) {
    return { candidates: [], best: null, selfClaimOrder, uniqueness: "single", error: "原版哈希没有对应历史订单" };
  }

  // 2. 逐个订单拉配方 + 本地比对
  onPhase?.("compare");
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

  // 3. 按信号质量降序
  results.sort((a, b) => b.result.confidence - a.result.confidence);
  const best = results[0] ?? null;

  // 4. 唯一性判定（C′）：见 `applyUniquenessCheck` 的三态表 ——
  //    `multi` = 多个订单都参与过（**都点出来**）；`ambiguous` = 分不清（不点名）。
  const uniqueness = applyUniquenessCheck(results);

  return { candidates: results, best, selfClaimOrder, uniqueness };
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