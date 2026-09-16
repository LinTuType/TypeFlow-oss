/**
 * 登录 / 注册（v1 · Terracotta 风格）
 *
 *  居中纯净登录：大 logo + 中性副标题 + 表单，登录页不放大标题
 *  不堆叠安全宣传 —— 信任页单独走顶栏 nav 入口
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiAuth, setToken, setTenant } from "../api/client";

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
      const { token } = await apiAuth.login(email, password);
      setToken(token);
      setTenant(displayName.trim() || email);
      navigate("/", { replace: true });
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
    <div style={{
      minHeight: "100vh",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "64px 24px",
      background: "var(--bg)",
    }}>
      <div style={{ maxWidth: 360, width: "100%", textAlign: "center" }}>

        {/* 大 logo（无底框，印章原色直出） */}
        <div style={{ marginBottom: 24, display: "flex", justifyContent: "center" }}>
          <img src="/logo.svg" style={{ width: 80, height: 80 }} alt="文镇" />
        </div>

        <h1 className="serif" style={{
          fontSize: 22, color: "var(--ink-900)",
          margin: "0 0 6px", fontWeight: 500, letterSpacing: "0.02em",
        }}>文镇 · TypeFlow</h1>
        <p style={{
          fontSize: 13, color: "var(--ink-700)", opacity: 0.6,
          margin: "0 auto 36px",
        }}>登录到工作台</p>

        {/* 忘记密码：内联小流程，替换整个表单区（不弹窗、不跳页） */}
        {forgot ? (
          <form onSubmit={submitForgot} style={{ textAlign: "left" }}>
            <div className="field">
              <label>注 册 邮 箱</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@studio.com" required />
            </div>
            {forgotMsg && (
              <div className={`notice ${forgotMsg.ok ? "ok" : "err"}`} style={{ marginTop: 12, marginBottom: 16 }}>
                {forgotMsg.text}
              </div>
            )}
            <button className="btn btn-primary" type="submit" disabled={forgotBusy} style={{ width: "100%" }}>
              {forgotBusy ? "发 送 中 …" : "发送重置邮件"}
            </button>
            <div style={{ textAlign: "center", marginTop: 16 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setForgot(false); setForgotMsg(null); setMsg(null); }}>
                返回登录
              </button>
            </div>
          </form>
        ) : (
        <form onSubmit={submit} style={{ textAlign: "left" }}>
          {mode === "register" && (
            <div className="field">
              <label>显 示 名 称</label>
              <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                placeholder="例如：我的字库工作室" />
            </div>
          )}
          <div className="field">
            <label>邮 箱</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@studio.com" required />
          </div>
          <div className="field">
            <label>密 码</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "register" ? "至少 8 位" : "密 码"} minLength={8} required />
          </div>

          {msg && (
            <div className={`notice ${msg.ok ? "ok" : "err"}`} style={{ marginTop: 12, marginBottom: 16 }}>
              {msg.text}
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "8px 0 24px" }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setMsg(null);
              setAgreed(false);
            }}>
              {mode === "login" ? "没有账号？注册" : "已有账号？登录"}
            </button>
            {mode === "login" && (
              <button
                type="button"
                onClick={() => { setForgot(true); setMsg(null); }}
                style={{
                  border: 0, background: "none", padding: 0, cursor: "pointer",
                  fontSize: 12.5, color: "var(--ink-300)", font: "inherit",
                }}
              >
                忘记密码？
              </button>
            )}
          </div>

          {/* 合规：注册必须勾选（服务端会核对，没勾直接 400） */}
          {mode === "register" && (
            <label
              style={{
                display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer",
                fontSize: 12.5, color: "var(--ink-2)", margin: "4px 0 16px", lineHeight: 1.6,
              }}
            >
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
                <span style={{ color: "var(--ink-300)" }}>（字体文件不上传，云端只存哈希）</span>
              </span>
            </label>
          )}

          <button className="btn btn-primary" type="submit" disabled={busy || (mode === "register" && !agreed)}>
            {busy ? "处 理 中 …" : mode === "login" ? "登 录" : "注册并登录"}
          </button>
        </form>
        )}
      </div>
    </div>
  );
}
