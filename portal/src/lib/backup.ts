/**
 * 本地数据备份与导入导出
 *
 * 备份分两条线：
 *   A. 绑定备份文件夹（FSA，Chromium）——数据变更时自动把全量 JSON 写进文件夹，
 *      之后同步交给用户自己的工具（网盘 / Time Machine）。见 backupFolder.ts。
 *   B. 手动导出 / 导入 JSON 文件——所有浏览器可用（Safari/Firefox 回落）。
 *
 * 导出文件 v3 = 一键带走"关于我的全部数据"，一个文件两段：
 *   · 本机段（customers / foundry / fonts 清单 / orderNotes）—— 可回灌（导入恢复）
 *   · 云端段（cloud：账号 / 字体登记 / 订单配方 / 审计）—— 只读凭证，导入时忽略
 * 云端段是"平台手里关于你的东西"的清单；按产品定稿，云端不存客户姓名与备注，
 * 所以这一段只有哈希、订单号与授权方案——**空是常态，不是故障**。
 *
 * ⚠️ 自动写文件夹那条线（A）走 buildExportFile()，**不含云端段**：
 *    它每次数据变更都会写一次，不该因此发网络请求。
 *
 * 导入 = 整表替换，因此导入前自动快照当前数据，可一键撤销（见 backupFolder.ts）。
 */

import { listLocalFonts, saveLocalFont, sha256Of, getLocalFontData } from "./localFonts";
import { buildZip, readZip, type ZipEntry } from "./zip";
import { listCustomers, replaceCustomers, type Customer } from "./localCustomers";
import { listOrderNotes, replaceOrderNotes, type LocalOrderNote } from "./localOrders";
import { listTraceRecords, replaceTraceRecords, type TraceRecord } from "./traceHistory";
import { readFoundry, writeFoundry, type Foundry } from "./foundry";
import { listSchemes, saveSchemes, isDefault, type LicenseScheme } from "./schemes";
import { apiAccount } from "../api/client";

/* ---------- 导入导出（本地 JSON 文件，v2 含本地订单关联） ---------- */
export interface ExportFile {
  app: "typeflow";
  v: 1 | 2 | 3;
  exported_at: string;
  customers: Customer[];
  /** 厂牌（授权方）。v1–v3 的老文件只有 name/short/site，缺 seal 时按圆章回落 */
  foundry: Foundry;
  fonts: Array<{ name: string; filename: string; sha256: string }>;   // 仅清单，本体不出本机
  /** P1 起：本地订单关联（clientId / note）。v1 导出无此字段，导入时兼容跳过 */
  orderNotes?: LocalOrderNote[];
  /** 批次 5.2 起：追溯历史（报告号/判定/文件摘要，只存本机）。老文件无此字段，导入时兼容跳过 */
  traces?: TraceRecord[];
  /** 授权方案（设置页可编辑增删，只存本机）。与出厂默认一致时不写入——老备份兼容即「字段缺席 = 不动现状」 */
  schemes?: LicenseScheme[];
  /** v3 起：云端段（只读，导入时忽略）。取不到就为 null，不影响本机段 */
  cloud?: Record<string, unknown> | null;
}

/** 本机段（自动写文件夹也用它，故**不含**云端段、不发请求） */
export async function buildExportFile(): Promise<ExportFile> {
  const schemes = listSchemes();
  return {
    app: "typeflow",
    v: 2,
    exported_at: new Date().toISOString(),
    customers: await listCustomers(),
    foundry: readFoundry(),
    fonts: (await listLocalFonts()).map((f) => ({ name: f.name, filename: f.filename, sha256: f.sha256 })),
    orderNotes: await listOrderNotes(),
    traces: await listTraceRecords(),
    ...(isDefault(schemes) ? {} : { schemes }),
  };
}

/**
 * 组装载荷：清单 JSON + 字体本体。文件夹备份与 zip 导出吃同一份——
 * "什么算本地数据"只有这一处定义，两种出口不会长成两套内容。
 */
export async function buildBackupPayload(): Promise<{
  json: ExportFile; fonts: ZipEntry[];
}> {
  const local = await buildExportFile();
  // 云端段取不到（离线 / 会话过期 / 接口异常）不该拖垮本机备份——降级为 null 并继续
  let cloud: Record<string, unknown> | null = null;
  try {
    cloud = (await apiAccount.exportData()) as Record<string, unknown>;
  } catch {
    cloud = null;
  }
  const json: ExportFile = { ...local, v: 3, cloud };
  const fonts: ZipEntry[] = [];
  for (const meta of local.fonts) {
    const data = await getLocalFontData(meta.sha256.slice(0, 16));
    if (!data) continue;   // 清单里有但本体缺失（理论不该发生）：宁可少带也不写坏文件
    fonts.push({ name: fontEntryName(meta.sha256, meta.filename), data: new Uint8Array(data) });
  }
  return { json, fonts };
}

