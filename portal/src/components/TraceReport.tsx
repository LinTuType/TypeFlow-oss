/**
 * 追溯鉴定书 —— 屏幕出口（打印出口在 lib/traceReportHtml.ts，两者吃同一份记录）
 *
 * 版式向授权书看齐（2026-09-17 重设计）。原来的横排版式（判定两栏 / 通道 4 列 /
 * 文件比对双卡）需要约 900px 才舒服，挪进左栏（约 620px）必然挤压；授权书能立在窄栏里，
 * 是因为它从设计上就是单列纵排 —— 所以这里做的是「换轴」而不是「缩小」：
 *   判定卡 + 元数据两栏 → 判定句（正文 + 加粗结论）+ 标签 chip
 *   通道 4 列网格       → 规线列表（名称 + 说明 / 结论值）
 *   候选卡 + evidence   → 一行规线 + 一个动作链接
 *   文件核验双卡        → facts 两列
 * 彩色只留在 chip 上（浅底标签）；判定本身用文字，不用彩色块 —— 授权书全篇就是长这样。
 *
 * record = null 时渲染「空白鉴定书」（标题 + 编号占位 + 引导句）：纸面始终在场，
 * 不会在分析完成那一刻"突然冒出一大块"。
 *
 * 保留的测试锚点：.report-id（编号行）、[data-channel-a] / [data-channel-b]。
 */

import { Link } from "react-router-dom";
import type { TraceRecord, TraceRecordCandidate } from "../lib/traceHistory";
import { channelScores } from "../lib/traceHistory";
import ProcessSlot, { type PaperProcess } from "./ProcessSlot";

