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
import apiClientSrc from "../api/client.ts?raw";
import securityPageSrc from "../pages/Security.tsx?raw";

/** 开源仓库（公开镜像，内容由 scripts/export-oss.mjs 从主仓库导出：engine + portal + 自证清单） */
export const REPO_URL = "https://github.com/LinTuType/TypeFlow-oss";

/** 开源范围（决策点 3，2026-09-16 拍板）：engine + portal公开，签发服务 worker 暂不公开 */
export const OSS_SCOPE: Array<{ area: string; open: boolean; why: string }> = [
  { area: "engine/（水印引擎）", open: true, why: "水印算法与嵌入逻辑，信任页「源码自证」即以其实时哈希为证" },
  { area: "portal/（门户前端）", open: true, why: "上传行为均在前端实现，代码公开即可核验无隐蔽传输" },
  { area: "自证清单 MANIFEST", open: true, why: "记录导出时的主仓库提交与逐文件 SHA-256，供与部署产物比对" },
  { area: "worker/（配方签发服务）", open: false, why: "服务端代码，持有密钥与租户数据；是否开源另行决策，不影响前述可核验链路" },
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
  /** 允许的网络调用说明。不填 = 该文件应当零网络调用（扫到即FAIL）；
      填了 = 扫到时展示这句"仅限预期出网"而不是报错 */
  expectNet?: string;
}

/** 参与自证的源码：三个"本来就不该有网络调用"的纯净文件 + 一个"唯一允许出网"的文件 */
export const PROOF_SOURCES: SourceProof[] = [
  {
    path: "portal/src/api/client.ts",
    title: "门户 API 客户端：业务请求的唯一出口——所有 /api 调用都从这里发出",
    source: apiClientSrc,
    expectNet: "仅调用本服务 /api/*（账号、哈希、订单、配方）——对应数据流向图的通道 ①",
  },
  {
    path: "portal/src/pages/Security.tsx",
    title: "本页源码：算「本页自证」哈希时会请求一次本页自身地址，不携带任何用户数据",
    source: securityPageSrc,
    expectNet: "仅 fetch 本页自身地址（/security），用于实时计算本页哈希——请求里没有查询参数、没有用户数据",
  },
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
/**
 * 出网清单只列**与字体和业务相关的数据**（字体 / 订单）——这是本页的议题；
 * 账号服务（登录、验证邮件等）与字体无关，见《隐私政策》，不在这里混列。
 * 云端订单不挂任何客户标识：哪笔订单是谁的，只有你本机的订单关联知道。
 */
export const OUTBOUND_FIELDS: Array<{ name: string; detail: string }> = [
  { name: "字体数据", detail: "字体名称与 SHA-256 哈希（用于登记与追溯比对，不可逆推出字体本身）" },
  { name: "订单信息", detail: "订单号、授权方案与水印产出哈希（用于签发归档，不含客户标识与授权费用）" },
];

/** 不出网清单 */
export const NEVER_OUTBOUND: string[] = [
  "字体文件本体（.ttf / .otf）",
  "字形轮廓与坐标数据",
  "嵌入过程与中间产物",
  "客户资料（姓名、备注、授权费用）——仅存本机，云端不记录",
  "备份文件——仅写入你绑定的本地文件夹，不经任何服务器",
];
