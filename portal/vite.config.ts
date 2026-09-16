import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// 管理门户：开发期代理到本地 worker；构建产物纯静态（页面只连 worker API）
// engine 在 portal 外（web-version/engine），需放开 fs.allow 并加 alias 引用。
// 注意：fs.allow 只放开用到的最小目录；watcher 显式忽略巨型产物目录
// （dist/dmg 内含整套 Glyphs/Photoshop App，扫它会把 dev server 拖到无响应）。
const engineAlias = resolve(__dirname, "../engine/src");
const allowDirs = [
  resolve(__dirname),                 // portal 根（index.html）
  resolve(__dirname, "src"),
  resolve(__dirname, "public"),
  resolve(__dirname, "..", "engine", "src"),
];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@engine": engineAlias },
  },
  server: {
    port: 5173,
    host: "127.0.0.1",
    strictPort: true,
    fs: { allow: allowDirs },
    watch: {
      ignored: [
        "**/dist/**",
        "**/node_modules/**",
        "**/.git/**",
        resolve(__dirname, "..", "..", "dist"),
      ],
    },
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/health": "http://127.0.0.1:8787",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});