const fmtSize = (n: number) => (n ? (n / 1024 / 1024 >= 1 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`) : "—");
const fmtTime = (t: number) =>
  new Date(t).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const shortSha = (s: string) => (s ? `${s.slice(0, 8)}…${s.slice(-6)}` : "—");

/** 标签徽章配色（对齐桌面版 labels chip 映射）—— 文书里唯一的彩色，只作标签用 */
function labelChipStyle(l: string): React.CSSProperties {
  if (l === "字体完整" || l === "校验通过" || l === "多重验证一致" || l === "双通道交叉验证 ✓"
    || l === "指纹完全吻合" || l === "指纹高度吻合" || l === "指纹吻合" || l === "信号清晰")
    return { background: "#eef3ef", color: "#597060" };
  if (l === "信号正常") return { background: "#f1f4ef", color: "#597060" };
  if (l === "指纹部分匹配" || l === "校验未通过" || l === "检测到均匀偏移干扰")
    return { background: "#faf5ea", color: "#8b6511" };
  if (l === "Name 表缺失" || l === "信号模糊" || l === "水印无法识别")
    return { background: "#f7ebe6", color: "#aa573d" };
  return { background: "var(--subtle)", color: "var(--muted)" };
}

/** 判定 → 一句话结论（文书语言，不用卡片） */
function verdictSentence(best: TraceRecordCandidate | null) {
  const oid = (id: string) => <span className="mono">{id}</span>;
  if (!best) return <>未识别出可靠的所属订单。</>;
  if (best.level === "high")
    return <>与订单 {oid(best.orderId)} 的水印指纹完全吻合，可确认签发来源。</>;
  if (best.level === "trusted")
    return <>与订单 {oid(best.orderId)} 的水印指纹高度一致，检测到轻度干扰，来源基本可靠。</>;
  if (best.level === "suspicious")
    // 「存疑」档不点名订单号：这份文书是要交给法务/采购看的，写上真实客户的
    // 订单号等于对第三方做出未经证实的指控（候选里总有人得分最高）
    return <>检测到与某份签发记录的部分水印特征吻合，但存在明显干扰，无法确证所属订单——本报告不点名订单。</>;
  return <>未识别出可靠的所属订单。</>;
}

/** 空白鉴定书：未分析时的纸面（纸始终在场，不等到出结果才出现） */
function BlankPaper({ process }: { process?: PaperProcess }) {
  return (
    <div className="paper">
      <div className="paper-head">
        <div className="paper-licensor">本机联合检测</div>
        <div className="paper-licensor-site">字体文件不出本机</div>
      </div>
      <div className="paper-top">
        <div>
          <h2>字体溯源鉴定书</h2>
          <div className="paper-sub report-id mono">尚未分析</div>
        </div>
        {process && (
          <ProcessSlot lines={process.lines} done={process.done}>{process.actions}</ProcessSlot>
        )}
      </div>
      <hr className="rule" />
      <p className="paper-body">
        导入可疑字体与原版字体后开始分析。本机会比对结构差异、水印信号与签发记录，
        产出一份可归档的鉴定书；全部计算在本机完成，字体文件不会离开设备。
      </p>
      <div className="facts">
        <div className="fact"><small>原版字体</small><b className="trace-pending">待导入</b></div>
        <div className="fact"><small>可疑字体</small><b className="trace-pending">待导入</b></div>
      </div>
    </div>
  );
}

export default function TraceReport({ record, process }: {
  record: TraceRecord | null;
  /** 右上角过程槽（进行中逐行写下，完成后换成导出动作） */
  process?: PaperProcess;
}) {
  if (!record) return <BlankPaper process={process} />;

  const best = record.candidates.find((c) => c.orderId === record.bestOrderId) ?? record.candidates[0] ?? null;
  const hit = record.matched;
  const others = record.candidates.filter((c) => c !== best);
  const cs = best ? channelScores(best) : null;

  return (
    <div className="paper">
      <div className="paper-head">
        <div className="paper-licensor">本机联合检测</div>
        <div className="paper-licensor-site">字体文件不出本机</div>
      </div>

      {/* 标题 + 编号在左，过程槽在右（槽底边与编号行底边对齐；空闲时槽内为空） */}
      <div className="paper-top">
        <div>
          <h2>字体溯源鉴定书</h2>
          <div className="paper-sub report-id mono">{record.reportNo} · {hit ? "已完成" : "未命中"}</div>
        </div>
        {process && (
          <ProcessSlot lines={process.lines} done={process.done}>{process.actions}</ProcessSlot>
        )}
      </div>

      <hr className="rule" />

      <p className="paper-body">
        本鉴定书对「{record.suspName || "可疑字体"}」与「{record.origName || "原版字体"}」
        的结构差异、水印信号与签发记录进行联合分析。全部计算在本机完成，字体文件未离开设备。
      </p>

      <p className="trace-verdict">判定：{verdictSentence(best)}</p>

      {best && (
        <div className="trace-chips">
          {best.labels.map((l, i) => (
            <span key={i} className="trace-chip" style={labelChipStyle(l)}>{l}</span>
          ))}
        </div>
      )}
      {/* 通道计数供 aria / 测试锚点使用（与检测通道区同源） */}
      <span className="mono" data-channel-a={cs?.a ?? ""} data-channel-b={cs?.b ?? ""} style={{ display: "none" }} />

      <div className="trace-sec">
        <div className="trace-sec-t">分析事实</div>
        <div className="facts">
          <div className="fact"><small>分析时间</small><b>{fmtTime(record.createdAt)}</b></div>
          <div className="fact"><small>分析方式</small><b>本地联合检测</b></div>
          <div className="fact"><small>自证订单</small><b className="mono hash-cell">{record.selfClaimOrder ?? "无"}</b></div>
          <div className="fact"><small>综合置信度</small><b>{best ? `${best.score}%` : "—"}</b></div>
        </div>
      </div>

      <div className="trace-sec">
        <div className="trace-sec-t">检测通道 · 3 个已完成</div>
        <div className="trace-rows">
          <div className="trace-row">
            <div className="trace-k">Name256 自证<span>可疑字体内部嵌入的名称表声明</span></div>
            <div className={"trace-v" + (record.selfClaimOrder && best && best.orderId === record.selfClaimOrder ? " ok" : "")}>
              {record.selfClaimOrder
                ? (best && best.orderId === record.selfClaimOrder ? "与命中订单一致" : "与命中订单不符")
                : "该文件未嵌入自证"}
            </div>
          </div>
          <div className="trace-row">
            <div className="trace-k">通道 A · 位移表决<span>锚定字形位移的多数投票</span></div>
            <div className={"trace-v" + (cs?.aOk ? " ok" : "")}>{cs ? `${cs.a} · ${cs.aOk ? "一致" : "有偏差"}` : "—"}</div>
          </div>
          <div className="trace-row">
            <div className="trace-k">通道 B · 置换方向<span>配对字形左右换位的方向采样</span></div>
            <div className={"trace-v" + (cs?.bOk ? " ok" : "")}>{cs ? `${cs.b} · ${cs.bOk ? "方向一致" : "有修改"}` : "—"}</div>
          </div>
        </div>
      </div>

      <div className="trace-sec">
        <div className="trace-sec-t">文件核验</div>
        <div className="facts">
          <div className="fact"><small>原版字体</small><b>{record.origName || "—"} · {fmtSize(record.origSize)}</b></div>
          <div className="fact"><small>可疑字体</small><b>{record.suspName || "—"} · {fmtSize(record.suspSize)}</b></div>
          <div className="fact"><small>原版 SHA-256</small><b className="mono hash-cell">{shortSha(record.origSha256)}</b></div>
          <div className="fact"><small>可疑 SHA-256</small><b className="mono hash-cell">{shortSha(record.suspSha256)}</b></div>
        </div>
      </div>

      {hit && best ? (
        <div className="trace-sec">
          <div className="trace-sec-t">最可能的签发订单</div>
          <div className="trace-rows">
            <div className="trace-row">
              <div className="trace-k">{best.orderId}<span>判定「{best.levelLabel}」</span></div>
              <div className="trace-v ok">{best.score}% · 命中</div>
            </div>
            {others.map((c) => (
              <div className="trace-row" key={c.orderId}>
                <div className="trace-k mono">{c.orderId}<span>判定「{c.levelLabel}」</span></div>
                <div className="trace-v">{c.score}%</div>
              </div>
            ))}
          </div>
          <Link className="trace-act" to="/orders">到订单页查看 →</Link>
        </div>
      ) : best ? (
        /* 未命中就不点名：候选里必然有分数最高者，写出来等于把一位无关客户
           牵连进一份要外发的文书里（引擎侧也有 0.5 的认领门槛兜底） */
        <div className="trace-sec">
          <div className="trace-sec-t">订单比对</div>
          <div className="trace-rows">
            <div className="trace-row">
              <div className="trace-k">未达到可确认的门槛<span>判定「{best.levelLabel}」</span></div>
              <div className="trace-v">—</div>
            </div>
          </div>
          <p className="paper-sub">候选比对未达到可确认门槛，故本报告不列出订单号。</p>
        </div>
      ) : null}

      <div className="sign">
        <div className="sign-who">
          <small>分析方式</small>
          <div className="sign-name">本机联合检测</div>
          <div className="paper-sub mono">{fmtTime(record.createdAt)}</div>
        </div>
      </div>

      <p className="paper-note">
        报告与原始文件应一并归档。本鉴定书仅呈现本机检测结果，不证明任何第三方的主张。
      </p>
    </div>
  );
}
