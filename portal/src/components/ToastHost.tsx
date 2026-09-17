/** Toast 宿主：挂在 App 根部，全局唯一。右下角固定，不占文档流。 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { getToastSnapshot, subscribeToast, toast, type ToastItem } from "../lib/toast";
import { IconAlert, IconCheckCircle, IconInfo, IconX } from "./Icon";

const ICONS = {
  success: IconCheckCircle,
  error: IconAlert,
  warn: IconAlert,
  info: IconInfo,
};

function Row({ t }: { t: ToastItem }) {
  const Icon = ICONS[t.type];
  // 退场两段式：先把行标成 out 触发 180ms 动画，再从 store 移除。
  // 直接 dismiss 是同步移除，行会瞬间消失，没法做退场。
  const [out, setOut] = useState(false);

  useEffect(() => {
    if (!out) return;
    const timer = window.setTimeout(() => toast.dismiss(t.id), 180);
    return () => window.clearTimeout(timer);
  }, [out, t.id]);

  useEffect(() => {
    if (!t.duration) return;
    const timer = window.setTimeout(() => setOut(true), t.duration);
    return () => window.clearTimeout(timer);
  }, [t.id, t.duration]);

  return (
    <div className={`toast toast-${t.type}${out ? " toast-out" : ""}`} role="status">
      <Icon size={15} className="toast-icon" />
      <div className="toast-body">
        <div className="toast-msg">{t.message}</div>
        {t.detail && <div className="toast-detail">{t.detail}</div>}
        {t.action && (
          <button className="toast-action"
            onClick={() => { t.action!.onClick(); setOut(true); }}>
            {t.action.label}
          </button>
        )}
      </div>
      <button className="toast-close" aria-label="关闭" onClick={() => setOut(true)}>
        <IconX size={13} />
      </button>
    </div>
  );
}

export default function ToastHost() {
  const items = useSyncExternalStore(subscribeToast, getToastSnapshot, getToastSnapshot);
  return (
    <div className="toast-host">
      {items.map((t) => <Row key={t.id} t={t} />)}
    </div>
  );
}
