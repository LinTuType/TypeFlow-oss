/**
 * 追溯历史 —— 落本机（批次 5.2）
 *
 * 为什么要落库：原先追溯结果只活在 React state 里，刷新即失；而页面文案自己就
 * 写着「原始文件与分析报告应一并保存」——承诺了留存，却没有留存。更隐蔽的是
 * 报告号由**渲染时刻**生成，同一份分析每次看编号都不同，连当归档编号都不合格。
 *
 * 现在的定义：
 *   · 报告号在**分析完成时**生成并随记录落库（TRACE-YYYYMMDD-NNN，NNN = 当天第几份）；
 *   · 只存**精简判定**（判定/分数/标签/双通道计数/文件摘要），不存原始 diff 数组
 *     与字体本体——历史要的是"结论与凭据"，不是重放分析；
 *   · 追溯的输入是「你手上的可疑文件」，最不该上云 ⇒ 全部只存本机，
 *     随本机段备份（backup.ts）一起搬运；上限 50 条，超出删最旧。
 */

import { STORE, dbGet, dbPut, dbDelete, dbGetAll, dbClear, openDb } from "./db";
import { CACHE_KEYS, invalidate, readThrough } from "./cache";
import type { FullTraceOutcome, TraceCandidateResult, UniquenessVerdict } from "./trace";

/** 供报告组件用（记录里带的就是这个三态） */
export type { UniquenessVerdict };

/** 单个候选订单的精简判定（足够渲染报告，不含 diff 数组） */
export interface TraceRecordCandidate {
  orderId: string;
  fontSha256: string;
  matched: boolean;
  /** 判定 */
  level: TraceCandidateResult["result"]["verdict"]["level"];
  levelLabel: string;
  score: number;
  labels: string[];
  confidence: number;
  channelA_matches: number;
  channelA_total: number;
  channelB_matches: number;
  channelB_total: number;
  /** 相关检测：判定实际采用的那个 ρ；null = ρ 路未启用（有效样本不足） */
  rhoUsed: number | null;
  /** 该 ρ 的有效样本数 */
  rhoValid: number;
  /** 该 ρ 来自哪一通道 */
  rhoChannel: "A" | "B" | null;
  /** 锚定字存活率（余量行的分子；分母恒为 60 个锚定字） */
  survivalRate: number;
  /** 位命中数 /20 */
  matchCount: number;
  /** 位移幅度分布（只数非空的 60 个锚定字）：满幅 / 小幅度 / 归零 —— 用于看出"不像单份签发物" */
  dispFull: number;
  dispSmall: number;
  dispZero: number;
}

/** 锚定字总数（余量行的分母，与引擎的 20 bit × 3 冗余一致） */
export const ANCHOR_TOTAL = 60;

/**
 * 「余量行」文案（屏幕报告与导出 HTML 共用）。
 *
 * 外部评审的建议：**别只给结论，把"这个结论有多稳"摆出来** —— 存活数与最优/次优 ρ
 * 本来就算得出来，加一行零成本；不需要读者记任何阈值，两个数一对比就知道。
 */
export function marginLine(
  best: TraceRecordCandidate,
  others: TraceRecordCandidate[],
): string {
  // ⚠️ 本仓库里已经存在的旧记录没有这几个字段（字段是 2026-09-18 加的，而报告落本机）
  // ⇒ 拿不到就显示「—」，别渲染成 "NaN / 60"。封闭测试期不做迁移，但这行兜底要留。
  const hasSurvival = Number.isFinite(best.survivalRate);
  const survivors = hasSurvival ? Math.round(best.survivalRate * ANCHOR_TOTAL) : null;
  const rho = best.rhoUsed === null || best.rhoUsed === undefined ? "—" : best.rhoUsed.toFixed(2);
  const second = others
    .map((c) => c.rhoUsed)
    .filter((v): v is number => typeof v === "number")
    .sort((a, b) => b - a)[0];
  const parts = [
    `锚定字存活 ${survivors === null ? "—" : survivors} / ${ANCHOR_TOTAL}`,
    `最优匹配 ρ ${rho}`,
  ];
  if (second !== undefined) parts.push(`次优 ${second.toFixed(2)}`);
  if (rho !== "—") parts.push(`有效样本 ${best.rhoValid ?? 0} / ${ANCHOR_TOTAL}`);
  // 位移幅度分布：正常单份字体几乎全"满幅"；被"多副本取平均"过的会出现大量"偏小/为零"
  if (Number.isFinite(best.dispFull)) {
    parts.push(`位移幅度 满幅 ${best.dispFull} · 偏小 ${best.dispSmall} · 为零 ${best.dispZero}`);
  }
  return parts.join(" · ");
}

/** 通道得分文案（屏幕报告与导出 HTML 共用；≥85% 视为达标） */
export function channelScores(c: TraceRecordCandidate): { a: string; aOk: boolean; b: string; bOk: boolean } {
  const fmt = (m: number, t: number) => (t ? `${m}/${t}` : "—");
  const ok = (m: number, t: number) => (t ? m / t >= 0.85 : false);
  return {
    a: fmt(c.channelA_matches, c.channelA_total), aOk: ok(c.channelA_matches, c.channelA_total),
    b: fmt(c.channelB_matches, c.channelB_total), bOk: ok(c.channelB_matches, c.channelB_total),
  };
}

