/**
 * 备份文件夹（File System Access API · Chromium-only）——P2 备份重建
 *
 * 绑定一个本地文件夹后，数据变更时自动把全量 JSON（客户 + 厂牌 + 订单关联 +
 * 字体清单）覆盖写入该文件夹的固定文件 `typeflow-data.json`；之后由用户自己的
 * 工具（网盘 / Time Machine / U 盘）负责同步——备份自动发生，不需要用户记得。
 *
 * 模式沿用案例验证过的套路：
 *   showDirectoryPicker(readwrite) → 句柄存统一 handles store →
 *   queryPermission/requestPermission 跨会话授权 → createWritable 原子替换。
 * Safari / Firefox 无此 API，回落手动导出（Settings 页）。
 *
 * 备份文件为明文 JSON（含客户资料），UI 须提示用户放在自己可控的位置。
 */

import { STORE, dbGet, dbPut } from "./db";
import { buildExportFile, FONTS_DIR } from "./backup";
import { listCustomers } from "./localCustomers";
import { listOrderNotes } from "./localOrders";
import { replaceCustomers } from "./localCustomers";
import { replaceOrderNotes } from "./localOrders";
import { listTraceRecords, replaceTraceRecords, type TraceRecord } from "./traceHistory";
import { getFolderHandle, checkFolderPerm, clearFolderHandle } from "./fsFolder";
import { readFoundry, writeFoundry, type Foundry } from "./foundry";
import { listLocalFonts, getLocalFontData } from "./localFonts";
import type { Customer } from "./localCustomers";
import type { LocalOrderNote } from "./localOrders";

const FILE_NAME = "typeflow-data.json";      // 固定文件名（覆盖式原子替换）
const SNAPSHOT_KEY = "last_snapshot";        // meta store 里的快照键
/** 自动备份节流：距上次写入不足该值时跳过（本地写成本极低，30s 足够） */
const THROTTLE_MS = 30_000;

/* ---------- 本地文件夹 —— 统一句柄（见 fsFolder.ts） ---------- */

/** 备份文件夹 = 统一本地文件夹；句柄/权限由 fsFolder 管理 */
export async function getBackupFolderHandle(): Promise<FileSystemDirectoryHandle | null> {
  return getFolderHandle();
}

export async function clearBackupFolderHandle(): Promise<void> {
  await clearFolderHandle();
}

/** 权限查询走统一 readwrite 语义（与扫描共享同一授权） */
export async function checkBackupPerm(
  handle: FileSystemDirectoryHandle,
  request = false,
): Promise<"granted" | "prompt" | "denied"> {
  return checkFolderPerm(handle, request);
}

export function isFsaWritableSupported(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
}

export interface BackupFolderState {
  name: string;
  /** 上次成功写入时间戳；null = 还没写过 */
  lastBackupAt: number | null;
}

/* ---------- 厂牌读写统一走 foundry.ts（原先此处各有一份键定义） ---------- */

/* ---------- 写入 ---------- */

/** 读取上次自动备份时间（存 meta store，与业务数据同库） */
export async function lastFolderBackupAt(): Promise<number | null> {
  const v = await dbGet<number>(STORE.META, "folder_backup_at");
  return v ?? null;
}

async function setFolderBackupAt(t: number): Promise<void> {
  await dbPut(STORE.META, t, "folder_backup_at");
}

/**
 * 立即写一次全量备份到绑定文件夹（覆盖式原子替换）。
 * 未绑定 / 无写权限时抛错（调用方决定提示还是静默）。
 */
export async function writeFolderBackup(): Promise<number> {
  const handle = await getBackupFolderHandle();
  if (!handle) throw new Error("尚未绑定本地文件夹");
  const perm = await checkBackupPerm(handle);
  if (perm !== "granted") throw new Error("需要重新授权文件夹访问");

  // 字体本体：typeflow-fonts/<sha16>-<文件名>，只写缺的（字体只在"添加"时变，增量写避免大文件反复落盘）
  const fontsDir = await handle.getDirectoryHandle(FONTS_DIR, { create: true });
  let fontsWritten = 0;
  for (const f of await listLocalFonts()) {
    const name = `${f.sha256.slice(0, 16)}-${f.filename}`;
    try {
      await fontsDir.getFileHandle(name);          // 已写过：跳过
    } catch {
      const data = await getLocalFontData(f.id);
      if (!data) continue;
      const fh = await fontsDir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(data);
      await w.close();
      fontsWritten++;
    }
  }

  // 清单 JSON：客户 / 订单关联 / 追溯历史 / 厂牌 / 字体清单（哈希），节流全量重写
  const data = await buildExportFile();
  const file = await handle.getFileHandle(FILE_NAME, { create: true });
  const writable = await file.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
  const at = Date.now();
  await setFolderBackupAt(at);
  void fontsWritten;
  return at;
}

/**
 * 变更点静默触发：已绑定 + 写权限 + 距上次写入超过节流窗口才真正执行。
 * 任何失败静默吞掉——自动备份不应干扰主流程。
 */
