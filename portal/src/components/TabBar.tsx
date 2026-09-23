import { NavLink } from "react-router-dom";
import { IconMore } from "./Icon";
import { TAB_ITEMS } from "./navItems";

/**
 * 窄屏底部入口（≤760px，桌面 display:none）
 *
 * 取替原先的「顶栏汉堡 → 侧栏抽屉」：底栏常驻 3 个页面入口 + 一个「更多」；
 * 「更多」把底栏放不下的项（追溯 / 客户 / 订单 / 安全与信任 / 设置 / 退出登录）
 * 收进一个贴着自己右上方弹出的菜单（见 MoreMenu.tsx），这里只负责开合它。
 *
 * 底栏与品牌条不经手账户与主题，所以本组件无内部状态。
 */

interface TabBarProps {
  /** 「更多」菜单是否展开（由 AppShell 持有）：展开时「更多」呈激活态 */
  moreOpen: boolean;
  onMore: () => void;
}

export default function TabBar({ moreOpen, onMore }: TabBarProps) {
  return (
    <nav className="tabbar">
      {TAB_ITEMS.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end}
          className={({ isActive }) => `tab-item${isActive ? " active" : ""}`}>
          <Icon size={20} />
          <span>{label}</span>
        </NavLink>
      ))}
      <button type="button" onClick={onMore} aria-expanded={moreOpen}
        aria-label="更多导航" className={`tab-item${moreOpen ? " active" : ""}`}>
        <IconMore size={20} />
        <span>更多</span>
      </button>
    </nav>
  );
}
