/**
 * 授权书 —— 一份 model，两个出口
 *
 * 背景（这是本轮要修的根因）：原先「屏幕上的预览」和「客户拿到的文书」是两段
 * 独立代码——标题不同、字段不同（预览有「授权期限·永久」，导出没有；导出有订单号
 * 行，预览把订单号挂在标题下）、哈希精度不同、视觉语言也不同。两段各自演进之后，
 * **你看到的和客户拿到的不是同一份东西**。
 *
 * 所以这里把「文书长什么样」收敛成一份数据：licenseFields() 给出**有序字段表**，
 * 两个出口都只是它的渲染器——
 *   · 屏幕出口：components/LicensePaper.tsx（React，卡片里的 .paper）
 *   · 打印出口：buildLicenseHtml()（独立 HTML，浏览器打印即存 PDF）
 * 字段增删只改 licenseFields()，两个出口自动同步。
 *
 * 另一个修复点：授权方（抬头 / 落款 / 印章）原先在文书里写死「文镇 TypeFlow」，
 * 每个用户的授权书都盖着平台的章。现在三处都读本机厂牌（lib/foundry.ts），
 * 未填时给中性占位，**不回落平台名**。
 */

import { licensorTitle, sealLines, sealText, signatureLine, type Foundry } from "./foundry";
import { schemeLabel, getScheme, DEFAULT_SCHEMES } from "./schemes";

/**
 * 授权版本文案 —— 统一从 lib/schemes.ts 读（设置页可编辑/增删，本机覆盖）。
 * ⚠️ 跨端契约：三个内置项的默认值与桌面版 config.py PRESET_LICENSES 逐字一致，
 * 默认表就住在 schemes.ts 的 DEFAULT_SCHEMES；改措辞要去那边（并同步桌面版）。
 */
export { DEFAULT_SCHEMES };

export function licenseTypeLabel(licenseType: string): string {
  return schemeLabel(licenseType);
}

/** 授权范围条款全文（本机覆盖优先；未知 key 返回空串，小节不渲染） */
export function licenseScopeText(licenseType: string): string {
  return getScheme(licenseType)?.scopeText ?? "";
}

/** 文书的全部内容（两个出口共用） */
export interface LicenseData {
  orderId: string;
  fontName: string;
  /** 授权方（本机厂牌：名称 / 简称 / 官网 / 印章形状） */
  licensor: Foundry;
  /** 被授权方（客户名；空 ⇒ 显示「（未署名）」） */
  licensee: string;
  licenseType: string;
  /** 授权期限：起止（ms 时间戳）。两者都缺省 = 永久。只存本机订单关联，不上云 */
  licenseStart?: number;
  licenseEnd?: number;
  /** 授权费用（选填；空 ⇒ 不出现该行） */
  amount?: string;
  /** 签发时间；未签发传空串 */
  issuedAt: string;
  /** 原版字体 SHA-256；未签发传空串 */
  fontSha256: string;
  /** 水印字体 SHA-256；未签发传空串 */
  watermarkedSha256: string;
}

/** 有序字段表里的一行 */
export interface LicenseField {
  k: string;
  v: string;
  /** 等宽小字（哈希用），两个出口都按此渲染 */
  mono?: boolean;
}

/** 空值占位：屏幕上留白会让人以为坏了，给一个明确的「—」 */
const DASH = "—";

/** 期限展示：起止都缺省 = 永久；有起止 = 「2026-09-17 至 2027-09-16」（文书用 ISO 式日期） */
export function licenseTermText(d: Pick<LicenseData, "licenseStart" | "licenseEnd">): string {
  if (d.licenseStart == null && d.licenseEnd == null) return "永久";
  const fmt = (ms: number | undefined) =>
    ms == null ? "—" : new Date(ms).toLocaleDateString("sv-SE");   // sv-SE = yyyy-mm-dd
  return `${fmt(d.licenseStart)} 至 ${fmt(d.licenseEnd)}`;
}

/**
 * 授权期限 = **时长**（不是起止日期）。
 *
 * 为什么这么定（2026-09-17 用户口径）：填两个日历日期等于让用户自己算有效区间，
 * 而且要先把「哪天开始」想清楚。实际上永远是「签发当天生效、持续 N 年 / N 个月」，
 * 所以只让用户选时长，起止日期本机算出来写进文书。
 *
 * ⚠️ 起算点是**签发当天 0 点（本地时区）**，与 licenseTermText 的 sv-SE 本地格式化同一口径；
 *    预览（未签发）与真正签发都调这里，两者算出同一天。
 */
export function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 加 N 个月，并把「月末跨月」夹回当月最后一天（1/31 + 1 月 = 2/28 而不是 3/3） */
export function addMonths(ms: number, months: number): number {
  const d = new Date(ms);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d.getTime();
}

