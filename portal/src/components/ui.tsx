/**
 * 页面骨架件
 *
 * 这一层是「骨」：页面模板的各个部位统一在这里定义，
 * 后面加任何新页都直接套，不用再排一次版。
 */
import type { ReactNode } from "react";

/* ---------- 页头：标题 + 副标题 + 右侧动作 ---------- */
export function PageHeader({
  title, sub, actions,
}: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        <h1>{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </header>
  );
}

/* ---------- 区块：带标题的一块内容 ---------- */
export function Section({
  title, desc, actions, children, flush,
}: {
  title?: ReactNode; desc?: ReactNode; actions?: ReactNode;
  children?: ReactNode; flush?: boolean;
}) {
  return (
    <section className={`section${flush ? " section-flush" : ""}`}>
      {(title || actions) && (
        <div className="section-head">
          <div>
            {title && <h2 className="section-title">{title}</h2>}
            {desc && <p className="section-desc">{desc}</p>}
          </div>
          {actions && <div className="section-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/* ---------- 空态 ---------- */
export function EmptyState({
  icon, title, desc, action,
}: {
  icon?: ReactNode; title: string; desc?: ReactNode; action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <div className="empty-title">{title}</div>
      {desc && <div className="empty-desc">{desc}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

/* ---------- 加载态 ---------- */
export function Spinner({ size = 14 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="加载中" />;
}

/** 首屏骨架：占位块，避免加载完成时页面跳动 */
export function SkeletonCards({ count = 6 }: { count?: number }) {
  return (
    <div className="card-grid">
      {Array.from({ length: count }, (_, i) => (
        <div className="card sk-card" key={i}>
          <div className="sk sk-glyph" />
          <div className="sk sk-line" style={{ width: "62%" }} />
          <div className="sk sk-line sk-sm" style={{ width: "38%" }} />
        </div>
      ))}
    </div>
  );
}

export function LoadingBlock({ text = "载入中…" }: { text?: string }) {
  return (
    <div className="loading-block">
      <Spinner /> <span>{text}</span>
    </div>
  );
}

/* ---------- 状态点/徽章 ---------- */
export function Badge({
  tone = "neutral", children,
}: { tone?: "neutral" | "ok" | "info" | "warn" | "danger" | "gold"; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

/** 是/否状态：强调"有/没有"的二元事实 */
export function Flag({ on, onText, offText }: { on: boolean; onText: string; offText: string }) {
  return on
    ? <span className="flag flag-on"><span className="dot" />{onText}</span>
    : <span className="flag flag-off"><span className="dot" />{offText}</span>;
}

/* ---------- 键值行（详情面板用） ---------- */
export function KV({ k, v, mono, copy }: { k: string; v: ReactNode; mono?: boolean; copy?: boolean }) {
  return (
    <div className="kv">
      <div className="kv-k">{k}</div>
      <div className={`kv-v${mono ? " mono" : ""}`}>
        {v}
        {copy && typeof v === "string" && (
          <button className="kv-copy" title="复制"
            onClick={() => void navigator.clipboard?.writeText(v)}>复制</button>
        )}
      </div>
    </div>
  );
}

/* ---------- 二栏：列表 + 详情 ---------- */
export function Split({
  list, detail, detailWidth = 330,
}: { list: ReactNode; detail: ReactNode; detailWidth?: number }) {
  return (
    <div className="split" style={{ ["--detail-w" as string]: `${detailWidth}px` }}>
      <div className="split-list">{list}</div>
      <aside className="split-detail">{detail}</aside>
    </div>
  );
}

/* ---------- 内联二次确认（无弹窗） ---------- */
import { useEffect, useState } from "react";

export function ConfirmButton({
  label, confirmLabel, onConfirm, danger, disabled, busy, icon,
}: {
  label: string; confirmLabel: string; onConfirm: () => void;
  danger?: boolean; disabled?: boolean; busy?: boolean; icon?: ReactNode;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);

  if (!armed) {
    return (
      <button className={`btn btn-icon${danger ? " btn-danger" : ""}`} disabled={disabled || busy}
        onClick={() => setArmed(true)}>{icon}{label}</button>
    );
  }
  return (
    <button className="btn btn-solid-danger btn-icon"
      disabled={busy}
      onClick={() => { setArmed(false); onConfirm(); }}>
      {confirmLabel}
    </button>
  );
}
