import { Link, useNavigate } from "react-router-dom";
import { WORK, LIBRARY, BOTTOM_LINKS, isTabbed } from "./navItems";
import { IconLogout } from "./Icon";
import { logoutSession } from "../lib/session";

/**
 * 窄屏「更多」菜单（≤760px，桌面 display:none）
 *
 * 点底栏右侧的「更多」在**它上方、右对齐**弹出，列出底栏放不下的项
 * （追溯 / 客户 / 订单 / 安全与信任 / 设置）+ 退出登录。
 *
 * 为什么不是左侧抽屉：入口本来就在右下角，菜单贴着入口出现，视线不用横跨整屏；
 * 且手机上打开抽屉时的灰色遮罩会压住底栏，看着重。窄屏侧栏抽屉已随之撤掉
 * （窄屏 `.sidebar{display:none}`，桌面侧栏不受影响）。
 *
 * 关闭路径：点菜单项 / 点内容区任意处（.more-veil，只盖内容区不盖底栏，
 * 所以点底栏别的入口能直接切页）/ Esc（AppShell 里统一处理）/ 路由变化。
 */

/** 底栏没上的项（顺序 = navItems 定义顺序） */
const ITEMS = [...WORK, ...LIBRARY, ...BOTTOM_LINKS].filter((i) => !isTabbed(i.to));

interface MoreMenuProps {
  open: boolean;
  onClose: () => void;
}

export default function MoreMenu({ open, onClose }: MoreMenuProps) {
  const navigate = useNavigate();

  const logout = async () => {
    await logoutSession();
    onClose();
    navigate("/login", { replace: true });
  };

  return (
    <>
      <div className={`more-veil${open ? " open" : ""}`} onClick={onClose} aria-hidden="true" />
      <div className={`more-menu${open ? " open" : ""}`} role="menu" aria-label="更多导航">
        {ITEMS.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to} className="more-item" role="menuitem" onClick={onClose}>
            <Icon size={16} />
            <span>{label}</span>
          </Link>
        ))}
        <button type="button" className="more-item more-item-quiet" role="menuitem" onClick={logout}>
          <IconLogout size={16} />
          <span>退出登录</span>
        </button>
      </div>
    </>
  );
}