/** 时长（月）→ 文书的起止字段。null / ≤0 = 永久（返回空对象，两字段都缺省） */
export function termForMonths(months: number | null | undefined): { licenseStart?: number; licenseEnd?: number } {
  if (months == null || months <= 0) return {};
  const start = startOfToday();
  return { licenseStart: start, licenseEnd: addMonths(start, months) };
}

/** 时长的中文写法：18 → 「1 年 6 个月」。用于选择行与清单，日期另有 licenseTermText */
export function durationText(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y ? `${y} 年` : "", m ? `${m} 个月` : ""].filter(Boolean).join(" ") || "0 个月";
}

/**
 * **有序字段表 —— 两个出口的唯一数据源。**
 * 想加一个字段？只改这里；预览与交付的 PDF 会同时出现。
 * 订单号不在此表（它是文书编号，两个出口都放在标题下方的副行）。
 */
export function licenseFields(d: LicenseData): LicenseField[] {
  const fields: LicenseField[] = [
    { k: "被授权方", v: d.licensee.trim() || "（未署名）" },
    { k: "授权字体", v: d.fontName.trim() || "（未选择字体）" },
    { k: "授权版本", v: licenseTypeLabel(d.licenseType) },
    { k: "授权期限", v: licenseTermText(d) },
  ];
  // 费用只在填了的时候出现——正式文书里一行空「—」不如不写
  if (d.amount && d.amount.trim()) fields.push({ k: "授权费用", v: `¥ ${d.amount.trim()}` });
  fields.push({ k: "签发时间", v: d.issuedAt || DASH });
  // ⚠️ 这里曾有两个 SHA-256 字段（原版 / 水印），2026-09-17 删除：
  // 授权书的读者是被授权方（采购 / 法务 / 财务），不会跑哈希核验，长哈希在窄栏里还会折成三行。
  // 双哈希另有归属——交付包里的「签发指纹.txt」（e2e 断言锁的就是那一份）。
  return fields;
}

/** 正文段落（两个出口共用同一句） */
export function licenseParagraph(d: LicenseData): string {
  const who = d.licensee.trim() || "（未署名）";
  const font = d.fontName.trim() || "（未选择字体）";
  // 生效句按期限二选一：永久 = 自签发起；有起止 = 写明区间（法律口径「至」含当日）。
  // 末句把「水印」和「别传播」放在一起：因为带了水印、传播出去可被追溯，所以才要求别传播，
  // 因果关系自带，不用额外解释。用「请勿」（对读者的提醒）与页脚的「不得…」（条款）分工区分。
  const effect = d.licenseStart == null && d.licenseEnd == null
    ? "授权自签发之日起生效"
    : `授权期限自 ${licenseTermText(d).replace(" 至 ", " 起至 ")} 止`;
  return `兹授权 ${who} 使用本字体「${font}」。${effect}，具体范围如下。本字体已施加唯一水印标识，请勿向第三方传播。`;
}

/**
 * 副行文案（标题下方）：文书编号。未签发时给占位，两个出口一致。
 * 只写「编号」前缀 —— 订单号本身已有 ORD- 前缀，再叠一个 NO. 是重复表达同一件事。
 */
export function licenseSubLine(d: LicenseData): string {
  return d.orderId ? `编号 ${d.orderId}` : "签发后生成编号";
}

/**
 * 归属小字（页脚）。
 * ⚠️ 2026-09-17 改：原文是「本授权书由『文镇 TypeFlow』在你的浏览器本地生成，字体文件未经第三方服务器处理」，
 * 三重错位 —— ①「你的浏览器」在 PDF 发给客户后主语指向错乱；②提平台名，厂牌不是文镇时会误导；
 * ③技术实现细节不属于文书。现在换成对双方都有意义的份数与转让限制。
 */
export function licenseFooter(): string {
  return "本授权书一式一份，由授权方电子出具。未经授权方书面许可，不得转让、转授或超出授权范围使用。";
}

/** 印章文字折行；返回空数组表示不渲染印章（未填厂牌或选择「不盖章」） */
export function licenseSealLines(d: LicenseData): string[] {
  if (d.licensor.seal === "none") return [];
  return sealLines(sealText(d.licensor));
}

/* ─────────────────────── 出口 B：打印 / 另存 PDF ─────────────────────── */

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 独立 HTML（浏览器打印 → 另存为 PDF）。
 * 视觉语言对齐屏幕上的 .paper（同一套色值），这样"预览即交付物"是字面成立的。
 */
