/**
 * 一体签发服务 —— 门户内直接完成「本地嵌入 → 下载水印 + 授权书」
 *
 * 流程（全部在本机浏览器完成，字体不离开设备）：
 *   1. 从本地字体库取字体 Bytes
 *   2. 云端签发配方（order_root）
 *   3. 引擎本地嵌入（纯 WebCrypto，零 node 依赖）
 *   4. 返回：水印 TTF bytes + Name256 内容
 *
 * 授权书由 lib/license.ts 生成（一份 model + 两个出口），走 window.print() 存为 PDF。
 */

/* ── 嵌入 worker 通道 ────────────────────────────────────────────────
   嵌入是 3.3s 的同步计算（密钥派生 + SHA-256 + 遍历几万字形重建 glyf），放主线程会把整页冻住
   （实测点击签发后 58ms 起冻结 3337ms：过程槽动画停在半句、按钮 spinner 停转、恢复后状态一次性涌出）。
   改到 worker 里跑，主线程保持可渲染。
   ⚠️ worker 是浏览器内部线程，同页面同机器，只走内存消息，不发网络请求 —— 字体不出设备。 */
let embedWorker: Worker | null = null;
let embedSeq = 0;

function getEmbedWorker(): Worker {
  if (!embedWorker) {
    embedWorker = new Worker(new URL("./embedWorker.ts", import.meta.url), { type: "module" });
  }
  return embedWorker;
}

interface WorkerEmbedOk {
  ok: true;
  bytes: ArrayBuffer;
  nModified: number;
  nameId256: string | null;
  fontSha256: string;
}

function embedInWorker(req: {
  fontData: ArrayBuffer; orderRoot: ArrayBuffer;
  tenantId: string; orderId: string; bitsSuffix: string;
  algoVersion?: string;
}): Promise<WorkerEmbedOk> {
  return new Promise((resolve, reject) => {
    const w = getEmbedWorker();
    const id = ++embedSeq;
    const onMsg = (e: MessageEvent) => {
      if (!e.data || e.data.id !== id) return;   // 并发时按 id 认领自己的回包
      w.removeEventListener("message", onMsg);
      if (e.data.ok) resolve(e.data as WorkerEmbedOk);
      else reject(new Error(e.data.error || "嵌入失败"));
    };
    w.addEventListener("message", onMsg);
    w.addEventListener("error", (e) => {
      w.removeEventListener("message", onMsg);
      reject(new Error(`嵌入线程异常：${e.message || "未知"}`));
    }, { once: true });
    w.postMessage({ id, ...req });
  });
}

export interface SignResult {
  fontBytes: Uint8Array;         // 水印字体
  nModified: number;
  nameId256Text: string;
  orderId: string;
  fontSha256: string;
  watermarkedSha256: string;     // 水印字体 SHA-256（完成回执用）
}

/**
 * 本地嵌入：从本地字体库取字体 + order_root → 生成水印字体。
 * @param data 原版字体 ArrayBuffer（本地库取）
 * @param recipe 云端 issuance-recipe 返回的 recipe（含 order_root_hex）
 */
export async function localEmbed(
  data: ArrayBuffer,
  recipe: { order_root_hex: string; order_id: string; bits_suffix?: string; algo_version?: string },
): Promise<SignResult> {
  const orderRoot = new Uint8Array(
    recipe.order_root_hex.match(/.{2}/g)!.map((h) => parseInt(h, 16)),
  );
  // postMessage 默认结构化克隆（拷贝），调用方的 ArrayBuffer 不会被夺走
  const r = await embedInWorker({
    fontData: data,
    orderRoot: orderRoot.buffer as ArrayBuffer,
    tenantId: "portal-local",
    orderId: recipe.order_id,
    bitsSuffix: recipe.bits_suffix ?? "",
    // 把配方里的算法版本号透传给引擎：写进 Name 256 的必须是**这份订单签发当时**的版本。
    // 历史订单的配方是 web-v1 / web-v2，「重新生成交付包」时若不透传就会写出当前版本号，
    // 同一份历史订单的两次交付会在同一个字段上给出两个不同的值。
    algoVersion: recipe.algo_version,
  });
  const bytes = new Uint8Array(r.bytes);
  // 本地计算水印字体哈希（完成回执 + 授权书用）
  const wmSha = await sha256Hex(bytes);
  return {
    fontBytes: bytes,
    nModified: r.nModified,
    nameId256Text: r.nameId256 ?? "",
    orderId: recipe.order_id,
    fontSha256: r.fontSha256,
    watermarkedSha256: wmSha,
  };
}

/** 计算 Uint8Array 的 SHA-256 hex（WebCrypto） */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 触发下载 Uint8Array 为文件 */
export function downloadBytes(bytes: Uint8Array, filename: string, mime = "application/octet-stream"): void {
  const copy = bytes.slice(); // 复制一份为 ArrayBuffer 视图，避免 SharedArrayBuffer 类型问题
  const blob = new Blob([copy.buffer as ArrayBuffer], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
