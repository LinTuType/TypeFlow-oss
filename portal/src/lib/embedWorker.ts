/**
 * 水印嵌入 worker —— 把嵌入从主线程挪走。
 *
 * 为什么要单独一条线程：
 *   嵌入是 3.3 秒的**同步**计算（密钥派生 + SHA-256 + 遍历几万个字形重建 glyf）。
 *   放在主线程会把整页冻住 —— 实测点击签发后 58ms 起冻结 3337ms，过程槽的逐字动画停在半句、
 *   按钮 spinner 停转，恢复后积压的状态一次性涌出（用户报的就是"卡第一条，然后快速走完"）。
 *
 * ⚠️ 数据边界（重要）：
 *   这是**浏览器内部的线程**，与主线程同页面、同机器、同源。它不发任何网络请求 ——
 *   引擎模块本身零网络调用（e2e 的"源码自证"断言锁着这一点），这里也只 import 引擎。
 *   字体字节通过 postMessage 传递，是内存里的结构化克隆，不出浏览器进程。
 *   provider 也不能跨线程传（含函数），所以在 worker 内自行创建。
 */
import { embedWatermark } from "@engine/embed";
import { createWebCryptoProvider } from "@engine/crypto";

/** 在 DOM lib 下 self 是 Window，这里按 worker 全局声明收窄（避免引入 webworker lib 与 DOM 冲突） */
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (msg: unknown, transfer?: Transferable[]) => void;
};

const provider = createWebCryptoProvider();

interface EmbedReq {
  id: number;
  fontData: ArrayBuffer;
  orderRoot: ArrayBuffer;
  tenantId: string;
  orderId: string;
  bitsSuffix: string;
  /** 配方里的算法版本号（历史订单是 web-v1 / web-v2）；缺省由引擎按容器取当前版本 */
  algoVersion?: string;
}

ctx.onmessage = (e: MessageEvent<EmbedReq>) => {
  const { id, fontData, orderRoot, tenantId, orderId, bitsSuffix, algoVersion } = e.data;
  void (async () => {
    try {
      const r = await embedWatermark({
        fontData: new Uint8Array(fontData),
        orderRoot: new Uint8Array(orderRoot),
        provider,
        tenantId,
        orderId,
        bitsSuffix,
        algoVersion,
      });
      // 结果字节用 Transferable 交回主线程（所有权转移，不拷贝）
      ctx.postMessage(
        {
          id, ok: true,
          bytes: r.bytes.buffer,
          nModified: r.nModified,
          nameId256: r.nameId256,
          fontSha256: r.selection.font_sha256,
        },
        [r.bytes.buffer],
      );
    } catch (err) {
      ctx.postMessage({ id, ok: false, error: (err as Error)?.message ?? String(err) });
    }
  })();
};
