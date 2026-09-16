/** Toast 宿主：挂在 App 根部，全局唯一。右下角固定，不占文档流。 */
import { useEffect, useSyncExternalStore } from "react";
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

  useEffect(() => {
    if (!t.duration) return;
    const timer = window.setTimeout(() => toast.dismiss(t.id), t.duration);
    return () => window.clearTimeout(timer);
  }, [t.id, t.duration]);

  return (
    <div className={`toast toast-${t.type}`} role="status">
      <Icon size={15} className="toast-icon" />
      <div className="toast-body">
        <div className="toast-msg">{t.message}</div>
        {t.detail && <div className="toast-detail">{t.detail}</div>}
        {t.action && (
          <button className="toast-action"
            onClick={() => { t.action!.onClick(); toast.dismiss(t.id); }}>
            {t.action.label}
          </button>
        )}
      </div>
      <button className="toast-close" aria-label="关闭" onClick={() => toast.dismiss(t.id)}>
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
