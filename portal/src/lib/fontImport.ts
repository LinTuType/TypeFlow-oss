/**
 * 字体入库 —— **唯一实现**
 *
 * 为什么单独一个文件：这段逻辑原先在字体库页（`Fonts.pickFont`）与签发页（`Issue.importFont`）
 * 各有一份，加「开始使用」引导就会变成第三份。三份实现迟早会长歪（其中一份漏了 `maybeFolderBackup`、
 * 另一份的提示文案不同都已经发生过），所以收敛到这里，页面只负责「给文件 + 报结果」。
 *
 * 数据边界：全程本机 —— 读文件、算 SHA-256、写 IndexedDB，没有任何网络调用
 * （字体库页的哈希同步是另一个显式动作，不在这里发生）。
 */

import { assertSupportedTtf } from "@engine/ttf/reader.js";
import { getLocalFontData, listLocalFonts, saveLocalFont, sha256Of } from "./localFonts";
import { invalidateFontFace } from "./fontFace";
import { maybeFolderBackup } from "./backupFolder";

export interface ImportFontResult {
  /** 本机主键 = sha256 前 16 位 */
  id: string;
  /** 字体名（文件名去扩展名） */
  name: string;
  sha256: string;
  /**
   * 同名但哈希不同的旧版本（有值时说明这次是「换版本入库」）：
   * 新版本作为**新字体**登记，旧版本与它的历史订单完全不受影响 —— 追溯靠哈希不靠文件名。
   */
  sameNamePrevious?: string;
}

/**
 * 把一个用户选中的 TTF 文件存进本机字体库。
 * 失败抛人话错误（OTF/CFF 的拒绝话术来自 `assertSupportedTtf`），调用方接住塞进 toast。
 */
export async function importFontFile(f: File): Promise<ImportFontResult> {
  const buf = await f.arrayBuffer();
  assertSupportedTtf(new Uint8Array(buf));   // OTF/CFF 拒之门外（人话文案）
  const sha = await sha256Of(buf);
  const id = sha.slice(0, 16);

  // 同名不同哈希 = 新版本（5.6 语义），先查出来以便调用方在提示里说清楚
  const sameName = (await listLocalFonts()).find((x) => x.filename === f.name && x.sha256 !== sha);
  // 同一份文件重复入库：直接返回既有记录，不做无意义的覆盖写
  const existing = await getLocalFontData(id);
  if (existing) {
    return { id, name: f.name.replace(/\.(ttf|otf|woff2?)$/i, ""), sha256: sha, sameNamePrevious: sameName?.name };
  }

  await saveLocalFont({
    id,
    name: f.name.replace(/\.(ttf|otf|woff2?)$/i, ""),
    filename: f.name,
    sha256: sha,
    glyphCount: 0,
    size: f.size,
    savedAt: Date.now(),
    data: buf,
  });
  invalidateFontFace(id);
  // 数据变更点 → 触发文件夹自动备份（内部节流 30s、失败静默）
  maybeFolderBackup();

  return {
    id,
    name: f.name.replace(/\.(ttf|otf|woff2?)$/i, ""),
    sha256: sha,
    sameNamePrevious: sameName?.name,
  };
}

/** 入库提示的说明行（两处页面共用同一句话，避免"同样的事两种说法"） */
export function importFontDetail(r: ImportFontResult): string {
  if (r.sameNamePrevious) {
    return `检测到与「${r.sameNamePrevious}」同名不同版本 —— 已作为新字体登记，旧版本与它的历史订单不受影响`;
  }
  return "未上传、未同步 —— 只保存在你的浏览器里，版本从此锁定";
}
