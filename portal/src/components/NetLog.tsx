/**
 * 网络日志折叠面板（preview v0.7 亮点）
 *
 * 透明度卖点：在签发/追溯页各放一个「本机 ↔ 云端网络日志」，默认折叠。
 * 它展示**本会话真实发出的请求**（从 fetch 拦截器收集，仅记录方法/路径/状态码，
 * 不记录 body），并固定脚注重申"所有请求仅传哈希/配方/状态"。
 *
 * 诚实边界：拦截器只记录 fetch 调用的 URL 路径与状态——不造假、不夸大，
 * 用户完全可以用浏览器 DevTools 交叉验证。
 */

import { useEffect, useState } from "react";
import { IconShield } from "./Icon";

/** 单条网络记录 */
export interface NetLogEntry {
  id: number;
  method: string;
  path: string;
  status: number | "…";   // "…" = 请求中
  time: string;           // HH:MM:SS
}

let seq = 0;
const listeners = new Set<(e: NetLogEntry) => void>();
let hooked = false;

/** 拦截 fetch，把请求广播给所有 NetLog 面板（全局一次） */
function installFetchHook(): void {
  if (hooked || typeof window === "undefined") return;
  hooked = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = (typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    let p: string;
    try { p = new URL(url, location.origin).pathname; } catch { p = String(url); }
    const m = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : undefined) ?? "GET").toUpperCase();
    const start = Date.now();
    const entry = (status: number | "…") => {
      const t = new Date(start).toTimeString().slice(0, 8);
      listeners.forEach((fn) => fn({ id: ++seq, method: m, path: p, status, time: t }));
    };
    try {
      const res = await orig(input, init);
      entry(res.status);
      return res;
    } catch (e) {
      entry("…");
      throw e;
    }
  };
}

/** 网络日志折叠面板（v0.7 风格：默认折叠，工具化文案） */
export default function NetLog({
  hint,
}: { hint?: string }) {
  const [entries, setEntries] = useState<NetLogEntry[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    installFetchHook();
    const fn = (e: NetLogEntry) => setEntries((prev) => [e, ...prev].slice(0, 20));
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);

  const count = entries.length;

  return (
    <details className="netlog-collapse" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: "var(--ink-500)", flexShrink: 0 }}>
          <path d="M2 12 H 22 M2 6 H 22 M2 18 H 22" />
        </svg>
        <span className="t-eyebrow" style={{ flex: 1, color: "var(--ink-500)" }}>
          网 络 日 志
        </span>
        <span style={{ fontSize: 11.5, color: "var(--ink-300)" }}>{count} 条</span>
        <svg className="caret-svg" width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="1.8" style={{ color: "var(--ink-300)" }}>
          <path d="M6 9l6 6 6-6" /></svg>
      </summary>
      <div className="netlog-list">
        {entries.length === 0 ? (
          <div style={{ padding: "12px 16px", fontSize: 12.5, color: "var(--ink-300)" }}>
            本会话还没有跨云请求 —— 有操作时实时出现在这里。
          </div>
        ) : (
          entries.map((e) => (
            <div className="netlog-row" key={e.id}>
              <span className={`netlog-method m-${e.method}`}>{e.method}</span>
              <span className="netlog-path" title={e.path}>{e.path}</span>
              <span className={`netlog-status${typeof e.status === "number" && e.status < 400 ? " s-2xx" : e.status === "…" ? "" : " s-4xx"}`}>
                {typeof e.status === "number" ? (e.status < 400 ? e.status : `⚠ ${e.status}`) : "…"}
              </span>
              <span className="netlog-time">{e.time}</span>
            </div>
          ))
        )}
      </div>
      {hint && (
        <div className="netlog-foot" style={{ background: "transparent", borderTop: "1px solid var(--rule-soft)" }}>
          <span style={{ flex: 1, color: "var(--ink-500)" }}>{hint}</span>
        </div>
      )}
    </details>
  );
}