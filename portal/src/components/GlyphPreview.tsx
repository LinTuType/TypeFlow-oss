/**
 * 字形预览 —— 用本机字体文件真渲染
 *
 * 字体 bytes 来自浏览器本地库（IndexedDB），经 FontFace 解析后按正常排版画出，
 * 全程不联网。卡片进入视口才开始加载，避免一次性解析整个库。
 */
import { useEffect, useRef, useState } from "react";
import { loadFontFace } from "../lib/fontFace";

interface Props {
  fontId: string;
  /** 本机是否持有字体文件本体。显式传 false 就不去读库（云端仅存哈希的行没有文件可画）；
   *  由 false 变 true 时必须重试加载 —— 见下面 effect 里的说明。 */
  local?: boolean;
  /** 样张；默认「永」——中文排版常用试金石 */
  sample?: string;
  /** 附加的一行小字（拉丁/数字） */
  sub?: string;
  height?: number;
  className?: string;
}

export default function GlyphPreview({
  fontId, local, sample = "永", sub = "Ag 0123", height = 72, className = "",
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [family, setFamily] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // 进入视口才加载
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // ⚠️ `local` 必须在依赖里。同一行可以从「云端仅存哈希」变成「本机也有文件」——
  //    合并后的行 key 不变（都是 sha256 前 16 位），React 复用同一个组件实例，
  //    依赖不变就不会重跑 effect ⇒ 卡片会一直停在「无文件」，刷新才恢复。
  //    （真机检查在预发上抓到过：库里有同哈希的云端行时添加这款字体，标本区画不出来。）
  useEffect(() => {
    if (!visible) return;
    if (local === false) { setFamily(null); setFailed(true); return; }
    let cancelled = false;
    setFailed(false);
    void loadFontFace(fontId).then((f) => {
      if (cancelled) return;
      setFamily(f);
      setFailed(!f);
    });
    return () => { cancelled = true; };
  }, [visible, fontId, local]);

  const style = family ? { fontFamily: `"${family}", "Songti SC", serif` } : undefined;

  return (
    <div ref={hostRef} className={`glyph ${className}`} style={{ height }}>
      {!family && !failed && <div className="glyph-placeholder" />}
      {failed && <div className="glyph-failed" title="本机没有这个字体的文件，无法预览">无文件</div>}
      {family && (
        <>
          <div className="glyph-main" style={style}>{sample}</div>
          {sub && <div className="glyph-sub" style={style}>{sub}</div>}
        </>
      )}
    </div>
  );
}
