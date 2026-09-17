/**
 * 从本机 IndexedDB 加载字体到 document.fonts，供页面**真实渲染**字形
 *
 * 这不是截图也不是服务端生成的预览图：字体 bytes 从浏览器本地库读出，
 * 交给浏览器的 FontFace 解析，再按正常文本排版画出来。
 * 整个过程零网络请求——顺带证明字体确实在本机。
 */

import { getLocalFontData } from "./localFonts";

const PREFIX = "tf-";
const pending = new Map<string, Promise<string | null>>();

/** 已加载则返回 font-family 名，失败返回 null */
export function loadFontFace(id: string): Promise<string | null> {
  const cached = pending.get(id);
  if (cached) return cached;

  const family = `${PREFIX}${id}`;
  const task = (async () => {
    try {
      const buf = await getLocalFontData(id);
      if (!buf || buf.byteLength === 0) return null;
      const face = new FontFace(family, buf);
      await face.load();
      document.fonts.add(face);
      return family;
    } catch {
      return null;
    }
  })();

  pending.set(id, task);
  // ⚠️ 失败结果**不进缓存**：字体本体是「以后可能才出现」的（添加字体 / 恢复备份 /
  // 换机导入），把 null 缓存下来会让同一页面里后续的加载永远拿到 null ——
  // 症状是标本卡一直显示「无文件」，刷新才恢复。成功才值得记。
  void task.then((f) => { if (!f) pending.delete(id); });
  return task;
}

/** 字体元数据变更后调用（重新添加字体时清缓存） */
export function invalidateFontFace(id?: string) {
  if (id) pending.delete(id);
  else pending.clear();
}
