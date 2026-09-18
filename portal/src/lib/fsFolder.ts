/**
 * 本地文件夹（File System Access API · Chromium-only）——统一绑定
 *
 * 一个文件夹同时承担两个职责（P0–P2 起合并，见数据管理方案）：
 *   1. 字体库来源（读）：扫描 .ttf/.otf → 算 SHA-256 → 导入本机库；
 *   2. 自动备份目标（写）：数据变更时写入 typeflow-data.json（backupFolder.ts）。
 *
 * 因此句柄统一以 **readwrite** 模式保存（一次授权同时覆盖读与写），
 * 权限查询也用 readwrite。历史版本曾分存 fonts（只读）/ backup（读写）
 * 两个句柄，getLocalFolder 会做一次静默迁移。
 *
 * 句柄存统一握手层 handles store，key = "local"。
 * file:// 与 Safari/Firefox 不可用——调用方需以 isFsaSupported() 分支展示。
 */

import { STORE, dbGet, dbPut, dbDelete } from "./db";
import { listLocalFonts, saveLocalFont, sha256Of, type FontContainer, type LocalFont } from "./localFonts";
import { assertSupportedFont } from "@engine/ttf/reader.js";

/** 统一句柄 key（握手段 handles store） */
export const FOLDER_KEY = "local";
/** 历史句柄 key（只读字体库 / 读写备份），迁移到 FOLDER_KEY 后即删除 */
const LEGACY_KEYS = ["fonts", "backup"];

export function isFsaSupported(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
}

/**
 * 读取本地文件夹句柄：先读统一 key，未找到时回退迁移历史 key（fonts/backup）。
 * 两个旧句柄以 readwrite 合并成一份（备份写必然需要写权限，read 授权不兼容）。
 */
export async function getFolderHandle(): Promise<FileSystemDirectoryHandle | null> {
  const cur = await dbGet<FileSystemDirectoryHandle>(STORE.HANDLES, FOLDER_KEY);
  if (cur) return cur;
  for (const legacy of LEGACY_KEYS) {
    const old = await dbGet<FileSystemDirectoryHandle>(STORE.HANDLES, legacy);
    if (!old) continue;
    await dbPut(STORE.HANDLES, old, FOLDER_KEY);
    await dbDelete(STORE.HANDLES, legacy);
    return old;
  }
  return null;
}

export async function clearFolderHandle(): Promise<void> {
  await dbDelete(STORE.HANDLES, FOLDER_KEY);
  for (const legacy of LEGACY_KEYS) await dbDelete(STORE.HANDLES, legacy);
}

/** 绑定本地文件夹（必须在用户点击中调用）；统一 readwrite 模式 */
export async function pickFolder(): Promise<string> {
  const picker = (window as unknown as {
    showDirectoryPicker?: (o?: unknown) => Promise<FileSystemDirectoryHandle>;
  }).showDirectoryPicker;
  if (!picker) throw new Error("当前浏览器不支持文件夹选择，请使用 Chrome 或 Edge");
  const handle = await picker({ id: "typeflow-local", mode: "readwrite" });
  await dbPut(STORE.HANDLES, handle, FOLDER_KEY);
  // 绑定新文件夹后，历史句柄不再兜底，避免旧句柄被误用
  for (const legacy of LEGACY_KEYS) await dbDelete(STORE.HANDLES, legacy);
  return handle.name;
}

/** 查询/请求读写权限；requestPermission 必须在用户手势中调用 */
export async function checkFolderPerm(
  handle: FileSystemDirectoryHandle,
  request = false,
): Promise<"granted" | "prompt" | "denied"> {
  const opts = { mode: "readwrite" as const };
  const h = handle as unknown as {
    queryPermission: (o: unknown) => Promise<PermissionState>;
    requestPermission?: (o: unknown) => Promise<PermissionState>;
  };
  let state = await h.queryPermission(opts);
  if (state !== "granted" && request && h.requestPermission) {
    state = await h.requestPermission(opts);
  }
  return state as "granted" | "prompt" | "denied";
}