export function buildLicenseHtml(d: LicenseData): string {
  const licensor = licensorTitle(d.licensor);
  const site = d.licensor.site.trim();
  const lines = licenseSealLines(d);
  const sealCls = d.licensor.seal === "square" ? "seal sq" : "seal";

  // 事实栏与屏幕出口同构：两列网格（原先是每项一行的表格，两处版式对不上）
  const fieldRows = licenseFields(d)
    .map((f) => `    <div class="fact"><small>${esc(f.k)}</small><b${f.mono ? ' class="mono"' : ""}>${esc(f.v)}</b></div>`)
    .join("\n");

  const sealHtml = lines.length
    ? `      <div class="${sealCls}">${lines.map((l) => `<i>${esc(l)}</i>`).join("")}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>字体授权书 ${esc(d.orderId)}</title>
<style>
  /* 色值与排版规格**逐项对齐屏幕出口**（components/LicensePaper.tsx + theme-v9.css 的 .paper 一族）——
     两处版式必须一致：同一个客户可能在屏幕上看预览、在 PDF 上看交付件。
     改动屏幕规格时，这里要同步改（反之亦然）。 */
  /* ⚠️ 整页限宽 500px 并居中：A4 内容区约 673px，若让 body 占满会让正文一行排到 45 字；
     而若只给段落下 max-width，就会变成「正文窄、事实栏宽」——右侧空出一块，视觉上很怪
     （实测用户反馈）。限宽 + auto 让左右留白对称，正文一行约 33 字。 */
  body{font-family:"Songti SC","STSong","SimSun",serif;color:#34322e;background:#fff;
       margin:44px auto;max-width:500px;
       line-height:1.8;font-size:14px;
       -webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .head{display:flex;justify-content:space-between;align-items:baseline;gap:16px;}
  .licensor{font-size:15px;font-weight:600;}
  .site{font-family:"SFMono-Regular","IBM Plex Mono",Consolas,monospace;font-size:11px;color:#918d86;}
  h1{font-size:30px;font-weight:500;margin:32px 0 6px;letter-spacing:.01em;}
  .sub{font-family:"SFMono-Regular","IBM Plex Mono",Consolas,monospace;font-size:11px;color:#918d86;}
  hr{border:0;border-top:1px solid #ebe8e2;margin:26px 0;}
  .body{font-size:15px;line-height:1.95;color:#4b4a47;margin:0;}
  .sec{margin-top:30px;}
  .sec-t{font-family:"SFMono-Regular","IBM Plex Mono",Consolas,monospace;font-size:11px;color:#918d86;letter-spacing:.04em;margin-bottom:8px;}
  .sec-p{font-size:15px;line-height:1.95;color:#4b4a47;margin:0;}
  .facts{display:grid;grid-template-columns:1fr 1fr;gap:16px 28px;margin:32px 0 0;}
  .fact small{display:block;font-size:11px;color:#918d86;margin-bottom:7px;letter-spacing:.02em;}
  .fact b{font-size:16px;font-weight:500;line-height:1.55;}
  .fact b.mono,.hash-cell{font-family:"SFMono-Regular","IBM Plex Mono",Consolas,monospace;
          font-size:11px;font-weight:400;line-height:1.65;word-break:break-all;}
  .sign{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;margin-top:50px;}
  .sign small{display:block;color:#918d86;font-size:10px;margin-bottom:5px;}
  .sign .who{font-size:15px;line-height:1.4;}
  .seal{width:60px;height:60px;border-radius:50%;border:1px solid #dfb4a3;color:#aa573d;
        display:grid;place-items:center;text-align:center;font-weight:600;font-size:12px;line-height:1.35;}
  .seal.sq{border-radius:3px;}
  .seal i{font-style:normal;display:block;}
  .note{font-size:12px;line-height:1.85;color:#918d86;margin:30px 0 0;border-top:1px solid #ebe8e2;padding-top:18px;}
  /* 打印时同样限宽居中：给纸张留对称的页边距，而不是一侧贴边、一侧空一大块 */
  @media print { body{margin:14mm auto;} }
</style></head><body>

<div class="head">
  <div class="licensor">${esc(licensor)}</div>
  ${site ? `<div class="site">${esc(site)}</div>` : ""}
</div>

<h1>字体授权书</h1>
<div class="sub">${esc(licenseSubLine(d))}</div>

<hr>

<p class="body">${esc(licenseParagraph(d))}</p>

<div class="facts">
${fieldRows}
</div>

${licenseScopeText(d.licenseType) ? `<div class="sec">
  <div class="sec-t">授权范围 · ${esc(licenseTypeLabel(d.licenseType))}</div>
  <p class="sec-p">${esc(licenseScopeText(d.licenseType))}</p>
</div>` : ""}

<div class="sign">
  <div>
    <small>授权方</small>
    <div class="who">${esc(signatureLine(d.licensor))}</div>
    <div class="sub" style="margin-top:6px">${esc(d.issuedAt || DASH)}</div>
  </div>
  ${sealHtml}
</div>

<div class="note">${esc(licenseFooter())}</div>
</body></html>`;
}

/** 打开授权书打印窗口（用户可「另存为 PDF」） */
export function printLicenseHtml(html: string): void {
  const win = window.open("", "_blank", "width=760,height=900");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}
