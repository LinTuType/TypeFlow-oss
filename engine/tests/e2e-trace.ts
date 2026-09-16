/**
 * 追溯专项 E2E v2：真实浏览器走「完整追溯」（方案 B）
 *
 * 流程：
 *   1. 注册新租户
 *   2. 字体库：添加原版字体 → 一键签发 → 下载水印字体（可疑字体）
 *   3. 追溯页：上传【原版】+【刚下载的水印字体（可疑）】
 *   4. 点「开始追溯」→ 断言命中刚签发的订单 + 置信度 > 0.85
 *
 * 浏览器下载的水印 TTF 自带 Name256（order_id 自证），且字形级特征
 * 与原版一致——完整追溯应在云端候选 + 本地比对后命中同一订单。
 */

import { launchChromium } from "./browser.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORTAL = "http://127.0.0.1:5173";
const FONT = "/Users/junzhong/Documents/AI Programs/font_watermark_tool/TypeFlow/tests/xingyun-Regular.ttf";
const fontBuf = readFileSync(FONT);

const email = `trace2_${Date.now().toString(36)}@test.dev`;
const pass: string[] = [];
const fail: string[] = [];
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "✔" : "✘"} ${label}${detail ? "  " + detail : ""}`);
  (cond ? pass : fail).push(label);
};

(async () => {
  const browser = await launchChromium();
  const page = await browser.newPage({ acceptDownloads: true });

  // 1. 注册
  await page.goto(PORTAL + "/login");
  await page.click("text=没有账号？注册");
  await page.fill('input[placeholder*="我的字库工作室"]', "追溯E2E工作室");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', "password123");
  await page.click("button[type=submit]");
  await page.waitForURL("**/", { timeout: 10000 }).catch(() => {});
  check("注册并登录", !page.url().endsWith("/login"));

  // 2. 字体库：添加原版 → 签发 → 下载水印
  await page.click("a.nav:has-text('字体库')");
  await page.waitForTimeout(600);
  await page.locator('input[type="file"]').setInputFiles({ name: "xingyun-Regular.ttf", mimeType: "font/ttf", buffer: fontBuf });
  await page.waitForSelector(".card", { timeout: 10000 }).catch(() => {});
  await page.click("button:has-text('签发并下载')");
  await page.waitForSelector("button:has-text('下载水印字体')", { timeout: 40000 }).catch(() => {});
  check("签发完成（本地嵌入）", ((await page.textContent("body")) ?? "").includes("签发完成"));

  // 下载水印字体（可疑字体）
  const dlBtn = page.locator("button:has-text('下载水印字体')").first();
  let wmPath: string | null = null;
  if (await dlBtn.count()) {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 20000 }).catch(() => null),
      dlBtn.click(),
    ]);
    if (download) {
      wmPath = await download.path();
      check("水印字体已下载", !!wmPath && !!download.suggestedFilename().includes("_watermarked.ttf"), download.suggestedFilename());
    } else {
      check("水印字体已下载", false, "未触发下载");
    }
  } else {
    check("水印字体已下载", false, "未找到下载按钮");
  }

  // 3. 追溯页：上传原版 + 可疑（水印）→ 开始追溯
  await page.click("a.nav:has-text('追溯')");
  await page.waitForTimeout(800);
  const inputs = page.locator('input[type="file"]');
  await inputs.nth(0).setInputFiles({ name: "xingyun-Regular.ttf", mimeType: "font/ttf", buffer: fontBuf });
  if (wmPath) {
    const wmBuf = readFileSync(wmPath);
    await inputs.nth(1).setInputFiles({ name: "xingyun-Regular_watermarked.ttf", mimeType: "font/ttf", buffer: wmBuf });
  }
  await page.waitForTimeout(1500); // 等待两侧 SHA-256 算出
  await page.click("button:has-text('开始追溯')");

  // 4. 等待追溯结果（引擎比对 + 网络，可能数秒）
  await page.waitForSelector("text=追溯结果", { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const body = (await page.textContent("body")) ?? "";

  const gotResult = body.includes("确认命中") || body.includes("未达命中置信度");
  check("追溯结果已渲染", gotResult, gotResult ? "" : body.slice(0, 120));
  check("命中确认（置信度≥0.85）", body.includes("确认命中"), body.includes("最高候选") ? "未达阈值" : "");
  // 订单号出现在结果区
  const orderInTrace = (body.match(/ORD-[A-Z0-9-]+/g) ?? []).length >= 1;
  check("结果含订单号", orderInTrace, (body.match(/ORD-[A-Z0-9-]+/g) ?? []).slice(0, 2).join(" "));

  console.log(`\n追溯 E2E v2：通过 ${pass.length} / ${pass.length + fail.length}`);
  await browser.close();
  process.exit(fail.length ? 1 : 0);
})();