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
  /** 样张；默认「永」——中文排版常用试金石 */
  sample?: string;
  /** 附加的一行小字（拉丁/数字） */
  sub?: string;
  height?: number;
  className?: string;
}

export default function GlyphPreview({
  fontId, sample = "永", sub = "Ag 0123", height = 72, className = "",
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

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void loadFontFace(fontId).then((f) => {
      if (cancelled) return;
      setFamily(f);
      setFailed(!f);
    });
    return () => { cancelled = true; };
  }, [visible, fontId]);

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
