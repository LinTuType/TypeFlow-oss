/**
 * 阶段 2：攻击测试与恢复率评估
 *
 * 覆盖（对照方案 §阶段2）：
 *   1. 全局平移（统一 +N）—— 通道 A 应失效，通道 B 相对间距应幸存 → 验证双通道价值
 *   2. 随机污染（部分字形坐标扰动）—— 量化为恢复率
 *   3. 子集化（真实 fontTools subset）—— 锚定字部分缺失时的冗余恢复
 *   4. 删 Name 表 —— 候选恢复（阶段 1 已验证，此处并入量化）
 *   5. 多订单交叉对比 —— 不同订单锚定字重叠率应低
 *   6. 错误订单误命中 —— 随机订单不应命中
 *
 * 输出指标：锚定通道 bit 恢复率 / 配对通道方向一致率 / 双通道综合命中率。
 * 任何攻击下「正确订单」置信度显著高于「错误订单」即视为该攻击被抵挡。
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { embedWatermark } from "../src/embed.js";
import { traceWatermark } from "../src/trace.js";
import { runSelection } from "../src/webv1.js";
import { createNodeCryptoProvider } from "../src/crypto.node.js";
import { overlapRatio, attackGlobalShift, attackPollute, attackSubset, attackStripName, attackCommonCharsSubset } from "./attack_util.js";
import { loadAnchorPool } from "../src/pool.js";
import { FONT_HYBUDAI, FONT_XINGYUN, resolveFont } from "./fontPath.js";

const NODE_CRYPTO = createNodeCryptoProvider();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const MASTER_KEY = new Uint8Array(Buffer.from(
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "hex",
));
const TENANT = "tenant-zhong";
const FIXTURES = [resolveFont(FONT_XINGYUN), resolveFont(FONT_HYBUDAI)];

/**
 * ⚠️ 命中判据 = **门户的口径**，与 `portal/src/lib/trace.ts` 一字不差。
 *
 * 原先这里用的是 `matchedOrder === order && confidence > 0.5` —— 那是条**死闸**：
 * `grep -rn matchedOrder portal/src` 零命中，门户根本不读它，而且它的零假设正好是 0.5（毫无余量）。
 * 用它当判据 ⇒ 这张表的"恢复率"可能比产品实际乐观，而对外文档引用的数字正是从这里来的。
 */
const isHit = (lv: string): boolean => lv === "high" || lv === "trusted";

// 结果汇总
type Row = { attack: string; order: string; conf: number; votes: number; total: number; hit: boolean; levelLabel: string };
const rows: Row[] = [];

/** 追溯一次并记录（显式传候选订单：全局平移/子集化会删 Name，不能依赖 Name 256） */
async function traceRecord(
  name: string,
  orig: Uint8Array,
  susp: Uint8Array,
  expectOrder: string,
): Promise<boolean> {
  const tr = await traceWatermark({
    originalBytes: orig,
    suspiciousBytes: susp,
    masterKey: MASTER_KEY,
    provider: NODE_CRYPTO,
    tenantId: TENANT,
    candidateOrders: [expectOrder],
  });
  const hit = isHit(tr.verdict.level);
  rows.push({
    attack: name,
    order: expectOrder,
    conf: tr.confidence,
    votes: tr.votes,
    total: tr.total,
    hit,
    levelLabel: tr.verdict.levelLabel,
  });
  return hit;
}

/** 正确订单 vs 干扰订单的置信度差（防误命中评价） */
async function confFor(
  orig: Uint8Array,
  susp: Uint8Array,
  order: string,
): Promise<{ conf: number; bits: number[]; level: string; levelLabel: string }> {
  const tr = await traceWatermark({
    originalBytes: orig,
    suspiciousBytes: susp,
    masterKey: MASTER_KEY,
    provider: NODE_CRYPTO,
    tenantId: TENANT,
    candidateOrders: [order],
  });
  return { conf: tr.confidence, bits: tr.channelA_bits, level: tr.verdict.level, levelLabel: tr.verdict.levelLabel };
}