export function maybeFolderBackup(): void {
  void (async () => {
    const handle = await getBackupFolderHandle();
    if (!handle) return;
    const perm = await checkBackupPerm(handle);
    if (perm !== "granted") return;
    const last = await lastFolderBackupAt();
    if (last && Date.now() - last < THROTTLE_MS) return;
    await writeFolderBackup();
  })().catch(() => void 0);
}

/** 备份文件夹状态（设置页展示） */
export async function getBackupFolderState(): Promise<BackupFolderState | null> {
  const handle = await getBackupFolderHandle();
  if (!handle) return null;
  return { name: handle.name, lastBackupAt: await lastFolderBackupAt() };
}

/* ---------- 读回（换浏览器 / 换设备后恢复本机数据） ---------- */

export interface FolderBackupPayload {
  /** typeflow-data.json 原文，调用方负责解析 */
  json: string;
  /** 字体本体，键名与 zip 内路径一致（typeflow-fonts/<sha16>-<文件名>）——两条恢复路径共用 applyExportFile */
  fonts: Map<string, Uint8Array>;
  folderName: string;
}

/**
 * 从绑定文件夹读回整份备份。
 *
 * 用途：换了浏览器 / 换了设备时 IndexedDB 是空的——云端只剩哈希与订单号，
 * 字体名、客户、授权方案全对不上号；绑定回原来那个文件夹即可整组恢复。
 * 只读本机磁盘，不发任何请求。
 *
 * 文件夹里没有 typeflow-data.json 时抛错（多半选错了文件夹）。
 * 字体子目录缺失不算失败：清单照样恢复（客户 / 厂牌 / 订单关联 / 授权方案），
 * 字体本体留待设置页「扫描字体」补。
 */
export async function readFolderBackup(): Promise<FolderBackupPayload> {
  const handle = await getBackupFolderHandle();
  if (!handle) throw new Error("尚未绑定本地文件夹");
  const perm = await checkBackupPerm(handle);
  if (perm !== "granted") throw new Error("需要重新授权文件夹访问");

  let json: string;
  try {
    const fh = await handle.getFileHandle(FILE_NAME);
    json = await (await fh.getFile()).text();
  } catch {
    throw new Error(`这个文件夹里没有 ${FILE_NAME}，请选当初绑定为备份的那个`);
  }

  const fonts = new Map<string, Uint8Array>();
  try {
    const dir = await handle.getDirectoryHandle(FONTS_DIR);
    // values() 为异步迭代器（TS dom 类型未收录，与 scanFontFolder 同一处理）
    const values = (dir as unknown as { values: () => AsyncIterable<FileSystemHandle> }).values();
    for await (const entry of values) {
      if (entry.kind !== "file") continue;
      const file = await (entry as FileSystemFileHandle).getFile();
      fonts.set(`${FONTS_DIR}/${entry.name}`, new Uint8Array(await file.arrayBuffer()));
    }
  } catch {
    /* 没有字体子目录：清单先恢复，字体后续扫描补 */
  }
  return { json, fonts, folderName: handle.name };
}

/* ---------- 导入前快照 / 一键撤销（P2 保障机制） ---------- */

interface LocalSnapshot {
  at: number;
  customers: Customer[];
  orderNotes: LocalOrderNote[];
  /** 批次 5.2 起带追溯历史；老快照无此字段，恢复时按空处理 */
  traces?: TraceRecord[];
  /** 老快照可能只有 name/short/site，缺 seal —— writeFoundry 按圆章回落 */
  foundry: Partial<Foundry>;
}

/**
 * 导入/恢复前调用：把当前客户库 + 订单关联 + 厂牌快照写入 meta store。
 * 保留一份，供 restoreSnapshot() 一键还原（点错一次能撤销）。
 */
export async function snapshotLocalData(): Promise<void> {
  const snap: LocalSnapshot = {
    at: Date.now(),
    customers: await listCustomers(),
    orderNotes: await listOrderNotes(),
    traces: await listTraceRecords(),
    foundry: readFoundry(),
  };
  await dbPut(STORE.META, snap, SNAPSHOT_KEY);
}

/** 是否有可撤销的快照 */
export async function hasSnapshot(): Promise<boolean> {
  return (await dbGet<LocalSnapshot>(STORE.META, SNAPSHOT_KEY)) !== undefined;
}

/**
 * 撤销上次导入：把快照内容整表写回（客户 / 订单关联 / 厂牌）。
 * 返回恢复的客户数；无快照返回 null。
 */
export async function restoreSnapshot(): Promise<number | null> {
  const snap = await dbGet<LocalSnapshot>(STORE.META, SNAPSHOT_KEY);
  if (!snap) return null;
  await replaceCustomers(snap.customers);
  await replaceOrderNotes(snap.orderNotes);
  await replaceTraceRecords(snap.traces ?? []);
  writeFoundry(snap.foundry ?? {});
  return snap.customers.length;
}