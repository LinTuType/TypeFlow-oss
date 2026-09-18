/**
 * 安全与信任 —— 两张流程 + 文字分列 + 自证表：
 *   页头 →「一次签发做了什么」→「一次追溯做了什么」→「数据在哪里」→
 *   自证表（一行摘要 + 就地展开：算法版本 / 源码自证 / 本页自证 / 开源范围）→ 动作
 *
 * 两张流程图的底色 = 数据在哪一侧（跨界白底 / 本机灰底），且互为镜像：
 *   签发 —— 五步里只有「本地嵌入」在本机；追溯 —— 五步里只有「拉取候选配方」跨界。
 *
 * 「数据在哪里」不再画图，改为按本机 / 云端分列的文字；出网 / 不出网清单已撤下（2026-09-18），
 * 出网 / 入网口径以这两处为准（出网 = 字体哈希 · 订单号 · 水印哈希；入网 = 订单配方 32 字节种子）。
 * 两列是**穷举**（口径：只写有什么，不写没有什么 ⇒ 列出来就是全部，所以两侧都得写全）：
 * 本机 = 字体文件/字形轮廓/嵌入中间产物 · 客户资料/备份文件 · 订单备注/授权方案与费用 · 追溯历史/报告；
 * 云端 = 字体哈希/订单号 · 水印哈希/追溯索引 · 主密钥（加密托管）· 账号/邮箱与密码派生值。
 * 账号数据不在这两列里逐项展开 —— 它是范围界定，给一条指向《隐私政策》的可点入口（约定里保留的例外）。
 *
 * 所有证据实时计算：引擎源文件（?raw 导入）实时 SHA-256 + 网络调用扫描，
 * 本页自证 fetch(location.href) 现场算哈希——不依赖预置文案。
 * 折叠态的结论句同样由扫描结果现场判定，不是写死的宣称。
 *
 * ⚠️ 源码 <pre> 必须保持条件渲染（点了才进 DOM）：
 *    Security.tsx 自身的源码里就有 verdict 那几个字串，常挂载会被 e2e 的 text= 计数捞到。
 */