// ─── 主流程 ───
let pass = 0, fail = 0;
(async () => {
for (const fontPath of FIXTURES) {
  const fontName = fontPath.split("/").pop()!;
  const orderA = `ORD-A-${fontName.slice(0, 6)}`;
  const orderB = `ORD-B-${fontName.slice(0, 6)}`;

  const wmA = await embedWatermark({ fontData: new Uint8Array(readFileSync(fontPath)), masterKey: MASTER_KEY, provider: NODE_CRYPTO, tenantId: TENANT, orderId: orderA });
  const orig = new Uint8Array(readFileSync(fontPath));

  console.log(`\n=== ${fontName} ===`);

  // ── 1. 干净回读（基线）──
  const clean = await traceRecord("clean", orig, wmA.bytes, orderA);
  console.log(`  [基线] 干净回读 ${clean ? "✅" : "❌"} conf=${rows[rows.length - 1].conf.toFixed(3)}`);

  // ── 2. 全局平移 +5 / +10 ──
  for (const shift of [5, 10]) {
    const shifted = attackGlobalShift(wmA.bytes, shift);
    const ok = await traceRecord(`shift+${shift}`, orig, shifted, orderA);
    console.log(`  [全局平移 +${shift}] ${ok ? "✅" : "❌"} conf=${rows[rows.length - 1].conf.toFixed(3)} votes=${rows[rows.length - 1].votes}/${rows[rows.length - 1].total}`);
  }

  // ── 3. 随机污染 10% / 50% ──
  const pollute10 = attackPollute(wmA.bytes, 0.10, 3, 101);
  const okP10 = await traceRecord("pollute10%", orig, pollute10, orderA);
  console.log(`  [污染 10%] ${okP10 ? "✅" : "❌"} conf=${rows[rows.length - 1].conf.toFixed(3)}`);

  const pollute50 = attackPollute(wmA.bytes, 0.50, 3, 202);
  const okP50 = await traceRecord("pollute50%", orig, pollute50, orderA);
  console.log(`  [污染 50%] ${okP50 ? "✅" : "❌"} conf=${rows[rows.length - 1].conf.toFixed(3)}`);

  // ── 4. 子集化 70% / 90%（fontTools subset，含锚定缺失）──
  for (const ratio of [0.7, 0.9]) {
    const sub = attackSubset(wmA.bytes, ratio, ratio * 100 | 0);
    const ok = await traceRecord(`subset${Math.round(ratio * 100)}%`, orig, sub.bytes, orderA);
    console.log(`  [子集化 ${Math.round(ratio * 100)}%] ${ok ? "✅" : "❌"} conf=${rows[rows.length - 1].conf.toFixed(3)} kept=${sub.kept}`);
  }

  // ── 4b. 常用字子集化（用户场景：重打包成常用字版本，锚定池存活验证）──
  const common = attackCommonCharsSubset(wmA.bytes, 13);
  const okCommon = await traceRecord("common-subset", orig, common.bytes, orderA);
  console.log(`  [常用字子集] ${okCommon ? "✅" : "❌"} conf=${rows[rows.length - 1].conf.toFixed(3)} kept=${common.kept}`);

  // ── 5. 删 Name 表 ──
  const stripped = attackStripName(wmA.bytes);
  const okStrip = await traceRecord("strip-name", orig, stripped, orderA);
  console.log(`  [删 Name] ${okStrip ? "✅" : "❌"} conf=${rows[rows.length - 1].conf.toFixed(3)}`);

  // ── 6. 多订单交叉对比：两订单锚定字重叠率 ──
  const selA = await runSelection(orig, MASTER_KEY, NODE_CRYPTO, TENANT, orderA, "", loadAnchorPool());
  const selB = await runSelection(orig, MASTER_KEY, NODE_CRYPTO, TENANT, orderB, "", loadAnchorPool());
  const overlap = overlapRatio(selA.anchors, selB.anchors);
  console.log(`  [交叉对比] 订单A/B 锚定重叠率 = ${(overlap * 100).toFixed(1)}% ${overlap < 0.5 ? "✅(低重叠)" : "❌(高重叠!)"}`);

  // ── 7. 错误订单误命中：同字体但错误 key/order 去 trace ──
  const wrongOrder = `ORD-UNRELATED-${fontName.slice(0, 6)}`;
  const wrong = await confFor(orig, wmA.bytes, wrongOrder);
  const noFalse = !isHit(wrong.level);
  console.log(`  [错误订单] 置信度=${wrong.conf.toFixed(3)} 判定「${wrong.levelLabel}」 ${noFalse ? "✅(未误命中)" : "❌(误命中!)"}`);

  // ── 8. 零假设：原版槽位选错（可疑是另一份字体）+ 一组无关候选 ──
  //    门户判"命中"只认 level ∈ {high, trusted}，所以这里必须一个都不许命中。
  const otherFont = resolveFont(fontPath === resolveFont(FONT_XINGYUN) ? FONT_HYBUDAI : FONT_XINGYUN);
  const unrelated = Array.from({ length: 20 }, (_, i) => `ORD-Z-${fontName.slice(0, 4)}-${String(i + 1).padStart(4, "0")}`);
  const trZero = await traceWatermark({
    originalBytes: orig,
    suspiciousBytes: new Uint8Array(readFileSync(otherFont)),
    masterKey: MASTER_KEY,
    provider: NODE_CRYPTO,
    tenantId: TENANT,
    candidateOrders: unrelated,
  });
  const zeroOk = !isHit(trZero.verdict.level);
  console.log(`  [零假设] 无关字体 + 20 个无关候选 → 最高分判定「${trZero.verdict.levelLabel}」 一致率=${trZero.confidence.toFixed(3)} ${zeroOk ? "✅(未误命中)" : "❌(误命中!)"}`);

  // ── 9. ρ 路在位（锁住相关检测器）──
  //    正牌水印字体上两通道的相关性都应≈1.0、有效样本=60。
  //    这条锁的是"网页版只有 bits 一路"那个缺口：补上 ρ 后，降级阶梯探针里
  //    "网页版不命中"从 35 格降到 5 格（余下 4 格是量化超阈、桌面同样失守）。
  const rhoProbe = await traceWatermark({
    originalBytes: orig,
    suspiciousBytes: wmA.bytes,
    masterKey: MASTER_KEY,
    provider: NODE_CRYPTO,
    tenantId: TENANT,
    candidateOrders: [orderA],
  });
  const rm = rhoProbe.verdict.metrics;
  const rhoOk = rm.rhoA >= 0.9 && rm.rhoB >= 0.9 && rm.rhoValid === 60;
  console.log(
    `  [相关检测] rhoA=${rm.rhoA.toFixed(3)} rhoB=${rm.rhoB.toFixed(3)} valid=${rm.rhoValid} ${rhoOk ? "✅" : "❌"}`,
  );

  // 输出每个攻击的命中结果
  const fontRows = rows.filter((r) => r.order === orderA);
  const allOk = clean && fontRows.filter((r) => r.hit).length === fontRows.length && noFalse && zeroOk && rhoOk && overlap < 0.5;
  if (allOk) { pass++; } else { fail++; }
}

// ─── 汇总表 ───
console.log(`\n${"═".repeat(70)}`);
console.log("阶段 2 攻击测试汇总");
console.log(`${"═".repeat(70)}`);
console.log(`攻击类型（横跨 2 字体）`.padEnd(24), "正确订单命中率", "平均置信度", "判定（各自）");
const byAttack = new Map<string, { hit: number; n: number; confSum: number; labels: string[] }>();
for (const r of rows) {
  const a = byAttack.get(r.attack) ?? { hit: 0, n: 0, confSum: 0, labels: [] };
  a.hit += r.hit ? 1 : 0;
  a.n += 1;
  a.confSum += r.conf;
  a.labels.push(r.levelLabel);
  byAttack.set(r.attack, a);
}
for (const [attack, a] of byAttack) {
  console.log(
    attack.padEnd(24),
    `${a.hit}/${a.n}`.padEnd(16),
    `${(a.confSum / a.n).toFixed(3)}`.padEnd(12),
    a.labels.join(" / "),
  );
}
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
})();