/**
 * 追溯报告 · 打印出口（独立 HTML，浏览器打印 → 另存 PDF）
 *
 * 与屏幕出口（components/TraceReport.tsx）吃同一份数据——TraceRecord。
 * 修复的欠账（§2.4 B-1）：页面文案叫用户「原始文件与分析报告一并保存」，
 * 但报告根本没法导出。现在报告号在分析时落库，这份 HTML 可以直接归档。
 *
 * 判定卡配色沿用屏幕同一套语义（绿=高可信 / 黄=存疑 / 灰=无法确认）。
 */

import { channelScores, type TraceRecord } from "./traceHistory";
import { printLicenseHtml } from "./license";

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const fmtSize = (n: number) =>
  n ? (n / 1024 / 1024 >= 1 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`) : "—";
const fmtTime = (t: number) => new Date(t).toLocaleString("zh-CN");

/* 与屏幕出口（TraceReport.tsx）同一套门户规格色 */
const VERDICT_COLOR: Record<string, { bg: string; border: string; fg: string }> = {
  high: { bg: "#eef3ef", border: "#597060", fg: "#597060" },
  trusted: { bg: "#f1f4ef", border: "#7a8f74", fg: "#597060" },
  suspicious: { bg: "#faf5ea", border: "#B8954A", fg: "#8b6511" },
  none: { bg: "#f5f3ee", border: "#d8d3cb", fg: "#67645f" },
};

export function buildTraceReportHtml(rec: TraceRecord): string {
  const best = rec.candidates.find((c) => c.orderId === rec.bestOrderId) ?? rec.candidates[0] ?? null;
  const others = rec.candidates.filter((c) => c !== best);
  const vc = VERDICT_COLOR[best?.level ?? "none"] ?? VERDICT_COLOR.none;
  const cs = best ? channelScores(best) : null;

  const sub = !best
    ? "没有可用的比对结果。"
    : best.level === "high"
      ? `可疑字体与订单 ${esc(best.orderId)} 的水印指纹完全吻合，可确认签发来源`
      : best.level === "trusted"
        ? `水印指纹与订单 ${esc(best.orderId)} 高度一致，检测到轻度干扰，来源基本可靠`
        : best.level === "suspicious"
          ? `水印指纹与订单 ${esc(best.orderId)} 部分吻合，但存在明显干扰，无法确证`
          : "未识别出可靠的所属订单";

  const chips = (best?.labels ?? []).map((l) => `<span class="chip">${esc(l)}</span>`).join("");

  const channelRow = (icon: string, name: string, desc: string, val: string, valDesc: string, ok: boolean) => `
    <div class="ch">
      <span class="ch-ic">${icon}</span>
      <div><b>${name}</b><p>${desc}</p></div>
      <div><b class="mono">${esc(val)}</b><p>${valDesc}</p></div>
      <span class="sig${ok ? "" : " warn"}">${esc(val)}</span>
    </div>`;

  const channels = `
    ${channelRow("✓", "Name256 自证", "可疑字体内部嵌入的名称表声明",
      rec.selfClaimOrder ?? "无自证",
      rec.selfClaimOrder ? (best && best.orderId === rec.selfClaimOrder ? "与命中订单一致" : "与命中订单不符") : "该文件未嵌入自证信息",
      !!rec.selfClaimOrder)}
    ${channelRow("A", "通道 A · 位移表决", "锚定字形位移的多数投票",
      cs?.a ?? "—", "表决序列与预期位比对（命中/有效）", !!cs?.aOk)}
    ${channelRow("B", "通道 B · 置换方向", "配对字形左右换位的方向采样",
      cs?.b ?? "—", "方向与预期一致的采样 / 有效采样", !!cs?.bOk)}`;

  const candidate = best
    ? `<div class="cand">
        <div class="cand-main">
          <div><h4>${esc(best.orderId)}</h4><p class="mono">判定「${esc(best.levelLabel)}」 · 置信度 ${esc(best.score)}%</p></div>
          <div class="cand-score">${esc(best.score)}<small>综合一致性 / 100</small></div>
        </div>
      </div>
      ${others.length ? `<div class="others">${others.map((o) =>
        `<div><span class="mono">${esc(o.orderId)}</span><span>判定「${esc(o.levelLabel)}」 · ${esc(o.score)}%</span></div>`).join("")}</div>` : ""}`
    : "";

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>追溯报告 ${esc(rec.reportNo)}</title>
<style>
  body{font-family:"Songti SC","STSong","SimSun",serif;color:#34322e;background:#fff;
       margin:44px 48px;line-height:1.75;font-size:13.5px;
       -webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .mono{font-family:"SFMono-Regular","IBM Plex Mono",Consolas,monospace;font-size:11px;}
  .rid{font-family:"SFMono-Regular","IBM Plex Mono",Consolas,monospace;font-size:11px;color:#918d86;margin-bottom:10px;}
  h1{font-size:26px;font-weight:600;margin:0 0 6px;}
  .desc{color:#67645f;margin:0 0 26px;}
  .verdict{border:1px solid ${vc.border};background:${vc.bg};border-radius:8px;padding:20px 22px;margin:0 0 22px;}
  .verdict small{display:block;font-size:11px;color:${vc.fg};letter-spacing:.08em;margin-bottom:8px;}
  .verdict h2{margin:0 0 8px;font-size:18px;font-weight:600;}
  .verdict p{margin:0;color:#4b4a47;font-size:12.5px;}
  .chip{display:inline-block;font-size:10.5px;padding:2px 9px;border-radius:999px;
        border:1px solid #d8d3cb;background:#fff;color:#555;margin:8px 6px 0 0;}
  table{width:100%;border-collapse:collapse;margin:0 0 26px;}
  td{border-bottom:1px solid #ebe8e2;padding:8px 0;vertical-align:top;font-size:12.5px;}
  tr:first-child td{border-top:1px solid #ebe8e2;}
  td.k{width:140px;color:#918d86;font-size:12px;}
  h3{font-size:15px;font-weight:600;margin:26px 0 10px;padding-bottom:6px;border-bottom:1px solid #ebe8e2;}
  .ch{display:grid;grid-template-columns:26px 1.3fr 1.4fr .6fr;gap:12px;align-items:center;
      padding:11px 0;border-bottom:1px solid #ebe8e2;}
  .ch b{font-size:12.5px;font-weight:600;}
  .ch p{margin:2px 0 0;color:#918d86;font-size:10.5px;}
  .ch-ic{width:24px;height:24px;border-radius:6px;background:#e9edf3;color:#102d50;
         display:grid;place-items:center;font-size:11px;font-weight:600;}
  .sig{justify-self:end;font-size:10.5px;color:#2e6b38;background:#eef6ee;padding:3px 8px;border-radius:999px;}
  .sig.warn{color:#8b6511;background:#fdf6e7;}
  .cand{border:1px solid #ebe8e2;border-radius:8px;overflow:hidden;}
  .cand-main{display:flex;justify-content:space-between;align-items:center;gap:18px;padding:16px 18px;}
  .cand h4{margin:0 0 4px;font-size:15px;}
  .cand p{margin:0;color:#918d86;}
  .cand-score{font-family:"SFMono-Regular","IBM Plex Mono",Consolas,monospace;font-size:24px;color:#102d50;text-align:right;}
  .cand-score small{display:block;font-size:9.5px;color:#918d86;margin-top:3px;}
  .others{border-top:1px solid #ebe8e2;padding:10px 18px;}
  .others>div{display:flex;justify-content:space-between;padding:5px 0;font-size:11.5px;color:#67645f;}
  .files{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
  .file{border:1px solid #ebe8e2;border-radius:8px;padding:14px 16px;}
  .file h4{margin:0 0 10px;font-size:13.5px;}
  .file div{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-top:1px solid #ebe8e2;font-size:11.5px;}
  .file div:first-of-type{border-top:0;}
  .file span{color:#918d86;}
  .note{font-size:11px;color:#918d86;margin-top:34px;border-top:1px solid #ebe8e2;padding-top:10px;}
  @media print { body{margin:12mm 14mm;} }
</style></head><body>

<div class="rid">${esc(rec.reportNo)} · ${rec.matched ? "已完成" : "未命中"}</div>
<h1>追溯报告</h1>
<p class="desc">对可疑字体与原版字体的结构差异、水印信号和签发记录进行联合分析。</p>

<div class="verdict">
  <small>${esc(best?.levelLabel ?? "无法判定")}${rec.bestOrderId ? ` · 源自 ${esc(rec.bestOrderId)}` : ""}</small>
  <h2>${sub}</h2>
  <p>${best ? `置信度 ${esc(best.score)}%。` : ""}${rec.matched
    ? "建议将本报告、原始文件和对应订单证据包一并归档。"
    : " 结果仅用于辅助判断。"}</p>
  <div>${chips}</div>
</div>

<table>
  <tbody>
    <tr><td class="k">分析时间</td><td>${esc(fmtTime(rec.createdAt))}</td></tr>
    <tr><td class="k">分析方式</td><td>本地联合检测（字体不出本机，云端只收哈希与订单号）</td></tr>
    <tr><td class="k">自证订单</td><td class="mono">${esc(rec.selfClaimOrder ?? "无")}</td></tr>
    <tr><td class="k">报告状态</td><td>${rec.matched ? "分析完成（命中）" : "未命中"}</td></tr>
  </tbody>
</table>

<h3>检测通道</h3>
${channels}

${best ? `<h3>最可能的签发订单</h3>${candidate}` : ""}

<h3>文件核验</h3>
<div class="files">
  <div class="file"><h4>原版字体</h4>
    <div><span>文件名</span><b>${esc(rec.origName || "—")}</b></div>
    <div><span>文件大小</span><b>${esc(fmtSize(rec.origSize))}</b></div>
    <div><span>SHA-256</span><b class="mono" style="word-break:break-all">${esc(rec.origSha256 || "—")}</b></div>
  </div>
  <div class="file"><h4>可疑字体</h4>
    <div><span>文件名</span><b>${esc(rec.suspName || "—")}</b></div>
    <div><span>文件大小</span><b>${esc(fmtSize(rec.suspSize))}</b></div>
    <div><span>SHA-256</span><b class="mono" style="word-break:break-all">${esc(rec.suspSha256 || "—")}</b></div>
  </div>
</div>

<div class="note">本报告由「文镇 TypeFlow」在你的浏览器本地生成（${esc(rec.reportNo)}）；字体文件未经第三方服务器处理，
云端仅按原版哈希返回候选订单并下发签发配方种子，比对全部在本机完成。追溯结果用于辅助判断，证明力由有权机关依法认定。</div>
</body></html>`;
}

/** 打开追溯报告打印窗口（另存为 PDF） */
export function printTraceReport(rec: TraceRecord): void {
  printLicenseHtml(buildTraceReportHtml(rec));
}
