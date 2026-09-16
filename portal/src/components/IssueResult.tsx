/**
 * 签发结果块 —— 完成态线性呈现（字体库页与订单页共用）
 *
 * 规格语言：不用描边纸卡；标题规线分区 + 动作行 + 双哈希短截。
 * e2e 依赖文案：签发完成 / 个字形 / 水印版 SHA-256 / 下载水印字体 / 下载交付包。
 */

import { downloadBytes, buildLicenseHtml, printLicenseHtml } from "../lib/issuer";
import { buildDeliveryZip } from "../lib/delivery";
import type { IssueOutcome } from "../lib/issueFlow";
import { IconPrint } from "./Icon";

export default function IssueResult({ outcome }: { outcome: IssueOutcome }) {
  const { sign, orderId, fontName, clientRef, licenseType, issuedAt } = outcome;

  const downloadFont = () => {
    downloadBytes(sign.fontBytes, `${orderId}_watermarked.ttf`, "font/ttf");
  };

  /** 交付包：水印字体 + 授权书 + 使用说明 + 指纹，一次下载齐全 */
  const downloadPackage = () => {
    const zip = buildDeliveryZip({
      orderId, fontName, clientRef, licenseType, issuedAt,
      fontSha256: sign.fontSha256,
      watermarkedSha256: sign.watermarkedSha256,
      nModified: sign.nModified,
      watermarkedFont: sign.fontBytes,
    });
    downloadBytes(zip, `${orderId}_交付包.zip`, "application/zip");
  };

  const printLicense = () => {
    const html = buildLicenseHtml({
      orderId, fontName, clientRef, licenseType,
      fontSha256: sign.fontSha256,
      watermarkedSha256: sign.watermarkedSha256,
      issuedAt,
    });
    printLicenseHtml(html);
  };

  return (
    <div className="issue-done">
      <div className="issue-done-head">
        <h3 className="issue-done-title"><span className="ok">✓</span> 签发完成</h3>
        <span className="issue-done-id mono">{orderId}</span>
      </div>

      <div className="issue-done-actions">
        <button className="btn btn-primary btn-md" onClick={downloadPackage}>下载交付包 (.zip)</button>
        <button className="btn btn-outline btn-md" onClick={downloadFont}>下载水印字体 (.ttf)</button>
        <button className="btn btn-outline btn-md" onClick={printLicense}>
          <IconPrint size={14} />打印 / 另存 PDF
        </button>
      </div>

      <div className="issue-done-meta">
        交付包含水印字体、授权书、使用说明与签发指纹。已修改 <b>{sign.nModified}</b> 个字形，水印版 SHA-256 已回执云端
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
