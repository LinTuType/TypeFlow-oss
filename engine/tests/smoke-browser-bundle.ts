/**
 * 浏览器 bundle 冒烟验证 — 阶段 3
 *
 * 用 Node 加载 dist/typeflow-engine.browser.js（IIFE 只依赖 globalThis + WebCrypto），
 * 模拟浏览器环境跑通：主密钥 → embed → trace 全链路。
 * 若 bundle 意外引用 node:* 会在这里失败（node:fs 等在浏览器不存在）。
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { FONT_XINGYUN, resolveFont } from "./fontPath.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const BUNDLE = join(ROOT, "dist", "typeflow-engine.browser.js");

// 模拟浏览器：IIFE 里我们 expose 了 window.TypeFlow —— 这里用 globalThis
await import("file://" + BUNDLE);

const tf = (globalThis as unknown as { TypeFlow: Record<string, unknown> }).TypeFlow;
const t = tf as {
  embed: (p: { fontData: Uint8Array; masterKey: Uint8Array; tenantId: string; orderId: string }) => Promise<any>;
  trace: (p: { originalBytes: Uint8Array; suspiciousBytes: Uint8Array; masterKey: Uint8Array; tenantId: string; candidateOrders?: string[] }) => Promise<any>;
  version: string;
};

console.log("TypeFlow.version =", t.version);

const fontPath = resolveFont(FONT_XINGYUN);
const orig = new Uint8Array(readFileSync(fontPath));
const masterKey = new Uint8Array(Buffer.from("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", "hex"));

const wm = await t.embed({
  fontData: orig,
  masterKey,
  tenantId: "tenant-zhong",
  orderId: "ORD-BROWSER-1",
});

const tr = await t.trace({
  originalBytes: orig,
  suspiciousBytes: wm.bytes,
  masterKey,
  tenantId: "tenant-zhong",
  candidateOrders: ["ORD-BROWSER-1"],
});

const ok = tr.matchedOrder === "ORD-BROWSER-1" && tr.confidence > 0.85;
console.log(`嵌入+追溯 (browser bundle): matched=${tr.matchedOrder} conf=${tr.confidence.toFixed(3)} → ${ok ? "✅" : "❌"}`);
console.log(`产物大小: ${wm.bytes.length} bytes, 修改字形: ${wm.nModified}`);
process.exit(ok ? 0 : 1);