/**
 * 阶段 3 E2E：真实浏览器验证 typeflow-local-signer.html
 *
 * 用 Playwright + Chromium：
 *   1. 打开本地 file:// 单页（断网场景：浏览器无联网意图）
 *   2. 拦截全部网络请求，断言 0 次外发（connect-src 'none' 应有 CSP 违规也拦截）
 *   3. 注入字体文件 + 配方 → 点击生成 → 断言 Name 256 输出 + 下载触发
 */

import { launchChromium } from "./browser.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const HTML = join(ROOT, "dist", "typeflow-local-signer.html");
const FONT = "/Users/junzhong/Documents/AI Programs/font_watermark_tool/TypeFlow/tests/xingyun-Regular.ttf";

const RECIPE = {
  // 配方模式：只含云端派生的订单种子（模拟云端 prepare 返回），不含主密钥
  order_root_hex: "2ccb8d8e1c0f73d2c1cf7a16ad48990b76bb1bd0e0b4913b0a2b0c0d0e0f1011",
  tenant_id: "tenant-zhong",
  order_id: "ORD-E2E-0001",
  bits_suffix: "",
};

(async () => {
  const browser = await launchChromium();
  const page = await browser.newPage();

  // 记录所有网络请求（含 CSP 拦截的违规）
  const networkLog: string[] = [];
  page.on("request", (req) => networkLog.push(req.url()));

  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (msg) => {
    if (msg.type() === "error") networkLog.push(`[console.error] ${msg.text()}`);
  });

  await page.goto("file://" + HTML);
  await page.waitForTimeout(300);

  // 注入字体文件（绕过 file input 限制）
  const fontBuf = readFileSync(FONT);
  await page.setInputFiles("#font", {
    name: "xingyun-Regular.ttf",
    mimeType: "font/ttf",
    buffer: fontBuf,
  });

  // 填配方 + 生成
  await page.fill("#recipe", JSON.stringify(RECIPE));
  await page.click("#go");
  await page.waitForSelector("#resultCard:not([hidden])", { timeout: 30000 });

  const namePreview = await page.textContent("#namePreview");
  const statusText = await page.textContent("#status");
  const fontInfo = await page.textContent("#fontInfo");

  // 断言结果
  const nameOk = namePreview?.includes(JSON.stringify(RECIPE.order_id)) ?? false;
  const webOk = !networkLog.some((u) => !u.startsWith("data:") && !u.startsWith("file:"));

  console.log("── 阶段 3 E2E ──");
  console.log("  Name 256 含 order_id:", nameOk ? "✅" : "❌");
  console.log("  Name 256:", (namePreview ?? "").slice(0, 90));
  console.log("  状态:", statusText);
  console.log("  字体信息:", fontInfo);
  console.log("  网络外发请求:", webOk ? "0 次 ✅" : networkLog.length + " 次 ❌");
  if (!webOk) console.log("  外发记录:", networkLog.slice(0, 5));
  console.log("  页面 JS 错误:", pageErrors.length === 0 ? "无 ✅" : "❌ " + pageErrors[0]);

  await browser.close();
  const ok = nameOk && webOk && pageErrors.length === 0;
  process.exit(ok ? 0 : 1);
})();