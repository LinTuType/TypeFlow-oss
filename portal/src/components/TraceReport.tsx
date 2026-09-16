/**
 * 追溯报告 —— 原型 v9「追溯报告」版式（report-head / verdict / report-meta /
 * channel-list / candidate / file-compare 全部用原型类名）
 *
 * 纯展示组件：数据来自 fullTrace() 的 FullTraceOutcome，不做任何联网。
 */

import type { FullTraceOutcome } from "../lib/trace";
import type { TraceResult, TraceVerdict } from "@engine/trace";
import { BadgeCheck, CheckCircle, ShieldCheck, AlertTriangle, XCircle, Binary, ScanLine, GitCompare } from "lucide-react";

/** 通道 A：与预期 20 bit 的命中数 / 有效位数（引擎表决输出） */
function channelAScore(r: TraceResult): { text: string; ok: boolean } {
  if (!r.channelA_total) return { text: "—", ok: false };
  const text = `${r.channelA_matches}/${r.channelA_total}`;
  return { text, ok: r.channelA_matches / r.channelA_total >= 0.85 };
}

/** 通道 B：方向与预期一致的采样数 / 有效采样数 */
function channelBScore(r: TraceResult): { text: string; ok: boolean } {
  if (!r.channelB_total) return { text: "—", ok: false };
  const text = `${r.channelB_matches}/${r.channelB_total}`;
  return { text, ok: r.channelB_matches / r.channelB_total >= 0.85 };
}

/** 判定卡配色与图标（对齐桌面版 TraceFont 置信度结论卡） */
function verdictStyle(level: TraceVerdict["level"]): {
  bg: string; border: string; iconBg: string; color: string; icon: React.ReactNode;
} {
  switch (level) {
    case "high":
      return { bg: "#F0F8F0", border: "#4CAF50", iconBg: "#E8F5E9", color: "#2E7D32", icon: <CheckCircle size={24} color="#2E7D32" /> };
    case "trusted":
      return { bg: "#F5F9F0", border: "#8BC34A", iconBg: "#F1F8E9", color: "#558B2F", icon: <ShieldCheck size={24} color="#558B2F" /> };
    case "suspicious":
      return { bg: "#FFF8E7", border: "#B8954A", iconBg: "#FFF8E1", color: "#F57F17", icon: <AlertTriangle size={24} color="#F57F17" /> };
    default:
      return { bg: "var(--paper-100, #F5F3EE)", border: "var(--rule, #D5D2C8)", iconBg: "#FFEBEE", color: "#8b6511", icon: <XCircle size={24} color="#C62828" /> };
  }
}

/** 标签徽章配色（对齐桌面版 labels chip 映射） */
function labelChipStyle(l: string): React.CSSProperties {
  if (l === "字体完整" || l === "校验通过" || l === "多重验证一致" || l === "双通道交叉验证 ✓")
    return { background: "#E8F5E9", color: "#2E7D32" };
  if (l === "指纹完全吻合" || l === "指纹高度吻合" || l === "指纹吻合")
    return { background: "#E8F5E9", color: "#2E7D32" };
  if (l === "信号清晰") return { background: "#E8F5E9", color: "#2E7D32" };
  if (l === "指纹部分匹配" || l === "校验未通过" || l === "检测到均匀偏移干扰")
    return { background: "#FFF3E0", color: "#E65100" };
  if (l === "信号正常") return { background: "#F1F8E9", color: "#558B2F" };
  if (l === "Name 表缺失" || l === "信号模糊" || l === "水印无法识别")
    return { background: "#FFF0F0", color: "#C43A31" };
  return { background: "var(--paper-100, #F5F3EE)", color: "var(--ink-500, #555)" };
}

interface TraceReportProps {
  outcome: FullTraceOutcome;
  origSha: string;
  suspSha: string;
  origName?: string;
  suspName?: string;
  origSize?: number;
  suspSize?: number;
}

