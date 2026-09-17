/**
 * 安全与信任 —— 原型 v9 结构：
 *   页头 → lead 摘要句 → 数据流向 SVG → OUTBOUND/NEVER 双栏清单 →
 *   drow 自证行（算法版本 / 源码自证 / 本页自证 / 离线兜底）→ 动作
 *
 * 所有证据实时计算：引擎源文件（?raw 导入）实时 SHA-256 + 网络调用扫描，
 * 本页自证 fetch(location.href) 现场算哈希——不依赖预置文案。
 */

import { useEffect, useState } from "react";
import { ALGO_VERSION } from "@engine/webv1";
import {
  PROOF_SOURCES, scanNetworkCalls, sha256Text,
  REPO_URL, OFFLINE_TOOL_PATH, OUTBOUND_FIELDS, NEVER_OUTBOUND, OSS_SCOPE,
} from "../lib/trust";
import { Button, InfoI, PageHeader, Spinner } from "../components/ui";

/** 本页自证：打开页面时实时计算（file:// 下诚实降级） */
async function computeSelfHash(): Promise<string> {
  try {
    const buf = await (await fetch(location.href, { cache: "no-store" })).arrayBuffer();
    const h = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return "当前打开方式不支持读取本页源码，HTTP 托管后可用";
  }
}

