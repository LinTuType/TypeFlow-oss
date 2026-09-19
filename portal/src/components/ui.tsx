/**
 * 页面骨架件
 *
 * 这一层是「骨」：页面模板的各个部位统一在这里定义，
 * 后面加任何新页都直接套，不用再排一次版。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { IconCheck, IconX } from "./Icon";

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

/* ---------- 带圈 i：解释性文本收纳（hover / 键盘聚焦显示气泡） ----------
   用法：<InfoI>解释文案，可含链接。</InfoI> 放在被解释内容（标题/行）旁边。
   气泡是 .infoi 的子元素：鼠标从图标移进气泡不会消失；::before 桥接 8px 空隙。 */
export function InfoI({ children }: { children: ReactNode }) {
  return (
    <span className="infoi" tabIndex={0} role="note"
      onClick={(e) => e.stopPropagation()}>
      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
        <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.1" />
        <circle cx="8" cy="4.9" r="0.95" fill="currentColor" />
        <rect x="7.3" y="7.1" width="1.4" height="4.6" rx="0.7" fill="currentColor" />
      </svg>
      <span className="infoi-tip">{children}</span>
    </span>
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

/* ---------- 加载态 ---------- */
export function Spinner({ size = 14 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="加载中" />;
}

/* ---------- 键值行（详情面板用） ---------- */
export function KV({ k, v, mono, copy }: { k: ReactNode; v: ReactNode; mono?: boolean; copy?: boolean }) {
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

/* ---------- 模态框（唯一入口）----------
   以前客户页与订单页各写一份 .modal-back，都只监听遮罩点击：
   Esc 关不掉、Tab 会跑到底层页面、打开时背景还能滚（§2.5 F-4）。
   这里收成一件：打开即聚焦对话框并圈定 Tab、Esc 关闭、锁定背景滚动、
   关闭后焦点归位到打开它的元素。样式沿用原型 .modal 语言。 */
const MODAL_OUT_MS = 200;

/**
 * 共用模态框。
 *
 * `children` 支持写成 render prop：`{(close) => …}`。
 * 需要主动关闭时**必须**用它拿到的 close，不要直接调外层的 setState ——
 * 只有走 close，对话框才会先播 200ms 退场动画再真正卸载（.modal-back.closing）。
 * 切换类操作（关掉本框同时开另一个框）请继续用外层 setState，别让两层遮罩叠着淡。
 */
export function Modal({
  onClose, label, children,
}: {
  onClose: () => void;
  label: string;
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);

  // onClose 通常是内联箭头函数（每次 render 都是新的）。用 ref 接住它，
  // 让下面的 effect 依赖保持稳定 —— 否则每次 render 都重跑 effect，
  // cleanup 里的 opener.focus() 会把焦点从对话框内的输入框抢回去。
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    window.setTimeout(() => onCloseRef.current(), MODAL_OUT_MS);
  }, []);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    boxRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Esc 挂在 document 上：焦点无论落在对话框内还是意外跑掉，都能关
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); close(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [close]);

  return (
    <div className={`modal-back open${closing ? " closing" : ""}`}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
        ref={boxRef}
        onKeyDown={(e) => {
          if (e.key !== "Tab") return;
          // 焦点圈定：Tab / Shift+Tab 在对话框内循环，不落到背景页
          const nodes = boxRef.current?.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          );
          if (!nodes || nodes.length === 0) { e.preventDefault(); return; }
          const list = Array.from(nodes);
          const first = list[0];
          const last = list[list.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }}>
        {/* 关闭出口收在右上角（2026-09-19）：底部动作行只留业务动作，不再被一个「关闭」占位。
            写在 children 之前 ⇒ 它是对话框内第一个可聚焦元素，Tab 圈定自然从它起算。 */}
        <button type="button" className="modal-x" aria-label="关闭" title="关闭" onClick={close}>
          <IconX size={16} />
        </button>
        {typeof children === "function" ? children(close) : children}
      </div>
    </div>
  );
}

/* ---------- 就地向下的展开体（手风琴） ----------
   内容常挂载、收起时用行高 0fr 裁切，因此展开与收起两个方向都有 240ms 过渡；
   收起时置 inert，避免 Tab 焦点落进看不见的表单里。样式见 theme-v9-ext.css .acc-panel。 */
export function AccordionPanel({
  open, children,
}: { open: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.inert = !open;
  }, [open]);

  return (
    <div ref={ref} className={`acc-panel${open ? " open" : ""}`} aria-hidden={!open}>
      <div className="acc-inner">{children}</div>
    </div>
  );
}

