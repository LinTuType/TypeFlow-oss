/**
 * 密钥体系修正验证 — 配方模式一致性
 *
 * 证明两条路径产出完全一致：
 *   A. 云端/测试：runSelection(masterKey)         → 内部派生 order_root
 *   B. 浏览器/配方：runSelection(orderRootOverride) → 直接用云端下发的 order_root
 *
 * 若 A ≠ B，说明配方链路断裂（订单种子对不上，追溯必失败）。
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runSelection } from "../src/webv1.js";
import { loadAnchorPool } from "../src/pool.js";
import { createNodeCryptoProvider } from "../src/crypto.node.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const FONT = "/Users/junzhong/Documents/AI Programs/font_watermark_tool/TypeFlow/tests/xingyun-Regular.ttf";
const TENANT = "tenant-demo";
const ORDER = "ORD-DEMO-001";

(async () => {
  const provider = createNodeCryptoProvider();
  const fontData = new Uint8Array(readFileSync(FONT));
  const masterKey = new Uint8Array(Buffer.from(KEY_HEX, "hex"));
  const pool = loadAnchorPool();

  // 路径 A：云端持有主密钥，派生 order_root
  const rA = await runSelection(fontData, masterKey, provider, TENANT, ORDER, "", pool);
  const orderRoot = new Uint8Array(Buffer.from(rA.order_root_hex, "hex"));

  // 路径 B：浏览器只拿 order_root（配方模式，不传主密钥）
  const rB = await runSelection(fontData, new Uint8Array(0), provider, TENANT, ORDER, "", pool, orderRoot);

  const fields: Array<keyof typeof rA> = [
    "order_root_hex", "font_sha256", "canonical_context", "bits_hex",
    "eligibles_total", "anchors", "pairs", "noises", "noise_shifts",
  ];
  const diffs = fields.filter((f) => JSON.stringify(rA[f]) !== JSON.stringify(rB[f]));

  console.log("── 密钥体系修正验证 ──");
  console.log(`  order_root: ${rA.order_root_hex.slice(0, 16)}…`);
  console.log(`  路径A(主密钥) 锚定: ${rA.anchors.slice(0, 5).map((c) => `U+${c.toString(16)}`).join(" ")}`);
  console.log(`  路径B(仅orderRoot) 锚定: ${rB.anchors.slice(0, 5).map((c) => `U+${c.toString(16)}`).join(" ")}`);
  if (diffs.length === 0) {
    console.log("  ✅ 两条路径逐字段一致 — 配方模式成立，密钥不落浏览器");
    process.exit(0);
  } else {
    console.log(`  ❌ 差异字段: ${diffs.join(", ")}`);
    process.exit(1);
  }
})();