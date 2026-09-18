/**
 * 交付包组装 —— 一次下载拿到「水印字体 + 授权书 + 使用说明 + 指纹」
 *
 * 为什么要有这个：之前签发结束只给一个 .ttf，客户拿到手不知道这字体什么授权、
 * 谁签的、怎么核对。打包成一份 zip 后，交付物是完整的、可存档的一组文件，
 * 也符合批次 4 的「交付物完整」退出条件。
 *
 * 全部在本机完成，不上传任何内容。授权书仍是 HTML（浏览器打印即存 PDF）。
 */

import { buildZip, type ZipEntry } from "./zip";
import { buildLicenseHtml, licenseTypeLabel, licenseTermText, type LicenseData } from "./license";
import { licensorTitle, signatureLine, type Foundry } from "./foundry";

export interface DeliveryMeta {
  orderId: string;
  fontName: string;
  clientRef: string;
  licenseType: string;
  /** 授权期限起止（ms）；都缺省 = 永久 */
  licenseStart?: number;
  licenseEnd?: number;
  /** 授权方（本机厂牌；写进授权书抬头 / 落款 / 印章） */
  licensor: Foundry;
  /** 授权费用（选填） */
  amount?: string;
  issuedAt: string;
  fontSha256: string;
  watermarkedSha256: string;
  nModified: number;
  watermarkedFont: Uint8Array;
}

/**
 * 水印字体的交付文件名 = **原版字体名 + 订单号**（用户口径 2026-09-18）。
 *
 * 为什么字体名放前面：拿到文件的先是客户。客户自己的字体文件夹里躺着几十个 ttf，
 * 「订单号_watermarked」对他是无意义的串；字体名在前，一眼认出是哪款字、哪一单，
 * 按名排序时同一款字的多单也自动聚在一起。订单号仍在名里 —— 追溯与核对不受影响。
 *
 * ⚠️ 这里是**唯一**的命名点：单文件下载、交付包内条目、使用说明里的核验命令
 * 都调它。改口径只改这一处（两个出口对不上，客户按说明书敲命令就会对不上文件名）。
 */
export function watermarkedFontName(fontName: string, orderId: string): string {
  return `${safeFileNamePart(fontName)}_${orderId}.ttf`;
}

/**
 * 文件名净化：字体名来自用户上传的文件名，什么都可能有。
 * 包内路径里出现「/」会被解压工具当成目录，Windows 下 `\ : * ? " < > |` 直接解压失败，
 * 首尾的空格/点在部分系统上会被悄悄吃掉（导致说明里的文件名与实际不符）。
 */
