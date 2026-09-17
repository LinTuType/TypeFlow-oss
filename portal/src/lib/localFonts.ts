/**
 * 本地字体库（统一存储层）
 *
 * 用途：把设计师的字体文件**保存在浏览器本地**（IndexedDB），
 * 在线一体流程中随时取用嵌入——字体文件从不离开本机。
 * 与云端字体库（只存哈希元数据）互补：
 *   云端 = 元数据 + 哈希（跨设备可见）
 *   本地 = 字体文件本体（仅本设备）
 *
 * 底层使用统一 db.ts（数据库 typeflow，store fonts）。
 */

import { STORE, dbGet, dbPut, dbDelete, dbGetAll, openDb } from "./db";

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

/** 计算文件 SHA-256（WebCrypto） */
export function sha256Of(buf: ArrayBuffer): Promise<string> {
  return crypto.subtle.digest("SHA-256", buf).then((d) =>
    [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""),
  );
}

/** 保存字体到本地库（重复 id 覆盖） */
export async function saveLocalFont(font: LocalFont): Promise<void> {
  await dbPut(STORE.FONTS, font);
}

/** 列出本地字体（不含 data，轻量） */
export async function listLocalFonts(): Promise<Array<Omit<LocalFont, "data">>> {
  const all = await dbGetAll<LocalFont>(STORE.FONTS);
  return all.map(({ data, ...meta }) => meta);
}

/** 取某字体的元数据（不含文件本体）—— 显示名 / 交付文件名的唯一权威在本机 */
export async function getLocalFont(id: string): Promise<Omit<LocalFont, "data"> | null> {
  const font = await dbGet<LocalFont>(STORE.FONTS, id);
  if (!font) return null;
  const { data, ...meta } = font;
  return meta;
}

/** 取某字体文件本体（订单签发时用） */
export async function getLocalFontData(id: string): Promise<ArrayBuffer | null> {
  const font = await dbGet<LocalFont>(STORE.FONTS, id);
  return font?.data ?? null;
}

/** 删除本地字体 */
export async function removeLocalFont(id: string): Promise<void> {
  await dbDelete(STORE.FONTS, id);
}

/** 删除全部本地字体（清本地数据用） */
export async function clearAllLocalFonts(): Promise<void> {
  const all = await listLocalFonts();
  await Promise.all(all.map((f) => removeLocalFont(f.id).catch(() => void 0)));
}