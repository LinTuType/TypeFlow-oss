/**
 * 信任要素 —— 「零上传」的可核验证据
 *
 * 设计原则：这里的每一条证据都在**浏览器里实时算出来**，不是写死的宣称文案。
 *   1. 源码片段：用 Vite `?raw` 导入**真实源文件**（不是复制粘贴的副本，改了源码这里就变）
 *   2. 哈希：用 WebCrypto 对源码文本实时算 SHA-256
 *   3. 网络调用扫描：对源码做正则扫描，报告是否存在 fetch / XHR / WebSocket / sendBeacon
 *
 * 于是「字体不上传」这句话可以被用户自己验证，而不是要求用户相信我们。
 */

import embedSrc from "@engine/embed.ts?raw";
import localFontsSrc from "./localFonts.ts?raw";
import issuerSrc from "./issuer.ts?raw";

/** 开源仓库（公开镜像，内容由 scripts/export-oss.mjs 从主仓库导出：engine + portal + 自证清单） */
export const REPO_URL = "https://github.com/LinTuType/TypeFlow-oss";

/** 开源范围（决策点 3，2026-09-16 拍板）：engine + portal公开，签发服务 worker 暂不公开 */
export const OSS_SCOPE: Array<{ area: string; open: boolean; why: string }> = [
  { area: "engine/（水印引擎）", open: true, why: "算法与嵌入逻辑——信任页「源码自证」算哈希的就是这些文件" },
  { area: "portal/（门户前端）", open: true, why: "上传行为全在这里，代码公开即可核验「没有偷偷发文件」" },
  { area: "自证清单 MANIFEST", open: true, why: "记录导出时的主仓库 commit 与逐文件 SHA-256，供与部署产物对照" },
  { area: "worker/（配方签发服务）", open: false, why: "服务端代码，持有密钥与租户数据；是否开源单独决策，不影响以上可核验链" },
];

/** 离线签发工具（可选下载，非主流程）：由 make-local-signer.mjs 产出到 portal/public */
export const OFFLINE_TOOL_PATH = "/typeflow-local-signer.html";

export interface SourceProof {
  /** 仓库内路径（展示用） */
  path: string;
  /** 这个文件负责什么（人话） */
  title: string;
  /** 源码全文（构建期真实导入） */
  source: string;
}

/** 参与自证的源码：挑最能让用户放心的三段 */
export const PROOF_SOURCES: SourceProof[] = [
  {
    path: "engine/src/embed.ts",
    title: "水印嵌入主流程：读字体字节 → 改字形坐标 → 写回，纯计算",
    source: embedSrc,
  },
  {
    path: "portal/src/lib/localFonts.ts",
    title: "本地字体库：字体文件存进 IndexedDB，只有读写，没有出口",
    source: localFontsSrc,
  },
  {
    path: "portal/src/lib/issuer.ts",
    title: "一体签发：取本地字体 + 云端配方 → 本机生成水印字体",
    source: issuerSrc,
  },
];

/** 网络调用特征（源码里出现任何一个，都说明"零上传"站不住） */
const NET_CALL_RE = /\b(fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|navigator\.sendBeacon)\b/g;

export interface ScanResult {
  hits: string[];
  clean: boolean;
}

/** 扫描源码里是否存在网络调用 */
export function scanNetworkCalls(src: string): ScanResult {
  const hits = Array.from(new Set(src.match(NET_CALL_RE) ?? []));
  return { hits, clean: hits.length === 0 };
}

/** 文本 SHA-256（WebCrypto） */
export async function sha256Text(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 出网清单：这些是唯一会离开本机的数据 */
export const OUTBOUND_FIELDS: Array<{ name: string; detail: string }> = [
  { name: "字体 SHA-256", detail: "64 个字符，用于事后追溯比对，无法还原成字体" },
  { name: "订单信息", detail: "订单号、客户标识、授权方案" },
  { name: "水印产出哈希", detail: "签发后归档用，无法还原成字体" },
];

/** 不出网清单 */
export const NEVER_OUTBOUND: string[] = [
  "字体文件本体（.ttf / .otf）",
  "字形轮廓与坐标数据",
  "嵌入过程与中间产物",
];
