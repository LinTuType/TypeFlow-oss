/**
 * 追溯页 —— 原型 v9 结构：双上传卡（.upload）+ 说明 + 分析按钮 → 内联报告
 *
 * 用法（两文件）：
 *   ① 原版字体（对标基准）
 *   ② 可疑/泄漏的字体（待验证）
 * 点【开始分析】→ 全程本地 + 云端配方双重完成：
 *   1. 云端按原版哈希返回候选订单
 *   2. 逐个候选取配方（order_root，云端只给订单种子）
 *   3. 本地引擎 traceWatermark 双通道比对（锚定 + 配对 + 平移扫描）
 *   4. 出命中订单 + 置信度 → 内联追溯报告（原型 report 版式）
 *
 * 注意：字体本身不出本机，云端只收到原版 SHA-256 与订单号。
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "../lib/toast";
import { fullTrace, sha256Hex, readSelfClaim, type FullTraceOutcome } from "../lib/trace";
import { PageHeader, Spinner } from "../components/ui";
import TraceReport from "../components/TraceReport";

/** 本地算 SHA-256（追溯用） */
async function fileSha256(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function Trace() {
  const [origFile, setOrigFile] = useState<File | null>(null);
  const [suspFile, setSuspFile] = useState<File | null>(null);
  const [origSha, setOrigSha] = useState("");
  const [suspSha, setSuspSha] = useState("");
  const [suspClaim, setSuspClaim] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<FullTraceOutcome | null>(null);

  const pickOrig = async (f: File | null) => {
    setOrigFile(f);
    setOrigSha("");
    if (f) {
      const h = await fileSha256(f);
      setOrigSha(h);
    }
  };

  const pickSusp = useCallback(async (f: File | null) => {
    setSuspFile(f);
    setSuspSha("");
    setSuspClaim(null);
    setOutcome(null);
    if (f) {
      const buf = await f.arrayBuffer();
      const h = await sha256Hex(new Uint8Array(buf));
      setSuspSha(h);
      const claim = readSelfClaim(new Uint8Array(buf));
      setSuspClaim(claim);
      if (claim) {
        toast.info("可疑字体自带 Name256 自证", { detail: `声称订单 ${claim}` });
      }
    }
  }, []);

  /** 开始完整追溯 */
  const startTrace = async () => {
    if (!origFile || !suspFile) { toast.warn("请先选原版和可疑字体"); return; }
    setBusy(true);
    setOutcome(null);
    try {
      const [origBuf, suspBuf] = await Promise.all([origFile.arrayBuffer(), suspFile.arrayBuffer()]);
      const out = await fullTrace(new Uint8Array(origBuf), new Uint8Array(suspBuf));
      setOutcome(out);
      if (out.error) {
        toast.warn(out.error);
      } else if (out.best?.matched) {
        toast.success(`命中订单 ${out.best.orderId}`, {
          detail: `判定「${out.best.result.verdict.levelLabel}」 · 置信度 ${out.best.result.verdict.score}%`,
        });
      } else if (out.candidates.length > 0) {
        toast.warn("未达命中阈值", {
          detail: `最高判定「${out.best?.result.verdict.levelLabel ?? "—"}」 · 置信度 ${out.best?.result.verdict.score ?? 0}%，见下方报告`,
        });
      }
    } catch (e) {
      toast.error("追溯失败", { detail: (e as Error).message });
    } finally { setBusy(false); }
  };

  const canGo = !busy && !!origFile && !!suspFile;

  return (
    <>
      <PageHeader
        title="字体追溯"
        sub="比较原版字体与可疑字体，分析水印信息并关联可能的签发订单。"
      />

      <input type="file" accept=".ttf,.otf,font/*" hidden id="fileOrig"
        onChange={(e) => void pickOrig(e.target.files?.[0] ?? null)} />
      <input type="file" accept=".ttf,.otf,font/*" hidden id="fileSusp"
        onChange={(e) => void pickSusp(e.target.files?.[0] ?? null)} />

      {/* 原型 v9：并列双上传卡 */}
      <div className="uploads">
        <button className="upload" onClick={() => document.getElementById("fileOrig")?.click()}>
          <h3>原版字体</h3>
          <p>从字体库选择，或使用本地原版文件。</p>
          <div className="fname">{origFile ? origFile.name : ""}</div>
        </button>
        <button className="upload" onClick={() => document.getElementById("fileSusp")?.click()}>
          <h3>可疑字体</h3>
          <p>选择需要鉴定来源的字体文件。</p>
          <div className="fname">{suspFile ? suspFile.name : ""}</div>
        </button>
      </div>

      {suspClaim && (
        <div className="notice" style={{ marginTop: 14 }}>
          可疑字体自带 Name256 自证：声称订单 <span className="mono">{suspClaim}</span>
        </div>
      )}

      <div className="info" style={{ marginTop: 24 }}>
        追溯会分别检查字体差异、水印通道和候选订单。结果仅用于辅助判断，原始文件与分析报告应一并保存。
        字体文件不出本机——云端只收到原版哈希与订单号。
      </div>

      <div className="actions" style={{ justifyContent: "flex-end", marginTop: 24 }}>
        <button className="btn btn-primary btn-md" disabled={!canGo} onClick={() => void startTrace()}>
          {busy ? <Spinner /> : null}
          {busy ? "分析中…" : "开始分析"}
        </button>
      </div>

      {/* 追溯报告（原型 report 版式，内联呈现） */}
      {outcome && !outcome.error && (
        <div style={{ marginTop: 42 }}>
          <TraceReport outcome={outcome} origSha={origSha} suspSha={suspSha}
            origName={origFile?.name ?? "—"} suspName={suspFile?.name ?? "—"}
            origSize={origFile?.size ?? 0} suspSize={suspFile?.size ?? 0} />
        </div>
      )}
      {outcome?.error && (
        <div className="notice warn" style={{ marginTop: 28 }}>
          {outcome.error}
        </div>
      )}
    </>
  );
}
