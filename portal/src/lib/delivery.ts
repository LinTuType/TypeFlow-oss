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
1. ${meta.orderId}_watermarked.ttf   已嵌入唯一水印的字体文件（安装即用）
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
  shasum -a 256 ${meta.orderId}_watermarked.ttf
Windows PowerShell：
  Get-FileHash .\\${meta.orderId}_watermarked.ttf -Algorithm SHA256
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
 * 文件名带订单号，避免多个订单的包混在一起时分不清。
 */
export function buildDeliveryZip(meta: DeliveryMeta): Uint8Array {
  const licenseHtml = buildLicenseHtml(licenseDataOf(meta));
  const enc = new TextEncoder();
  const entries: ZipEntry[] = [
    { name: `${meta.orderId}_watermarked.ttf`, data: meta.watermarkedFont },
    { name: "字体授权书.html", data: enc.encode(licenseHtml) },
    { name: "使用说明.txt", data: enc.encode(usageText(meta)) },
    { name: "签发指纹.txt", data: enc.encode(fingerprintText(meta)) },
  ];
  return buildZip(entries);
}
