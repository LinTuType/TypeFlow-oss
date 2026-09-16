/**
 * 邮箱验证落地页 —— 注册后验证邮件里「验证邮箱」按钮的跳转目标（公开页）。
 *
 * 进入即自动消费令牌（一次性、24 小时有效）；验证状态只做记录，
 * 不阻断任何功能（内测期策略）——它真正的作用是保证"自助找回密码"
 * 用的邮箱确实是用户本人的。
 */

import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiAuth } from "../api/client";

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<"working" | "ok" | "fail">("working");
  const [message, setMessage] = useState("");
  // 防止 StrictMode 下 useEffect 双执行把令牌消费两次（第二次必然 400）
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current || !token) return;
    fired.current = true;
    apiAuth.verifyEmail(token)
      .then((r) => { setState("ok"); setMessage(r.message ?? "邮箱已验证"); })
      .catch((err: Error) => { setState("fail"); setMessage(err.message); });
  }, [token]);

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      padding: "64px 24px", background: "var(--bg)",
    }}>
      <div style={{ maxWidth: 360, width: "100%", textAlign: "center" }}>
        <div style={{ marginBottom: 24, display: "flex", justifyContent: "center" }}>
          <img src="/logo.svg" style={{ width: 80, height: 80 }} alt="文镇" />
        </div>
        <h1 className="serif" style={{ fontSize: 22, color: "var(--ink-900)", margin: "0 0 20px", fontWeight: 500 }}>
          邮箱验证
        </h1>

        {!token ? (
          <div className="notice err">链接不完整（缺少令牌）。请从邮件里的按钮进入。</div>
        ) : state === "working" ? (
          <p style={{ fontSize: 13.5, color: "var(--ink-2)" }}>验证中 …</p>
        ) : state === "ok" ? (
          <div className="notice ok" style={{ marginBottom: 20 }}>{message}</div>
        ) : (
          <div className="notice err" style={{ marginBottom: 20 }}>{message}</div>
        )}

        <div style={{ marginTop: 12 }}>
          <Link to="/login" style={{ fontSize: 12.5, color: "var(--ink-300)" }}>← 返回登录</Link>
        </div>
      </div>
    </div>
  );
}
