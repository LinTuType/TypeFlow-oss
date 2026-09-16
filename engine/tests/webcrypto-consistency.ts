/**
 * WebCrypto 一致性验证 — 阶段 3
 *
 * 证明浏览器（WebCrypto）引擎与 Node（node:crypto）引擎输出逐字节一致：
 *   相同 字体 + key + order → 相同 锚定/配对/扰动/指纹。
 * Node ≥20 内置全局 crypto.subtle（即 WebCrypto 标准实现），
 * 所以可直接在 Node 里用 createWebCryptoProvider() 模拟浏览器环境。
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runSelection, bytesToHex } from "../src/webv1.js";
import { loadAnchorPool } from "../src/pool.js";
import { createNodeCryptoProvider } from "../src/crypto.node.js";
import { createWebCryptoProvider } from "../src/crypto.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const KEY_HEX =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const TENANT = "tenant-zhong";
const FIXTURES = [
  "/Users/junzhong/Documents/AI Programs/font_watermark_tool/TypeFlow/tests/xingyun-Regular.ttf",
  "/Users/junzhong/Documents/AI Programs/font_watermark_tool/TypeFlow/tests/HYBuDaiXiongBasicW.ttf",
];

(async () => {
  // 先做自检：WebCrypto 可用
  try {
    createWebCryptoProvider();
  } catch (e) {
    console.error("❌ WebCrypto 不可用:", (e as Error).message);
    process.exit(1);
  }

  const node = createNodeCryptoProvider();
  const web = createWebCryptoProvider();

  let pass = 0;
  for (const fontPath of FIXTURES) {
    const data = new Uint8Array(readFileSync(fontPath));
    const key = new Uint8Array(Buffer.from(KEY_HEX, "hex"));
    const pool = loadAnchorPool();

    for (const order of ["ORD-WEB-0001", "ORD-WEB-0002", "ORD-WEB-0002_zz"]) {
      const r1 = await runSelection(data, key, node, TENANT, order, "", pool);
      const r2 = await runSelection(data, key, web, TENANT, order, "", pool);

      const field: Array<keyof typeof r1> = [
        "font_sha256", "canonical_context", "order_root_hex", "bits_hex",
        "eligibles_total", "anchors", "pairs", "noises", "noise_shifts",
      ];
      const diffs = field.filter((f) => JSON.stringify(r1[f]) !== JSON.stringify(r2[f]));
      if (diffs.length === 0) {
        console.log(`  ✔ ${fontPath.split("/").pop()} :: ${order} — Node ↔ WebCrypto 一致`);
        pass++;
      } else {
        console.log(`  ✘ ${fontPath.split("/").pop()} :: ${order} 差异字段: ${diffs.join(",")}`);
      }
    }
  }
  console.log(`\nWebCrypto 一致性: 通过 ${pass}/6`);
  process.exit(pass === 6 ? 0 : 1);
})();