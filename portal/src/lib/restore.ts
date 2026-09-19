/**
 * 本机数据恢复（换浏览器 / 换设备）
 *
 * 为什么需要：云端按数据最小化只登记哈希与订单号——字体名（= 文件名去扩展名，
 * 常含客户代号或未发布款名）与客户、授权方案一律只存本机。换了浏览器后
 * IndexedDB 是空的，字体卡片与订单列表就只剩一串 sha16，认不出是哪款字、哪家客户。
 *
 * 恢复不引入任何新的数据流向：从**本机磁盘**的备份文件夹（或用户手上的备份 zip）
 * 读回本机段，全程不发请求。云端一行不改，"字体不出本机"的承诺照旧成立。
 */

import { apiFonts, apiOrders, type FontInfo, type OrderInfo } from "../api/client";
import { listLocalFonts } from "./localFonts";
import { listCustomers } from "./localCustomers";
import { listOrderNotes } from "./localOrders";
import { readFolderBackup, writeFolderBackup, type FolderBackupPayload } from "./backupFolder";
import { pickFolder } from "./fsFolder";
import { applyExportFile, importDataFile, type ApplyResult, type ExportFile } from "./backup";

export interface LocalDataGap {
  cloudFonts: number;
  cloudOrders: number;
  localFonts: number;
  localCustomers: number;
  localOrders: number;
  /** 云端登记过、本机没有的字体数（换浏览器后 = 全部） */
  missingFonts: number;
  /** 是否该提示：本机三段全空而云端有数据 */
  shouldPrompt: boolean;
}

/** 云端登记行的键：与门户各处一致，取 sha256 前 16 位（缺 sha 时回落 font_id 去前缀） */
const fontKey = (f: FontInfo): string =>
  (f.original_font_sha256 || f.font_id.replace(/^font_/, "")).slice(0, 16);

/**
 * 探测"这个浏览器里没有本机数据"。
 *
 * 判据取「本机三段全空 + 云端有数据」，而不是「有任何缺失」：
 * 用户主动删掉一款字体（云端哈希按设计保留）不该被反复劝着恢复。
 * 取不到云端数据时返回 null——宁可不出提示，也不误报。
 */
export async function detectLocalDataGap(): Promise<LocalDataGap | null> {
  try {
    const [cloud, ordersRes, locals, customers, notes] = await Promise.all([
      // ⚠️ 必须走 apiFonts.list()（带缓存）。这里原先手写 api("GET","/api/fonts")，
      // 于是本组件挂在概览/字体库/订单三页上，每次切页都绕过缓存重发一次请求 ——
      // 外面看起来就是"切页仍在重刷数据"，而罪魁祸首藏在"恢复提示"这个看不见的角落里。
      apiFonts.list(),
      apiOrders.list(),
      listLocalFonts(),
      listCustomers(),
      listOrderNotes(),
    ]);
    const cloudFonts = cloud.fonts ?? [];
    const orders: OrderInfo[] = ordersRes.orders ?? [];
    const localIds = new Set(locals.map((f) => f.id));
    const cloudHasData = cloudFonts.length > 0 || orders.length > 0;
    const localEmpty = locals.length === 0 && customers.length === 0 && notes.length === 0;
    return {
      cloudFonts: cloudFonts.length,
      cloudOrders: orders.length,
      localFonts: locals.length,
      localCustomers: customers.length,
      localOrders: notes.length,
      missingFonts: cloudFonts.filter((f) => !localIds.has(fontKey(f))).length,
      shouldPrompt: cloudHasData && localEmpty,
    };
  } catch {
    return null;
  }
}

/**
 * 本机三段（字体 / 客户 / 订单关联）是否全空。不联网。
 * 用于判断「这次绑定文件夹是不是接回旧备份」——见 Settings 页 doBindFolder。
 */
