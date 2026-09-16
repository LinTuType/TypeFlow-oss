/**
 * 阶段 5 E2E：管理门户真实浏览器验证
 *
 * 流程：打开 portal（:5173，代理到 :8787 worker）
 *   1. 注册新租户 → 进入仪表盘（骨架：页头 + 入口卡）
 *   2. 字体库：零上传信任区（收起 → 展开证据 → 源码自证）
 *   3. 字体库：空态 → 添加字体到本机（Toast 反馈 + 卡片 + 详情面板）
 *   4. 一键签发：本地嵌入 → 下载水印字体 → 云端哈希已同步
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "./browser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORTAL = "http://localhost:5173";
const FONT = "/Users/junzhong/Documents/AI Programs/font_watermark_tool/TypeFlow/tests/xingyun-Regular.ttf";

const email = `e2e_${Date.now().toString(36)}@test.dev`;

(async () => {
  const browser = await launchChromium();
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  let pass = 0, fail = 0;
  const check = (label: string, cond: boolean, detail = "") => {
    console.log(`  ${cond ? "✔" : "✘"} ${label}${detail ? "  " + detail : ""}`);
    cond ? pass++ : fail++;
  };

  // 1. 打开 → 注册（合规：必须勾选条款，未勾选时提交按钮禁用）
  await page.goto(PORTAL + "/login");
  await page.click("text=没有账号？注册");
  await page.fill('input[placeholder*="我的字库工作室"]', "E2E 测试工作室");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', "password123");
  check("未勾选条款时提交按钮禁用", await page.locator("button[type=submit]").isDisabled());
  await page.check('input[aria-label="同意用户协议与隐私政策"]');
  check("勾选条款后可提交", !(await page.locator("button[type=submit]").isDisabled()));
  await page.click("button[type=submit]");
  await page.waitForURL("**/", { timeout: 10000 }).catch(() => {});
  check("注册并自动登录进入仪表盘", !page.url().endsWith("/login"));

  // 2. 仪表盘骨架（原型 v9：lead 统计句 + 线性继续工作）
  await page.waitForSelector("text=资料库中有", { timeout: 8000 }).catch(() => {});
  const dash = (await page.textContent("body")) ?? "";
  check("仪表盘 lead 统计句渲染", dash.includes("款字体") && dash.includes("位客户") && dash.includes("笔订单"));
  check("仪表盘含待办尾巴", dash.includes("等待处理"));
  check("继续工作线性行 3 条", (await page.locator("a.continue-row").count()) === 3,
    `实际 ${await page.locator("a.continue-row").count()} 条`);
  check("侧栏显示登录身份", dash.includes("E2E 测试工作室"));

  // 3. 字体库：先验证空态
  await page.click(".sidebar-item:has-text('字体库')");
  await page.waitForSelector("text=还没有字体", { timeout: 10000 }).catch(() => {});
  check("字体库空态", ((await page.textContent("body")) ?? "").includes("还没有字体"));

  // 3a. 添加字体到本机（Toast + 标本卡）
  const fontBuf = readFileSync(FONT);
  await page.locator('input[type="file"]').setInputFiles({ name: "xingyun-Regular.ttf", mimeType: "font/ttf", buffer: fontBuf });
  await page.waitForSelector(".toast", { timeout: 10000 }).catch(() => {});
  const toastText = (await page.locator(".toast").first().textContent()) ?? "";
  check("添加字体后 Toast 提示仅存本机", toastText.includes("已存入本机"), toastText.slice(0, 40));

  await page.waitForSelector(".font-card", { timeout: 15000 }).catch(() => {});
  check("字体以标本卡呈现", (await page.locator(".font-card").count()) >= 1);
  check("卡片带真渲染字形", (await page.locator(".font-card .glyph").count()) >= 1);
  const body1 = (await page.textContent("body")) ?? "";
  check("卡片标记 仅本机", body1.includes("仅本机"));
  check("卡片有签发按钮（悬停操作区）", (await page.locator(".font-card .mini button:has-text('签发')").count()) >= 1);

  // 4. 卡片「签发」→ 签发页预选字体 → 生成签发文件 → 下载水印字体
  await page.hover(".font-card");
  await page.click(".font-card .mini button:has-text('签发')");
  await page.waitForURL("**/issue", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(600);
  const pickVal = (await page.locator(".pick").nth(1).textContent()) ?? "";
  check("签发页已预选字体", !pickVal.includes("选择字体"), pickVal.slice(0, 30));

  await page.click("button:has-text('生成签发文件')");
  await page.waitForSelector("button:has-text('下载水印字体')", { timeout: 40000 }).catch(() => {});
  const body2 = (await page.textContent("body")) ?? "";
  check("一键签发完成（本地嵌入成功）", body2.includes("签发完成"));
  check("结果卡显示字形修改数与水印哈希", body2.includes("个字形") && body2.includes("水印版 SHA-256"));

  const dlBtn = page.locator("button:has-text('下载水印字体')").first();
  if (await dlBtn.count()) {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 20000 }).catch(() => null),
      dlBtn.click(),
    ]);
    check("水印字体可下载", !!download && download.suggestedFilename().includes("_watermarked.ttf"),
      download ? download.suggestedFilename() : "未触发下载");
  } else {
    check("水印字体可下载", false, "未找到下载按钮");
  }

  // 4b. 签发后云端哈希应已同步（卡片技术行出现「已同步」）
  await page.goto(PORTAL + "/fonts");
  await page.waitForSelector(".font-card:has-text('已同步')", { timeout: 15000 }).catch(() => {});
  check("签发后云端哈希已同步", ((await page.textContent("body")) ?? "").includes("已同步"));

  // 4c. 安全与信任：数据流向图 + 源码自证 + 本页自证（原型结构）
  await page.click(".navlink:has-text('安全与信任')");
  await page.waitForTimeout(1200);
  const secBody = (await page.textContent("body")) ?? "";
  check("安全页数据流向图已渲染", (await page.locator("svg[aria-label*='数据流向']").count()) > 0);
  check("安全页含出网/不出网清单", secBody.includes("出网数据项") && secBody.includes("本地专属数据"));
  const scanOk = await page.locator("text=✓ 无网络调用").count();
  check("源码自证扫描通过（3 个文件无网络调用）", scanOk === 3, `实际 ${scanOk} 个`);
  check("提供离线签发工具下载入口", (await page.locator("a[href='/typeflow-local-signer.html']").count()) > 0);
  check("本页自证已实时计算 SHA-256", /^[0-9a-f]{64}$/.test(((await page.locator(".hash-line").first().textContent()) ?? "").trim()));

  // 4d. 合规（批次 4）：条款页公开可读 + 设置页的账号与合规抽屉
  await page.goto(PORTAL + "/terms");
  const termsBody = (await page.textContent("body")) ?? "";
  check("用户协议页公开可读", termsBody.includes("用户协议") && termsBody.includes("无法验证你最终产出的字体文件内容"));
  await page.goto(PORTAL + "/privacy");
  const privBody = (await page.textContent("body")) ?? "";
  check("隐私政策页公开可读", privBody.includes("隐私政策") && privBody.includes("一个字节都不上传"));

  await page.goto(PORTAL + "/settings");
  await page.click("button.setting:has-text('账号与合规')");
  await page.waitForTimeout(400);
  const acctBody = (await page.textContent("body")) ?? "";
  check("设置页提供云端数据导出", acctBody.includes("导出云端数据"));
  // 注销是危险操作：先点出密码确认框，再断言（不能只有一个裸按钮）
  await page.click("button:has-text('注销账号…')");
  await page.waitForTimeout(200);
  const delBody = (await page.textContent("body")) ?? "";
  check("设置页提供账号注销（密码确认 + 不可撤销提示）",
    delBody.includes("不可撤销") && delBody.includes("永久删除我的账号"));

  // 5. 无 JS 错误
  check("无页面 JS 错误", errors.length === 0, errors[0] ?? "");

  console.log(`\n通过 ${pass} / ${pass + fail}`);
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})();
