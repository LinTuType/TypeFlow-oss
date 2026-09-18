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
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { launchChromium } from "./browser.js";
import { FONT_XINGYUN, FIXTURES_DIR, resolveFont } from "./fontPath.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORTAL = "http://localhost:5173";
/** worker（dev-server）直连地址：邮箱验证要在跑 UI 之外拿一封捕获到的邮件 */
const WORKER = "http://127.0.0.1:8787";
const FONT = resolveFont(FONT_XINGYUN);
/**
 * OTF（CFF 轮廓）样本 —— 用**仓库内子集**而不是 `resolveFont`：
 * 这一段在 e2e 末尾跑，要的是快与确定性（本机的全量样本是 12.7MB / 23058 字形）。
 */
const OTF_SAMPLE = join(FIXTURES_DIR, "tsuku-subset.otf");
/** 该样本在界面里的字体名 = 文件名去扩展名（`importFontFile` 的口径） */
const OTF_FONT_NAME = "tsuku-subset";

const email = `e2e_${Date.now().toString(36)}@test.dev`;

/** 本用例设置的授权方：授权书的抬头 / 落款 / 印章都要读它（见 lib/foundry.ts）。
    2 字简称 → 印章按「简称 / 印」两行渲染 */
const LICENSOR_NAME = "E2E 测试字库";
const LICENSOR_SHORT = "测试";
const LICENSOR_SITE = "https://e2e-licensor.test";

/** 被授权方的交付邮箱：签发后「邮件发给客户」的收件人就是它（只存本机客户库 / 订单关联） */
const CLIENT_NAME = "青岚设计有限公司";
const CLIENT_EMAIL = "design@qinglan.test";

