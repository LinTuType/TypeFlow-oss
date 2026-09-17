import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import PageStage from "./PageStage";
import { IconMenu } from "./Icon";

/**
 * 应用外壳：桌面 = 238px 固定侧栏 + 居中主内容区；窄屏（≤760px）= 顶栏 + 侧栏抽屉
 *
 * 窄屏此前没有任何兜底：侧栏 fixed 238px + .main 同宽 margin ⇒ 375px 手机内容区只剩约 65px，
 * 必然不可用（§2.5 F-3）。现在 ≤760px 由 CSS 把侧栏收成抽屉，这里补三件事：
 * 汉堡按钮开抽屉 / 遮罩与 Esc 关抽屉 / 路由变化自动收起。
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
  const [navOpen, setNavOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => { applyTheme(theme); }, [theme]);
  // 路由变化即收起抽屉（点导航项后不要让抽屉挡着内容）
  useEffect(() => { setNavOpen(false); }, [pathname]);
  // Esc 也能收
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setNavOpen(false); };
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
      {/* 窄屏顶栏（桌面 display:none）：汉堡开抽屉 */}
      <header className="topbar">
        <button className="topbar-menu" onClick={() => setNavOpen(true)} aria-label="打开导航菜单">
          <IconMenu size={20} />
        </button>
        <span className="topbar-brand"><img className="sidebar-logo" src="/logo.svg" alt="文镇" />文镇 TypeFlow</span>
      </header>
      <Sidebar theme={theme} onToggleTheme={toggleTheme} open={navOpen} />
      <div className={`side-veil${navOpen ? " open" : ""}`} onClick={() => setNavOpen(false)}
        aria-hidden="true" />
      <main className="main">
        {/* 页面转场（错位翻页）由 PageStage 负责：它缓存 useOutlet() 的 element 撑住退场阶段 */}
        <div className="main-inner">
          <PageStage routeKey={pathname} />
        </div>
      </main>
    </div>
  );
}