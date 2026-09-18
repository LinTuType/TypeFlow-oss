/**
 * 图标层 —— 与原型 v9 同源（lucide-react，同名图标）
 *
 * 原型通过 <i data-lucide="…"> 使用 Lucide；此处以组件形式对齐同名图标，
 * 保证侧栏 / 页面图标与原型逐个一致。导航图标名取自原型：
 *   house · file-signature · scan-search · type · users-round · receipt-text
 *   shield-check · settings
 * 其余通用符号（对勾 / 叉 / 复制等）保留零依赖内联实现。
 *
 * 粗细统一：Lucide 默认 2.0、内联网格 1.8 —— 同一按钮里混排会看出轻重差，
 * 统一压到 1.8（也贴近原型导航的 1.5 细线语言）。资料库三页的行内操作
 * 图标也在这层取（Pencil=编辑、RefreshCw=同步哈希），语义与侧栏同源。
 */
import type { ComponentType, SVGProps } from "react";
import {
  House, FileSignature, ScanSearch, Type, UsersRound, ReceiptText,
  ShieldCheck, Settings, Sun, Moon, Menu, Printer, Trash2, Ban,
  Pencil, RefreshCw, Mail, type LucideIcon,
} from "lucide-react";

type P = SVGProps<SVGSVGElement> & { size?: number };

/**
 * lucide 图标统一出口：钉住 1.8 线宽（页面可用 strokeWidth 覆盖）。
 *
 * 入参用 lucide 自己的 LucideIcon 类型，而不是就地约束成 ComponentType<P>：
 * lucide 的 size 是 `string | number`，收窄成 number 会让每个图标都报
 * 「ForwardRefExoticComponent 不可赋给 FunctionComponent」（tsc 2 处报错）。
 */
function lucide(Icon: LucideIcon): ComponentType<P> {
  return (p) => <Icon strokeWidth={1.8} {...p} />;
}

/* ── 原型导航 / 页面图标（lucide-react 同名） ── */
export const IconGauge = lucide(House);            // 侧栏·概览
export const IconSpark = lucide(FileSignature);    // 侧栏·签发
export const IconScanSearch = lucide(ScanSearch);  // 侧栏·追溯
export const IconLayers = lucide(Type);            // 侧栏·字体库
export const IconUser = lucide(UsersRound);        // 侧栏·客户
export const IconFile = lucide(ReceiptText);       // 侧栏·订单
export const IconShield = lucide(ShieldCheck);     // 安全与信任
export const IconSettings = lucide(Settings);      // 设置
export const IconSun = lucide(Sun);
export const IconMoon = lucide(Moon);
export const IconMenu = lucide(Menu);           // 窄屏顶栏·打开导航抽屉

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

/* 垃圾桶 / 打印机改用 lucide 同名图标（原型本来就是 lucide）——
   手写版用在 13px 的小按钮里会糊：打印机的 rect(16×7)+两段路径缩到 13px 后线条挤成一团，
   和旁边疏朗的手写垃圾桶也不像一个体系。 */
export const IconTrash = lucide(Trash2);
export const IconBan = lucide(Ban);              // 订单·作废（禁止符号）

/* ── 资料库行内操作（客户行 / 字体卡 mini）——与侧栏导航同语义 ── */
export const IconPencil = lucide(Pencil);        // 客户·编辑
export const IconSync = lucide(RefreshCw);       // 字体·同步哈希到云端

export const IconDownload = (p: P) => (
  <Svg {...p}><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14" /></Svg>
);

export const IconUpload = (p: P) => (
  <Svg {...p}><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19h14" /></Svg>
);

export const IconChevron = (p: P) => (
  <Svg {...p}><path d="m9 6 6 6-6 6" /></Svg>
);

export const IconPrint = lucide(Printer);
export const IconMail = lucide(Mail);            // 交付邮件（把预填好的信交给本机邮件客户端）
