import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import TabBar from "./TabBar";
import MoreMenu from "./MoreMenu";
import PageStage from "./PageStage";

/**
 * 应用外壳：桌面 = 238px 固定侧栏 + 居中主内容区；窄屏（≤760px）= 品牌条 + 底部入口 + 「更多」菜单
 *
 * 窄屏此前没有任何兜底：侧栏 fixed 238px + .main 同宽 margin ⇒ 375px 手机内容区只剩约 65px，
 * 必然不可用（§2.5 F-3）。现在 ≤760px 的导航 = TabBar（3 个页面入口 + 「更多」）
 * + MoreMenu（贴底栏右上方弹出的菜单），这里补三件事：点「更多」开合 / 点内容区与 Esc 收起 /
 * 路由变化自动收起。
 * ⚠️ 窄屏既没有顶栏汉堡也没有侧栏（`.sidebar` 在 ≤760px 直接 display:none）。
 * 主题切换状态提升至此处，传递给 Sidebar 和后代（通过 CSS 变量响应）
 * 主内容区交给 PageStage：它按路由 key 重挂载并播放「错位翻页」转场
 */
const THEME_KEY = "typeflow_theme";

function initialTheme(): "light" | "dark" {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(t: "light" | "dark") {
  document.documentElement.setAttribute("data-theme", t);
}

export default function AppShell() {
  const [theme, setTheme] = useState<"light" | "dark">(initialTheme);
  const [moreOpen, setMoreOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => { applyTheme(theme); }, [theme]);
  /**
   * 窄屏外壳高度 = 浏览器「可视区」高度，由 JS 量出来写进 --app-h。
   *
   * ⚠️ 别改回纯 CSS 单位（2026-09-23 实测踩过两次）：
   *   · `100vh` 在 iOS 上等于「工具栏收起时的大视口」，比可视区高 ⇒ 底栏被推到屏幕外；
   *   · `100dvh` 本意是动态可视区，但在部分 WebKit / 第三方内核上量出来仍是那个大视口，
   *     而且外壳高度一旦偏大，**滚动也救不回来**（滚动在内容区内部、外壳不动），
   *     表现成用户报的"固定只显示一半，上划也不能完全呈现"。
   * `window.innerHeight` 是可视区高度（工具栏之下），且随工具栏收放实时变化，最可靠。
   */
  useEffect(() => {
    const sync = () => {
      document.documentElement.style.setProperty("--app-h", `${window.innerHeight}px`);
    };
    sync();
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
      vv?.removeEventListener("resize", sync);
    };
  }, []);
  // 路由变化即收起「更多」菜单（点菜单项后不要让浮层留在屏幕上）
  useEffect(() => { setMoreOpen(false); }, [pathname]);
  // Esc 也能收
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMoreOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem(THEME_KEY, next);
  };

  return (
    <div className="layout">
      {/* 窄屏品牌条（桌面 display:none）：只剩品牌，导航入口已下移到底栏 */}
      <header className="topbar">
        <span className="topbar-brand"><img className="sidebar-logo" src="/logo.svg" alt="文镇" />文镇 TypeFlow</span>
      </header>
      <Sidebar theme={theme} onToggleTheme={toggleTheme} />
      <main className="main">
        {/* 页面转场（错位翻页）由 PageStage 负责：它缓存 useOutlet() 的 element 撑住退场阶段 */}
        <div className="main-inner">
          <PageStage routeKey={pathname} />
        </div>
      </main>
      {/* 窄屏底部入口 + 「更多」菜单，两者桌面都 display:none */}
      <TabBar moreOpen={moreOpen} onMore={() => setMoreOpen((v) => !v)} />
      <MoreMenu open={moreOpen} onClose={() => setMoreOpen(false)} />
    </div>
  );
}