/**
 * 零上传信任面板 —— 用「承诺 + 可核验证据」打消字体上传顾虑
 *
 * 三段式：
 *   1. 承诺卡：一句话说清字体去哪了
 *   2. 数据流向图：本机 ↔ 云端之间到底传了什么（唯一的出网项逐个列出）
 *   3. 源码自证：真实源码 + 实时哈希 + 网络调用扫描（用户可自己验，不用信我们）
 *
 * 字体库页与安全页共用。
 */

import { useEffect, useState } from "react";
import {
  PROOF_SOURCES, scanNetworkCalls, sha256Text,
  REPO_URL, OFFLINE_TOOL_PATH, OUTBOUND_FIELDS, NEVER_OUTBOUND, OSS_SCOPE,
} from "../lib/trust";
import { IconShield } from "./Icon";

/** 本机 ↔ 云端数据流向图（内联 SVG，Navy 配色） */
export function DataFlowDiagram() {
  return (
    <svg viewBox="0 0 680 236" style={{ width: "100%", height: "auto", display: "block" }}
      role="img" aria-label="数据流向：字体文件只在本机，仅哈希与订单信息出网">
      <defs>
        <marker id="tf-arrow-ok" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
          <path d="M0,0 L7,3 L0,6 z" fill="#0e2a4d" />
        </marker>
        <marker id="tf-arrow-back" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
          <path d="M0,0 L7,3 L0,6 z" fill="#0e2a4d" />
        </marker>
      </defs>

      {/* 左：本机 */}
      <rect x="16" y="48" width="196" height="152" rx="6" fill="#FBFAF8" stroke="#EEEAE4" />
      <text x="114" y="34" textAnchor="middle" fontSize="13" fontWeight="600" fill="#37352F">本机浏览器</text>
      <text x="114" y="78" textAnchor="middle" fontSize="12" fill="#6B6A67">字体文件（存 IndexedDB）</text>
      <text x="114" y="106" textAnchor="middle" fontSize="12" fill="#6B6A67">水印嵌入引擎</text>
      <text x="114" y="134" textAnchor="middle" fontSize="12" fill="#6B6A67">授权书生成</text>
      <text x="114" y="168" textAnchor="middle" fontSize="11" fill="#91908C">WebCrypto 本地计算</text>
      <text x="114" y="186" textAnchor="middle" fontSize="11" fill="#91908C">字体从不离开这里</text>

      {/* 右：云端 */}
      <rect x="468" y="48" width="196" height="152" rx="6" fill="#FFFFFF" stroke="#EEEAE4" />
      <text x="566" y="34" textAnchor="middle" fontSize="13" fontWeight="600" fill="#37352F">文镇云端</text>
      <text x="566" y="78" textAnchor="middle" fontSize="12" fill="#6B6A67">哈希元数据</text>
      <text x="566" y="106" textAnchor="middle" fontSize="12" fill="#6B6A67">订单与配方</text>
      <text x="566" y="134" textAnchor="middle" fontSize="12" fill="#6B6A67">追溯索引</text>
      <text x="566" y="168" textAnchor="middle" fontSize="11" fill="#91908C">主密钥仅存于此</text>
      <text x="566" y="186" textAnchor="middle" fontSize="11" fill="#91908C">（订单种子单向派生）</text>

      {/* 通道 1：出网（右上） */}
      <line x1="220" y1="76" x2="458" y2="76" stroke="#0e2a4d" strokeWidth="1.5" markerEnd="url(#tf-arrow-ok)" />
      <text x="339" y="64" textAnchor="middle" fontSize="11.5" fill="#0e2a4d">
        ① 出网：{OUTBOUND_FIELDS.map((f) => f.name).join(" · ")}
      </text>
      <text x="339" y="92" textAnchor="middle" fontSize="10.5" fill="#6B6A67">合计不到 1 KB，且不含任何字体内容</text>

      {/* 通道 2：入网（配方，右下） */}
      <line x1="458" y1="150" x2="220" y2="150" stroke="#0e2a4d" strokeWidth="1.5" markerEnd="url(#tf-arrow-back)" />
      <text x="339" y="168" textAnchor="middle" fontSize="11.5" fill="#0e2a4d">② 入网：订单配方（32 字节种子，不含主密钥）</text>

      {/* 被禁止的通道：字体本体 */}
      <line x1="228" y1="116" x2="452" y2="116" stroke="#b85c3c" strokeWidth="1.5"
        strokeDasharray="5 4" opacity="0.75" />
      <line x1="326" y1="106" x2="354" y2="126" stroke="#b85c3c" strokeWidth="2" />
      <line x1="354" y1="106" x2="326" y2="126" stroke="#b85c3c" strokeWidth="2" />
      <text x="275" y="133" textAnchor="middle" fontSize="11.5" fill="#b85c3c">字体文件本体 · 从不传输</text>
      <text x="419" y="133" textAnchor="middle" fontSize="11.5" fill="#b85c3c">云端也无处存放</text>

      {/* 底部注脚 */}
      <text x="340" y="222" textAnchor="middle" fontSize="11" fill="#91908C">
        箭头 ① 是页面上唯一会发出的数据；字体加工全部发生在左侧框内
      </text>
    </svg>
  );
}

