/**
 * 追溯页 —— 选取/导入对齐签发页（点条目就地展开），报告落本机历史
 *
 * 两个槽位：
 *   · 原版字体 = pick 行 → 就地展开共用 FontPicker（本机字体库选取 or 导入文件），
 *     与签发页同一条路径、同一套交互语言；导入的文件若与库内字体同哈希，自动按库内字体处理。
 *   · 可疑字体 = pick 行 → 导入文件（可疑字体通常不在你的库里）。
 *
 * 自动匹配（上传即可信）：
 *   可疑字体若自带 Name256 自证订单 → 取该订单云端配方里的 font_sha256 →
 *   在本机字体库里找同一哈希的原版 → 找到就自动填进「原版」槽位，
 *   用户不用再手动翻出原版文件。字体本体始终不出本机。
 *
 * 历史落本机（批次 5.2）：分析完成即生成报告号（TRACE-YYYYMMDD-NNN）并落 IndexedDB，
 * 可回看、可导出打印 HTML、可删除；随本机段备份搬运。上限 50 条。
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "../lib/toast";
import { fullTrace, sha256Hex, readSelfClaim, type FullTraceOutcome, type TracePhase } from "../lib/trace";
import { listLocalFonts, getLocalFontData, type LocalFont } from "../lib/localFonts";
import { apiTrace } from "../api/client";
import {
  newReportNo, recordFromOutcome, saveTraceRecord, listTraceRecords, removeTraceRecord,
  type TraceRecord,
} from "../lib/traceHistory";
import { printTraceReport } from "../lib/traceReportHtml";
import { maybeFolderBackup } from "../lib/backupFolder";
import { assertSupportedFont } from "@engine/ttf/reader.js";
import { AccordionPanel, Button, ConfirmButton, InfoI, PageHeader, Spinner } from "../components/ui";
import TraceReport from "../components/TraceReport";
import FontPicker from "../components/FontPicker";
import { IconChevron, IconPrint, IconTrash } from "../components/Icon";

type OrigSource =
  | { kind: "library"; id: string; name: string; size: number; sha256: string }
  | { kind: "file"; name: string; size: number; sha256: string };

/** 追溯阶段 → 过程槽文案（顺序即推进顺序，由 fullTrace 的 onPhase 驱动） */
const TRACE_PHASE_LABEL: Record<TracePhase, string> = {
  selfclaim: "读取可疑字体自证",
  hash: "计算原版字体指纹",
  candidates: "拉取候选签发订单",
  compare: "比对各通道水印信号",
};

