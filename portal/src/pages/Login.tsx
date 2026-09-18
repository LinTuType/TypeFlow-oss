/**
 * 登录 / 注册（v9 语言：纸面直排 + 规线下划线控件，无卡片底板）
 *
 *  居中纯净登录：大 logo + 中性副标题 + 表单，登录页不放大标题
 *  不堆叠安全宣传 —— 信任页单独走顶栏 nav 入口
 */

import { useState } from "react";
import { Button } from "../components/ui";
import { useNavigate } from "react-router-dom";
import { apiAuth, setToken, setTenant, setEmailVerified } from "../api/client";
import { isOnboardingDismissed } from "../lib/onboarding";

export default function Login() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [forgot, setForgot] = useState(false);
  const [forgotMsg, setForgotMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [forgotBusy, setForgotBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (mode === "register") {
        if (!displayName.trim()) throw new Error("请填写显示名称");
        if (!agreed) throw new Error("需要先阅读并同意《用户协议》与《隐私政策》");
        await apiAuth.register(email, password, displayName.trim(), agreed);
        setMsg({ ok: true, text: "注册成功，已自动登录" });
      }
      const res = await apiAuth.login(email, password);
      setToken(res.token);
      // 显示名以服务端为准（登录时表单里没有昵称，只有注册时才有；曾经因此退化成显示邮箱）
      setTenant(res.display_name || displayName.trim() || email);
      // 邮箱验证状态：未验证会挡住签发，设置页据此给出提示与重发入口
      setEmailVerified(res.email_verified === true);
      // 首次登录算首次（用户 2026-09-18 口径）：引导还没放过就先走一遍「开始使用」。
      // 注册与登录共用一个出口 —— 两个模式都覆盖；完成或跳过后标记写住，之后直接进概览。
      navigate(isOnboardingDismissed() ? "/" : "/welcome", { replace: true });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  /** 忘记密码：服务端无论邮箱存不存在都回同一句话（防枚举），直接原样展示 */
  const submitForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotBusy(true);
    setForgotMsg(null);
    try {
      const { message } = await apiAuth.forgotPassword(email);
      setForgotMsg({ ok: true, text: message });
    } catch (err) {
      setForgotMsg({ ok: false, text: (err as Error).message });
    } finally {
      setForgotBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-box">

        <div className="login-head">
          <img className="login-logo" src="/logo.svg" alt="文镇" />
          <h1>文镇 · TypeFlow</h1>
          <p className="login-sub">登录到工作台</p>
        </div>

        {/* 忘记密码：内联小流程，替换整个表单区（不弹窗、不跳页） */}
        {forgot ? (
          <form onSubmit={submitForgot}>
            <label className="login-field">
              <span className="field-label">注册邮箱</span>
              <input className="line-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@studio.com" required />
            </label>
            {forgotMsg && (
              <div className={`notice ${forgotMsg.ok ? "ok" : "err"}`} style={{ marginTop: 12, marginBottom: 16 }}>
                {forgotMsg.text}
              </div>
            )}
            <Button variant="primary" type="submit" disabled={forgotBusy} style={{ width: "100%" }}>
              {forgotBusy ? "发送中…" : "发送重置邮件"}
            </Button>
            <div className="login-alt">
              <Button variant="ghost" size="sm" type="button" onClick={() => { setForgot(false); setForgotMsg(null); setMsg(null); }}>
                返回登录
              </Button>
            </div>
          </form>
        ) : (
        <form onSubmit={submit}>
          {mode === "register" && (
            <label className="login-field">
              <span className="field-label">显示名称</span>
              <input className="line-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                placeholder="例如：我的字库工作室" />
            </label>
          )}
          <label className="login-field">
            <span className="field-label">邮箱</span>
            <input className="line-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@studio.com" required />
          </label>
          <label className="login-field">
            <span className="field-label">密码</span>
            <input className="line-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "register" ? "至少 8 位" : "输入密码"} minLength={8} required />
          </label>

          {msg && (
            <div className={`notice ${msg.ok ? "ok" : "err"}`} style={{ marginTop: 12, marginBottom: 16 }}>
              {msg.text}
            </div>
          )}

          <div className="login-row">
            <Button variant="ghost" size="sm" type="button" onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setMsg(null);
              setAgreed(false);
            }}>
              {mode === "login" ? "没有账号？注册" : "已有账号？登录"}
            </Button>
            {mode === "login" && (
              <button type="button" className="login-forgot"
                onClick={() => { setForgot(true); setMsg(null); }}>
                忘记密码？
              </button>
            )}
          </div>

          {/* 合规：注册必须勾选（服务端会核对，没勾直接 400） */}
          {mode === "register" && (
            <label className="login-agree">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                style={{ marginTop: 4 }}
                aria-label="同意用户协议与隐私政策"
              />
              <span>
                我已阅读并同意
                <a href="/terms" target="_blank" rel="noreferrer">《用户协议》</a>与
                <a href="/privacy" target="_blank" rel="noreferrer">《隐私政策》</a>
                <span style={{ color: "var(--muted)" }}>（字体文件不上传，云端只存哈希）</span>
              </span>
            </label>
          )}

          <Button variant="primary" type="submit" disabled={busy || (mode === "register" && !agreed)}
            style={{ width: "100%" }}>
            {busy ? "处理中…" : mode === "login" ? "登录" : "注册并登录"}
          </Button>
        </form>
        )}
      </div>
    </div>
  );
}