export default function Security() {
  const [selfHash, setSelfHash] = useState<string | null>(null);
  const [hashes, setHashes] = useState<Record<string, string>>({});
  const [openPath, setOpenPath] = useState<string | null>(null);

  const runSelfCheck = () => {
    setSelfHash(null);
    void computeSelfHash().then(setSelfHash);
    void (async () => {
      const out: Record<string, string> = {};
      for (const p of PROOF_SOURCES) out[p.path] = await sha256Text(p.source);
      setHashes(out);
    })();
  };

  useEffect(runSelfCheck, []);

  return (
    <>
      <PageHeader
        title="安全与信任"
        sub="本页说明数据边界、算法版本与自证方式。下列声明均可独立核验，证据在页面打开时实时计算。"
      />

      {/* 数据流向图（原型 v9 重绘版式，色值取当前规格 token） */}
      <svg viewBox="0 0 680 264" style={{ width: "100%", height: "auto", display: "block", marginTop: 40 }}
        role="img" aria-label="数据流向：字体文件只在本机，出网仅字体哈希与订单信息">
        <defs>
          <marker id="arr-ok" markerWidth="7" markerHeight="7" refX="6" refY="2.5" orient="auto">
            <path d="M0,0 L6,2.5 L0,5 z" fill="#102d50" />
          </marker>
        </defs>
        {/* 左：本机 */}
        <text x="40" y="40" style={{ font: "600 15px var(--serif)" }} fill="#34322e">本机浏览器</text>
        <rect x="24" y="56" width="208" height="184" rx="8" fill="#f5f3ef" stroke="#ebe8e2" strokeWidth="1" />
        <text x="48" y="92" fontSize="12" fill="#4b4a47">字体文件 · IndexedDB</text>
        <text x="48" y="118" fontSize="12" fill="#4b4a47">水印嵌入引擎</text>
        <text x="48" y="144" fontSize="12" fill="#4b4a47">授权书生成</text>
        <line x1="48" y1="164" x2="208" y2="164" stroke="#e0ddd5" strokeWidth="1" />
        <text x="48" y="188" fontSize="10.5" fill="#918d86">WebCrypto 本地计算</text>
        <text x="48" y="208" fontSize="10.5" fill="#918d86">字体文件仅存于本机</text>
        {/* 右：云端 */}
        <text x="488" y="40" style={{ font: "600 15px var(--serif)" }} fill="#34322e">文镇云端</text>
        <rect x="472" y="56" width="184" height="184" rx="8" fill="#fffefd" stroke="#ebe8e2" strokeWidth="1" />
        <text x="496" y="92" fontSize="12" fill="#4b4a47">哈希元数据</text>
        <text x="496" y="118" fontSize="12" fill="#4b4a47">订单与配方</text>
        <text x="496" y="144" fontSize="12" fill="#4b4a47">追溯索引</text>
        <line x1="496" y1="164" x2="632" y2="164" stroke="#e0ddd5" strokeWidth="1" />
        <text x="496" y="188" fontSize="10.5" fill="#918d86">主密钥仅存于云端</text>
        <text x="496" y="208" fontSize="10.5" fill="#918d86">订单种子单向派生</text>
        {/* ① 出网 */}
        <text x="256" y="78" style={{ font: "500 10px var(--mono)" }} fill="#102d50" letterSpacing="1">① 出网</text>
        <line x1="256" y1="88" x2="448" y2="88" stroke="#102d50" strokeWidth="1.5" markerEnd="url(#arr-ok)" />
        <text x="256" y="106" fontSize="10.5" fill="#67645f">字体哈希 · 订单信息 · 水印哈希</text>
        <text x="256" y="122" fontSize="10.5" fill="#918d86">每请求合计不足 1 KB，不含任何字体内容</text>
        {/* 被禁止通道 */}
        <line x1="256" y1="150" x2="448" y2="150" stroke="#aa573d" strokeWidth="1.25" strokeDasharray="5 4" opacity="0.8" />
        <line x1="344" y1="141" x2="360" y2="159" stroke="#aa573d" strokeWidth="1.75" />
        <line x1="360" y1="141" x2="344" y2="159" stroke="#aa573d" strokeWidth="1.75" />
        <text x="256" y="172" fontSize="10.5" fill="#aa573d">字体文件本体 · 不传输，云端不设存储路径</text>
        {/* ② 入网 */}
        <text x="256" y="200" style={{ font: "500 10px var(--mono)" }} fill="#102d50" letterSpacing="1">② 入网</text>
        <line x1="448" y1="210" x2="256" y2="210" stroke="#102d50" strokeWidth="1.5" markerEnd="url(#arr-ok)" />
        <text x="256" y="228" fontSize="10.5" fill="#67645f">订单配方 · 32 字节种子，不含主密钥</text>
        {/* 底注 */}
        <text x="340" y="254" textAnchor="middle" fontSize="10.5" fill="#918d86">
          通道 ① 为全部业务出网数据；字体处理均在本地完成
        </text>
      </svg>

      {/* OUTBOUND / NEVER 双栏（原型 facts） */}
      <div className="facts">
        <div>
          <div className="kicker">OUTBOUND</div>
          <div className="section-title">出网数据项
            <InfoI>本清单与上方数据流向图逐项列出与字体及业务相关的全部出网数据，不存在其他业务出网通道。账号服务（登录、验证邮件等）与字体无关，详见《隐私政策》。</InfoI>
          </div>
          <ul>
            {OUTBOUND_FIELDS.map((f) => (
              <li key={f.name}><b>{f.name}</b>：{f.detail}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="kicker">NEVER</div>
          <div className="section-title">本地专属数据</div>
          <ul>
            {NEVER_OUTBOUND.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </div>
      </div>

      {/* 开源范围（决策点 3 拍板结果上屏——原先这段唯一渲染在没人引用的死组件里） */}
      <div className="drow"><small>开源范围 · 公开部分为可自证内容，私有部分另行评估</small>
        <div className="sublist">
          {OSS_SCOPE.map((o) => (
            <div key={o.area}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: o.open ? "var(--green)" : "var(--rust)" }}>
                  {o.open ? "✓ 公开" : "✕ 私有"}
                </span>
                <span style={{ fontSize: 12.5 }}>{o.area}</span>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{o.why}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 自证行（原型 drow） */}
      <div className="drow"><small>算法版本</small>
        <b><span className="mono" style={{ fontSize: 15 }}>{ALGO_VERSION}</span>（已冻结，改动需升版本号）</b>
      </div>
      <div className="drow"><small>源码自证 · 浏览器内对上述 {PROOF_SOURCES.length} 个关键源文件实时计算 SHA-256 并扫描网络调用（<a href={REPO_URL} target="_blank" rel="noreferrer" style={{ color: "var(--navy)" }}>开源仓库：引擎与门户公开，签发服务端私有</a>）</small>
        <div className="sublist">
          {PROOF_SOURCES.map((p) => {
            const scan = scanNetworkCalls(p.source);
            const open = openPath === p.path;
            const verdict = scan.clean
              ? { text: "✓ 无网络调用", color: "var(--green)" }
              : p.expectNet
                ? { text: "✓ 仅限预期出网", color: "var(--navy)" }
                : { text: `✕ 发现 ${scan.hits.join(" / ")}`, color: "var(--rust)" };
            return (
              <div key={p.path}>
                <div className="proof-head">
                  <span style={{ fontSize: 12, color: verdict.color, fontWeight: 600 }}>
                    {verdict.text}
                  </span>
                  <code className="proof-path">{p.path}</code>
                  <Button variant="ghost" size="sm"
                    onClick={() => setOpenPath(open ? null : p.path)}>
                    {open ? "收起源码" : "查看源码"}
                  </Button>
                </div>
                <div className="proof-meta">
                  {p.title}{p.expectNet && `——${p.expectNet}`} · SHA-256 {hashes[p.path]
                    ? <code>{hashes[p.path]}</code>
                    : <Spinner />}
                </div>
                {open && (
                  <pre className="proof-src">{p.source}</pre>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="drow"><small>本页自证 · SHA-256（打开页面时实时计算）</small>
        <b className="hash-line">{selfHash ?? "正在计算……"}</b>
      </div>
      <div className="drow"><small>离线兜底</small>
        <b>支持完全离线签发：使用离线签名工具，配方于本机生成，证据可离线核验</b>
      </div>

      <div className="actions" style={{ marginTop: 24 }}>
        <a className="btn btn-outline btn-md" href={OFFLINE_TOOL_PATH} download="typeflow-local-signer.html">
          下载离线签名工具
        </a>
        <Button onClick={runSelfCheck}>重新自检</Button>
      </div>
    </>
  );
}