/* ---------- 按钮（唯一入口：变体与尺寸只在这里定义） ----------
   起因：原型 .btn 只定义了尺寸，页面靠手拼 `className="btn btn-outline btn-sm"`；
   忘写变体就会掉出设计系统（实测：裸 .btn 渲染成浏览器默认白控件）。
   这一层把变体钉死，页面不再手写按钮类名。样式见 theme-v9-ext.css `.btn` 一族。 */
export type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-solid";
export type BtnSize = "md" | "sm";

const VARIANT_CLASS: Record<BtnVariant, string> = {
  primary: "btn-primary",
  secondary: "",                    // 基类 .btn 本身就是次级按钮（透明底 + 1px --strong 描边）
  ghost: "btn-ghost",
  danger: "btn-danger",
  "danger-solid": "btn-solid-danger",
};

export function Button({
  variant = "secondary", size = "md", icon, busy, className, children, ...rest
}: {
  variant?: BtnVariant; size?: BtnSize; icon?: ReactNode; busy?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = ["btn", size === "sm" ? "btn-sm" : "btn-md", VARIANT_CLASS[variant], className]
    .filter(Boolean).join(" ");
  return (
    <button {...rest} className={cls}>
      {busy ? <Spinner size={size === "sm" ? 12 : 14} /> : icon}
      {children}
    </button>
  );
}

/* ---------- 内联二次确认（无弹窗） ---------- */
export function ConfirmButton({
  label, confirmLabel, onConfirm, danger, disabled, busy, icon, title,
}: {
  label: string; confirmLabel: string; onConfirm: () => void;
  danger?: boolean; disabled?: boolean; busy?: boolean; icon?: ReactNode;
  /** 图标化场景专用：未武装态的 title / aria-label。
      label="" 时按钮只剩图标，语义从这里取；缺省回落 label || confirmLabel。 */
  title?: string;
}) {
  const [armed, setArmed] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  /**
   * 武装态的三条退出路径 —— 曾经只有「点确认」和「4 秒超时」，用户反馈"无法取消"。
   * 现在：① 明确的「取消」按钮 ② 点组件外部自动解除 ③ Esc 解除（超时保留，防呆）。
   * 武装态用勾 / 叉**图标**而非文字 —— 行内空间窄，两个文字按钮会溢出重叠（实测）；
   * confirmLabel 降级为 aria-label / title，语义不丢。
   */
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setArmed(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setArmed(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [armed]);

  return (
    <span className="confirm-wrap" ref={wrapRef}>
      {!armed ? (
        <button className={`btn btn-icon${danger ? " btn-danger" : ""}`} disabled={disabled || busy}
          aria-label={title ?? (label || confirmLabel)} title={title ?? (label || confirmLabel)}
          onClick={() => setArmed(true)}>{icon}{label}</button>
      ) : (
        <>
          <button className="btn btn-icon" aria-label="取消" title="取消" disabled={busy}
            onClick={() => setArmed(false)}><IconX size={13} /></button>
          <button className="btn btn-icon btn-solid-danger" aria-label={confirmLabel} title={confirmLabel}
            disabled={busy}
            onClick={() => { setArmed(false); onConfirm(); }}><IconCheck size={13} /></button>
        </>
      )}
    </span>
  );
}
