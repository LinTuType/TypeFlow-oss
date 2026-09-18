/**
 * 交付邮件（mailto）—— 由**本机邮件客户端**发出，不经过任何服务器
 *
 * 数据边界：这里只拼一段 `mailto:` 链接交给操作系统。浏览器把收件人、主题、正文
 * 递给本机邮件程序，中途没有任何服务端参与 —— 与「字体全程不出本机」是同一件事的两个面：
 * 邮件正文里只有客户本来就该知道的信息（订单号、字体名、授权范围、期限、费用），
 * 不含哈希、不含技术实现细节（授权书的读者是采购 / 法务 / 财务，不看这些）。
 *
 * ⚠️ 两件必须记住的限制：
 *   ① `mailto:` **不能带附件** —— 浏览器协议层就不允许。所以由调用方在打开邮件之前
 *      先把交付包下载下来（文件就落在用户的下载目录里，拖进邮件即可），正文里也点名了
 *      该附哪个文件。
 *   ② URL 长度有实际上限：中文经 encodeURIComponent 后每个字占 9 个字符，正文一长
 *      就可能被邮件客户端截断成半截。所以正文刻意写得很短，并留了一个精简版本兜底
 *      （见 buildDeliveryMail / mailtoUrl）。
 */

import { deliveryPackageName, watermarkedFontName } from "./delivery";
import { licenseTermText, licenseTypeLabel, type LicenseData } from "./license";
import { signatureLine, type Foundry } from "./foundry";

/**
 * 拼一封邮件所需的最少信息。
 * ⚠️ 不含客户名与收件人：客户名是授权书抬头的事（文书正文里已有），
 * 收件人由调用方按本机客户库补进来（见 deliveryMailto）。DeliveryMeta 结构上兼容，可直接传。
 */
export interface MailMeta {
  orderId: string;
  fontName: string;
  licenseType: string;
  licenseStart?: number;
  licenseEnd?: number;
  amount?: string;
  licensor: Foundry;
  issuedAt: string;
}

export interface DeliveryMail {
  /** 收件人（客户邮箱；空串 = 邮箱留空，由用户自己填） */
  to: string;
  subject: string;
  /** 完整正文 */
  body: string;
  /** 精简正文 —— 仅当完整版 URL 过长时改用（宁可少两行说明，也不能被客户端截断） */
  bodyShort: string;
}

/**
 * mailto URL 的安全上限。
 * 各客户端不一（旧版 Windows 邮件客户端 2048 字符就开始截），这里取 1800 留余量。
 */
const URL_SAFE_MAX = 1800;

/**
 * 生成交付邮件的三个字段 —— **文案唯一来源**（签发页与订单页都调它）。
 *
 * 写法遵守既定口径：只写有什么，不写没有什么（「附件是哪个文件」要写，
 * 「云端没有记录」这类否定式后缀不写）；正文里不出现哈希与技术实现。
 */
export function buildDeliveryMail(meta: MailMeta): DeliveryMail {
  const zip = deliveryPackageName(meta.orderId);
  const fontFile = watermarkedFontName(meta.fontName, meta.orderId);

  /* 有序信息行：客户核对全靠这几行。
     两条可有可无的行按「有才写」处理 —— 老订单（本机关联里没有授权方案）与免填费用
     不该在邮件里留下「授权版本：—」这种占位。 */
  const typeLabel = meta.licenseType.trim() ? licenseTypeLabel(meta.licenseType) : "";
  const facts = [
    `订单号：${meta.orderId}`,
    `授权字体：${meta.fontName}`,
    ...(typeLabel ? [`授权版本：${typeLabel}`] : []),
    `授权期限：${licenseTermText(meta)}`,
    ...(meta.amount && meta.amount.trim() ? [`授权费用：¥ ${meta.amount.trim()}`] : []),
    `签发时间：${meta.issuedAt}`,
  ].join("\n");

  const tail = `\n\n${signatureLine(meta.licensor)}`;
  // 附件说明点名具体文件名：点发信之前交付包已自动下载，用户只需把它拖进邮件
  const head = `您好：\n\n随信附上本次字体授权的交付文件，附件为 ${zip}，内含水印字体 ${fontFile}、`
    + "字体授权书与使用说明。";

  return {
    to: "",   // 收件人不在这里决定 —— 由调用方给（deliveryMailto 的第二个参数）
    subject: `字体授权交付 · ${meta.orderId} · ${meta.fontName}`,
    body: `${head}\n\n${facts}${tail}`,
    bodyShort: `您好：\n\n附件为本次字体授权的交付文件 ${zip}。\n\n${facts}${tail}`,
  };
}

/** 把三个字段拼成 mailto 链接（收件人可空；邮箱是 ASCII 安全字符，不编码） */
export function mailtoUrl(m: DeliveryMail): string {
  const build = (body: string) =>
    `mailto:${m.to.trim()}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(body)}`;
  const full = build(m.body);
  return full.length <= URL_SAFE_MAX ? full : build(m.bodyShort);
}

/**
 * 带收件人的一版（签发页 / 订单页都用它）。
 * 邮箱来自本机客户库，云端不存 —— 取不到就留空，用户在邮件里自己填。
 */
export function deliveryMailto(meta: MailMeta, to?: string): { url: string; mail: DeliveryMail } {
  const base = buildDeliveryMail(meta);
  const mail: DeliveryMail = { ...base, to: (to ?? "").trim() };
  return { url: mailtoUrl(mail), mail };
}

/** 授权书数据 → 邮件 meta（订单页手上只有一份 LicenseData 时用） */
export function mailMetaOf(license: LicenseData): MailMeta {
  return {
    orderId: license.orderId,
    fontName: license.fontName,
    licenseType: license.licenseType,
    licenseStart: license.licenseStart,
    licenseEnd: license.licenseEnd,
    amount: license.amount,
    licensor: license.licensor,
    issuedAt: license.issuedAt,
  };
}
