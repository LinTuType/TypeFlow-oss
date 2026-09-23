import { NavLink, useNavigate } from "react-router-dom";
import { getTenant } from "../api/client";
import { WORK, LIBRARY, BOTTOM_LINKS } from "./navItems";
import { logoutSession } from "../lib/session";

/**
 * 侧栏导航（238px，固定高度满屏）—— **桌面专用**
 *
 * 分组（定义在 navItems.ts，与窄屏底栏共用一份）：
 *   工作：概览 / 签发 / 追溯
 *   资料库：字体库 / 客户 / 订单
 *   底部：安全与信任 / 设置 / 账户
 *
 * ⚠️ 窄屏（≤760px）里整条侧栏 `display:none`：那个尺寸下的导航是
 * 「底部入口 + 更多菜单」（见 TabBar.tsx / MoreMenu.tsx）。侧栏原先兼作窄屏抽屉，
 * 2026-09-23 改成右下角菜单后已撤掉（`.side-veil` 与 open 态一并删除）。
 */

interface SidebarProps {
  theme: "light" | "dark";
  onToggleTheme: () => void;
}

export default function Sidebar({ theme, onToggleTheme }: SidebarProps) {
  const navigate = useNavigate();
  const who = getTenant();

  const logout = async () => {
    await logoutSession();
    navigate("/login", { replace: true });
  };

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `sidebar-item${isActive ? " active" : ""}`;

  return (
    <aside className="sidebar">
      {/* 品牌 */}
      <button className="sidebar-brand" onClick={() => navigate("/")}>
        <img className="sidebar-logo" src="/logo.svg" alt="文镇" />
        <span>
          <div className="sidebar-brand-text">文镇 TypeFlow</div>
          <div className="sidebar-brand-sub">字体授权工作台</div>
        </span>
      </button>

      {/* 导航 */}
      <nav className="sidebar-nav">
        <div className="sidebar-group">
          <div className="sidebar-label">工作</div>
          {WORK.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={linkClass}>
              <Icon size={16} />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>

        <div className="sidebar-group">
          <div className="sidebar-label">资料库</div>
          {LIBRARY.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={linkClass}>
              <Icon size={16} />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      {/* 底部（原型：navlink 文本行 + 账户；暗色切换冻结） */}
      <div className="sidebar-bottom">
        {BOTTOM_LINKS.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className="navlink">
            <Icon size={16} />
            <span>{label}</span>
          </NavLink>
        ))}

        <div className="sidebar-account" onClick={logout} title="点击退出登录">
          <span className="sidebar-avatar">
            {(who ?? "U").slice(0, 1).toUpperCase()}
          </span>
          <span>
            <div className="sidebar-account-name">{who ?? "已登录"}</div>
            <div className="sidebar-account-sub">退出登录</div>
          </span>
        </div>
      </div>
    </aside>
  );
}