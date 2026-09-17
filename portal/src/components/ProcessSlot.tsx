/**
 * 文书右上角的「过程槽」—— 歌词式向上滚动，滚完只留结果控件。
 *
 * 形态是算出来的，不是拍的：
 *   · 槽高 48px = max(日志窗口 44px, 结果控件 48px)。两态**不同时出现**（进行中只有日志、
 *     完成只有控件），所以取较大值 —— 相加会把标题行撑高、在文书里留出一块空白。
 *   · 窗口固定 2 行。过程有几步都一样高，旧行向上滚出并淡出 ⇒ 占位恒定，
 *     否则日志一多就把正文挤走（这是"挤占文本空间"的根因）。
 *   · 槽与标题行 `align-items: end` 对齐：结果控件底边与文书编号行底边落在同一条线上。
 *
 * ⚠️ 日志是「排队放出」的，不跟着数据到达时间直接渲染：
 *   真实阶段可能极快（追溯是纯本地计算，实测四步不到 220ms），直接渲染会让行一闪而过，
 *   根本看不清过程。所以这里维护 revealed / typed 两个游标，按固定节奏逐行逐字放出，
 *   与底层计算速度**解耦**。完成态也要等队列放完才切 —— 否则日志还在滚、下载控件已经出现。
 *
 * 空闲时（lines 为空）不渲染任何东西 —— 视觉上就是"那里本来就空着"。
 */
import { useEffect, useState, type ReactNode } from "react";

const LINE = 22;     // 单行高，与 .proc-row 一致
const WIN = 2;       // 可视行数
const CHAR_MS = 14;  // 逐字速度（一行 10 字 ≈ 140ms）
const HOLD_MS = 90;  // 一行打完后停留，再放下一行

/** 文书面（授权书 / 鉴定书）右上角过程槽的入参 */
export interface PaperProcess {
  lines: string[];
  done: boolean;
  actions?: ReactNode;
}

export default function ProcessSlot({ lines, done, children }: {
  /** 已到达的步骤文案（可能一次涌进来多条，由槽自己排队放出） */
  lines: string[];
  /** 底层已完成：等队列放完后切到结果控件 */
  done: boolean;
  /** 完成态控件（下载 / 导出等） */
  children?: ReactNode;
}) {
  const [revealed, setRevealed] = useState(0);   // 已放出的行数
  const [typed, setTyped] = useState(0);         // 当前行已打出的字数

  // 新一轮（父组件清空 lines）时游标归零
  useEffect(() => {
    if (lines.length === 0) { setRevealed(0); setTyped(0); }
  }, [lines.length]);

  // 节奏机：先把当前行逐字打完，停留一下，再放下一行
  useEffect(() => {
    if (revealed >= lines.length) return;
    const cur = lines[revealed] ?? "";
    if (typed < cur.length) {
      const t = window.setTimeout(() => setTyped((n) => n + 1), CHAR_MS);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => { setRevealed((n) => n + 1); setTyped(0); }, HOLD_MS);
    return () => window.clearTimeout(t);
  }, [revealed, typed, lines]);

  const queued = revealed < lines.length;        // 队列里还有没放完的
  const settled = done && !queued;               // 真正可以切到结果控件
  const shown = lines.slice(0, Math.min(revealed + 1, lines.length));   // 已放出 + 正在打的那行
  const shift = Math.max(0, shown.length - WIN) * LINE;

  if (lines.length === 0 && !done && children == null) return <div className="proc-slot" />;

  return (
    <div className="proc-slot">
      {shown.length > 0 && (
        <div className={"proc-log" + (settled ? " out" : "")}
          style={{ transform: `translateY(-${shift}px)` }}>
          {shown.map((t, i) => {
            const isCur = i === revealed && queued;   // 正在打的那行
            return (
              <div className="proc-row" key={i}
                /* 滚出可视窗口的行淡掉 —— 用逐行透明度而不是遮罩渐变，避免在上层叠一层遮罩元素 */
                style={{ opacity: shown.length - 1 - i >= WIN ? 0 : 1 }}>
                <span className="proc-mk">{isCur ? "·" : "✓"}</span>
                <span className="proc-tx">
                  {isCur ? t.slice(0, typed) : t}
                  {isCur && <i className="proc-cur" />}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {children != null && (
        <div className={"proc-res" + (settled ? " on" : "")}>{children}</div>
      )}
    </div>
  );
}
