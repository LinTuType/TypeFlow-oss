/**
 * 签发进度 —— 线性规线列表（规格语言：无底色盒、规线分区）
 *
 * 对接 issueOne 的 onPhase 回调；每阶段都对应一次真实云端请求。
 * 样式在 theme-v9-ext.css `.issue-progress` 一族。
 */

import type { IssuePhase } from "../lib/issueFlow";
import { IconCheckCircle, IconInfo } from "./Icon";
import { Spinner } from "./ui";

/** 签发阶段 → 展示文案 */
export const PHASE_LABEL: Array<{ phase: IssuePhase; label: string; net?: string }> = [
  { phase: "register", label: "登记哈希元数据", net: "POST /api/fonts/register" },
  { phase: "order", label: "创建订单", net: "POST /api/orders" },
  { phase: "recipe", label: "云端签发配方", net: "POST /api/orders/issuance-recipe" },
  { phase: "embed", label: "本地嵌入水印（字体不出本机）" },
  { phase: "complete", label: "提交完成回执", net: "POST /api/orders/complete" },
];

export default function IssueProgress({ phase, done }: { phase: IssuePhase | null; done: boolean }) {
  if (!phase && !done) return null;
  const curIdx = phase ? PHASE_LABEL.findIndex((p) => p.phase === phase) : -1;
  const pct = done ? 100 : curIdx >= 0 ? ((curIdx + 1) / PHASE_LABEL.length) * 100 : 0;

  return (
    <div className="issue-progress">
      <div className="issue-progress-head">
        <b>{done ? "签发进度 · 已完成" : "签发进度 · 进行中"}</b>
        <span>每一步都会真实请求云端</span>
      </div>
      <div className="progress-track">
        <div style={{ width: `${pct}%` }} />
      </div>
      <div className="issue-progress-steps">
        {PHASE_LABEL.map(({ phase: p, label }, i) => {
          const state = done || curIdx > i ? "done" : curIdx === i ? "doing" : "pending";
          return (
            <div className={`progress-step ${state}`} key={p}>
              <span className="step-ic">
                {state === "done" ? <IconCheckCircle size={14} />
                  : state === "doing" ? <IconInfo size={14} />
                    : <span className="step-dot" />}
              </span>
              <span style={{ flex: 1 }}>{label}</span>
              {state === "doing" && <Spinner size={12} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
