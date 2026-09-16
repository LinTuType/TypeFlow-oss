/**
 * 图标层 —— 与原型 v9 同源（lucide-react，同名图标）
 *
 * 原型通过 <i data-lucide="…"> 使用 Lucide；此处以组件形式对齐同名图标，
 * 保证侧栏 / 页面图标与原型逐个一致。导航图标名取自原型：
 *   house · file-signature · scan-search · type · users-round · receipt-text
 *   shield-check · settings
 * 其余通用符号（对勾 / 叉 / 复制等）保留零依赖内联实现。
 */
import type { SVGProps } from "react";
import {
  House, FileSignature, ScanSearch, Type, UsersRound, ReceiptText,
  ShieldCheck, Settings, Sun, Moon,
} from "lucide-react";

type P = SVGProps<SVGSVGElement> & { size?: number };

/* ── 原型导航 / 页面图标（lucide-react 同名） ── */
export const IconGauge = House;            // 侧栏·概览
export const IconSpark = FileSignature;    // 侧栏·签发
export const IconScanSearch = ScanSearch;  // 侧栏·追溯
export const IconLayers = Type;            // 侧栏·字体库
export const IconUser = UsersRound;        // 侧栏·客户
export const IconFile = ReceiptText;       // 侧栏·订单
export const IconShield = ShieldCheck;     // 安全与信任
export const IconSettings = Settings;      // 设置
export const IconSun = Sun;
export const IconMoon = Moon;

/* ── 通用符号（内联实现，视觉同 Lucide 24 网格） ── */
function Svg({ size = 16, children, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" {...rest}>{children}</svg>
  );
}

export const IconCheck = (p: P) => (
  <Svg {...p}><path d="M20 6 9 17l-5-5" /></Svg>
);

export const IconCheckCircle = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M8.5 12.5 11 15l4.5-5" /></Svg>
);

export const IconAlert = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5M12 16.2v.1" /></Svg>
);

export const IconInfo = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.8v.1" /></Svg>
);

export const IconX = (p: P) => (
  <Svg {...p}><path d="M18 6 6 18M6 6l12 12" /></Svg>
);

export const IconPlus = (p: P) => (
  <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
);

export const IconCopy = (p: P) => (
  <Svg {...p}><rect x="9" y="9" width="11" height="11" rx="1.5" /><path d="M5 15V6a1.5 1.5 0 0 1 1.5-1.5H15" /></Svg>
);

export const IconSearch = (p: P) => (
  <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></Svg>
);

export const IconTrash = (p: P) => (
  <Svg {...p}><path d="M4 7h16M9.5 7V4.8h5V7M6 7l1 13h10l1-13" /></Svg>
);

export const IconDownload = (p: P) => (
  <Svg {...p}><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14" /></Svg>
);

export const IconUpload = (p: P) => (
  <Svg {...p}><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19h14" /></Svg>
);

export const IconChevron = (p: P) => (
  <Svg {...p}><path d="m9 6 6 6-6 6" /></Svg>
);

export const IconPrint = (p: P) => (
  <Svg {...p}><path d="M7 8V4h10v4" /><rect x="4" y="8" width="16" height="7" rx="1.2" /><path d="M7 16.5h10V20H7z" /></Svg>
);
