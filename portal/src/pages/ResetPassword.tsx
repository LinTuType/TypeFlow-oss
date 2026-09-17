/**
 * 密码重置落地页 —— 邮件里「设置新密码」按钮的跳转目标（公开页，无需登录）。
 *
 * URL 形如 /reset-password?token=xxx。令牌 30 分钟有效、只能用一次；
 * 成功后服务端已吊销该账号全部旧会话，引导用户用新密码重新登录。
 */

import { useState } from "react";
import { Button } from "../components/ui";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiAuth } from "../api/client";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== password2) {
      setMsg({ ok: false, text: "两次输入的密码不一致" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const { message } = await apiAuth.resetPassword(token, password);
      setDone(true);
      setMsg({ ok: true, text: message });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      padding: "64px 24px", background: "var(--bg)",
    }}>
      <div style={{ maxWidth: 360, width: "100%", textAlign: "center" }}>
        <div style={{ marginBottom: 24, display: "flex", justifyContent: "center" }}>
          <img src="/logo.svg" style={{ width: 80, height: 80 }} alt="文镇" />
        </div>
        <h1 className="serif" style={{ fontSize: 22, color: "var(--ink-900)", margin: "0 0 24px", fontWeight: 500 }}>
          设置新密码
        </h1>

        {!token && (
          <div className="notice err" style={{ textAlign: "left" }}>
            链接不完整（缺少令牌）。请从邮件里的按钮进入，或在
            <Link to="/login" style={{ color: "var(--navy)" }}>登录页</Link>重新申请。
          </div>
        )}

        {token && done ? (
          <>
            {msg && <div className={`notice ${msg.ok ? "ok" : "err"}`} style={{ marginBottom: 20 }}>{msg.text}</div>}
            <Button variant="primary" onClick={() => navigate("/login", { replace: true })}>
              去登录
            </Button>
          </>
        ) : token ? (
          <form onSubmit={submit} style={{ textAlign: "left" }}>
            <div className="field">
              <label>新 密 码</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 8 位" minLength={8} required />
            </div>
            <div className="field">
              <label>再 输 一 遍</label>
              <input className="input" type="password" value={password2} onChange={(e) => setPassword2(e.target.value)}
                placeholder="再输入一次新密码" minLength={8} required />
            </div>
            {msg && <div className={`notice ${msg.ok ? "ok" : "err"}`} style={{ marginBottom: 16 }}>{msg.text}</div>}
            <Button variant="primary" type="submit" disabled={busy} style={{ width: "100%" }}>
              {busy ? "提 交 中 …" : "确认重置"}
            </Button>
            <p style={{ fontSize: 12, color: "var(--ink-300)", lineHeight: 1.7, marginTop: 16 }}>
              重置成功后，你在所有设备上的登录状态都会失效，需要用新密码重新登录。
            </p>
          </form>
        ) : null}

        <div style={{ marginTop: 20 }}>
          <Link to="/login" style={{ fontSize: 12.5, color: "var(--ink-300)" }}>← 返回登录</Link>
        </div>
      </div>
    </div>
  );
}
