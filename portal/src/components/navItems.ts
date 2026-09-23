import type { ComponentType } from "react";
import {
  IconGauge, IconSpark, IconScanSearch, IconLayers, IconUser, IconFile,
  IconShield, IconSettings,
} from "./Icon";

/**
 * 导航项定义 —— 桌面侧栏与窄屏底栏的唯一数据源
 *
 * 此前 WORK / LIBRARY / BOTTOM_LINKS 写在 Sidebar.tsx 里。窄屏加底栏后，
 * 两个组件都要读同一份列表（底栏取其中几项、抽屉取剩下的），所以抽到此处。
 * ⚠️ 新加导航项只改这里；底栏要放哪几项改动 TAB_PATHS 一处。
 */

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  end?: boolean;
}

export const WORK: NavItem[] = [
  { to: "/", label: "概览", icon: IconGauge, end: true },
  { to: "/issue", label: "签发", icon: IconSpark },
  { to: "/trace", label: "追溯", icon: IconScanSearch },
];

export const LIBRARY: NavItem[] = [
  { to: "/fonts", label: "字体库", icon: IconLayers },
  { to: "/clients", label: "客户", icon: IconUser },
  { to: "/orders", label: "订单", icon: IconFile },
];

export const BOTTOM_LINKS: NavItem[] = [
  { to: "/security", label: "安全与信任", icon: IconShield },
  { to: "/settings", label: "设置", icon: IconSettings },
];

/**
 * 窄屏（≤760px）上底栏的入口 —— 其余项收进「更多」抽屉。
 *
 * 顺序 = WORK 与 LIBRARY 里的自然顺序（概览 · 签发 · 字体库），
 * 底栏右侧固定接一个「更多」按钮（非 NavItem，见 TabBar.tsx）。
 * 只有窄屏生效：桌面端 .tabbar 整体 display:none，侧栏照旧显示全部项。
 */
const TAB_PATHS = ["/", "/issue", "/fonts"];

export const TAB_ITEMS: NavItem[] = [...WORK, ...LIBRARY].filter((i) =>
  TAB_PATHS.includes(i.to)
);

/** 该项是否已上底栏（窄屏抽屉据此把它隐藏，避免两处重复） */
export const isTabbed = (to: string): boolean => TAB_PATHS.includes(to);
