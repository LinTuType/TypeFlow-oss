/**
 * 本地字体库（IndexedDB）
 *
 * 用途：把设计师的字体文件**保存在浏览器本地**（IndexedDB），
 * 在线一体流程中随时取用嵌入——字体文件从不离开本机。
 * 与云端字体库（只存哈希元数据）互补：
 *   云端 = 元数据 + 哈希（跨设备可见）
 *   本地 = 字体文件本体（仅本设备）
 */

const DB_NAME = "typeflow_local_fonts";
const STORE = "fonts";

export interface LocalFont {
  id: string;              // sha256 前 16 位（与云端 font_id 一致）
  name: string;            // 显示名
  filename: string;
  sha256: string;          // 完整哈希（= 云端 original_font_sha256）
  glyphCount: number;
  size: number;
  savedAt: number;
  data: ArrayBuffer;       // 字体文件本体（仅存本机）
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 计算文件 SHA-256（WebCrypto） */
export function sha256Of(buf: ArrayBuffer): Promise<string> {
  return crypto.subtle.digest("SHA-256", buf).then((d) =>
    [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""),
  );
}

/** 保存字体到本地库（重复 id 覆盖） */
export async function saveLocalFont(font: LocalFont): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(font);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 列出本地字体（不含 data，轻量） */
export async function listLocalFonts(): Promise<Array<Omit<LocalFont, "data">>> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const all = req.result as LocalFont[];
      resolve(all.map(({ data, ...meta }) => meta));
    };
    req.onerror = () => reject(req.error);
  });
}

/** 取某字体文件本体（订单签发时用） */
export async function getLocalFontData(id: string): Promise<ArrayBuffer | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve((req.result as LocalFont | undefined)?.data ?? null);
    req.onerror = () => reject(req.error);
  });
}

/** 删除本地字体 */
export async function removeLocalFont(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}