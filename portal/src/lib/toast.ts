/**
 * 全局轻提示（Toast）—— 替代页面内塞 notice 块的反馈方式
 *
 * 设计约束（对齐桌面版体验）：
 *   - 无弹窗、不阻塞：固定右下角，不吃文档流
 *   - 零视觉跳动：出现/消失只做位移 + 淡入，不影响布局
 *   - 自动消失，可手动关闭；同一时刻最多 4 条
 */

export type ToastType = "success" | "error" | "info" | "warn";

export interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  detail?: string;
  action?: { label: string; onClick: () => void };
  /** 毫秒；error 默认不自动消失（要用户看到） */
  duration?: number;
}

const MAX = 4;
let seq = 0;
let items: ToastItem[] = [];
const listeners = new Set<() => void>();

function emit() {
  items = [...items];
  listeners.forEach((l) => l());
}

function push(type: ToastType, message: string, opts: Omit<ToastItem, "id" | "type" | "message"> = {}) {
  const item: ToastItem = {
    id: ++seq,
    type,
    message,
    duration: type === "error" ? 0 : 4000,
    ...opts,
  };
  items = [...items, item].slice(-MAX);
  emit();
  return item.id;
}

export const toast = {
  success: (message: string, opts?: Omit<ToastItem, "id" | "type" | "message">) => push("success", message, opts),
  error: (message: string, opts?: Omit<ToastItem, "id" | "type" | "message">) => push("error", message, opts),
  info: (message: string, opts?: Omit<ToastItem, "id" | "type" | "message">) => push("info", message, opts),
  warn: (message: string, opts?: Omit<ToastItem, "id" | "type" | "message">) => push("warn", message, opts),
  dismiss: (id: number) => {
    items = items.filter((t) => t.id !== id);
    emit();
  },
  clear: () => {
    items = [];
    emit();
  },
};

// ---- React 订阅（useSyncExternalStore 需要稳定的快照引用）----
export function subscribeToast(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function getToastSnapshot(): ToastItem[] {
  return items;
}
