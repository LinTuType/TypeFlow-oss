/**
 * 字体库文件夹（File System Access API · Chromium-only）
 *
 * 用户绑定一个本地文件夹作为字体库来源：
 *   - 句柄（FileSystemDirectoryHandle）持久化在 IndexedDB，跨会话可用；
 *   - 权限：会话内授权一次后可反复读取；跨会话 Chrome 会重新询问，
 *     对同一目录授权三次后 Chrome 会记住（近似持久）；
 *   - 扫描：枚举文件夹内 .ttf / .otf → 算 SHA-256 → 与本地库比对 →
 *     新字体整体导入（含字体文件本体，可直接用于签发）；
 *   - 字形数：解析 maxp 表 numGlyphs（ttf/otf 通用），导入即有元数据。
 *
 * file:// 与 Safari/Firefox 不可用——调用方需以 isFsaSupported() 分支展示。
 */

import { listLocalFonts, saveLocalFont, sha256Of, type LocalFont } from "./localFonts";

const HANDLE_DB = "typeflow_fs";
const HANDLE_STORE = "handles";
const HANDLE_KEY = "fonts";

export function isFsaSupported(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDLE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveHandle(h: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readwrite");
    tx.objectStore(HANDLE_STORE).put(h, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getFontDirHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readonly");
    const req = tx.objectStore(HANDLE_STORE).get(HANDLE_KEY);
    req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function clearFontDirHandle(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readwrite");
    tx.objectStore(HANDLE_STORE).delete(HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 绑定文件夹（必须在用户点击中调用）；返回文件夹名 */
export async function pickFontFolder(): Promise<string> {
  const picker = (window as unknown as { showDirectoryPicker?: (o?: unknown) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  if (!picker) throw new Error("当前浏览器不支持文件夹选择，请使用 Chrome 或 Edge");
  const handle = await picker({ id: "typeflow-fonts", mode: "read" });
  await saveHandle(handle);
  return handle.name;
}

/** 查询/请求读权限；requestPermission 必须在用户手势中调用 */
export async function checkDirPermission(handle: FileSystemDirectoryHandle, request = false): Promise<"granted" | "prompt" | "denied"> {
  const opts = { mode: "read" as const };
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

/** 扫描绑定文件夹：新字体（按 SHA-256 判重）连同本体导入本地库 */
export async function scanFontFolder(): Promise<FolderScanResult> {
  const handle = await getFontDirHandle();
  if (!handle) throw new Error("尚未绑定字体库文件夹");
  const perm = await checkDirPermission(handle);
  if (perm !== "granted") throw new Error("需要重新授权文件夹访问");

  const existing = new Set((await listLocalFonts()).map((f) => f.id));
  const result: FolderScanResult = { added: [], skipped: 0, total: 0, folderName: handle.name };

  // values() 为异步迭代器（TS dom 类型未收录，宽松处理）
  const values = (handle as unknown as { values: () => AsyncIterable<FileSystemHandle> }).values();
  for await (const entry of values) {
    if (entry.kind !== "file") continue;
    if (!/\.(ttf|otf)$/i.test(entry.name)) continue;
    result.total++;
    const file = await (entry as FileSystemFileHandle).getFile();
    const buf = await file.arrayBuffer();
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
    };
    await saveLocalFont(font);
    result.added.push(entry.name);
  }
  return result;
}