import { useEffect, useMemo, useState } from "react";
import { ALGO_VERSION } from "@engine/webv1";
import {
  PROOF_SOURCES, scanNetworkCalls, sha256Text,
  REPO_URL, OFFLINE_TOOL_PATH, OSS_SCOPE,
} from "../lib/trust";
import { AccordionPanel, Button, PageHeader, Spinner } from "../components/ui";

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
  const [proofOpen, setProofOpen] = useState(false);

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

  /** 折叠态结论句的依据：有几个文件扫出了「非预期」的网络调用（预期出网的除外） */
  const unexpected = useMemo(
    () => PROOF_SOURCES.filter((p) => !scanNetworkCalls(p.source).clean && !p.expectNet).length,
    [],
  );

  return (
    <>
      <PageHeader
        title="安全与信任"
        sub="数据边界、算法版本与自证方式。每项声明都能自行核验，证据在打开页面时算出。"
      />

      {/* ── 一次签发做了什么：五步流程 + 每步的数据与去向 + 产出 ─────────────
          底色 = 数据在哪一侧：跨界步骤白底、本机步骤灰底。 */}
      <div className="block">
        <div className="block-title">一次签发做了什么</div>
        <svg viewBox="0 0 680 180" role="img" aria-labelledby="flow-title flow-desc">
          <title id="flow-title">一次签发做了什么</title>
          <desc id="flow-desc">五步签发流程：登记哈希、创建订单、取云端配方、本地嵌入、提交回执。每步标注流转的数据与去向，其中本地嵌入在本机完成，产出水印字体与授权书交付给客户。</desc>
          <defs>
            <marker id="flow-arrow" markerWidth="9" markerHeight="9" refX="7.7" refY="3.2" orient="auto">
              <path d="M0,0 L7.7,3.2 L0,6.4 z" fill="#918d86" />
            </marker>
            <marker id="flow-arrow-done" markerWidth="9" markerHeight="9" refX="7.7" refY="3.2" orient="auto">
              <path d="M0,0 L7.7,3.2 L0,6.4 z" fill="#97C459" />
            </marker>
          </defs>

          <rect x="40" y="20" width="88" height="64" rx="8" fill="#fffefd" stroke="#d8d3cb" strokeWidth="1" />
          <text x="84" y="42" textAnchor="middle" fontSize="11.5" fill="#34322e">登记哈希</text>
          <text x="84" y="60" textAnchor="middle" fontSize="10.5" fill="#67645f">字体哈希</text>
          <text x="84" y="75" textAnchor="middle" fontSize="9.5" fill="#102d50">出网</text>
          <line x1="128" y1="52" x2="168" y2="52" stroke="#918d86" strokeWidth="1.5" markerEnd="url(#flow-arrow)" />

          <rect x="168" y="20" width="88" height="64" rx="8" fill="#fffefd" stroke="#d8d3cb" strokeWidth="1" />
          <text x="212" y="42" textAnchor="middle" fontSize="11.5" fill="#34322e">创建订单</text>
          <text x="212" y="60" textAnchor="middle" fontSize="10.5" fill="#67645f">订单号</text>
          <text x="212" y="75" textAnchor="middle" fontSize="9.5" fill="#102d50">出网</text>
          <line x1="256" y1="52" x2="296" y2="52" stroke="#918d86" strokeWidth="1.5" markerEnd="url(#flow-arrow)" />

          <rect x="296" y="20" width="88" height="64" rx="8" fill="#fffefd" stroke="#d8d3cb" strokeWidth="1" />
          <text x="340" y="42" textAnchor="middle" fontSize="11.5" fill="#34322e">取云端配方</text>
          <text x="340" y="60" textAnchor="middle" fontSize="10.5" fill="#67645f">32 字节种子</text>
          <text x="340" y="75" textAnchor="middle" fontSize="9.5" fill="#102d50">入网</text>
          <line x1="384" y1="52" x2="424" y2="52" stroke="#918d86" strokeWidth="1.5" markerEnd="url(#flow-arrow)" />

          <rect x="424" y="20" width="88" height="64" rx="8" fill="#f5f3ef" stroke="#d8d3cb" strokeWidth="1" />
          <text x="468" y="42" textAnchor="middle" fontSize="11.5" fill="#34322e">本地嵌入</text>
          <text x="468" y="60" textAnchor="middle" fontSize="10.5" fill="#67645f">字体文件</text>
          <text x="468" y="75" textAnchor="middle" fontSize="9.5" fill="#597060">本机</text>
          <line x1="512" y1="52" x2="552" y2="52" stroke="#918d86" strokeWidth="1.5" markerEnd="url(#flow-arrow)" />

          <rect x="552" y="20" width="88" height="64" rx="8" fill="#fffefd" stroke="#d8d3cb" strokeWidth="1" />
          <text x="596" y="42" textAnchor="middle" fontSize="11.5" fill="#34322e">提交回执</text>
          <text x="596" y="60" textAnchor="middle" fontSize="10.5" fill="#67645f">水印哈希</text>
          <text x="596" y="75" textAnchor="middle" fontSize="9.5" fill="#102d50">出网</text>

          <path d="M468,84 L468,93 Q468,101 460,101 L348,101 Q340,101 340,109 L340,116"
            fill="none" stroke="#97C459" strokeWidth="1.5" markerEnd="url(#flow-arrow-done)" />
          <rect x="240" y="118" width="200" height="42" rx="8" fill="#EAF3DE" stroke="#97C459" strokeWidth="1" />
          <text x="340" y="135" textAnchor="middle" fontSize="11.5" fill="#3B6D11">水印字体 · 授权书</text>
          <text x="340" y="150" textAnchor="middle" fontSize="10" fill="#3B6D11">交付给客户</text>
        </svg>
      </div>

      {/* ── 一次追溯做了什么：五步流程 + 产出 ─────────────────────────────
          与签发流程互为镜像：五步里只有「拉取候选配方」跨界（白底），其余四步都在本机（灰底）。 */}
      <div className="block">
        <div className="block-title">一次追溯做了什么</div>
        <svg viewBox="0 0 680 180" role="img" aria-labelledby="trace-title trace-desc">
          <title id="trace-title">一次追溯做了什么</title>
          <desc id="trace-desc">五步追溯流程：导入可疑字体、读取字体自证、匹配本机原版、向云端拉取候选订单与配方、本机比对水印信号。五步里只有拉取候选会出网，产出鉴定书并在本机留存。</desc>
          <defs>
            <marker id="trace-arrow" markerWidth="9" markerHeight="9" refX="7.7" refY="3.2" orient="auto">
              <path d="M0,0 L7.7,3.2 L0,6.4 z" fill="#918d86" />
            </marker>
            <marker id="trace-arrow-done" markerWidth="9" markerHeight="9" refX="7.7" refY="3.2" orient="auto">
              <path d="M0,0 L7.7,3.2 L0,6.4 z" fill="#97C459" />
            </marker>
          </defs>

          <rect x="40" y="20" width="88" height="64" rx="8" fill="#f5f3ef" stroke="#d8d3cb" strokeWidth="1" />
          <text x="84" y="42" textAnchor="middle" fontSize="11.5" fill="#34322e">导入可疑字体</text>
          <text x="84" y="60" textAnchor="middle" fontSize="10.5" fill="#67645f">可疑字体</text>
          <text x="84" y="75" textAnchor="middle" fontSize="9.5" fill="#597060">本机</text>
          <line x1="128" y1="52" x2="168" y2="52" stroke="#918d86" strokeWidth="1.5" markerEnd="url(#trace-arrow)" />

          <rect x="168" y="20" width="88" height="64" rx="8" fill="#f5f3ef" stroke="#d8d3cb" strokeWidth="1" />
          <text x="212" y="42" textAnchor="middle" fontSize="11.5" fill="#34322e">读取自证</text>
          <text x="212" y="60" textAnchor="middle" fontSize="10.5" fill="#67645f">订单号</text>
          <text x="212" y="75" textAnchor="middle" fontSize="9.5" fill="#597060">本机</text>
          <line x1="256" y1="52" x2="296" y2="52" stroke="#918d86" strokeWidth="1.5" markerEnd="url(#trace-arrow)" />

          <rect x="296" y="20" width="88" height="64" rx="8" fill="#f5f3ef" stroke="#d8d3cb" strokeWidth="1" />
          <text x="340" y="42" textAnchor="middle" fontSize="11.5" fill="#34322e">匹配本机原版</text>
          <text x="340" y="60" textAnchor="middle" fontSize="10.5" fill="#67645f">原版字体</text>
          <text x="340" y="75" textAnchor="middle" fontSize="9.5" fill="#597060">本机</text>
          <line x1="384" y1="52" x2="424" y2="52" stroke="#918d86" strokeWidth="1.5" markerEnd="url(#trace-arrow)" />

          <rect x="424" y="20" width="88" height="64" rx="8" fill="#fffefd" stroke="#d8d3cb" strokeWidth="1" />
          <text x="468" y="42" textAnchor="middle" fontSize="11.5" fill="#34322e">拉取候选配方</text>
          <text x="468" y="60" textAnchor="middle" fontSize="10.5" fill="#67645f">原版哈希</text>
          <text x="468" y="75" textAnchor="middle" fontSize="9.5" fill="#102d50">出网 · 入网</text>
          <line x1="512" y1="52" x2="552" y2="52" stroke="#918d86" strokeWidth="1.5" markerEnd="url(#trace-arrow)" />

          <rect x="552" y="20" width="88" height="64" rx="8" fill="#f5f3ef" stroke="#d8d3cb" strokeWidth="1" />
          <text x="596" y="42" textAnchor="middle" fontSize="11.5" fill="#34322e">比对水印信号</text>
          <text x="596" y="60" textAnchor="middle" fontSize="10.5" fill="#67645f">命中订单</text>
          <text x="596" y="75" textAnchor="middle" fontSize="9.5" fill="#597060">本机</text>

          <path d="M596,84 L596,93 Q596,101 588,101 L508,101 Q500,101 500,109 L500,116"
            fill="none" stroke="#97C459" strokeWidth="1.5" markerEnd="url(#trace-arrow-done)" />
          <rect x="400" y="118" width="200" height="42" rx="8" fill="#EAF3DE" stroke="#97C459" strokeWidth="1" />
          <text x="500" y="135" textAnchor="middle" fontSize="11.5" fill="#3B6D11">鉴定书</text>
          <text x="500" y="150" textAnchor="middle" fontSize="10" fill="#3B6D11">命中订单与置信度</text>
        </svg>
      </div>

      {/* ── 数据在哪里：本机 / 云端各存什么（横向并排，窄屏回落单列） ─────────
          两列都是**穷举**：口径是「只写有什么，不写没有什么」——列出来就是全部，
          所以两侧都得写全，漏项等于对外少声明一项。 */}
      <div className="block">
        <div className="block-title">数据在哪里</div>
        <div className="loc-grid">
          <div>
            <div className="loc-head">本机浏览器</div>
            <div className="loc-body">
              <div>字体文件 · 字形轮廓 · 嵌入中间产物</div>
              <div>客户资料 · 备份文件</div>
              <div>订单备注 · 授权方案与费用</div>
              <div>追溯历史 · 报告</div>
            </div>
          </div>
          <div>
            <div className="loc-head">文镇云端</div>
            <div className="loc-body">
              <div>字体哈希 · 订单号</div>
              <div>水印哈希 · 追溯索引</div>
              <div>主密钥 · 加密托管</div>
              <div>账号 · 邮箱与密码派生值</div>
            </div>
          </div>
        </div>
        {/* 范围界定（约定里保留的例外之一，不是否定式后缀）：账号数据不在本页逐项展开，
            它归《隐私政策》管，所以给一条可点的指向，而不是让读者以为「没写就是没有」。 */}
        <div className="loc-note">
          账号服务（登录、验证邮件）见<a href="/privacy" target="_blank" rel="noreferrer">《隐私政策》</a>
        </div>
      </div>

      {/* ── 自证表：折叠态一行摘要，证据收进展开体 ─────────────────────── */}
      <div className="verify-table">
        <div className="verify-row">
          <div className="verify-label">可验证性</div>
          <div className="verify-main">
            <div className="verify-summary">
              <span style={{ color: unexpected ? "var(--rust)" : "var(--green)" }}>
                {unexpected
                  ? `✕ ${unexpected} 个源文件出现非预期网络调用`
                  : `✓ ${PROOF_SOURCES.length} 个源文件已实时哈希，无异常网络调用`}
              </span>
              <span className="sep">·</span>
              <span>算法版本 <span className="mono">{ALGO_VERSION}</span></span>
              <span className="sep">·</span>
              <span>本页 SHA-256 {selfHash ? "已实时计算" : "计算中"}</span>
            </div>
          </div>
          <button
            className={`verify-toggle${proofOpen ? " open" : ""}`}
            aria-expanded={proofOpen}
            onClick={() => setProofOpen((v) => !v)}
          >
            {proofOpen ? "收起自证详情" : "查看自证详情"}
          </button>
        </div>

        <AccordionPanel open={proofOpen}>
          <div className="verify-inner">
            <div className="drow">
              <small>算法版本</small>
              <b><span className="mono" style={{ fontSize: 15 }}>{ALGO_VERSION}</span>（已冻结，改动需升版本号）</b>
            </div>

            <div className="drow">
              <small>源码自证</small>
              <div className="verify-note">
                浏览器内实时算 SHA-256、扫网络调用。源码见{" "}
                <a href={REPO_URL} target="_blank" rel="noreferrer">开源仓库</a>
              </div>
              {PROOF_SOURCES.map((p) => {
                const scan = scanNetworkCalls(p.source);
                const open = openPath === p.path;
                const verdict = scan.clean
                  ? { text: "✓ 无网络调用", color: "var(--green)" }
                  : p.expectNet
                    ? { text: "✓ 仅限预期出网", color: "var(--navy)" }
                    : { text: `✕ 发现 ${scan.hits.join(" / ")}`, color: "var(--rust)" };
                return (
                  <div className="verify-src" key={p.path}>
                    <div className="proof-head">
                      <span style={{ fontSize: 12, fontWeight: 500, color: verdict.color }}>
                        {verdict.text}
                      </span>
                      <code className="proof-path">{p.path}</code>
                      <button className="verify-src-btn"
                        onClick={() => setOpenPath(open ? null : p.path)}>
                        {open ? "收起源码" : "查看源码"}
                      </button>
                    </div>
                    <div className="verify-src-meta">
                      {p.title} · SHA-256 {hashes[p.path] ? <code>{hashes[p.path]}</code> : <Spinner />}
                    </div>
                    {open && <pre className="proof-src">{p.source}</pre>}
                  </div>
                );
              })}
            </div>

            <div className="drow">
              <small>本页自证 · SHA-256（打开页面时实时计算）</small>
              <b className="hash-line">{selfHash ?? "正在计算……"}</b>
            </div>

            <div className="drow">
              <small>开源范围</small>
              <div className="verify-note">公开部分为可自证内容，私有部分另行评估</div>
              {OSS_SCOPE.map((o) => (
                <div className="verify-oss" key={o.area}>
                  <div className="verify-oss-head">
                    <span className="verify-oss-tag"
                      style={{ color: o.open ? "var(--green)" : "var(--rust)" }}>
                      {o.open ? "✓ 公开" : "✕ 私有"}
                    </span>
                    <span>{o.area}</span>
                  </div>
                  <div className="verify-oss-why">{o.why}</div>
                </div>
              ))}
            </div>
          </div>
        </AccordionPanel>
      </div>

      <div className="actions" style={{ marginTop: 36 }}>
        <a className="btn btn-outline btn-md" href={OFFLINE_TOOL_PATH} download="typeflow-local-signer.html">
          下载离线签名工具
        </a>
        <Button onClick={runSelfCheck}>重新自检</Button>
      </div>
    </>
  );
}