/** 读取 ZIP（中央目录 → 局部头 → 数据）。交付包用 store，deflate 也一并支持，便于复用 */
function readZip(buf: Buffer): Map<string, Buffer> {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("不是合法 ZIP：找不到中央目录结束记录");
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("中央目录条目签名错误");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    // 局部头的文件名与扩展字段长度可能不同，必须按局部头重新定位数据起点
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    out.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");


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
  // 首次登录算首次（用户 2026-09-18 口径）：引导没放过时先落「开始使用」而不是概览
  await page.waitForURL("**/welcome", { timeout: 15000 }).catch(() => {});
  check("首次登录进入「开始使用」引导", page.url().endsWith("/welcome"), page.url());

  // 1a. 「开始使用」引导：五步清单，当前步就地展开（复用设置页那套规线条目语言）
  // ⚠️ 等 `.step-mark`（引导页独有）而不是 `.settings .setting-item` —— 后者会被上一页在
  //    转场期间的残留 DOM 命中（PageStage 退出阶段旧内容仍挂载），于是采样打到载入态。
  await page.waitForSelector(".step-mark", { timeout: 15000 }).catch(() => {});
  check("引导列出五步（各带序号标记与右箭头）",
    (await page.locator(".settings .setting-item").count()) === 5
    && (await page.locator(".step-mark").count()) === 5
    && (await page.locator(".settings .setting-chev").count()) === 5);
  const firstStepTitle = (await page.locator(".settings .setting-item.open .setting b").first().textContent()) ?? "";
  check("默认展开第一个未完成的步骤（验证邮箱）", firstStepTitle.includes("验证邮箱"), firstStepTitle);
  check("第一步时「上一步」不可点",
    await page.locator(".welcome-foot button:has-text('上一步')").isDisabled());
  check("进度按真实数据算（新账号 0 / 5）",
    ((await page.locator(".welcome-progress").textContent()) ?? "").includes("0 / 5"));
  // 跳过 = 写住标记 + 回概览（下次登录不再自动进引导；标记只存本机）
  await page.click(".welcome-foot .kv-link:has-text('跳过引导')");
  await page.waitForURL("**/", { timeout: 10000 }).catch(() => {});
  const startFlag = await page.evaluate(() => localStorage.getItem("typeflow_start_dismissed"));
  check("跳过引导后回概览并写住标记",
    startFlag === "1" && !page.url().includes("/welcome"), String(startFlag));

  // 1b. 邮箱验证（P1-8 起未验证会被挡在签发之外）。
  //     本地 worker 的 dev-server 捕获邮件并开了一条 /api/__dev/mails 通道，
  //     所以这里走的是真实链路：注册 → 收信 → 用令牌验证。
  const mails = (await (await fetch(WORKER + "/api/__dev/mails")).json()) as
    Array<{ to: string; html: string }>;
  const verifyMail = mails.filter((m) => m.to === email).pop();
  const verifyToken = (verifyMail?.html.match(/token=([A-Za-z0-9_-]+)/) ?? [])[1] ?? "";
  check("注册即发出验证邮件（dev 邮件捕获）", verifyToken.length > 20);
  const verifyRes = await fetch(WORKER + "/api/auth/verify-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: verifyToken }),
  });
  check("邮箱验证通过（签发闸门的前提）", verifyRes.status === 200, `HTTP ${verifyRes.status}`);

  // 2. 仪表盘骨架（原型 v9：lead 统计句 + 线性继续工作）
  await page.waitForSelector("text=资料库中有", { timeout: 8000 }).catch(() => {});
  const dash = (await page.textContent("body")) ?? "";
  check("仪表盘 lead 统计句渲染", dash.includes("款字体") && dash.includes("位客户") && dash.includes("笔订单"));
  check("仪表盘含待办尾巴", dash.includes("等待处理"));
  // 概览首屏有载入态（正文 !loading 才渲染）——先等线性行出来再计数。
  // 原先在同一个表达式的 cond 与 detail 里各 count 一次，两次取到的是不同时刻的 DOM：
  // 报出过「实际 3 条」却判失败（cond 时还是 0，detail 时已经 3），是断言写法自身的竞态。
  await page.waitForSelector("a.continue-row", { timeout: 10000 }).catch(() => {});
  const continueRows = await page.locator("a.continue-row").count();
  check("继续工作线性行 3 条", continueRows === 3, `实际 ${continueRows} 条`);
  check("侧栏显示登录身份", dash.includes("E2E 测试工作室"));
  const navDeco = await page.locator(".navlink").first().evaluate((el) => getComputedStyle(el).textDecorationLine);
  check("侧栏底部入口（安全与信任 / 设置）无下划线", navDeco === "none", navDeco);

  // 2a. 厂牌（授权方）：授权书的抬头 / 落款 / 印章都读它 —— 先设好，后面逐处验文书。
  //     这一步同时守住"厂牌只存本机"：写完能在 localStorage 里读到，且不上云。
  await page.goto(PORTAL + "/settings");
  await page.waitForSelector("button.setting", { timeout: 10000 }).catch(() => {});
  await page.click("button.setting:has-text('厂牌信息')");
  await page.waitForTimeout(400);
  await page.fill('input[aria-label="授权方名称"]', LICENSOR_NAME);
  await page.fill('input[aria-label="授权方简称"]', LICENSOR_SHORT);
  await page.fill('input[aria-label="官网地址"]', LICENSOR_SITE);
  await page.locator(".setting-item.open button:has-text('保存')").click();
  await page.waitForTimeout(400);
  const foundryLs = await page.evaluate(() => localStorage.getItem("typeflow_foundry_name"));
  check("厂牌信息只存本机（localStorage，不上云）", foundryLs === LICENSOR_NAME, String(foundryLs));

  // 3. 字体库：先验证空态（顺带验证页面转场的两个阶段）
  await page.click(".sidebar-item:has-text('字体库')");
  await page.waitForTimeout(70);
  const outPhase = await page.evaluate(`(() => {
    const h = document.querySelector(".pg-stage");
    if (!h) return "无 .pg-stage";
    const u = Array.from(h.querySelectorAll("*")).filter((el) => el.style && el.style.animation)[0];
    return u ? u.style.animation : "无动画";
  })()`);
  check("切页先播退出阶段（旧内容仍挂载，pg-out）", String(outPhase).includes("pg-out"), String(outPhase));
  await page.waitForTimeout(200);
  const inPhase = await page.evaluate(`(() => {
    const h = document.querySelector(".pg-stage");
    if (!h) return "无 .pg-stage";
    const u = Array.from(h.querySelectorAll("*")).filter((el) => el.style && el.style.animation)[0];
    return u ? u.style.animation : "无动画";
  })()`);
  check("换场后新内容依次进入（pg-in）", String(inPhase).includes("pg-in"), String(inPhase));
  await page.waitForSelector("text=还没有字体", { timeout: 10000 }).catch(() => {});
  check("字体库空态", ((await page.textContent("body")) ?? "").includes("还没有字体"));

  // 3a. 添加字体到本机（Toast + 标本卡）
  const fontBuf = readFileSync(FONT);
  await page.locator('input[type="file"]').setInputFiles({ name: "xingyun-Regular.ttf", mimeType: "font/ttf", buffer: fontBuf });
  // 精确等"已存入本机"那条出现（前面厂牌 toast 可能还挂着，等 .toast 会立即放行）
  await page.waitForSelector(".toast:has-text('已存入本机')", { timeout: 15000 }).catch(() => {});
  // 两个曾经真实存在的缺陷：原型层 .toast{opacity:0} 依赖 .show 类（门户从不挂），
  // 而 .toast 自身 position:fixed 会脱离 .toast-host 的 flex 流导致多条逐像素重叠。
  // 这两条都只能量计算样式才抓得到 —— textContent / waitForSelector 的可见性判定都不看 opacity。
  await page.waitForTimeout(280);
  const toastStyle = await page.locator(".toast").first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { opacity: cs.opacity, position: cs.position };
  });
  check("Toast 真的可见（opacity 未被原型层压成 0）", toastStyle.opacity === "1", `opacity=${toastStyle.opacity}`);
  check("Toast 由 host 定位（自身不 fixed，否则多条会完全重叠）", toastStyle.position === "static", `position=${toastStyle.position}`);
  const toastText = (await page.locator(".toast").allTextContents()).join(" | ");
  check("添加字体后 Toast 提示仅存本机", toastText.includes("已存入本机"), toastText.slice(0, 60));
  // §2.5 F-2 的后续（2026-09-18）：OTF/CFF 已经**支持**了，所以这条断言从"被拒绝"改成两件
  // 与 UI 直接相关、且不往库里留状态的事：
  //   ① 选择器的 accept 必须放行 .otf（否则用户根本选不中，功能等于没上）
  //   ② 内容不是字体的文件仍要被**明确拒绝**（人话文案），而不是悄悄进库、等到签发才炸
  const fontAccept = (await page.locator('input[type="file"]').first().getAttribute("accept")) ?? "";
  check("字体选择器放行 .otf（不再只收 .ttf）", fontAccept.includes(".otf"), fontAccept);

  await page.locator('input[type="file"]').setInputFiles({
    name: "not-a-font.otf", mimeType: "font/otf", buffer: Buffer.from([0x4f, 0x54, 0x54, 0x4f]),
  });
  await page.waitForTimeout(800);
  const badFontToast = (await page.locator(".toast").allTextContents()).join(" | ");
  check("内容不是字体时明确拒绝（人话文案，不静默进库）",
    badFontToast.includes("解析失败") || badFontToast.includes("文件过短"),
    badFontToast.slice(0, 70));

  await page.waitForSelector(".font-card", { timeout: 15000 }).catch(() => {});
  check("字体以标本卡呈现", (await page.locator(".font-card").count()) >= 1);
  // ⚠️ `.glyph` 是外层容器，永远存在 —— 原来这条断言等于没断言（所以漏掉了真机上的
  //    「标本区显示无文件」缺陷）。真渲染的标志是 `.glyph-main`（拿到 FontFace 才渲染）
  //    并且没有 `.glyph-failed` 占位。
  await page.waitForSelector(".font-card .glyph-main", { timeout: 15000 }).catch(() => {});
  check("卡片带真渲染字形（不是「无文件」占位）",
    (await page.locator(".font-card .glyph-main").count()) >= 1
    && (await page.locator(".font-card .glyph-failed").count()) === 0);
  const body1 = (await page.textContent("body")) ?? "";
  check("卡片标记 本机·版本已锁定（5.6 语义）", body1.includes("版本已锁定"));
  check("卡片有签发按钮（悬停操作区，图标化走 title 语义）",
    (await page.locator(".font-card .mini button[title='签发']").count()) >= 1);

  // 4. 卡片「签发」→ 签发页预选字体 → 生成签发文件 → 下载水印字体
  await page.hover(".font-card");
  await page.click(".font-card .mini button[title='签发']");
  await page.waitForURL("**/issue", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(600);
  const pickVal = (await page.locator(".pick").nth(1).textContent()) ?? "";
  check("签发页已预选字体", !pickVal.includes("选择字体"), pickVal.slice(0, 30));
  // §2.5 F-8：点了只弹"待后端支持"的假按钮已摘（不展示做不到的功能）
  check("「保存草稿」假按钮已摘", (await page.locator("button:has-text('保存草稿')").count()) === 0);
  // 文书抬头 = 用户自己的厂牌（原先写死「TYPEFLOW · 文镇」——等于用平台名义替用户授权）
  const paperWho = ((await page.locator(".paper-licensor").first().textContent()) ?? "").trim();
  check("右栏文书抬头读本机厂牌（不是平台名）", paperWho === LICENSOR_NAME, paperWho);
  check("右栏文书渲染印章（取厂牌简称）",
    ((await page.locator(".paper .seal").first().textContent()) ?? "").replace(/\s/g, "").includes(LICENSOR_SHORT));
  // 长表单往下填时文书不跟着滚走（注释里写了 sticky、CSS 里曾没有）
  const stickyPos = await page.locator(".paper-stick").evaluate((el) => getComputedStyle(el).position);
  check("右栏文书滚动吸附（sticky）", stickyPos === "sticky", stickyPos);

  // 4a. 三个选择项 = 点条目就地向下展开（含右箭头），展开体内可直接新建客户 / 导入字体
  check("签发页四个选择项均为就地展开行（客户/字体/方案/期限）",
    (await page.locator(".pick[aria-expanded]").count()) === 4
    && (await page.locator(".pick-chev").count()) === 4);
  const closedH = await page.locator(".issue-field").first().locator(".acc-inner").evaluate((el) => el.clientHeight);
  check("选择项默认收起（展开体高度 0）", closedH === 0, `实际 ${closedH}px`);
  await page.locator(".pick").first().click();
  await page.waitForTimeout(400);
  const custH = await page.locator(".issue-field").first().locator(".acc-inner").evaluate((el) => el.clientHeight);
  check("点客户条目后就地展开", custH > 60, `实际 ${custH}px`);
  check("展开体内提供「新建客户」入口",
    (await page.locator(".acc-panel.open .picker-add:has-text('新建客户')").count()) === 1);
  // 5.5 资料库卡片的前置：订单要带上客户 → 就地新建客户并选中
  await page.locator(".acc-panel.open .picker-add:has-text('新建客户')").click();
  await page.fill('input[aria-label="新客户名称"]', CLIENT_NAME);
  // 交付邮箱一起填上：签发后的「邮件发给客户」靠它预填收件人（见 4a-4 的断言）
  await page.fill('input[aria-label="新客户联系方式"]', CLIENT_EMAIL);
  await page.locator(".acc-panel.open button:has-text('创建客户')").click();
  await page.waitForTimeout(600);
  check("展开体内新建客户成功并选中",
    ((await page.locator(".pick").first().textContent()) ?? "").includes(CLIENT_NAME));
  await page.locator(".pick").nth(1).click();          // 切换：客户收起、字体展开
  await page.waitForTimeout(400);
  check("展开体内提供「导入字体」入口",
    (await page.locator(".acc-panel.open .picker-add:has-text('导入字体')").count()) === 1);
  await page.locator(".pick").nth(1).click();
  await page.waitForTimeout(300);

  // 4a-3. 授权期限（2026-09-17 改版）：**选「时长」，不是选日期**
  //   起算点固定 = 签发当天，用户只回答「授权多久」；到期日本机算（lib/license.ts · termForMonths）。
  //   交互：预设档点选即收起（与「授权范围」一致）；「自定义时长」留在展开态，填完按「确定」才生效。
  const termFact = () => (page.locator(".paper .fact").filter({ hasText: "授权期限" }).first().textContent()) ?? "";
  const termPick = () => page.locator(".pick").nth(3);
  const termPickText = async () => ((await termPick().textContent()) ?? "").trim();
  const openTerm = async () => { await termPick().click(); await page.waitForTimeout(300); };
  const day1 = new Date(); day1.setHours(0, 0, 0, 0);
  const plusM = (n: number) => {
    const x = new Date(day1); x.setDate(1); x.setMonth(x.getMonth() + n); x.setDate(day1.getDate());
    return x.toLocaleDateString("sv-SE");
  };
  check("文书授权期限默认永久", (await termFact()).includes("永久"));
  await openTerm();
  check("期限档位是时长，且不再有日期输入",
    (await page.locator(".acc-panel.open .license-row:has-text('1 年 6 个月')").count()) === 1
    && (await page.locator(".acc-panel.open input[type=date]").count()) === 0);

  // 预设档：点选即收起
  await page.locator(".acc-panel.open .license-row:has-text('1 年 6 个月')").click();
  await page.waitForTimeout(400);
  check("期限选预设档后自动收起（与授权范围一致）", (await page.locator(".acc-panel.open").count()) === 0);
  const termRow = await termFact();
  check("选 1 年 6 个月 → 文书授权期限行写成起止日期",
    termRow.includes(plusM(0)) && termRow.includes(plusM(18)), termRow.slice(0, 44));
  check("选择行显示的是时长", (await termPickText()).includes("1 年 6 个月"));

  // 自定义档：不收起，且「确定」之前不生效（先填 3 年，与上一档 1 年 6 个月可区分）
  await openTerm();
  await page.locator(".acc-panel.open .license-row:has-text('自定义时长')").click();
  await page.waitForTimeout(400);
  check("期限选自定义档后保持展开（要接着填年 / 月）",
    (await page.locator(".acc-panel.open .term-custom").count()) === 1);
  check("未填完时「确定」不可点",
    await page.locator(".acc-panel.open .picker-form-actions button:has-text('确定')").isDisabled());
  await page.fill('input[aria-label="授权年数"]', "3");
  await page.fill('input[aria-label="授权月数"]', "");
  await page.waitForTimeout(200);
  check("「确定」之前不生效（选择行与文书都还是上一档）",
    (await termPickText()).includes("1 年 6 个月") && (await termFact()).includes(plusM(18)));
  await page.locator(".acc-panel.open .picker-form-actions button:has-text('确定')").click();
  await page.waitForTimeout(400);
  check("确定后收起且值生效（自定义时长同样算出起止日期）",
    (await page.locator(".acc-panel.open").count()) === 0
    && (await termPickText()).includes("3 年")
    && (await termFact()).includes(plusM(36)), (await termFact()).slice(0, 44));

  // 「取消」= 放弃这次编辑，已生效的档位不受影响
  await openTerm();
  await page.locator(".acc-panel.open .license-row:has-text('自定义时长')").click();
  await page.waitForTimeout(300);
  await page.fill('input[aria-label="授权年数"]', "9");
  await page.locator(".acc-panel.open .picker-form-actions button:has-text('取消')").click();
  await page.waitForTimeout(400);
  check("「取消」放弃编辑，期限回到原来那一档（仍是 3 年）",
    (await page.locator(".acc-panel.open").count()) === 0
    && (await termPickText()).includes("3 年")
    && (await termFact()).includes(plusM(36)));

  // 复位成永久，后面的签发与交付包断言不受期限影响
  await openTerm();
  await page.locator(".acc-panel.open .license-row:has-text('永久')").click();
  await page.waitForTimeout(400);
  check("改回永久后文书期限行回到永久", (await termFact()).includes("永久"));

  await page.fill('input[aria-label="授权价格"]', "1,299");
  await page.click("button:has-text('生成签发文件')");
  // 过程槽是排队放出的（逐行逐字），结果控件要等队列放完才 on —— 不能只看按钮在不在 DOM 里
  await page.waitForSelector(".paper .proc-res.on", { timeout: 45000 }).catch(() => {});
  const body2 = (await page.textContent("body")) ?? "";
  check("一键签发完成（本地嵌入成功）", body2.includes("签发完成"));
  check("结果卡显示字形修改数与水印哈希", body2.includes("个字形") && body2.includes("水印版 SHA-256"));

  // 4a-2. 过程槽（2026-09-17）：进度与下载入口都在授权书右上角，不再另开一块
  check("下载入口在授权书右上角的过程槽里（左栏不再有按钮行）",
    (await page.locator(".paper .proc-res.on .proc-a").count()) === 2
    && (await page.locator(".issue-done-actions").count()) === 0);
  check("过程槽完成后保留完整五步记录",
    (await page.locator(".paper .proc-row").count()) === 5);
  check("过程槽底边与文书编号行底边对齐",
    await page.locator(".paper").evaluate((paper) => {
      const slot = paper.querySelector(".proc-slot");
      const sub = paper.querySelector(".paper-sub");
      if (!slot || !sub) return false;
      return Math.abs(slot.getBoundingClientRect().bottom - sub.getBoundingClientRect().bottom) <= 1;
    }));

  // 命名口径（2026-09-18 用户口径）：交付的水印字体叫「原版字体名_订单号.ttf」——
  // 字体名在前，客户在自己的字体文件夹里认得出是哪款字、哪一单。
  const orderId = ((await page.locator(".issue-done-id").first().textContent()) ?? "").trim();
  const dlBtn = page.locator("button:has-text('下载水印字体')").first();
  if (await dlBtn.count()) {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 20000 }).catch(() => null),
      dlBtn.click(),
    ]);
    check("水印字体可下载，且命名为「字体名_订单号.ttf」",
      !!download && download.suggestedFilename() === `xingyun-Regular_${orderId}.ttf`,
      download ? download.suggestedFilename() : "未触发下载");
  } else {
    check("水印字体可下载，且命名为「字体名_订单号.ttf」", false, "未找到下载按钮");
  }

  // 4a-4. 交付邮件入口（2026-09-18）：预填收件人与内容，交给**本机邮件客户端**。
  //   ⚠️ 只读 href、不点击 —— 点它会真的去开邮件客户端，而且会先触发一次交付包下载（页面会离开）。
  //   收件人来自客户库（上面新建客户时填的那份交付邮箱）。
  const mailA = page.locator(".paper .proc-res.on .proc-a-row a");
  check("过程槽第一行是「下载交付包 ∥ 邮件发给客户」两个一级动作",
    (await mailA.count()) === 1
    && ((await mailA.textContent()) ?? "").includes("邮件发给客户"));
  const mailHref = (await mailA.getAttribute("href")) ?? "";
  const mailDecoded = decodeURIComponent(mailHref);
  check("邮件入口是 mailto 链接（交给本机邮件客户端，不经服务器）",
    mailHref.startsWith("mailto:"), mailHref.slice(0, 40));
  check("邮件收件人取客户库里的交付邮箱",
    mailHref.startsWith(`mailto:${CLIENT_EMAIL}`), mailHref.slice(0, 60));
  check("邮件主题与正文预填订单号 / 字体 / 期限，并点名该附哪个交付包",
    mailDecoded.includes(orderId) && mailDecoded.includes("xingyun-Regular")
    && mailDecoded.includes("授权期限：永久") && mailDecoded.includes(`${orderId}_交付包.zip`),
    mailDecoded.replace(/\s+/g, " ").slice(0, 80));

  // 4b. 交付包（批次 4）：水印字体 + 授权书 + 使用说明 + 指纹，一次下载齐全
  const zipBtn = page.locator("button:has-text('下载交付包')").first();
  let zipFiles: Map<string, Buffer> | null = null;
  let firstTtf: Buffer | null = null;   // 首次签发的交付包内水印字体（重算要逐字节比对）
  if (await zipBtn.count()) {
    const [zipDl] = await Promise.all([
      page.waitForEvent("download", { timeout: 20000 }).catch(() => null),
      zipBtn.click(),
    ]);
    const zipPath = zipDl ? await zipDl.path() : null;
    if (zipPath) zipFiles = readZip(readFileSync(zipPath));
    check("交付包可下载", !!zipDl && zipDl.suggestedFilename().includes("交付包"),
      zipDl ? zipDl.suggestedFilename() : "未触发下载");
  } else {
    check("交付包可下载", false, "未找到交付包按钮");
  }
  check("交付包含四个文件（字体 / 授权书 / 使用说明 / 指纹）",
    !!zipFiles && zipFiles.size === 4, zipFiles ? [...zipFiles.keys()].join(" · ") : "解包失败");
  if (zipFiles) {
    const ttf = zipFiles.get(`xingyun-Regular_${orderId}.ttf`);
    firstTtf = ttf ?? null;
    const usg = zipFiles.get("使用说明.txt")?.toString("utf8") ?? "";
    const lic = zipFiles.get("字体授权书.html")?.toString("utf8") ?? "";
    const fp = zipFiles.get("签发指纹.txt")?.toString("utf8") ?? "";
    const shownSha = (((await page.locator(".issue-done-sha span").nth(3).textContent()) ?? "").trim()).replace("…", "");
    check("交付包内水印字体与页面回执哈希一致", !!ttf && sha256(ttf).startsWith(shownSha),
      ttf ? sha256(ttf).slice(0, 24) : "包内没有水印字体");
    check("使用说明含订单号、核验命令对上包内文件名与存 PDF 指引",
      usg.includes(orderId) && usg.includes("另存为 PDF") && usg.includes(`xingyun-Regular_${orderId}.ttf`));
    check("授权书 HTML 含订单号与标题", lic.includes(orderId) && lic.includes("字体授权书"));
    check("授权书抬头是用户自己的厂牌（不是平台名）",
      lic.includes(`class="licensor">${LICENSOR_NAME}`) && !lic.includes("文镇 TypeFlow · 本地签发"));
    check("授权书落款含授权方与官网", lic.includes(LICENSOR_NAME) && lic.includes(LICENSOR_SITE));
    check("授权书印章取厂牌简称（文字印）",
      lic.includes(`<i>${LICENSOR_SHORT}</i>`) && lic.includes("<i>印</i>"));
    check("指纹清单含双哈希与订单号", fp.includes("原版字体 SHA-256") && fp.includes("水印字体 SHA-256") && fp.includes(orderId));
  } else {
    for (const l of ["交付包内水印字体与页面回执哈希一致", "使用说明含订单号、核验命令对上包内文件名与存 PDF 指引",
      "授权书 HTML 含订单号与标题", "指纹清单含双哈希与订单号"]) check(l, false, "解包失败");
  }

  // 4b-1. 印章图片（新增）：上传后**替代**文字印章（不叠加）。这里守住前三件事 ——
  //   ① 加工全在浏览器里完成（600×600 会被缩到 512 上限）；② 只存本机 localStorage；
  //   ③ 屏幕出口立刻换成图片章。第四件（打印出口 / 交付包里的 HTML）在 4b-2 里随重算一起验。
  await page.goto(PORTAL + "/settings");
  await page.waitForSelector("button.setting", { timeout: 10000 }).catch(() => {});
  await page.click("button.setting:has-text('厂牌信息')");
  await page.waitForTimeout(400);
  // 用 canvas 现造一张 600×600 的 PNG：超过 512 上限，正好把等比缩放那一步也走到
  const sealPng = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 600; c.height = 600;
    const ctx = c.getContext("2d");
    if (!ctx) return "";
    ctx.fillStyle = "#aa573d";
    ctx.fillRect(0, 0, 600, 600);
    return c.toDataURL("image/png");
  });
  const [sealChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator(".setting-item.open button:has-text('上传图片')").click(),
  ]);
  await sealChooser.setFiles({
    name: "seal.png", mimeType: "image/png",
    buffer: Buffer.from(sealPng.split(",")[1], "base64"),
  });
  await page.waitForSelector(".setting-item.open .seal-img", { timeout: 10000 }).catch(() => {});
  const sealToast = (await page.locator(".toast").allTextContents()).join(" | ");
  check("上传印章图片后就地出预览（加工在浏览器里完成）",
    (await page.locator(".setting-item.open .seal-img").count()) === 1);
  check("超过 512px 的印章被等比缩到上限（600×600 → 512×512）",
    sealToast.includes("512×512"), sealToast.slice(0, 80));
  await page.locator(".setting-item.open button:has-text('保存')").click();
  await page.waitForTimeout(400);
  const sealLs = await page.evaluate(() => localStorage.getItem("typeflow_foundry_seal_image"));
  check("印章图片只存本机（localStorage 里的 data URL）",
    !!sealLs && sealLs.startsWith("data:image/png;base64,"), String(sealLs).slice(0, 30));

  // 屏幕出口：图片章替代文字章 —— 两者不同时出现
  await page.goto(PORTAL + "/issue");
  await page.waitForTimeout(700);
  check("上传印章后授权书落款换成图片章（文字章让位）",
    (await page.locator(".paper .seal-img").count()) === 1
    && (await page.locator(".paper .seal").count()) === 0);

  // 4b-2. 订单页「重新生成交付包」：水印字体不落本地库，靠「本机原版字体 + 云端配方」重算，
  //       嵌入是确定性的 ⇒ 结果必须与首次逐字节一致（这是"重新下载"成立的全部依据）
  await page.goto(PORTAL + "/orders");
  await page.waitForSelector(".trow", { timeout: 15000 }).catch(() => {});
  // §2.5 F-10：状态筛选（下划线式选择语言）
  check("订单页提供状态筛选", (await page.locator(".choice[aria-label='按状态筛选订单'] button").count()) === 4);
  await page.locator(".choice button:has-text('已作废')").click();
  await page.waitForTimeout(200);
  check("筛选「已作废」→ 空态", ((await page.textContent("body")) ?? "").includes("还没有订单"));
  await page.locator(".choice button:has-text('全部')").click();
  await page.waitForTimeout(200);

  // 字体列必须显示本机字体名：云端自 2026-09-17 起不存字体名（display_name 写空串），
  // 任何 `order.font_name || order.font_id` 的写法都会退化成 `font_9ea2d420…`（本会话修过一版）。
  const fontCell = (((await page.locator(`.trow:has-text('${orderId}')`).locator("span").nth(2).textContent()) ?? "")).trim();
  check("订单表字体列显示本机字体名（不是 sha16）", fontCell === "xingyun-Regular", fontCell);

  await page.click(`.trow:has-text('${orderId}')`);
  await page.waitForTimeout(400);
  const regenBtn = page.locator("button:has-text('重新生成交付包')");
  check("已签发订单提供「重新生成交付包」入口", (await regenBtn.count()) === 1,
    `实际 ${await regenBtn.count()} 个`);
  let regenZip: Map<string, Buffer> | null = null;
  if (await regenBtn.count()) {
    const [regenDl] = await Promise.all([
      page.waitForEvent("download", { timeout: 30000 }).catch(() => null),
      regenBtn.click(),
    ]);
    check("重新生成的交付包可下载", !!regenDl && regenDl.suggestedFilename().includes("交付包"),
      regenDl ? regenDl.suggestedFilename() : "未触发下载");
    const rp = regenDl ? await regenDl.path() : null;
    if (rp) regenZip = readZip(readFileSync(rp));
  } else {
    check("重新生成的交付包可下载", false, "未找到按钮");
  }
  if (regenZip) {
    const ttf2 = regenZip.get(`xingyun-Regular_${orderId}.ttf`);
    const lic2 = regenZip.get("字体授权书.html")?.toString("utf8") ?? "";
    check("重算结果与首次逐字节一致（本地嵌入是确定性的）",
      !!ttf2 && !!firstTtf && sha256(ttf2) === sha256(firstTtf),
      ttf2 ? sha256(ttf2).slice(0, 16) : "包内没有水印字体");
    check("重算出的授权书与原单一致（订单号 + 授权方抬头 + 字体名取本机）",
      lic2.includes(orderId) && lic2.includes(LICENSOR_NAME) && lic2.includes("xingyun-Regular"));
    // 打印出口同步：授权书 HTML 内嵌的是 data URL 图片章，文字章让位（两个出口不能各是一套）
    check("打印出口的授权书印章也是上传的图片章（内嵌 data URL）",
      lic2.includes('class="seal-img"') && lic2.includes("data:image/png;base64,")
      && !lic2.includes(`<i>${LICENSOR_SHORT}</i>`));
  } else {
    for (const l of ["重算结果与首次逐字节一致（本地嵌入是确定性的）",
      "重算出的授权书与原单一致（订单号 + 授权方抬头 + 字体名取本机）",
      "打印出口的授权书印章也是上传的图片章（内嵌 data URL）"]) check(l, false, "解包失败");
  }

  // §2.5 F-4 + 5.5：客户名是跳转链接 → 直接打开客户详情卡（订单号 / 金额本地拼接）
  await page.click(`.modal button:has-text('青岚设计有限公司')`);
  await page.waitForURL("**/customers", { timeout: 10000 }).catch(() => {});
  // 打开动画（veil 160ms + 对话框 220ms）期间固定等待不够稳，改成等元素本身
  await page.waitForSelector(".modal", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  check("订单卡点客户名跳转并打开客户卡",
    page.url().endsWith("/customers") && (await page.locator(".modal-back.open").count()) === 1);
  const cardBody = (await page.textContent(".modal")) ?? "";
  check("客户卡聚合订单与累计金额（本地拼接）",
    cardBody.includes(orderId) && cardBody.includes("累计授权费用") && cardBody.includes("1,299"),
    cardBody.includes("累计") ? "含订单与金额" : "缺内容");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  check("客户卡 Esc 可关", (await page.locator(".modal-back").count()) === 0);

  // 订单模态框 Esc / 滚动解锁（重新开一次验证）
  await page.goto(PORTAL + "/orders");
  await page.waitForSelector(".trow", { timeout: 15000 }).catch(() => {});
  await page.locator(".trow").first().click();
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  check("订单模态框 Esc 可关", (await page.locator(".modal-back").count()) === 0);
  const bodyOv = await page.evaluate(() => document.body.style.overflow);
  check("模态框关闭后背景滚动解锁", bodyOv === "", `overflow=${bodyOv || "(空)"}`);

  // 概览「最近订单」行：又是另一份字体名映射（不是订单页那份），同样只能读本机字体库
  await page.goto(PORTAL + "/");
  await page.waitForSelector(".recent-row", { timeout: 15000 }).catch(() => {});
  const recentTitle = (((await page.locator(".recent-row .order-title").first().textContent()) ?? "")).trim();
  check("概览最近订单行显示本机字体名（不是 sha16）", recentTitle.includes("xingyun-Regular"),
    recentTitle.slice(0, 48));

  // 4b-3. 追溯：选取对齐签发页（pick 行就地展开）+ 自证自动匹配 + 报告落本机历史
  await page.goto(PORTAL + "/trace");
  await page.waitForSelector(".pick", { timeout: 15000 }).catch(() => {});
  check("追溯页选取采用签发页的 pick 行语言（两个槽位）", (await page.locator(".pick").count()) === 2,
    `实际 ${await page.locator(".pick").count()} 个`);

  // 左右栏（2026-09-17）：鉴定书在左、导入在右；空闲态先显示空白鉴定书
  check("追溯页左右栏：鉴定书在左、导入在右",
    (await page.locator(".trace-layout > section").count()) === 2
    && (await page.locator(".trace-layout > section").first().locator(".paper").count()) === 1);
  check("追溯空闲态显示空白鉴定书（纸面始终在场，不是空白栏）",
    ((await page.locator(".report-id").first().textContent()) ?? "").includes("尚未分析"));
  // 只导入可疑字体：Name256 自证订单 → 云端配方 font_sha256 → 本机库自动匹配原版
  await page.locator(".pick").nth(1).click();
  await page.waitForTimeout(450);
  await page.locator(".acc-panel.open input[type=file]").setInputFiles({
    name: "suspicious.ttf", mimeType: "font/ttf", buffer: firstTtf!,
  });
  await page.waitForTimeout(2000);
  const pickOrigTxt = ((await page.locator(".pick").first().textContent()) ?? "").trim();
  check("上传可疑字体后自动匹配本机原版（自证 → 配方 → 字体库）",
    !pickOrigTxt.includes("选择原版字体"), pickOrigTxt.slice(0, 24));
  const traceBody1 = (await page.textContent("body")) ?? "";
  check("可疑字体的 Name256 自证被读出并展示",
    traceBody1.includes("Name256 自证") && traceBody1.includes(orderId));
  await page.click("button:has-text('开始分析')");
  // ⚠️ 不能等 .report-id：空闲态的「空白鉴定书」也有这个锚点（文本是「尚未分析」），会提前通过。
  // .trace-verdict 只有出了结果才渲染，加上过程槽队列放完（proc-res.on）才是真正的"分析完成"。
  await page.waitForSelector(".trace-verdict", { timeout: 60000 }).catch(() => {});
  await page.waitForSelector(".paper .proc-res.on", { timeout: 20000 }).catch(() => {});
  const repId = ((await page.locator(".report-id").first().textContent()) ?? "").trim();
  const repNo = repId.split(" · ")[0];
  check("追溯完成且报告号在分析时生成（TRACE-YYYYMMDD-NNN）",
    /^TRACE-\d{8}-\d{3} · 已完成$/.test(repId), repId);
  const repBody = (await page.textContent("body")) ?? "";
  check("报告命中本次签发的订单", repBody.includes(orderId) && repBody.includes("最可能的签发订单"));

  // 历史落本机：刷新后仍在 → 可回看同一份报告 → 可导出打印 HTML
  await page.reload();
  await page.waitForSelector(".trace-hrow", { timeout: 15000 }).catch(() => {});
  check("追溯历史落本机（刷新后仍在）", (await page.locator(".trace-hrow").count()) >= 1);
  check("追溯历史在右栏、开始分析控件之下（左栏整栏留给鉴定书）",
    (await page.locator(".trace-layout > section").nth(1).locator(".trace-hrow").count()) >= 1
    && (await page.locator(".trace-layout > section").first().locator(".trace-hrow").count()) === 0);

  // 二次确认必须可取消（曾经只有「点确认」和「4 秒超时」两条出路，用户反馈无法取消）。
  // 武装态是勾 / 叉图标（行内空间窄，文字按钮会溢出），取消按钮以 aria-label="取消" 定位。
  await page.locator(".trace-hrow .confirm-wrap").first().locator("button").last().click();
  await page.waitForTimeout(120);
  check("删除按钮进入二次确认（出现「取消」）",
    (await page.locator(".trace-hrow .confirm-wrap button[aria-label='取消']").count()) === 1);
  await page.locator(".trace-hrow .confirm-wrap button[aria-label='取消']").first().click();
  await page.waitForTimeout(200);
  check("点「取消」可退出二次确认，记录仍在",
    (await page.locator(".trace-hrow .confirm-wrap button[aria-label='取消']").count()) === 0
    && (await page.locator(".trace-hrow").count()) >= 1);
  await page.locator(".trace-hrow").first().click();
  await page.waitForTimeout(400);
  check("历史报告可回看（同一份报告号）",
    ((await page.locator(".report-id").first().textContent()) ?? "").trim() === repId);
  const [repWin] = await Promise.all([
    page.waitForEvent("popup", { timeout: 15000 }).catch(() => null),
    page.locator("button[aria-label^='导出']").first().click(),
  ]);
  await page.waitForTimeout(600);
  const repHtml = repWin ? await repWin.content() : "";
  check("报告可导出为可打印 HTML（含报告号 / 订单号 / 标题）",
    repHtml.includes(repNo) && repHtml.includes(orderId) && repHtml.includes("追溯报告"),
    repHtml ? `长度 ${repHtml.length}` : "未捕获打印窗口");
  if (repWin) await repWin.close().catch(() => {});

  // 4c. 签发后云端哈希应已同步（卡片技术行出现「已同步」）
  await page.goto(PORTAL + "/fonts");
  await page.waitForSelector(".font-card:has-text('已同步')", { timeout: 15000 }).catch(() => {});
  check("签发后云端哈希已同步", ((await page.textContent("body")) ?? "").includes("已同步"));
  // 5.5 ③：标本卡的经营视角——签发次数 + 最近一单
  const fontMeta = (await page.textContent("body")) ?? "";
  check("字体卡显示签发次数与最近一单", /1 次签发 · 最近 \d{1,2}\/\d{1,2}/.test(fontMeta));

  // 4d. 安全与信任：两张图（数据在哪里 / 一次签发做了什么）+ 自证表
  //     2026-09-18 改版：出网 / 不出网文字清单撤下，改由图承担（图上标注即口径）；
  //     自证区从「纵排 drow 全摊开」收成「一行摘要 + 就地展开」。
  await page.click(".navlink:has-text('安全与信任')");
  await page.waitForTimeout(1200);
  const secBody = (await page.textContent("body")) ?? "";
  check("安全页三块都在（签发流程 / 追溯流程 / 数据在哪里）",
    (await page.locator("svg[aria-labelledby*='flow-title']").count()) === 1
    && (await page.locator("svg[aria-labelledby*='trace-title']").count()) === 1
    && (await page.locator(".block-title").count()) === 3);
  check("区块标题上屏且图有可访问名称（title / desc 成对）",
    secBody.includes("一次签发做了什么") && secBody.includes("一次追溯做了什么")
    && secBody.includes("数据在哪里")
    && (await page.locator("svg[aria-labelledby*='flow-title'] > title#flow-title").count()) === 1
    && (await page.locator("svg[aria-labelledby*='trace-title'] > desc#trace-desc").count()) === 1);
  check("签发流程五步与产出都在",
    secBody.includes("登记哈希") && secBody.includes("创建订单") && secBody.includes("取云端配方")
    && secBody.includes("本地嵌入") && secBody.includes("提交回执")
    && secBody.includes("水印字体 · 授权书"));
  check("追溯流程五步与产出都在",
    secBody.includes("导入可疑字体") && secBody.includes("读取自证") && secBody.includes("匹配本机原版")
    && secBody.includes("拉取候选配方") && secBody.includes("比对水印信号")
    && secBody.includes("鉴定书"));
  // 出网 / 入网口径：清单撤下后，由「数据在哪里」按本机 / 云端分列承担。
  // 两列是**穷举** —— 所以断言要钉住「最容易漏、也最有分量」的那几项，
  // 而且要落在列内（不是整页正文），否则别处的同名文字会给出假通过。
  const locCols = await page.locator(".loc-grid > div").allTextContents();
  check("数据在哪里按本机 / 云端分列",
    locCols.length === 2 && locCols[0].includes("本机浏览器") && locCols[1].includes("文镇云端")
    && locCols[1].includes("字体哈希 · 订单号"));
  check("本机列列出最强承诺（订单备注 / 授权方案与费用 / 追溯历史）",
    locCols[0].includes("订单备注") && locCols[0].includes("授权方案与费用")
    && locCols[0].includes("追溯历史") && locCols[0].includes("客户资料"),
    locCols[0].replace(/\s+/g, " ").slice(0, 60));
  check("云端列列出账号数据（邮箱与密码派生值）",
    locCols[1].includes("账号") && locCols[1].includes("密码派生值"),
    locCols[1].replace(/\s+/g, " ").slice(0, 60));
  check("账号数据的边界指向《隐私政策》（范围界定）",
    (await page.locator(".loc-note a[href='/privacy']").count()) === 1
    && ((await page.locator(".loc-note").first().textContent()) ?? "").includes("账号服务"));
  const scanOk = await page.locator("text=✓ 无网络调用").count();
  check("源码自证扫描通过（3 个纯净文件零网络调用）", scanOk === 3, `实际 ${scanOk} 个`);
  // 修复"自证清单漏掉真正发请求的文件"：api/client.ts 在列，并如实标注为唯一出网通道
  const netMark = await page.locator("text=✓ 仅限预期出网").count();
  check("出网文件如实标注（client.ts 仅 /api · 本页仅自证请求）",
    netMark === 2 && secBody.includes("api/client.ts") && secBody.includes("pages/Security.tsx"),
    `标注 ${netMark} 个`);
  check("折叠态摘要给出结论（源文件已哈希 · 算法版本 · 本页自证）",
    secBody.includes("个源文件已实时哈希，无异常网络调用")
    && secBody.includes("算法版本") && secBody.includes("本页 SHA-256"));
  // 撤清单后的口径守卫：业务数据只说字体与订单，不混账号，也不点名云厂商
  check("安全页不出现禁用词（客户信息 / 账号数据 / 云厂商名）",
    !secBody.includes("客户信息") && !secBody.includes("账号数据") && !secBody.includes("阿里云"));
  // 修复"开源范围表唯一渲染点在死组件里"：决策点 3 的结果现在真的上屏
  check("开源范围上屏（引擎/门户公开 · worker 私有）",
    secBody.includes("开源范围") && secBody.includes("worker/（配方签发服务）") && secBody.includes("✕ 私有"));
  check("提供离线签发工具下载入口", (await page.locator("a[href='/typeflow-local-signer.html']").count()) > 0);
  check("本页自证已实时计算 SHA-256", /^[0-9a-f]{64}$/.test(((await page.locator(".hash-line").first().textContent()) ?? "").trim()));

  // 4e. 合规（批次 4）：条款页公开可读 + 设置页的账号与合规抽屉
  await page.goto(PORTAL + "/terms");
  const termsBody = (await page.textContent("body")) ?? "";
  check("用户协议页公开可读", termsBody.includes("用户协议") && termsBody.includes("无法验证你最终产出的字体文件内容"));
  await page.goto(PORTAL + "/privacy");
  const privBody = (await page.textContent("body")) ?? "";
  check("隐私政策页公开可读", privBody.includes("隐私政策") && privBody.includes("一个字节都不上传"));

  // 4c. 移除印章图片 → 屏幕出口回到文字印章，本机记录同时清空（「移除」是可反悔的）
  await page.goto(PORTAL + "/settings");
  await page.waitForSelector("button.setting", { timeout: 10000 }).catch(() => {});
  await page.click("button.setting:has-text('厂牌信息')");
  await page.waitForTimeout(400);
  await page.locator(".setting-item.open button:has-text('移除')").click();
  await page.waitForTimeout(200);
  await page.locator(".setting-item.open button:has-text('保存')").click();
  await page.waitForTimeout(400);
  const sealCleared = await page.evaluate(() => localStorage.getItem("typeflow_foundry_seal_image"));
  check("移除印章图片后本机记录清空", sealCleared === "", String(sealCleared));
  await page.goto(PORTAL + "/issue");
  await page.waitForTimeout(700);
  check("移除后授权书落款回到文字印章",
    (await page.locator(".paper .seal").count()) === 1
    && (await page.locator(".paper .seal-img").count()) === 0);

  // 4d-0. 引导按真实数据打勾 + 设置页可重新打开（2026-09-18）
  //   验两件事：① 步骤状态不是另存的进度，而是从字体库 / 厂牌 / 订单现算出来的；
  //   ② 会话里的邮箱验证状态是注册那一刻的快照，点一次第 1 步的按钮会向服务端核对并同步
  //      —— 服务端已验证时只回 already_verified，不会重复发信。
  await page.goto(PORTAL + "/settings");
  await page.waitForSelector("button.setting", { timeout: 10000 }).catch(() => {});
  await page.click("button.setting:has-text('数据与备份')");
  await page.waitForTimeout(400);
  const reopenLink = page.locator(".setting-item.open .kv-link:has-text('重新显示')");
  check("设置页提供「重新显示」引导入口", (await reopenLink.count()) === 1);
  await reopenLink.click();
  await page.waitForURL("**/welcome", { timeout: 10000 }).catch(() => {});
  // 等引导页自己的标记（不能等 `.setting-item`：设置页的残留 DOM 会把它骗过去，见 1a 的说明）
  await page.waitForSelector(".step-mark", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(300);
  // 此时字体已入库、厂牌已填、订单已签发 ⇒ 第 3 / 4 / 5 步该自己亮起来
  const marksBefore = await page.locator(".step-mark.done").count();
  check("引导按真实数据打勾（字体 / 授权方 / 订单 三步已完成）",
    marksBefore === 3, `已完成 ${marksBefore} 步`);
  // 第 1 步默认就是展开的（第一个未完成）
  await page.locator(".setting-item.open button:has-text('发验证邮件')").click();
  await page.waitForTimeout(1500);
  const marksAfter = await page.locator(".step-mark.done").count();
  check("点一次把验证状态同步过来（服务端已验证时不重复发信）",
    marksAfter === 4, `已完成 ${marksAfter} 步`);
  await page.click(".welcome-foot .kv-link:has-text('跳过引导')");
  await page.waitForURL("**/", { timeout: 10000 }).catch(() => {});

  await page.goto(PORTAL + "/settings");
  // 设置页首屏是载入态（此时还没有条目），先等条目渲染出来再断言
  await page.waitForSelector("button.setting", { timeout: 10000 }).catch(() => {});
  // 设置条目 = 点条目就地向下展开（原右侧滑出抽屉已退役）
  check("设置页不再使用侧滑抽屉", (await page.locator(".drawer, .drawer-back").count()) === 0);
  const settingRows = await page.locator("button.setting").count();
  const settingChevs = await page.locator("button.setting .setting-chev").count();
  check("设置页 5 个条目都是可展开行（带箭头）",
    settingRows === 5 && settingChevs === 5, `条目 ${settingRows} / 箭头 ${settingChevs}`);
  const setClosed = await page.locator(".setting-item").first().locator(".acc-inner").evaluate((el) => el.clientHeight);
  check("设置条目默认全部收起", setClosed === 0, `实际 ${setClosed}px`);
  await page.click("button.setting:has-text('账号与合规')");
  await page.waitForTimeout(400);
  check("点击设置条目后就地展开（非抽屉）",
    (await page.locator("button.setting:has-text('账号与合规')").getAttribute("aria-expanded")) === "true"
    && (await page.locator(".acc-panel.open").count()) === 1);
  const setOpen = await page.locator(".setting-item").filter({ hasText: "账号与合规" })
    .locator(".acc-inner").evaluate((el) => el.clientHeight);
  check("展开后条目内容可见", setOpen > 200, `实际 ${setOpen}px`);
  // 用计算样式守住展开体的"连成一片 + 呼吸感"——别再靠肉眼看截图（曾漏过 .setting-item 没挂 open 类）
  const itemBg = await page.locator(".setting-item.open").evaluate((el) => getComputedStyle(el).backgroundColor);
  check("展开条目（标题与内容）同底色 #f5f3ef", itemBg === "rgb(245, 243, 239)", itemBg);
  const bodyPad = await page.locator(".setting-item.open .setting-body").evaluate((el) => {
    const s = getComputedStyle(el);
    return `${s.paddingTop}/${s.paddingRight}/${s.paddingBottom}/${s.paddingLeft}`;
  });
  check("展开体有呼吸内边距（20/20/30/20）", bodyPad === "20px/20px/30px/20px", bodyPad);
  const acctBody = (await page.textContent(".setting-item:has(.setting:has-text('账号与合规'))")) ?? "";
  check("数据可携指向合并后的唯一导出入口",
    acctBody.includes("数据可携") && acctBody.includes("数据与备份 → 导出数据"));
  // 注销是危险操作：先点出密码确认框，再断言（不能只有一个裸按钮）
  await page.click("button:has-text('注销账号…')");
  await page.waitForTimeout(200);
  const delBody = (await page.textContent("body")) ?? "";
  check("设置页提供账号注销（密码确认 + 不可撤销提示）",
    delBody.includes("不可撤销") && delBody.includes("永久删除我的账号"));

  // 4f. 数据与备份：逐项列本机/云端，且导出一个文件带走两段（本机 + 云端）
  await page.click("button.setting:has-text('数据与备份')");
  await page.waitForTimeout(400);
  const dataPanel = (await page.textContent(".setting-item:has(.setting:has-text('数据与备份'))")) ?? "";
  check("数据与备份按分区规整（本机 / 云端 / 备份 / 导出 / 危险操作）",
    dataPanel.includes("本机数据 · 只在这台设备") && dataPanel.includes("云端登记 · 只有哈希与订单号")
    && dataPanel.includes("客户库") && dataPanel.includes("字体登记"));
  check("云端无客户项已说明（空是常态）", dataPanel.includes("云端按设计不保存客户姓名与备注"));

  // 4g. 授权方案编辑/增删（2026-09-17）：设置页加自定义方案 → 签发页选项实时出现
  await page.click("button.setting:has-text('授权方案')");
  await page.waitForTimeout(400);
  check("授权方案展开体默认渲染三个内置项",
    (await page.locator(".setting-item .drow").filter({ hasText: "企业商用" }).count()) === 1
    && (await page.locator(".setting-item .drow").filter({ hasText: "个人版" }).count()) === 1);
  await page.click(".picker-add:has-text('自定义方案')");
  await page.fill('input[aria-label="新方案名称"]', "展会授权");
  await page.fill('textarea[aria-label="新方案条款"]', "仅限指定展会物料使用，展会结束后授权终止。");
  await page.click("button:has-text('创建方案')");
  await page.waitForTimeout(400);
  check("自定义方案创建成功并显示条款",
    (await page.locator(".setting-item .drow").filter({ hasText: "展会授权" }).count()) === 1
    && ((await page.textContent("body")) ?? "").includes("仅限指定展会物料使用"));
  await page.goto(PORTAL + "/issue");
  await page.waitForTimeout(600);
  await page.locator(".pick").nth(2).click();
  await page.waitForTimeout(300);
  const schemeRows = await page.locator(".acc-panel.open .license-row").count();
  check("自定义方案出现在签发页选项", schemeRows === 4,
    `选项 ${schemeRows}（内置 3 + 自定义 1）`);
  await page.goto(PORTAL + "/settings");
  await page.waitForSelector("button.setting", { timeout: 10000 }).catch(() => {});
  await page.click("button.setting:has-text('授权方案')");
  await page.waitForTimeout(400);
  await page.locator(".drow:has-text('展会授权') .btn-icon[title='隐藏方案']").first().click();
  await page.waitForTimeout(300);
  check("方案隐藏后给出恢复显示入口",
    (await page.locator("button:has-text('恢复显示')").count()) === 1);
  await page.goto(PORTAL + "/issue");
  await page.waitForTimeout(600);
  await page.locator(".pick").nth(2).click();
  await page.waitForTimeout(300);
  check("隐藏后签发页选项回到三个",
    (await page.locator(".acc-panel.open .license-row").count()) === 3);

  // 恢复现场：回到设置页并重新展开「数据与备份」（后续断言依赖该面板在展开态）
  await page.goto(PORTAL + "/settings");
  await page.waitForSelector("button.setting", { timeout: 10000 }).catch(() => {});
  await page.click("button.setting:has-text('数据与备份')");
  await page.waitForTimeout(400);

  // 控件风格集中性：裸 .btn 必须是项目次级按钮（透明底 + 描边），而不是浏览器默认白控件
  const plainBtnBg = await page.locator("button:has-text('导入数据')")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  check("裸 .btn 已套上项目次级按钮样式（不再是系统白控件）",
    plainBtnBg === "rgba(0, 0, 0, 0)", plainBtnBg);
  // 二次确认态使用补定义的 btn-solid-danger（锈红实底），点一下只是"上膛"，不会真删。
  // 武装态现在是勾图标（行内文字会溢出），用 aria-label 定位。
  await page.click("button:has-text('清除本地数据')");
  await page.waitForTimeout(200);
  await page.mouse.move(0, 0);            // 移开指针，读非 hover 的底色
  await page.waitForTimeout(150);
  const armedBg = await page.locator("button[aria-label='确认清除']")
    .evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => "未找到");
  check("危险操作的二次确认是锈红实底（btn-solid-danger 已定义）",
    armedBg === "rgb(170, 87, 61)" || armedBg === "rgb(150, 73, 47)", armedBg);

  const [expDl] = await Promise.all([
    page.waitForEvent("download", { timeout: 20000 }).catch(() => null),
    page.click("button:has-text('导出数据')"),
  ]);
  const expPath = expDl ? await expDl.path() : null;
  const expEntries = expPath ? readZip(readFileSync(expPath)) : null;
  const expJson: any = expEntries ? JSON.parse(expEntries.get("typeflow-data.json")!.toString("utf8")) : null;
  check("导出的 zip 备份一个文件含清单 + 字体本体 + 云端段",
    !!expJson && expJson.v === 3 && Array.isArray(expJson.customers) && !!expJson.cloud
    && [...expEntries!.keys()].some((k) => k.startsWith("typeflow-fonts/")),
    expJson ? `v${expJson.v} · 包内 ${expEntries!.size} 个文件 · 云端订单 ${expJson.cloud?.orders?.length ?? "—"}` : "未触发下载");
  check("云端段只存不透明 client_id 与哈希（无姓名）",
    !!expJson?.cloud?.orders?.length
    && "client_id" in expJson.cloud.orders[0]
    && !("client_ref" in expJson.cloud.orders[0])
    && !JSON.stringify(expJson.cloud).includes("client_ref"));

  // 4g. 窄屏外壳（§2.5 F-3）：≤760px 侧栏收成抽屉 + 顶栏，模态框不溢出
  // 4f. 切页回顶：react-router 默认不重置滚动位置。短页面互切时新页不可滚、
  // 浏览器会把 scrollY 夹紧到 0，正好掩盖掉这个问题 —— 所以先把视口压矮，
  // 制造真正的「长页 → 长页」场景再验。
  await page.setViewportSize({ width: 1440, height: 420 });
  await page.goto(PORTAL + "/security");
  await page.waitForTimeout(700);
  await page.evaluate(() => window.scrollTo(0, 500));
  const yBefore = await page.evaluate(() => window.scrollY);
  await page.click(".sidebar-item:has-text('签发')");
  await page.waitForTimeout(700);
  const yAfter = await page.evaluate(() => window.scrollY);
  await page.setViewportSize({ width: 1440, height: 900 });
  check("切页回顶：长页滚到中部后切页，新页从顶部开始", yBefore > 0 && yAfter === 0, `${yBefore} → ${yAfter}`);

  await page.setViewportSize({ width: 375, height: 720 });
  await page.goto(PORTAL + "/orders");
  await page.waitForSelector(".trow", { timeout: 15000 }).catch(() => {});
  check("窄屏显示顶栏（汉堡入口）",
    (await page.locator(".topbar").isVisible()) && (await page.locator(".topbar-menu").isVisible()));
  check("窄屏侧栏默认收起（抽屉态）",
    await page.locator(".sidebar").evaluate((el) => el.getBoundingClientRect().left < 0));
  await page.click(".topbar-menu");
  await page.waitForTimeout(450);
  check("点汉堡后抽屉展开",
    await page.locator(".sidebar").evaluate((el) => el.getBoundingClientRect().left === 0));
  await page.click(".sidebar-item:has-text('签发')");
  await page.waitForURL("**/issue", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(450);   // 等收起过渡（220ms）走完再量位置
  check("抽屉内点导航跳转并自动收起",
    page.url().endsWith("/issue")
    && await page.locator(".sidebar").evaluate((el) => el.getBoundingClientRect().left < 0));
  await page.goto(PORTAL + "/orders");
  await page.waitForSelector(".trow", { timeout: 15000 }).catch(() => {});
  await page.locator(".trow").first().click();
  await page.waitForTimeout(400);
  const modalW = await page.locator(".modal").evaluate((el) => el.getBoundingClientRect().width);
  const vw = await page.evaluate(() => window.innerWidth);
  check("窄屏模态框不溢出（宽 ≤ 视口-32px）", modalW <= vw - 30, `modal=${Math.round(modalW)} vw=${vw}`);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 900 });

  // 5. 重新登录后侧栏仍显示显示名（修过的 bug：退出再进退化成显示邮箱）
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(PORTAL + "/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', "password123");
  await page.click("button[type=submit]");
  await page.waitForTimeout(1500);
  const sidebarWho = (await page.locator(".sidebar-account-name").textContent()) ?? "";
  check("重新登录后侧栏显示显示名（不是邮箱）",
    sidebarWho.trim() === "E2E 测试工作室", sidebarWho.trim());

  // 5b. 标本卡真渲染的回归线（2026-09-18 部署后真机检查在预发上抓到的缺陷）：
  //     同一行会从「这份字体不在本机」变成「本机也有文件」，而合并后的行 key 不变
  //     （都是 sha256 前 16 位）⇒ React 复用同一个组件实例。若 GlyphPreview 的 effect
  //     不把 local 放进依赖，就永远不会重试，卡片一直停在「无文件」，刷新才恢复。
  //     这里把那条时序在页面里复现：删掉本机本体（该行退化成云端行）→ 原样加回来。
  await page.goto(PORTAL + "/fonts");
  await page.waitForSelector(".font-card .glyph-main", { timeout: 20000 }).catch(() => {});
  check("进字体库即出真字形", (await page.locator(".font-card .glyph-main").count()) >= 1
    && (await page.locator(".font-card .glyph-failed").count()) === 0);

  await page.hover(".font-card");
  await page.locator(".font-card .mini button[title='删除字体']").first().click();
  await page.waitForTimeout(200);
  await page.locator("button[aria-label='确认删除字体']").first().click();
  // 等状态真的翻过来再断言：删除要经过 removeLocalFont → load()（重取云端 + 本机）。
  // 固定 sleep 在整条 test:all 并发跑时不够用（实测 900ms 会偶发假失败）。
  await page.waitForSelector(".font-card .glyph-failed", { timeout: 15000 }).catch(() => {});
  check("删除本机本体后该行写人话「这份字体不在本机」（此时画不出字形是正常的）",
    ((await page.textContent("body")) ?? "").includes("这份字体不在本机")
    && (await page.locator(".font-card .glyph-failed").count()) >= 1);

  await page.locator('input[type="file"]').setInputFiles({
    name: "xingyun-Regular.ttf", mimeType: "font/ttf", buffer: fontBuf,
  });
  await page.waitForSelector(".font-card .glyph-main", { timeout: 25000 }).catch(() => {});
  check("同哈希重新入库后标本区自行恢复（不靠刷新）",
    (await page.locator(".font-card .glyph-main").count()) >= 1
    && (await page.locator(".font-card .glyph-failed").count()) === 0);

  // 5c. 换浏览器后的样子（2026-09-18）：本机 IndexedDB 是空的，云端只剩哈希与订单号 ——
  //     提示条要说清"本机数据不在这个浏览器里"并摆出恢复入口；字体卡片与订单列写人话，
  //     不再拿 sha16 顶替字体名（那串东西客户和自己都认不出）。
  //     只清本机三表，不动 sessionStorage —— 会话令牌在那里，清了就登出了。
  await page.evaluate(() => new Promise<void>((resolve) => {
    const req = indexedDB.open("typeflow", 2);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(["fonts", "customers", "orders"], "readwrite");
      tx.objectStore("fonts").clear();
      tx.objectStore("customers").clear();
      tx.objectStore("orders").clear();
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    };
    req.onerror = () => resolve();
  }));

  await page.goto(PORTAL + "/fonts");
  await page.waitForSelector(".notice.warn", { timeout: 20000 }).catch(() => {});
  const gapBody = (await page.textContent("body")) ?? "";
  check("清空本机数据后，字体库摆出「从备份恢复」入口",
    gapBody.includes("本机数据不在这个浏览器里") && gapBody.includes("导入备份文件"), gapBody.slice(0, 60));
  check("云端登记的行写人话，不再出现「云端仅存哈希」",
    gapBody.includes("这份字体不在本机") && !gapBody.includes("云端仅存哈希"));

  await page.goto(PORTAL + "/orders");
  await page.waitForSelector(".notice.warn", { timeout: 20000 }).catch(() => {});
  const gapOrders = (await page.textContent("body")) ?? "";
  check("订单页字体列写人话（不是 font_ 开头的哈希），并同样给出恢复入口",
    gapOrders.includes("字体不在本机") && gapOrders.includes("本机数据不在这个浏览器里"));

  // 7. OTF（CFF 轮廓）从界面走一遍：入库 → 签发 → 下载文件名 / 包内条目 / 使用说明都必须是 .otf。
  //
  //    为什么单独放最后：这一段要往字体库里加一份字体，而前面大量步骤用 `.font-card` 的
  //    `first()` 定位（删除 → 重入库的时序断言），插进去会真的打坏它们。放末尾则字体库里
  //    只有它这一份本机字体，定位无歧义。
  await page.goto(PORTAL + "/fonts");
  await page.waitForSelector(".font-card, .empty", { timeout: 20000 }).catch(() => {});
  await page.locator('input[type="file"]').first().setInputFiles({
    name: `${OTF_FONT_NAME}.otf`, mimeType: "font/otf", buffer: readFileSync(OTF_SAMPLE),
  });
  await page.waitForSelector(".toast:has-text('已存入本机')", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(400);
  const otfToast = (await page.locator(".toast").allTextContents()).join(" | ");
  check("OTF 能入库（不再是「暂不支持 OTF/CFF」）", otfToast.includes("已存入本机"), otfToast.slice(0, 50));

  const otfCard = page.locator(`.font-card:has-text('${OTF_FONT_NAME}')`).first();
  await otfCard.waitFor({ timeout: 20000 }).catch(() => {});
  check("字体库出现这张 OTF 卡片", (await otfCard.count()) === 1);
  check("卡片标注格式为 OTF（按文件名后缀渲染）",
    ((await otfCard.textContent()) ?? "").includes("OTF"), ((await otfCard.textContent()) ?? "").slice(0, 40));

  // 从卡片直接签发（签发页会预选这份 OTF）
  await otfCard.hover();
  await otfCard.locator(".mini button[title='签发']").click();
  await page.waitForURL("**/issue", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(600);
  const otfPick = (await page.locator(".pick").nth(1).textContent()) ?? "";
  check("签发页已预选该 OTF 字体", otfPick.includes(OTF_FONT_NAME), otfPick.slice(0, 30));

  // 客户在上一步（5c）被清空了，就地新建一个
  await page.locator(".pick").first().click();
  await page.waitForTimeout(400);
  await page.locator(".acc-panel.open .picker-add:has-text('新建客户')").click();
  await page.fill('input[aria-label="新客户名称"]', "OTF 用例客户");
  await page.locator(".acc-panel.open button:has-text('创建客户')").click();
  await page.waitForTimeout(600);
  check("签发页可新建并选中客户",
    ((await page.locator(".pick").first().textContent()) ?? "").includes("OTF 用例客户"));

  await page.click("button:has-text('生成签发文件')");
  await page.waitForSelector(".paper .proc-res.on", { timeout: 60000 }).catch(() => {});
  check("OTF 一键签发完成", ((await page.textContent("body")) ?? "").includes("签发完成"));

  const otfOrderId = ((await page.locator(".issue-done-id").first().textContent()) ?? "").trim();
  const otfDlBtn = page.locator("button:has-text('下载水印字体')").first();
  let otfDownloaded: Buffer | null = null;
  if (await otfDlBtn.count()) {
    const [dl] = await Promise.all([
      page.waitForEvent("download", { timeout: 30000 }).catch(() => null),
      otfDlBtn.click(),
    ]);
    const p = dl ? await dl.path() : null;
    if (p) otfDownloaded = readFileSync(p);
    check(`OTF 水印字体命名为「${OTF_FONT_NAME}_订单号.otf」（OTF 进就 OTF 出，不改名叫 .ttf）`,
      !!dl && dl.suggestedFilename() === `${OTF_FONT_NAME}_${otfOrderId}.otf`,
      dl ? dl.suggestedFilename() : "未触发下载");
  } else {
    check("OTF 水印字体可下载", false, "未找到下载按钮");
  }
  check("下载到的仍是 OTF 容器（首四字节 OTTO）",
    !!otfDownloaded && otfDownloaded.subarray(0, 4).toString("latin1") === "OTTO",
    otfDownloaded ? otfDownloaded.subarray(0, 4).toString("latin1") : "未取到文件");

  const otfZipBtn = page.locator("button:has-text('下载交付包')").first();
  let otfZipFiles: Map<string, Buffer> | null = null;
  if (await otfZipBtn.count()) {
    const [zipDl] = await Promise.all([
      page.waitForEvent("download", { timeout: 30000 }).catch(() => null),
      otfZipBtn.click(),
    ]);
    const zp = zipDl ? await zipDl.path() : null;
    if (zp) otfZipFiles = readZip(readFileSync(zp));
  }
  check("OTF 交付包内那一条字体也是 .otf（与单文件下载逐字一致）",
    !!otfZipFiles && otfZipFiles.has(`${OTF_FONT_NAME}_${otfOrderId}.otf`),
    otfZipFiles ? [...otfZipFiles.keys()].join(" · ") : "解包失败");
  check("OTF 交付包的使用说明按 .otf 写安装步骤",
    !!otfZipFiles && (otfZipFiles.get("使用说明.txt")?.toString("utf8") ?? "").includes(".otf"),
    (otfZipFiles?.get("使用说明.txt")?.toString("utf8") ?? "").split("\n").find((l) => l.includes("安装字体"))?.slice(0, 50) ?? "");

  // 6. 无 JS 错误
  check("无页面 JS 错误", errors.length === 0, errors[0] ?? "");

  console.log(`\n通过 ${pass} / ${pass + fail}`);
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})();