const fmtSize = (n: number) => (n ? (n / 1024 / 1024 >= 1 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`) : "—");
const shortSha = (s: string) => (s ? `${s.slice(0, 8)}…${s.slice(-6)}` : "—");

export default function TraceReport({ outcome, origSha, suspSha, origName, suspName, origSize, suspSize }: TraceReportProps) {
  const best = outcome.best;
  const hit = !!best?.matched;
  const timeStr = new Date().toLocaleString("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  const others = outcome.candidates.filter((c) => c !== best);

  return (
    <section>
      {/* 报告头（原型 report-head：报告号 + 标题 + 摘要说明） */}
      <div className="report-head">
        <div>
          <div className="report-id">TRACE-{timeStr.replace(/\D/g, "").slice(0, 8)} · {hit ? "已完成" : "未命中"}</div>
          <h1 className="title serif" style={{ fontSize: 32 }}>追溯报告</h1>
          <p className="desc">对可疑字体与原版字体的结构差异、水印信号和签发记录进行联合分析。</p>
        </div>
      </div>

      {/* 判定 + 元数据（判定文案对齐桌面版「水印追溯鉴定书」置信度结论卡） */}
      <div className="report-summary">
        {best && (() => {
          const v = best.result.verdict;
          const vs = verdictStyle(v.level);
          const sub =
            v.level === "high"
              ? <>可疑字体与订单 <span className="mono">{best.orderId}</span> 的水印指纹完全吻合，可确认签发来源</>
              : v.level === "trusted"
                ? <>水印指纹与订单 <span className="mono">{best.orderId}</span> 高度一致，检测到轻度干扰，来源基本可靠</>
                : v.level === "suspicious"
                  ? <>水印指纹与订单 <span className="mono">{best.orderId}</span> 部分吻合，但存在明显干扰，无法确证</>
                  : <>未识别出可靠的所属订单</>;
          return (
            <article className="verdict" style={{ background: vs.bg, borderColor: vs.border }}>
              <div className="verdict-top" style={{ color: vs.color }}>
                {vs.icon}
                {v.levelLabel}
                {hit && <span className="mono" style={{ fontSize: 13, color: "var(--ink-500, #555)", fontWeight: 400 }}>源自 {best.orderId}</span>}
              </div>
              <h2>{sub}</h2>
              <p>
                置信度 {v.score}% · {v.labels[0] ?? "—"} · {v.labels[1] ?? "—"} · {v.labels[2] ?? "—"}
                {hit ? "。建议将本报告、原始文件和对应订单证据包一并归档。" : " 结果仅用于辅助判断。"}
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                {v.labels.map((l, i) => (
                  <span key={i} style={{
                    ...labelChipStyle(l),
                    fontSize: 11, padding: "2px 8px", borderRadius: 999, border: "1px solid var(--rule, #D5D2C8)",
                  }}>{l}</span>
                ))}
              </div>
            </article>
          );
        })()}
        {!best && (
          <article className="verdict verdict-warn">
            <div className="verdict-top"><BadgeCheck size={18} />无法判定</div>
            <h2>没有可用的比对结果</h2>
            <p>没有候选订单或字体无法解析，无法形成判定。</p>
          </article>
        )}
        <aside className="report-meta">
          <div className="meta-line"><span>分析时间</span><b>{timeStr}</b></div>
          <div className="meta-line"><span>分析方式</span><b>本地联合检测</b></div>
          <div className="meta-line"><span>自证订单</span><b className="mono">{outcome.selfClaimOrder ?? "无"}</b></div>
          <div className="meta-line"><span>报告状态</span>
            <b style={{ color: hit ? "#216e39" : "#8b6511" }}>{hit ? "分析完成" : "未命中"}</b>
          </div>
        </aside>
      </div>

      {/* 检测通道（原型 channel-list 三行） */}
      <section className="report-section">
        <div className="report-section-head">
          <h3>检测通道</h3>
          <span className="meta">3 个通道已完成</span>
        </div>
        <div className="channel-list">
          <div className="channel">
            <span className="channel-icon"><Binary size={15} /></span>
            <div><b>Name256 自证</b><p>可疑字体内部嵌入的名称表声明</p></div>
            <div><b className="mono">{outcome.selfClaimOrder ?? "无自证"}</b>
              <p>{outcome.selfClaimOrder ? (best && best.orderId === outcome.selfClaimOrder ? "与命中订单一致" : "与命中订单不符") : "该文件未嵌入自证信息"}</p></div>
            <span className={`signal${outcome.selfClaimOrder ? "" : " warn"}`}>{outcome.selfClaimOrder ? "一致" : "无"}</span>
          </div>
          <div className="channel">
            <span className="channel-icon"><ScanLine size={15} /></span>
            <div><b>通道 A · 位移表决</b><p>锚定字形位移的多数投票</p></div>
            <div><b className="mono">{best ? channelAScore(best.result).text : "—"}</b>
              <p>表决序列与预期位比对（命中/有效）</p></div>
            <span className={`signal${best && channelAScore(best.result).ok ? "" : " warn"}`}>{best ? channelAScore(best.result).text : "—"}</span>
          </div>
          <div className="channel">
            <span className="channel-icon"><GitCompare size={15} /></span>
            <div><b>通道 B · 置换方向</b><p>配对字形左右换位的方向采样</p></div>
            <div><b className="mono">{best ? channelBScore(best.result).text : "—"}</b>
              <p>方向与预期一致的采样 / 有效采样</p></div>
            <span className={`signal${best && channelBScore(best.result).ok ? "" : " warn"}`}>{best && channelBScore(best.result).ok ? "方向一致" : "有修改"}</span>
          </div>
        </div>
      </section>

      {/* 最可能的签发订单（原型 candidate 卡） */}
      {best && (
        <section className="report-section">
          <div className="report-section-head">
            <h3>最可能的签发订单</h3>
            <span className="meta">按多通道一致性排序</span>
          </div>
          <article className="candidate">
            <div className="candidate-main">
              <div>
                <h4>{best.orderId}</h4>
                <p className="mono">判定「{best.result.verdict.levelLabel}」 · 置信度 {best.result.verdict.score}%</p>
              </div>
              <div className="candidate-score">
                {best.result.verdict.score}
                <small>综合一致性 / 100</small>
              </div>
              <div className="candidate-actions">
                <a className="btn secondary btn-md" href="/orders">查看订单</a>
              </div>
            </div>
            <div className="evidence">
              <div><small>通道 A 表决</small><b className="mono">{channelAScore(best.result).text}</b></div>
              <div><small>通道 B 方向</small><b className="mono">{channelBScore(best.result).text}</b></div>
              <div><small>判定</small><b>{best.matched ? "命中" : "仅候选"}</b></div>
            </div>
          </article>
          {others.length > 0 && (
            <div style={{ marginTop: 14 }}>
              {others.map((c) => (
                <div className="kv" key={c.orderId}>
                  <div className="kv-k mono">{c.orderId}</div>
                  <div className="kv-v mono">判定「{c.result.verdict.levelLabel}」 · {c.result.verdict.score}%</div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 文件核验（原型 file-compare 双卡） */}
      <section className="report-section">
        <div className="report-section-head">
          <h3>文件核验</h3>
          <span className="meta">摘要用于确认本次分析对象</span>
        </div>
        <div className="file-compare">
          <article className="file-card">
            <h4>原版字体</h4>
            <div className="file-line"><span>文件名</span><b>{origName ?? "—"}</b></div>
            <div className="file-line"><span>文件大小</span><b>{fmtSize(origSize ?? 0)}</b></div>
            <div className="file-line"><span>SHA-256</span><b className="hash-line">{shortSha(origSha)}</b></div>
          </article>
          <article className="file-card">
            <h4>可疑字体</h4>
            <div className="file-line"><span>文件名</span><b>{suspName ?? "—"}</b></div>
            <div className="file-line"><span>文件大小</span><b>{fmtSize(suspSize ?? 0)}</b></div>
            <div className="file-line"><span>SHA-256</span><b className="hash-line">{shortSha(suspSha)}</b></div>
          </article>
        </div>
      </section>
    </section>
  );
}