/* ---------- 兼容旧导出名（原字体库文件夹语义） ---------- */

/** 旧名：读取「本地文件夹」句柄（同 getFolderHandle） */
export async function getFontDirHandle(): Promise<FileSystemDirectoryHandle | null> {
  return getFolderHandle();
}
/** 旧名：解除绑定（同 clearFolderHandle） */
export async function clearFontDirHandle(): Promise<void> {
  return clearFolderHandle();
}
/** 旧名：绑定（同 pickFolder） */
export async function pickFontFolder(): Promise<string> {
  return pickFolder();
}
/** 旧名：读写权限（同 checkFolderPerm） */
export async function checkDirPermission(
  handle: FileSystemDirectoryHandle,
  request = false,
): Promise<"granted" | "prompt" | "denied"> {
  return checkFolderPerm(handle, request);
}

/** 解析 maxp 表 numGlyphs（ttf / otf 通用；解析失败返回 0） */
export function readGlyphCount(buf: ArrayBuffer): number {
  try {
    const dv = new DataView(buf);
    const numTables = dv.getUint16(4);
    for (let i = 0; i < numTables; i++) {
      const off = 12 + i * 16;
      const tag = String.fromCharCode(
        dv.getUint8(off), dv.getUint8(off + 1), dv.getUint8(off + 2), dv.getUint8(off + 3),
      );
      if (tag === "maxp") {
        const tableOff = dv.getUint32(off + 8);
        return dv.getUint16(tableOff + 4);
      }
    }
  } catch {
    /* 非 TTF/OTF 或解析失败 */
  }
  return 0;
}

export interface FolderScanResult {
  added: string[];
  skipped: number;
  total: number;
  folderName: string;
}

/** 扫描本地文件夹：新字体（按 SHA-256 判重）连同本体导入本地库 */
export async function scanFontFolder(): Promise<FolderScanResult> {
  const handle = await getFolderHandle();
  if (!handle) throw new Error("尚未绑定本地文件夹");
  const perm = await checkFolderPerm(handle);
  if (perm !== "granted") throw new Error("需要重新授权文件夹访问");

  const existing = new Set((await listLocalFonts()).map((f) => f.id));
  const result: FolderScanResult = { added: [], skipped: 0, total: 0, folderName: handle.name };

  // values() 为异步迭代器（TS dom 类型未收录，宽松处理）
  const values = (handle as unknown as { values: () => AsyncIterable<FileSystemHandle> }).values();
  for await (const entry of values) {
    if (entry.kind !== "file") continue;
    // 与单个导入走同一道校验：不是受支持的字体（.ttc / WOFF / WOFF2 / 未知 sfnt）挡在外面，
    // 别让它们进库后在签发或追溯时才报错。判据是**文件内容**，不是扩展名 ——
    // 扩展名写错的文件（真 OTF 叫 .ttf 之类）也能被正确识别。
    if (!/\.(ttf|otf)$/i.test(entry.name)) continue;
    result.total++;
    const file = await (entry as FileSystemFileHandle).getFile();
    const buf = await file.arrayBuffer();
    let container: FontContainer;
    try {
      container = assertSupportedFont(new Uint8Array(buf));
    } catch {
      result.skipped++;
      continue;
    }
    const sha = await sha256Of(buf);
    const id = sha.slice(0, 16);
    if (existing.has(id)) {
      result.skipped++;
      continue;
    }
    const font: LocalFont = {
      id,
      name: entry.name.replace(/\.(ttf|otf)$/i, ""),
      filename: entry.name,
      sha256: sha,
      glyphCount: readGlyphCount(buf),
      size: file.size,
      savedAt: Date.now(),
      data: buf,
      container,
    };
    await saveLocalFont(font);
    result.added.push(entry.name);
  }
  return result;
}