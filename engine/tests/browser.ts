/**
 * 启动 chromium（三个 E2E 共用）
 *
 * 为什么不能直接 `chromium.launch()`：本机 playwright 只装了缓存形式的
 * headless shell，直接 launch 会找不到可执行文件。而硬编码那个缓存路径又会让
 * CI（ubuntu）必然失败。
 *
 * 策略：按顺序试几个已知位置，全都没有就把解析交给 playwright 自己
 * （CI 里先跑 `npx playwright install --with-deps chromium` 即可）。
 * 想指定别的浏览器：`TF_CHROME=/path/to/chrome npm run portal:e2e`。
 */

import { existsSync } from "node:fs";
import { chromium, type Browser } from "playwright";

const CANDIDATES = [
  process.env.TF_CHROME,
  // 本机 playwright 缓存（版本号会随 playwright 升级变，故列两个常见位置 + 系统 Chrome 兜底）
  "/Users/junzhong/Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter((p): p is string => typeof p === "string" && p.length > 0);

export async function launchChromium(): Promise<Browser> {
  for (const path of CANDIDATES) {
    if (!existsSync(path)) continue;
    try {
      return await chromium.launch({ executablePath: path, headless: true });
    } catch {
      // 这个位置不可用（架构不符/权限），试下一个
    }
  }
  return chromium.launch({ headless: true });
}
