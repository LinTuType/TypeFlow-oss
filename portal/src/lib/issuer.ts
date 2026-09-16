/**
 * 一体签发服务 —— 门户内直接完成「本地嵌入 → 下载水印 + 授权书」
 *
 * 流程（全部在本机浏览器完成，字体不离开设备）：
 *   1. 从本地字体库取字体 Bytes
 *   2. 云端签发配方（order_root）
 *   3. 引擎本地嵌入（纯 WebCrypto，零 node 依赖）
 *   4. 返回：水印 TTF bytes + Name256 内容
 *
 * 授权书由 buildLicenseHtml 生成 HTML，走 window.print() 存为 PDF（零依赖，中文正常）。
 */

import { embedWatermark } from "@engine/embed";
import { createWebCryptoProvider } from "@engine/crypto";

const provider = createWebCryptoProvider();

export interface SignResult {
  fontBytes: Uint8Array;         // 水印字体
  nModified: number;
  nameId256Text: string;
  orderId: string;
  fontSha256: string;
  watermarkedSha256: string;     // 水印字体 SHA-256（完成回执用）
}

/**
 * 本地嵌入：从本地字体库取字体 + order_root → 生成水印字体。
 * @param data 原版字体 ArrayBuffer（本地库取）
 * @param recipe 云端 issuance-recipe 返回的 recipe（含 order_root_hex）
 */
export async function localEmbed(
  data: ArrayBuffer,
  recipe: { order_root_hex: string; order_id: string; bits_suffix?: string },
): Promise<SignResult> {
  const orderRoot = new Uint8Array(
    recipe.order_root_hex.match(/.{2}/g)!.map((h) => parseInt(h, 16)),
  );
  const fontData = new Uint8Array(data);
  const result = await embedWatermark({
    fontData,
    orderRoot,
    provider,
    tenantId: "portal-local",
    orderId: recipe.order_id,
    bitsSuffix: recipe.bits_suffix ?? "",
  });
  // 本地计算水印字体哈希（完成回执 + 授权书用）
  const wmSha = await sha256Hex(result.bytes);
  return {
    fontBytes: result.bytes,
    nModified: result.nModified,
    nameId256Text: result.nameId256,
    orderId: recipe.order_id,
    fontSha256: result.selection.font_sha256,
    watermarkedSha256: wmSha,
  };
}

/** 计算 Uint8Array 的 SHA-256 hex（WebCrypto） */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 触发下载 Uint8Array 为文件 */
export function downloadBytes(bytes: Uint8Array, filename: string, mime = "application/octet-stream"): void {
  const copy = bytes.slice(); // 复制一份为 ArrayBuffer 视图，避免 SharedArrayBuffer 类型问题
  const blob = new Blob([copy.buffer as ArrayBuffer], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** 授权书 HTML（打印/保存 PDF 用；对齐桌面版授权书要素） */
export function buildLicenseHtml(opts: {
  orderId: string;
  fontName: string;
  clientRef: string;
  licenseType: string;
  fontSha256: string;
  watermarkedSha256: string;
  issuedAt: string;
}): string {
  const typeLabel =
    opts.licenseType === "enterprise" ? "企业商用版" :
    opts.licenseType === "personal_commercial" ? "个人商用版" : "个人版";
  const escaped = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>字体授权书</title>
<style>
  body{font-family:"Songti SC","STSong","SimSun",serif;color:#1a1a1a;margin:48px;line-height:1.8;font-size:14px;}
  .seal{color:#C43A31;font-size:13px;}
  h1{font-size:26px;text-align:center;letter-spacing:.2em;font-weight:600;margin-bottom:8px;}
  .sub{text-align:center;color:#6B6B6B;font-size:13px;margin-bottom:36px;}
  table{width:100%;border-collapse:collapse;margin:24px 0;}
  td{border:1px solid #d8d0c4;padding:8px 12px;}
  td.k{width:140px;background:#FBF7F0;color:#6B6B6B;font-size:13px;}
  .foot{margin-top:48px;text-align:right;color:#6B6B6B;font-size:12px;}
  .note{font-size:12px;color:#999;margin-top:40px;border-top:1px solid #d8d0c4;padding-top:8px;}
</style></head><body>
<h1>字体授权书</h1>
<div class="sub">Font License Certificate · ${escaped(opts.orderId)}</div>
<table>
  <tr><td class="k">订单号</td><td>${escaped(opts.orderId)}</td></tr>
  <tr><td class="k">字体名称</td><td>${escaped(opts.fontName)}</td></tr>
  <tr><td class="k">被授权方</td><td>${escaped(opts.clientRef || "（未署名）")}</td></tr>
  <tr><td class="k">授权版本</td><td>${escaped(typeLabel)}</td></tr>
  <tr><td class="k">签发时间</td><td>${escaped(opts.issuedAt)}</td></tr>
  <tr><td class="k">原版字体 SHA-256</td><td style="font-size:12px">${escaped(opts.fontSha256)}</td></tr>
  <tr><td class="k">水印字体 SHA-256</td><td style="font-size:12px">${escaped(opts.watermarkedSha256)}</td></tr>
</table>
<div>兹证明，本字体已由授权方依据订单 ${escaped(opts.orderId)} 完成唯一水印标识签发，用于 ${escaped(typeLabel)} 授权范围。如需验证来源，可通过追溯功能匹配订单。</div>
<div class="seal" style="margin-top:32px">文镇 TypeFlow · 本地签发（字体未经第三方服务器处理）</div>
<div class="note">本授权书由浏览器本地生成；水印字体经唯一订单密钥嵌入，可作为字体泄露溯源之依据。</div>
</body></html>`;
}

/** 打开授权书打印窗口（用户可"另存为 PDF"） */
export function printLicenseHtml(html: string): void {
  const win = window.open("", "_blank", "width=760,height=900");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}