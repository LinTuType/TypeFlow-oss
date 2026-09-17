/**
 * 一致性对照测试 — 阶段 0 关键验证
 *
 * 验证目标（manifest 3.9 的确定性三测）：
 *   - 同 key + 同 order + 同 font → TS 与 Python 参考实现产出完全一致的
 *       20 bit 指纹、60 锚定、60 配对、100 扰动及位移
 *
 * 执行方式：
 *   1. 用真实的测试字体（datasets/ 或桌面版 tests/ 里的 TTF）
 *   2. 先调 python3 reference_webv1.py 生成基准 JSON（P 参考实现）
 *   3. 用 TS 引擎 runSelection 计算同输入结果
 *   4. 深比较全部字段，任何不一致即 fail
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runSelection } from "../src/webv1.js";
import { loadAnchorPool } from "../src/pool.js";
import { createNodeCryptoProvider } from "../src/crypto.node.js";
import { FONT_HYBUDAI, FONT_XINGYUN, resolveFont } from "./fontPath.js";

const NODE_CRYPTO = createNodeCryptoProvider();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

// 测试用字体：本机默认取父仓库的完整样本，CI 取仓库内子集样本（见 fontPath.ts）
const FIXTURES = [
  { name: FONT_XINGYUN, path: resolveFont(FONT_XINGYUN) },
  { name: FONT_HYBUDAI, path: resolveFont(FONT_HYBUDAI) },
];

// 测试向量：多租户 × 多订单 × 多后缀
const CASES = [
  { tenant: "tenant-zhong", order: "ORD-2026-0001", suffix: "" },
  { tenant: "tenant-zhong", order: "ORD-2026-0001", suffix: "_abc" },
  { tenant: "tenant-li", order: "ORD-2026-0002", suffix: "" },
  { tenant: "tenant-zhong", order: "ORD-2026-0003", suffix: "_b2" },
];

// 固定 32 字节主密钥（测试恒定，确保可复现）
const MASTER_KEY_HEX =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// 输出目录（用于失败时 dump 差异）
const OUT = join(ROOT, "engine/tests/out");
mkdirSync(OUT, { recursive: true });

/** 运行 Python 参考实现并解析 JSON */
function runReference(
  fontPath: string,
  tenant: string,
  order: string,
  suffix: string,
): Record<string, unknown> {
  const outFile = join(OUT, `ref_${order}${suffix || "_nosuf"}.json`);
  const res = spawnSync(
    "python3",
    [
      join(ROOT, "reference/reference_webv1.py"),
      fontPath,
      "--master-key",
      MASTER_KEY_HEX,
      "--tenant",
      tenant,
      "--order",
      order,
      "--suffix",
      suffix,
      "--json-out",
      outFile,
    ],
    { encoding: "utf8" },
  );
  if (res.status !== 0) {
    throw new Error(
      `Python 参考实现运行失败 (exit ${res.status})\n${res.stderr}`,
    );
  }
  return JSON.parse(readFileSync(outFile, "utf8"));
}

/** 深度比较两个值，返回差异路径列表 */
function diff(a: unknown, b: unknown, path = "root"): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  // 对数组/对象分别升序后比较（manifest 输出 anchors 等为数组，顺序本身即语义）
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return [`${path}: 长度 ${a.length} ≠ ${b.length}`];
    }
    for (let i = 0; i < a.length; i++) {
      const sub = diff(a[i], b[i], `${path}[${i}]`);
      if (sub.length) return sub;
    }
  }
  if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const sub = diff(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        `${path}.${k}`,
      );
      if (sub.length) return sub;
    }
  }
  return [`${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`];
}

/** 跑一个用例：基准 vs TS */
async function runCase(font: { name: string; path: string }, tc: {
  tenant: string;
  order: string;
  suffix: string;
}): Promise<string[]> {
  const ref = runReference(font.path, tc.tenant, tc.order, tc.suffix);
  const fontData = new Uint8Array(readFileSync(font.path));
  const masterKey = new Uint8Array(Buffer.from(MASTER_KEY_HEX, "hex"));

  const ts = await runSelection(fontData, masterKey, NODE_CRYPTO, tc.tenant, tc.order, tc.suffix, loadAnchorPool());

  // 比较全部字段（纯函数，无副作用）
  const diffs = diff(ref, ts);
  if (diffs.length) {
    // dump 便于排查
    writeFileSync(
      join(OUT, `ts_${tc.order}${tc.suffix || "_nosuf"}.json`),
      JSON.stringify(ts, null, 2),
    );
  }
  return diffs.map((d) => `[${font.name}/${tc.tenant}/${tc.order}${tc.suffix}] ${d}`);
}

// ─── 主流程 ───
let pass = 0;
let fail = 0;
const failures: string[] = [];

console.log("═ 阶段 0 一致性验证 ═");
console.log(`字体: ${FIXTURES.length} 个  用例: ${FIXTURES.length * CASES.length} 个\n`);

(async () => {
for (const font of FIXTURES) {
  for (const tc of CASES) {
    const label = `${font.name} :: ${tc.tenant}/${tc.order}${tc.suffix}`;
    try {
      const diffs = await runCase(font, tc);
      if (diffs.length === 0) {
        console.log(`  ✔ ${label}`);
        pass++;
      } else {
        console.log(`  ✘ ${label}`);
        failures.push(...diffs);
        fail++;
      }
    } catch (err) {
      console.log(`  ✘ ${label} (异常)`);
      failures.push(`${label} 异常: ${(err as Error).message}`);
      fail++;
    }
  }
}

console.log(`\n通过 ${pass} / ${pass + fail}`);
if (failures.length) {
  console.log("\n── 差异明细 ──");
  for (const f of failures.slice(0, 20)) console.log("  " + f);
  process.exit(1);
} else {
  console.log("\n✅ TS 引擎与 Python 参考实现完全一致，web-v1 选择逻辑事实冻结达成。");
}
})();