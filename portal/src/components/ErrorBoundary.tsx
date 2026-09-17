/**
 * 渲染兜底（React ErrorBoundary）
 *
 * 为什么要有：任何一页抛错之前，整个 SPA 是白屏——用户不知道数据还在不在，
 * 只会反复刷新把状态搞得更糟。兜底页只说三件事：出了什么错（原样展示）、
 * 数据在哪里（本机字体 + 云端记录都不受影响）、下一步怎么办（刷新 / 回首页）。
 *
 * 注意它只兜"渲染期"错误：事件回调里的异常要靠调用方自己的 try/catch（现有 toast 已覆盖）。
 */
import { Component, type ReactNode } from "react";

interface State { error: Error | null }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[TypeFlow] 页面渲染异常", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const msg = String(this.state.error?.message ?? this.state.error);
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 32 }}>
        <div style={{ maxWidth: 480 }}>
          <div className="kicker">文镇 TypeFlow</div>
          <h1 style={{ font: "600 24px/1.4 var(--serif)", margin: "8px 0 12px" }}>页面出了点问题</h1>
          <p style={{ color: "var(--sub)", fontSize: 13.5, lineHeight: 1.8, margin: "0 0 16px" }}>
            你的数据都在——字体存于本机浏览器，云端记录不受影响。刷新页面或回到首页即可继续。
          </p>
          <code className="mono" style={{ display: "block", color: "var(--muted)", wordBreak: "break-all", marginBottom: 20 }}>
            {msg}
          </code>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-md" onClick={() => { location.assign("/"); }}>回到首页</button>
            <button className="btn btn-md btn-primary" onClick={() => { location.reload(); }}>刷新页面</button>
          </div>
        </div>
      </div>
    );
  }
}
