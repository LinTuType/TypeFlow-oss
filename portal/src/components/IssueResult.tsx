/**
 * 签发结果块 —— 完成态线性呈现（字体库页与订单页共用）
 *
 * 规格语言：不用描边纸卡；标题规线分区 + 动作行 + 双哈希短截。
 * 授权书与交付包的数据都来自 lib/license.ts 那一份 model（一个出口是屏幕上的
 * LicensePaper，另一个出口就是这里的 HTML）。
 *
 * ⚠️ 交付动作（下载交付包 / 水印字体 / 打印）已抽成 `IssueDeliveries`，
 * 由授权书右上角的过程槽渲染 —— 签发完后下载入口就在文书上，不再另开一块。
 * 本组件只剩摘要（签发完成 / 字形数 / 双哈希）。
 *
 * e2e 依赖文案：签发完成 / 个字形 / 水印版 SHA-256 / 下载水印字体 / 下载交付包。
 */

import { useMemo } from "react";
import { downloadBytes } from "../lib/issuer";
import { buildLicenseHtml, printLicenseHtml } from "../lib/license";
import {
  buildDeliveryZip, deliveryPackageName, fontFileExt, fontFileMime, licenseDataOf, watermarkedFontName,
  type DeliveryMeta,
} from "../lib/delivery";
import { deliveryMailto } from "../lib/mailto";
import { readFoundry } from "../lib/foundry";
import type { IssueOutcome } from "../lib/issueFlow";

/** 由 outcome 推出交付所需的 meta（本组件与 IssueDeliveries 共用同一份推导） */
function useDelivery(outcome: IssueOutcome) {
  const {
    orderId, fontName, clientRef, clientEmail, licenseType, licenseStart, licenseEnd, amount, issuedAt, sign,
  } = outcome;
  /** 授权方读本机厂牌（写进授权书抬头 / 落款 / 印章）；签发过程中不会变，读一次即可 */
  const licensor = useMemo(() => readFoundry(), []);
  const meta: DeliveryMeta = {
    orderId, fontName, clientRef, licenseType, licenseStart, licenseEnd, licensor, amount, issuedAt,
    fontSha256: sign.fontSha256,
    watermarkedSha256: sign.watermarkedSha256,
    nModified: sign.nModified,
    watermarkedFont: sign.fontBytes,
  };
  /** 交付物的扩展名按**水印字体字节**判定：OTF 就交 OTF，不改名叫 .ttf */
  const fontExt = fontFileExt(sign.fontBytes);
  /** 交付邮件：收件人取客户库里的邮箱（签发时带过来的），客户端缺就留空自己填 */
  const { url: mailUrl } = deliveryMailto({ ...meta, fontExt }, clientEmail);
  return {
    sign,
    mailUrl,
    /** 文件名 = 原版字体名 + 订单号（与交付包内那份逐字一致，见 lib/delivery.ts） */
    downloadFont: () =>
      downloadBytes(sign.fontBytes, watermarkedFontName(fontName, orderId, fontExt), fontFileMime(fontExt)),
    /** 交付包：水印字体 + 授权书 + 使用说明 + 指纹，一次下载齐全 */
    downloadPackage: () => downloadBytes(buildDeliveryZip(meta), deliveryPackageName(orderId), "application/zip"),
    printLicense: () => printLicenseHtml(buildLicenseHtml(licenseDataOf(meta))),
  };
}

/**
 * 交付动作 —— 放在授权书右上角的过程槽里（完成态）。
 * 形态是下划线式链接而非按钮块：纸面上放按钮会立刻不像文书。
 *
 * 动作分两行排，是**按 200px 固定槽宽算出来的**（.paper-top 的第二列写死 200px，
 * 槽高 48px 且 overflow:hidden —— 多出一行会被直接裁掉）：
 *   第一行 下载交付包 ∥ 邮件发给客户   ≈158px（两个都是「把交付物送出去」的一级动作）
 *   第二行 下载水印字体 · 打印授权书   ≈133px
 * 所以「下载交付包」去掉了 (.zip) 后缀 —— 腾出的宽度正好容纳邮件入口。
 */
export function IssueDeliveries({ outcome }: { outcome: IssueOutcome }) {
  const { downloadFont, downloadPackage, printLicense, mailUrl } = useDelivery(outcome);
  return (
    <>
      <div className="proc-a-row">
        <button className="proc-a" onClick={downloadPackage}>下载交付包</button>
        {/* 点它的顺序是「先下载、再开邮件」：mailto 协议带不了附件，所以让交付包先落到
            用户的下载目录里，邮件正文里点名了该拖哪个文件进去。不 preventDefault ——
            由浏览器自己走 mailto 导航，比 location.href 稳（用户手势在手）。 */}
        <a className="proc-a" href={mailUrl} onClick={downloadPackage}>邮件发给客户 ↗</a>
      </div>
      <div className="proc-a2">
        <button onClick={downloadFont}>下载水印字体</button>
        <span className="proc-sep">·</span>
        <button onClick={printLicense}>打印授权书</button>
      </div>
    </>
  );
}

export default function IssueResult({ outcome }: { outcome: IssueOutcome }) {
  const { orderId } = outcome;
  const { sign } = useDelivery(outcome);

  return (
    <div className="issue-done">
      <div className="issue-done-head">
        <h3 className="issue-done-title"><span className="ok">✓</span> 签发完成</h3>
        <span className="issue-done-id mono">{orderId}</span>
      </div>

      <div className="issue-done-meta">
        交付包含水印字体、授权书、使用说明与签发指纹（下载入口在右侧授权书右上角）。已修改 <b>{sign.nModified}</b> 个字形，水印版 SHA-256 已回执云端
      </div>
      <div className="issue-done-sha mono">
        <span>原版 SHA-256</span>
        <span>{sign.fontSha256.slice(0, 24)}…</span>
        <span>水印 SHA-256</span>
        <span>{sign.watermarkedSha256.slice(0, 24)}…</span>
      </div>
    </div>
  );
}