/** 一份追溯报告的落库形态（= 报告渲染的唯一数据源） */
export interface TraceRecord {
  /** 主键 = 报告号（分析时刻生成，永不变化） */
  id: string;
  reportNo: string;
  createdAt: number;
  /** 原版字体 */
  origName: string;
  origSha256: string;
  origSize: number;
  /** 可疑字体 */
  suspName: string;
  suspSha256: string;
  suspSize: number;
  /** 可疑字体 Name256 自证的订单号（若有） */
  selfClaimOrder: string | null;
  /** 命中的订单号；null = 未命中 */
  bestOrderId: string | null;
  matched: boolean;
  /**
   * 唯一性判定：`single` / `multi`（多个订单都参与过 ⇒ 都点名）/ `ambiguous`（分不清 ⇒ 不点名）。
   * 多副本取平均时通常是 `multi`（那 k 个候选的相关性都稳且接近）。
   */
  uniqueness?: UniquenessVerdict;
  candidates: TraceRecordCandidate[];
}

/** 历史上限：追溯报告是低频操作，50 份足够回溯；超出删最旧 */
const MAX_RECORDS = 50;

/** 分析完成时生成报告号（当天序号按已有记录递增） */
export async function newReportNo(): Promise<string> {
  const today = new Date();
  const ymd = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("");
  const all = await listTraceRecords();
  const n = all.filter((r) => r.reportNo.includes(ymd)).length + 1;
  return `TRACE-${ymd}-${String(n).padStart(3, "0")}`;
}

/** 把一次完整追溯的结果压缩成可落库的记录 */
export function recordFromOutcome(
  outcome: FullTraceOutcome,
  files: {
    origName: string; origSha256: string; origSize: number;
    suspName: string; suspSha256: string; suspSize: number;
  },
  reportNo: string,
): TraceRecord {
  const candidates: TraceRecordCandidate[] = outcome.candidates.map((c) => ({
    orderId: c.orderId,
    fontSha256: c.fontSha256,
    matched: c.matched,
    level: c.result.verdict.level,
    levelLabel: c.result.verdict.levelLabel,
    score: c.result.verdict.score,
    labels: c.result.verdict.labels,
    confidence: c.result.confidence,
    channelA_matches: c.result.channelA_matches,
    channelA_total: c.result.channelA_total,
    channelB_matches: c.result.channelB_matches,
    channelB_total: c.result.channelB_total,
    rhoUsed: c.result.verdict.metrics.rhoUsed,
    rhoValid: c.result.verdict.metrics.rhoValid,
    rhoChannel: c.result.verdict.metrics.rhoChannel,
    survivalRate: c.result.verdict.metrics.survivalRate,
    matchCount: c.result.verdict.metrics.matchCount,
    dispFull: c.result.verdict.metrics.dispFull,
    dispSmall: c.result.verdict.metrics.dispSmall,
    dispZero: c.result.verdict.metrics.dispZero,
  }));
  const best = outcome.best;
  return {
    id: reportNo,
    reportNo,
    createdAt: Date.now(),
    ...files,
    selfClaimOrder: outcome.selfClaimOrder,
    bestOrderId: best?.orderId ?? null,
    matched: !!best?.matched,
    uniqueness: outcome.uniqueness,
    candidates,
  };
}

/** 保存一条记录（内置上限裁剪） */
export async function saveTraceRecord(rec: TraceRecord): Promise<void> {
  await dbPut(STORE.TRACES, rec);
  // 先把缓存失效再读：否则裁剪用的 all 是写之前那份，会漏裁最新一条之外的顺序变化
  invalidate(CACHE_KEYS.localTraces);
  const all = await listTraceRecords();
  if (all.length > MAX_RECORDS) {
    const stale = [...all]
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, all.length - MAX_RECORDS);
    await Promise.all(stale.map((r) => dbDelete(STORE.TRACES, r.id).catch(() => void 0)));
    invalidate(CACHE_KEYS.localTraces);
  }
}

/** 列出全部记录（新→旧）—— 走缓存（追溯页与设置页都在读） */
export async function listTraceRecords(): Promise<TraceRecord[]> {
  return readThrough(CACHE_KEYS.localTraces, async () => {
    const all = await dbGetAll<TraceRecord>(STORE.TRACES);
    return all.sort((a, b) => b.createdAt - a.createdAt);
  });
}

/** 取单条 */
export async function getTraceRecord(id: string): Promise<TraceRecord | undefined> {
  return dbGet<TraceRecord>(STORE.TRACES, id);
}

/** 删除一条 */
export async function removeTraceRecord(id: string): Promise<void> {
  await dbDelete(STORE.TRACES, id);
  invalidate(CACHE_KEYS.localTraces);
}

/** 清空（清本地数据用） */
export async function clearAllTraceRecords(): Promise<void> {
  await dbClear(STORE.TRACES);
  invalidate(CACHE_KEYS.localTraces);
}

/** 用一份备份整表替换（导入恢复用）——先清空再写入 */
export async function replaceTraceRecords(items: TraceRecord[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE.TRACES, "readwrite");
    const store = tx.objectStore(STORE.TRACES);
    store.clear();
    for (const r of items) store.put(r);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  invalidate(CACHE_KEYS.localTraces);
}
