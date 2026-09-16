import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";

/**
 * 应用外壳：238px 固定侧栏 + 居中主内容区
 *
 * 主题切换状态提升至此处，传递给 Sidebar 和后代（通过 CSS 变量响应）
 * main-inner 按路由 key 重挂载，触发 §08 页面进入动效（180ms 上移淡入）
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
  const { pathname } = useLocation();

  useEffect(() => { applyTheme(theme); }, [theme]);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem(THEME_KEY, next);
  };

  return (
    <div className="layout">
      <Sidebar theme={theme} onToggleTheme={toggleTheme} />
      <main className="main">
        <div className="main-inner" key={pathname}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}