import { useEffect } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { getToken } from "./api/client";
import { cleanupLegacyStorage } from "./lib/db";

import Shell from "./components/AppShell";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import Fonts from "./pages/Fonts";
import Issue from "./pages/Issue";
import Orders from "./pages/Orders";
import Trace from "./pages/Trace";
import Security from "./pages/Security";
import Clients from "./pages/Clients";
import Settings from "./pages/Settings";
import { Terms, Privacy } from "./pages/Legal";
import ResetPassword from "./pages/ResetPassword";
import VerifyEmail from "./pages/VerifyEmail";

/** 启动时清理 P0/P3 遗留并申请持久化存储 */
function usePersist() {
  useEffect(() => {
    cleanupLegacyStorage();
    if (navigator.storage?.persist) {
      navigator.storage.persist().catch(() => void 0);
    }
  }, []);
}

/** 路由守卫：未登录跳登录页 */
function RequireAuth({ children }: { children: React.ReactElement }) {
  const token = getToken();
  const location = useLocation();
  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return children;
}

export default function App() {
  usePersist();
  const navigate = useNavigate();
  const location = useLocation();

  // token 变化时若在 login 则跳首页
  useEffect(() => {
    if (getToken() && location.pathname === "/login") {
      navigate("/", { replace: true });
    }
  }, [location.pathname, navigate]);

  return (
    <ErrorBoundary>
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* 合规页：公开可读（注册页会链接过来，此时用户尚未登录） */}
      <Route path="/terms" element={<Terms />} />
      <Route path="/privacy" element={<Privacy />} />
      {/* 邮件链接落地页：公开（用户此时必然未登录——密码重置的前提就是忘了密码） */}
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route element={<RequireAuth><Shell /></RequireAuth>}>
        <Route path="/" element={<Overview />} />
        <Route path="/fonts" element={<Fonts />} />
        <Route path="/issue" element={<Issue />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/customers" element={<Clients />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/trace" element={<Trace />} />
        <Route path="/security" element={<Security />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </ErrorBoundary>
  );
}