export function safeFileNamePart(name: string): string {
  const cleaned = (name || "")
    .replace(/[\\/:*?"<>|]/g, "_")     // 路径分隔符 + Windows 非法字符
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "")
    .slice(0, 80);                     // 抗超长文件名（字体名可能是整串代号）
  return cleaned || "字体";
}

/**
 * 交付包压缩文件的名字 —— 签发页下载、订单页重算、邮件正文里提到的都是它。
 * 包名是**授权方自己的归档物**，所以订单号在前（交付给客户的水印字体命名口径相反：字体名在前）。
 */
export function deliveryPackageName(orderId: string): string {
  return `${orderId}_交付包.zip`;
}

/** 组装授权书数据（交付包里的 HTML 与屏幕预览吃同一份） */
export function licenseDataOf(meta: DeliveryMeta): LicenseData {
  return {
    orderId: meta.orderId,
    fontName: meta.fontName,
    licensor: meta.licensor,
    licensee: meta.clientRef,
    licenseType: meta.licenseType,
    licenseStart: meta.licenseStart,
    licenseEnd: meta.licenseEnd,
    amount: meta.amount,
    issuedAt: meta.issuedAt,
    fontSha256: meta.fontSha256,
    watermarkedSha256: meta.watermarkedSha256,
  };
}

/** 使用说明（纯文本，客户/客户的设计师直接能读） */
export function usageText(meta: DeliveryMeta): string {
  const fontFile = watermarkedFontName(meta.fontName, meta.orderId);
  return `文镇 TypeFlow 交付包 · 使用说明
========================================

订单号：${meta.orderId}
字体名：${meta.fontName}
授权方：${licensorTitle(meta.licensor)}
被授权方：${meta.clientRef || "（未署名）"}
授权版本：${licenseTypeLabel(meta.licenseType)}
授权期限：${licenseTermText(meta)}
${meta.amount ? `授权费用：¥ ${meta.amount}\n` : ""}签发时间：${meta.issuedAt}

包含文件
----------------------------------------
1. ${fontFile}   已嵌入唯一水印的字体文件（安装即用）
2. 字体授权书.html                   授权书，可打印或另存为 PDF
3. 使用说明.txt                      本文件
4. 签发指纹.txt                      哈希清单，用于事后核对与追溯

怎么用
----------------------------------------
· 安装字体：Windows 双击 .ttf → 点「安装」；macOS 双击 → 点「安装字体」。
· 拿到 PDF 授权书：双击打开「字体授权书.html」，用浏览器打印（Cmd/Ctrl + P），
  在打印对话框里选择「另存为 PDF」。
· 存档建议：把整份 zip 和发票、合同存放在一起；授权书与订单号一一对应。

关于水印
----------------------------------------
· 字体中嵌入了与订单绑定的水印标识，不改变字体的正常显示与排版。
· 收到疑似外泄的字体文件时，可用「文镇 TypeFlow」的追溯功能比对来源。
· 字体文件本身不上传云端，云端只保存哈希值，用于核对签发记录。

核对指纹（可选）
----------------------------------------
在终端执行（macOS / Linux）：
  shasum -a 256 "${fontFile}"
Windows PowerShell：
  Get-FileHash ".\\${fontFile}" -Algorithm SHA256
结果应与「签发指纹.txt」中的水印字体 SHA-256 完全一致。
`;
}

/** 指纹清单（机器可读 + 人能看懂） */
export function fingerprintText(meta: DeliveryMeta): string {
  return `文镇 TypeFlow 签发指纹
========================================
订单号            ${meta.orderId}
字体名            ${meta.fontName}
授权方            ${signatureLine(meta.licensor)}
被授权方          ${meta.clientRef || "（未署名）"}
授权版本          ${licenseTypeLabel(meta.licenseType)}
授权期限          ${licenseTermText(meta)}
${meta.amount ? `授权费用          ¥ ${meta.amount}\n` : ""}签发时间          ${meta.issuedAt}
修改字形数        ${meta.nModified}

原版字体 SHA-256
  ${meta.fontSha256}

水印字体 SHA-256
  ${meta.watermarkedSha256}

说明：水印字体 SHA-256 已回执云端，作为该订单的完成凭据；如需验证字体来源，
可将文件哈希与上述值比对，或用追溯功能匹配订单。
`;
}

/**
 * 组装交付包字节。
 * 包内水印字体走 watermarkedFontName（字体名 + 订单号），多个订单混在一起时既能
 * 按字体归类、也能靠订单号分清；包的压缩文件本身用订单号命名。
 */
export function buildDeliveryZip(meta: DeliveryMeta): Uint8Array {
  const licenseHtml = buildLicenseHtml(licenseDataOf(meta));
  const enc = new TextEncoder();
  const entries: ZipEntry[] = [
    { name: watermarkedFontName(meta.fontName, meta.orderId), data: meta.watermarkedFont },
    { name: "字体授权书.html", data: enc.encode(licenseHtml) },
    { name: "使用说明.txt", data: enc.encode(usageText(meta)) },
    { name: "签发指纹.txt", data: enc.encode(fingerprintText(meta)) },
  ];
  return buildZip(entries);
}
