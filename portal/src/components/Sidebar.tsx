import { NavLink, useNavigate } from "react-router-dom";
import { apiAuth, clearToken, clearTenant, clearEmailVerified, getTenant } from "../api/client";
import { IconGauge, IconSpark, IconScanSearch, IconLayers, IconUser, IconFile, IconShield, IconSettings } from "./Icon";

/**
 * 侧栏导航（240px，固定高度满屏）
 *
 * 分组：
 *   工作：概览 / 签发 / 追溯
 *   资料库：字体库 / 客户 / 订单
 *   底部：安全与信任 / 设置 / 暗色切换 / 账户
 */

/* ---- 导航项定义 ---- */
interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  end?: boolean;
}

const WORK: NavItem[] = [
  { to: "/", label: "概览", icon: IconGauge, end: true },
  { to: "/issue", label: "签发", icon: IconSpark },
  { to: "/trace", label: "追溯", icon: IconScanSearch },
];

const LIBRARY: NavItem[] = [
  { to: "/fonts", label: "字体库", icon: IconLayers },
  { to: "/clients", label: "客户", icon: IconUser },
  { to: "/orders", label: "订单", icon: IconFile },
];

const BOTTOM_LINKS: NavItem[] = [
  { to: "/security", label: "安全与信任", icon: IconShield },
  { to: "/settings", label: "设置", icon: IconSettings },
];

interface SidebarProps {
  theme: "light" | "dark";
  onToggleTheme: () => void;
  /** 窄屏抽屉是否展开（桌面恒为展开态，由 CSS 控制） */
  open?: boolean;
}

export default function Sidebar({ theme, onToggleTheme, open }: SidebarProps) {
  const navigate = useNavigate();
  const who = getTenant();

  const logout = async () => {
    // 先吊销服务端会话（批次 2 起 token 是可吊销的）；网络失败也要放人走，
    // 否则用户会卡在一个"点了没反应"的界面上
    try {
      await apiAuth.logout();
    } catch {
      /* 忽略：本地清干净即可 */
    }
    clearToken();
    // 显示名与验证状态也要清：只清 token 的话，下一位登录者进来看见的是
    // 上一位的用户名（侧栏问候语），共用设备的场景尤其明显
    clearTenant();
    clearEmailVerified();
    navigate("/login", { replace: true });
  };

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `sidebar-item${isActive ? " active" : ""}`;

  return (
    <aside className={`sidebar${open ? " open" : ""}`}>
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