/** 字体在备份里的文件名：<sha16>-<原文件名>——同名不同版本不会互相覆盖 */
export function fontEntryName(sha256: string, filename: string): string {
  return `typeflow-fonts/${sha256.slice(0, 16)}-${filename}`;
}

/** 导出为下载文件：一个 ZIP = 清单 JSON + 字体本体（换机导入这一份即完整恢复） */
export async function exportDataFile(): Promise<{ name: string; cloud: boolean; fonts: number }> {
  const { json, fonts } = await buildBackupPayload();
  const entries: ZipEntry[] = [
    { name: "typeflow-data.json", data: new TextEncoder().encode(JSON.stringify(json, null, 2)) },
    ...fonts,
  ];
  const name = `typeflow-backup-${new Date().toISOString().slice(0, 10)}.zip`;
  downloadBytes(buildZip(entries), name, "application/zip");
  return { name, cloud: json.cloud !== null, fonts: fonts.length };
}

function downloadBytes(bytes: Uint8Array, filename: string, mime: string): void {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 从备份文件导入：ZIP（新，含字体本体）或 JSON（旧 v1–v3，无本体）。
 * 恢复客户库 / 厂牌 / 本地订单关联 / 追溯历史（整表替换），zip 再按哈希回灌字体本体。
 * 调用方应在替换前先 snapshotLocalData()，导入出错或后悔时可 restoreSnapshot() 一键还原。
 */
export async function importDataFile(file: File): Promise<{
  customers: number; fonts: number; orders: number; traces: number; fontsRestored: number; schemes: number;
}> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;   // "PK"
  let raw: ExportFile;
  let fontBlobs = new Map<string, Uint8Array>();
  if (isZip) {
    const entries = readZip(buf);
    const jsonEntry = entries.get("typeflow-data.json");
    if (!jsonEntry) throw new Error("备份 zip 里没有 typeflow-data.json");
    raw = JSON.parse(new TextDecoder().decode(jsonEntry)) as ExportFile;
    for (const [name, data] of entries) {
      if (name.startsWith("typeflow-fonts/")) fontBlobs.set(name, data);
    }
  } else {
    raw = JSON.parse(new TextDecoder().decode(buf)) as ExportFile;
  }
  const v = raw?.v;
  if (raw?.app !== "typeflow" || (v !== 1 && v !== 2 && v !== 3) || !Array.isArray(raw.customers)) {
    throw new Error("文件格式无法识别（需要文镇导出的 JSON 备份）");
  }
  await replaceCustomers(raw.customers);
  if (raw.foundry) writeFoundry(raw.foundry);
  // v2 起才有订单关联；v1 文件跳过（订单会显示"未识别客户"）
  if (v !== 1 && Array.isArray(raw.orderNotes)) {
    await replaceOrderNotes(raw.orderNotes);
  }
  // 批次 5.2 起带追溯历史；老文件无此字段，跳过即可
  if (Array.isArray(raw.traces)) {
    await replaceTraceRecords(raw.traces);
  }
  // 授权方案：备份里有才替换（老备份没有 = 保持本机现状，不误清自定义方案）
  if (Array.isArray(raw.schemes)) {
    saveSchemes(raw.schemes);
  }
  // 批次 5.6：zip 备份带字体本体 → 按清单哈希逐个回灌（已入库的跳过，大小对不上则拒绝）
  let fontsRestored = 0;
  if (fontBlobs.size > 0 && Array.isArray(raw.fonts)) {
    for (const meta of raw.fonts) {
      const entry = fontEntryName(meta.sha256, meta.filename);
      const data = fontBlobs.get(entry);
      if (!data) continue;                                  // 旧备份或文件缺失：跳过
      const id = meta.sha256.slice(0, 16);
      if (await getLocalFontData(id)) { fontsRestored++; continue; }   // 已在本机：不重复写入
      const digest = await sha256Of(data.slice().buffer as ArrayBuffer);
      if (digest !== meta.sha256.toLowerCase()) {
        throw new Error(`字体「${meta.filename}」哈希与清单不一致（期望 ${meta.sha256.slice(0, 12)}…，实际 ${digest.slice(0, 12)}…），已中止导入`);
      }
      await saveLocalFont({
        id, name: meta.name || meta.filename, filename: meta.filename,
        sha256: meta.sha256, glyphCount: 0, size: data.length,
        savedAt: Date.now(), data: data.slice().buffer as ArrayBuffer,
      });
      fontsRestored++;
    }
  }
  return {
    customers: raw.customers.length,
    fonts: raw.fonts?.length ?? 0,
    orders: v !== 1 ? raw.orderNotes?.length ?? 0 : 0,
    traces: raw.traces?.length ?? 0,
    schemes: Array.isArray(raw.schemes) ? raw.schemes.length : 0,
    fontsRestored,
  };
}