export default function Trace() {
  const [fonts, setFonts] = useState<Array<Omit<LocalFont, "data">>>([]);
  const [loading, setLoading] = useState(true);
  const [importBusy, setImportBusy] = useState(false);

  // 就地展开（同时只开一个，同签发页）
  const [openPicker, setOpenPicker] = useState<"orig" | "susp" | null>(null);

  // 原版槽位
  const [orig, setOrig] = useState<OrigSource | null>(null);
  const [origBytes, setOrigBytes] = useState<Uint8Array | null>(null);

  // 可疑槽位
  const [susp, setSusp] = useState<{ name: string; size: number; sha256: string } | null>(null);
  const [suspBytes, setSuspBytes] = useState<Uint8Array | null>(null);
  const [suspClaim, setSuspClaim] = useState<string | null>(null);
  /** 可疑文件与本机库内某字体完全相同（说明它是未嵌水印的原版拷贝） */
  const [suspMatch, setSuspMatch] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [record, setRecord] = useState<TraceRecord | null>(null);
  const [history, setHistory] = useState<TraceRecord[]>([]);
  /** 过程槽日志：按真实阶段推进逐条累加；traceDone 后槽切到导出动作 */
  const [logLines, setLogLines] = useState<string[]>([]);
  const [traceDone, setTraceDone] = useState(false);
  /** 删除历史时锁住按钮 —— 否则删到一半还能再点（其余四处危险操作都有这道锁） */
  const [delBusy, setDelBusy] = useState(false);

  const load = useCallback(async () => {
    setFonts(await listLocalFonts().catch(() => []));
    setHistory(await listTraceRecords().catch(() => []));
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  /** 原版：从本机库选（与签发页同一条路） */
  const pickFromLibrary = async (id: string) => {
    const f = fonts.find((x) => x.id === id);
    if (!f) return;
    const data = await getLocalFontData(id);
    if (!data) { toast.error("字体数据读取失败", { detail: "请在字体库重新添加该字体" }); return; }
    setOrig({ kind: "library", id: f.id, name: f.name, size: f.size, sha256: f.sha256 });
    setOrigBytes(new Uint8Array(data));
    setOpenPicker(null);
  };

  /** 原版：导入文件（哈希命中库内字体时自动归到库内那一份） */
  const importOrig = async (f: File | null) => {
    if (!f) return;
    setImportBusy(true);
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      assertSupportedFont(buf);                // 原版：入库前先按内容校验（.ttc / WOFF / WOFF2 挡在这里）
      const sha = await sha256Hex(buf);
      const hit = fonts.find((x) => x.sha256 === sha);
      if (hit) {
        // 同一份文件已经在库里：直接用库内的（连带把库 id 关联上，提示更明确）
        const data = await getLocalFontData(hit.id);
        setOrig({ kind: "library", id: hit.id, name: hit.name, size: hit.size, sha256: hit.sha256 });
        setOrigBytes(data ? new Uint8Array(data) : buf);
        toast.info(`这就是字体库里的「${hit.name}」`, { detail: "已按本机字体库中的那份处理" });
      } else {
        setOrig({ kind: "file", name: f.name, size: f.size, sha256: sha });
        setOrigBytes(buf);
      }
      setOpenPicker(null);
    } finally {
      setImportBusy(false);
    }
  };

  /**
   * 可疑：导入文件 + 两级自动匹配
   * ① 文件哈希与库内某字体相同 → 标记"这是未嵌水印的原版拷贝"；
   * ② 自带 Name256 自证订单 → 用订单配方的 font_sha256 反查本机库，
   *    命中且原版槽位为空时自动填上——用户只上传一个文件就能开跑。
   */
  const importSusp = async (f: File | null) => {
    if (!f) return;
    setImportBusy(true);
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      assertSupportedFont(buf);                // 可疑：同上（引擎兜底之外的前置提示）
      const sha = await sha256Hex(buf);
      const claim = readSelfClaim(buf);
      setSusp({ name: f.name, size: f.size, sha256: sha });
      setSuspBytes(buf);
      setSuspClaim(claim);
      setRecord(null);
      setSuspMatch(fonts.find((x) => x.sha256 === sha)?.name ?? null);

      // 自证订单 → 配方里的原版哈希 → 本机库匹配
      if (claim) {
        try {
          const res = await apiTrace.orderRecipe(claim);
          const recipe = (res.recipe ?? res) as { font_sha256?: string };
          const shaHex = recipe?.font_sha256?.toLowerCase();
          const hit = shaHex ? fonts.find((x) => x.sha256 === shaHex) : undefined;
          if (hit) {
            if (!orig) {
              await pickFromLibrary(hit.id);
              toast.info(`已按自证订单自动匹配原版：${hit.name}`, {
                detail: `可疑字体声明来自订单 ${claim}，其原版就在你的字体库里`,
              });
            } else {
              toast.info(`自证订单 ${claim} 的原版是「${hit.name}」`, { detail: "当前已选原版与此不同，如需改选请在「原版字体」里换" });
            }
          }
        } catch { /* 自证订单取不到配方（已作废/无权限）→ 静默，手动选原版即可 */ }
      } else if (!orig) {
        toast.info("已导入可疑字体", { detail: "该文件未嵌入自证信息，请再选择原版字体作为比对基准" });
      }
      setOpenPicker(null);
    } finally {
      setImportBusy(false);
    }
  };

  /** 开始完整追溯 → 报告落本机历史 */
  const startTrace = async () => {
    if (!origBytes || !suspBytes || !orig || !susp) { toast.warn("请先选原版和可疑字体"); return; }
    setBusy(true);
    setRecord(null);
    setLogLines([]);
    setTraceDone(false);
    try {
      // onPhase 由 fullTrace 在真实阶段推进时回调（读自证 → 算哈希 → 拉候选 → 逐单比对）
      const out: FullTraceOutcome = await fullTrace(origBytes, suspBytes, (p) => {
        setLogLines((prev) => [...prev, TRACE_PHASE_LABEL[p]]);
      });
      const no = await newReportNo();
      const rec = recordFromOutcome(out, {
        origName: orig.name, origSha256: orig.sha256, origSize: orig.size,
        suspName: susp.name, suspSha256: susp.sha256, suspSize: susp.size,
      }, no);
      await saveTraceRecord(rec);
      setRecord(rec);
      setHistory(await listTraceRecords());
      maybeFolderBackup();
      if (out.error) {
        toast.warn(out.error, { detail: `报告 ${no} 已存入本机历史` });
      } else if (rec.matched) {
        toast.success(`命中订单 ${rec.bestOrderId}`, {
          detail: `判定「${rec.candidates[0]?.levelLabel ?? "—"}」 · 报告 ${no} 已存入本机历史`,
        });
      } else if (rec.candidates.length > 0) {
        toast.warn("未达命中阈值", { detail: `报告 ${no} 已存入本机历史，见下方报告` });
      }
    } catch (e) {
      toast.error("追溯失败", { detail: (e as Error).message });
    } finally { setBusy(false); setTraceDone(true); }
  };

  const canGo = !busy && !!origBytes && !!suspBytes;

  return (
    <>
      <PageHeader
        title="字体追溯"
        sub={<>比较原版字体与可疑字体，分析水印信息并关联可能的签发订单。报告自动存入本机历史。
          <InfoI>追溯会分别检查字体差异、水印通道和候选订单。原始文件与本报告应一并保存——
            报告可随时从下方历史导出（打印为 PDF）。字体文件不出本机，云端只收到原版哈希与订单号。</InfoI>
        </>}
      />

      {/* 左右栏（镜向签发页）：左 = 鉴定书与历史（产出），右 = 导入与动作 */}
      <div className="trace-layout">
        {/* ── 左：鉴定书 + 追溯历史（同栏，滚动阅读连续） ── */}
        <section>
          <TraceReport record={record} process={{
            lines: logLines,
            done: traceDone,
            actions: record ? (
              <button className="proc-a" onClick={() => printTraceReport(record)}>
                导出鉴定书（打印为 PDF）
              </button>
            ) : null,
          }} />
        </section>

        {/* ── 右：导入与动作（与签发页同一套「点条目就地展开」） ── */}
        <section>
          <div className="issue-field">
            <button className={`pick${orig ? "" : " empty"}`} aria-expanded={openPicker === "orig"}
              onClick={() => setOpenPicker(openPicker === "orig" ? null : "orig")}>
              <span className="pick-text">
                <small>原版字体（比对基准）</small>
                <b>{orig ? orig.name : "选择原版字体"}</b>
              </span>
              <IconChevron size={16} className="pick-chev" />
            </button>
            <AccordionPanel open={openPicker === "orig"}>
              <FontPicker
                fonts={fonts} loading={loading} busy={importBusy}
                onPick={(id) => void pickFromLibrary(id)}
                onImport={(f) => void importOrig(f)}
              />
            </AccordionPanel>
          </div>

          <div className="issue-field">
            <button className={`pick${susp ? "" : " empty"}`} aria-expanded={openPicker === "susp"}
              onClick={() => setOpenPicker(openPicker === "susp" ? null : "susp")}>
              <span className="pick-text">
                <small>可疑字体（待鉴定）
                  <InfoI>可疑字体通常不在你的字体库里——从本机选择文件导入即可。若它自带水印自证，
                    会尝试自动匹配你的原版字体。文件不会上传。</InfoI>
                </small>
                <b>{susp ? susp.name : "导入可疑字体"}</b>
              </span>
              <IconChevron size={16} className="pick-chev" />
            </button>
            <AccordionPanel open={openPicker === "susp"}>
              <FontPicker
                fonts={[]} loading={false} busy={importBusy}
                onPick={() => void 0} onImport={(f) => void importSusp(f)}
              />
            </AccordionPanel>
          </div>

          {/* 自动匹配提示（就地进行，不打断） */}
          {(suspClaim || suspMatch) && (
            <div className="notice" style={{ marginTop: 4 }}>
              {suspMatch && <div>该文件与字体库中的「{suspMatch}」完全相同 —— 它是<b>未嵌水印的原版拷贝</b>，不含可追溯水印。</div>}
              {suspClaim && <div>可疑字体自带 Name256 自证：声称订单 <span className="mono">{suspClaim}</span></div>}
            </div>
          )}

          <div className="issue-actions">
            <Button variant="primary" style={{ flex: 1 }} disabled={!canGo} onClick={() => void startTrace()}>
              {busy ? <Spinner /> : null}
              {busy ? "分析中…" : "开始分析"}
            </Button>
          </div>

          {/* ── 追溯历史（本机 IndexedDB，上限 50 条，随本机段备份搬运）
                 放在开始分析之下：同属"操作 → 记录"这一列，左栏整栏留给鉴定书 ── */}
          <section className="report-section trace-history-sec">
            <div className="report-section-head">
              <h3>追溯历史</h3>
              <span className="meta">{history.length > 0 ? `${history.length} 条 · 只存本机` : "只存本机"}</span>
            </div>
            {history.length === 0 ? (
              <div className="picker-empty" style={{ padding: "18px 4px" }}>
                还没有追溯记录 —— 完成一次分析后会自动存到这里，含报告号与判定结论。
              </div>
            ) : (
              <div className="trace-history">
                {history.map((h) => (
                  <div key={h.id} className={`trace-hrow${record?.id === h.id ? " active" : ""}`}
                    role="button" tabIndex={0} onClick={() => setRecord(h)}>
                    <span className="mono trace-hno">{h.reportNo}</span>
                    <span className="mono trace-htime">
                      {new Date(h.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className={"trace-hres" + (h.matched ? " ok" : "")}>
                      {h.matched ? `命中 ${h.bestOrderId}` : "未命中"}
                    </span>
                    <span className="trace-hname ellipsis">{h.suspName || "—"}</span>
                    <span className="trace-hops" onClick={(e) => e.stopPropagation()}>
                      <button className="btn btn-icon" aria-label={`导出 ${h.reportNo}`}
                        onClick={() => printTraceReport(h)}><IconPrint size={13} /></button>
                      <ConfirmButton label="" confirmLabel="确认删除" danger
                        disabled={delBusy} busy={delBusy}
                        icon={<IconTrash size={13} />}
                        onConfirm={async () => {
                          setDelBusy(true);
                          try {
                            await removeTraceRecord(h.id);
                            if (record?.id === h.id) setRecord(null);
                            setHistory(await listTraceRecords());
                            toast.info(`已删除 ${h.reportNo}`);
                          } finally { setDelBusy(false); }
                        }} />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </section>
      </div>
    </>
  );
}
