/**
 * 平台检测 —— 为 Mac / Windows 分别应用不同字体策略
 *
 * 在应用启动时执行，将 .platform-mac 或 .platform-win 类加到
 * <html> 上，theme-navy.css 中的平台专用规则便会生效。
 */
export function detectPlatform(): 'mac' | 'win' {
  const ua = navigator.userAgent;
  return /Mac|iPhone|iPad|iPod/i.test(ua) ? 'mac' : 'win';
}

/** 应用平台类到 <html> */
export function applyPlatformClass(): void {
  const cls = detectPlatform();
  document.documentElement.classList.add('platform-' + cls);
}