export async function isLocalDataEmpty(): Promise<boolean> {
  const [fonts, customers, notes] = await Promise.all([
    listLocalFonts(), listCustomers(), listOrderNotes(),
  ]);
  return fonts.length === 0 && customers.length === 0 && notes.length === 0;
}

export interface RestoreOutcome extends ApplyResult {
  source: "folder" | "file";
  folderName?: string;
}

export interface BindFolderOutcome {
  /** 用户选中的文件夹名 */
  name: string;
  /** 有值时表示这次绑定**接回了旧备份**（换设备 / 换浏览器后的第一次绑定） */
  restored?: RestoreOutcome;
}

/**
 * 绑定本地文件夹 —— 设置页与「开始使用」引导共用这一处（原先只有设置页里那份）。
 *
 * ⚠️ **顺序是安全线，别调换**：先探文件夹里有没有旧备份；有、且本机三段全空 ⇒ 走「接回备份」。
 * 如果径直 `writeFolderBackup()`，会用一份**空的本机数据**覆盖掉用户唯一的备份，且不可逆
 * —— 这是换浏览器后最容易踩的毁数据路径。
 *
 * 刷新页面（reload）留给调用方：`finishRestore()` 会 reload，库函数不该自己跳走。
 */
export async function bindFolderAndRestore(): Promise<BindFolderOutcome> {
  const name = await pickFolder();
  let incoming: FolderBackupPayload | null = null;
  try { incoming = await readFolderBackup(); } catch { incoming = null; }
  if (incoming && await isLocalDataEmpty()) {
    const raw = JSON.parse(incoming.json) as ExportFile;
    const r = await applyExportFile(raw, incoming.fonts);
    return { name, restored: { ...r, source: "folder", folderName: incoming.folderName } };
  }
  await writeFolderBackup();
  return { name };
}

/** 从绑定文件夹恢复：重新授权后整组读回（本机磁盘读取，不发请求） */
export async function restoreFromFolder(): Promise<RestoreOutcome> {
  const { json, fonts, folderName } = await readFolderBackup();
  const raw = JSON.parse(json) as ExportFile;
  const r = await applyExportFile(raw, fonts);
  return { ...r, source: "folder", folderName };
}

/** 从备份文件恢复（zip 或旧版 JSON；Safari / Firefox 没有文件夹 API 时的回落） */
export async function restoreFromFile(file: File): Promise<RestoreOutcome> {
  const r = await importDataFile(file);
  return { ...r, source: "file" };
}

/* ---------- 恢复后刷新：结果经 sessionStorage 传递 ----------
   reload 会清掉页面状态，toast 来不及看 ⇒ 先存一条，由 takeRestoreFlash 取出播报。 */
const FLASH_KEY = "typeflow.restore.flash";

export function finishRestore(outcome: RestoreOutcome): void {
  try { sessionStorage.setItem(FLASH_KEY, JSON.stringify(outcome)); } catch { /* 无痕模式忽略 */ }
  window.location.reload();
}

export function takeRestoreFlash(): RestoreOutcome | null {
  let raw: string | null = null;
  try { raw = sessionStorage.getItem(FLASH_KEY); } catch { return null; }
  if (!raw) return null;
  try { sessionStorage.removeItem(FLASH_KEY); } catch { /* 忽略 */ }
  try { return JSON.parse(raw) as RestoreOutcome; } catch { return null; }
}

/** 恢复结果的人话摘要（提示条与设置页共用这一处措辞） */
export function restoreSummary(o: RestoreOutcome): string {
  const parts = [
    o.customers > 0 ? `${o.customers} 位客户` : "",
    o.orders > 0 ? `${o.orders} 笔订单关联` : "",
    o.fontsRestored > 0 ? `${o.fontsRestored} 份字体` : "",
    o.traces > 0 ? `${o.traces} 份追溯报告` : "",
    o.schemes > 0 ? `${o.schemes} 条授权方案` : "",
  ].filter(Boolean);
  return parts.length ? `已恢复 ${parts.join("、")}` : "没有读到可恢复的内容";
}
