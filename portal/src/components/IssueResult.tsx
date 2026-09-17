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
import { buildDeliveryZip, licenseDataOf, type DeliveryMeta } from "../lib/delivery";
import { readFoundry } from "../lib/foundry";
import type { IssueOutcome } from "../lib/issueFlow";

/** 由 outcome 推出交付所需的 meta（本组件与 IssueDeliveries 共用同一份推导） */
function useDelivery(outcome: IssueOutcome) {
  const { orderId, fontName, clientRef, licenseType, licenseStart, licenseEnd, amount, issuedAt, sign } = outcome;
  /** 授权方读本机厂牌（写进授权书抬头 / 落款 / 印章）；签发过程中不会变，读一次即可 */
  const licensor = useMemo(() => readFoundry(), []);
  const meta: DeliveryMeta = {
    orderId, fontName, clientRef, licenseType, licenseStart, licenseEnd, licensor, amount, issuedAt,
    fontSha256: sign.fontSha256,
    watermarkedSha256: sign.watermarkedSha256,
    nModified: sign.nModified,
    watermarkedFont: sign.fontBytes,
  };
  return {
    sign,
    downloadFont: () => downloadBytes(sign.fontBytes, `${orderId}_watermarked.ttf`, "font/ttf"),
    /** 交付包：水印字体 + 授权书 + 使用说明 + 指纹，一次下载齐全 */
    downloadPackage: () => downloadBytes(buildDeliveryZip(meta), `${orderId}_交付包.zip`, "application/zip"),
    printLicense: () => printLicenseHtml(buildLicenseHtml(licenseDataOf(meta))),
  };
}

/**
 * 交付动作 —— 放在授权书右上角的过程槽里（完成态）。
 * 形态是下划线式链接而非按钮块：纸面上放按钮会立刻不像文书。
 */
export function IssueDeliveries({ outcome }: { outcome: IssueOutcome }) {
  const { downloadFont, downloadPackage, printLicense } = useDelivery(outcome);
  return (
    <>
      <button className="proc-a" onClick={downloadPackage}>下载交付包 (.zip)</button>
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