/** 源码自证：真实源码 + 实时哈希 + 网络调用扫描 */
function SourceProofList() {
  const [hashes, setHashes] = useState<Record<string, string>>({});
  const [openPath, setOpenPath] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const out: Record<string, string> = {};
      for (const p of PROOF_SOURCES) out[p.path] = await sha256Text(p.source);
      setHashes(out);
    })();
  }, []);

  return (
    <div>
      {PROOF_SOURCES.map((p) => {
        const scan = scanNetworkCalls(p.source);
        const open = openPath === p.path;
        return (
          <div key={p.path} style={{ borderTop: "1px solid var(--paper-200)", paddingTop: 10, marginTop: 10 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, color: scan.clean ? "var(--ok)" : "var(--danger)", fontWeight: 600 }}>
                {scan.clean ? "✓ 无网络调用" : `✕ 发现 ${scan.hits.join(" / ")}`}
              </span>
              <code style={{ fontSize: 12.5, color: "var(--ink-900)" }}>{p.path}</code>
              <button className="btn" style={{ padding: "2px 8px", fontSize: 12, marginLeft: "auto" }}
                onClick={() => setOpenPath(open ? null : p.path)}>
                {open ? "收起源码" : "查看源码"}
              </button>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--ink-500)", marginTop: 2 }}>{p.title}</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-300)", marginTop: 2 }}>
              SHA-256 {hashes[p.path] ? <code>{hashes[p.path]}</code> : "计算中…"}
            </div>
            {open && (
              <pre style={{
                marginTop: 8, maxHeight: 260, overflow: "auto", background: "var(--paper-2)",
                border: "1px solid var(--line)", borderRadius: "var(--radius)",
                padding: 12, fontSize: 11.5, lineHeight: 1.55, color: "var(--sub)",
              }}>{p.source}</pre>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * @param defaultOpen 默认是否展开。字体库页传 false（收起成一条），
 *   让页面重心回到字体本身；安全页完整展开。
 */
export default function TrustPanel({ defaultOpen = true }: { defaultOpen?: boolean }) {
  const [showProof, setShowProof] = useState(false);
  const [open, setOpen] = useState(defaultOpen);

  if (!open) {
    return (
      <button className="trust-bar" onClick={() => setOpen(true)}>
        <IconShield size={15} />
        <b>字体不会离开你的电脑</b>
        <span>本机处理 · 仅哈希出网 · 可自行验证</span>
        <span className="trust-bar-more">展开证据</span>
      </button>
    );
  }

  return (
    <div style={{ marginBottom: 18, padding: "8px 0 0" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 600 }}>字体不会离开你的电脑</h2>
          <p style={{ margin: "0 0 14px", fontSize: 13.5, color: "var(--ink-500)" }}>
            这句话不需要你相信——下面每一条都能自己验。
          </p>
        </div>
        <button className="btn btn-sm" onClick={() => setOpen(false)}>收起</button>
      </div>

      <DataFlowDiagram />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginTop: 16 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-700)", marginBottom: 6 }}>会出网的（就这三样）</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "var(--ink-500)", lineHeight: 1.85 }}>
            {OUTBOUND_FIELDS.map((f) => (
              <li key={f.name}><strong style={{ color: "var(--ink-700)" }}>{f.name}</strong>：{f.detail}</li>
            ))}
          </ul>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-700)", marginBottom: 6 }}>永不出网的</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "var(--ink-500)", lineHeight: 1.85 }}>
            {NEVER_OUTBOUND.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </div>
      </div>

      <div style={{ marginTop: 16, borderTop: "1px solid var(--paper-200)", paddingTop: 12 }}>
        <button className="btn" onClick={() => setShowProof((v) => !v)}>
          {showProof ? "收起" : "展开"}引擎源码自证（{PROOF_SOURCES.length} 个文件）
        </button>
        <span style={{ fontSize: 12.5, color: "var(--ink-500)", marginLeft: 10 }}>
          源码在浏览器里实时算哈希并扫描网络调用，不是我们写的一句承诺
        </span>
        {showProof && <SourceProofList />}
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16, alignItems: "center" }}>
        <a className="btn" href={REPO_URL} target="_blank" rel="noreferrer">查看开源代码（引擎 + 门户）</a>
        <a className="btn" href={OFFLINE_TOOL_PATH} download="typeflow-offline-signer.html">
          下载离线签发工具（可选）
        </a>
        <span style={{ fontSize: 12.5, color: "var(--ink-500)" }}>
          想彻底断网也能用：下载这个单页工具，双击打开即可离线签发。
        </span>
      </div>

      <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--ink-500)", lineHeight: 1.8 }}>
        <strong style={{ color: "var(--ink-700)" }}>开源范围</strong>：
        {OSS_SCOPE.map((s, i) => (
          <span key={s.area}>
            {i > 0 && " · "}
            <span style={{ color: s.open ? "var(--ok, var(--ink-700))" : "var(--ink-500)" }}>
              {s.open ? "✓" : "✕"} {s.area}
            </span>
          </span>
        ))}
        。签发服务端暂不开源，但零上传的证据链全部在浏览器侧，不依赖对服务端的信任。
      </div>
    </div>
  );
}
