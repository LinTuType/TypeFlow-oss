/**
 * CryptoProvider 接口 + 浏览器(WebCrypto)实现 — 阶段 3
 *
 * 本文件**零 Node 依赖**，可安全打进浏览器离线签发工具的 bundle。
 * Node 实现见 crypto.node.ts（仅在测试/参考环境中 import，不进浏览器包）。
 *
 * 引擎层不直接触碰任何 crypto API，统一接收注入的 CryptoProvider，
 * 保证 Node 与浏览器输出逐字节一致。
 */

/** HMAC-SHA256 / SHA-256 / 随机 统一抽象（均为异步，兼容 WebCrypto） */
export interface CryptoProvider {
  /** HMAC-SHA256(key, msg) → 32 字节摘要 */
  hmacSha256(key: Uint8Array, msg: Uint8Array): Promise<Uint8Array>;
  /** SHA-256(data) → 32 字节摘要 */
  sha256(data: Uint8Array): Promise<Uint8Array>;
  /** 生成 byteLength 字节加密安全随机数（注册租户时用） */
  randomBytes(byteLength: number): Promise<Uint8Array>;
}

/** 浏览器实现：WebCrypto（SubtleCrypto） */
export function createWebCryptoProvider(): CryptoProvider {
  const g = globalThis as {
    crypto?: { subtle?: SubtleCrypto; getRandomValues?: (a: Uint8Array) => void };
  };
  const subtle = g.crypto?.subtle;
  if (!subtle) throw new Error("当前环境无 WebCrypto.subtle，请使用 Node provider");

  return {
    async hmacSha256(key, msg) {
      const k = await subtle.importKey(
        "raw",
        key as BufferSource,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const sig = await subtle.sign("HMAC", k, msg as BufferSource);
      return new Uint8Array(sig);
    },
    async sha256(data) {
      return new Uint8Array(await subtle.digest("SHA-256", data as BufferSource));
    },
    async randomBytes(n) {
      const out = new Uint8Array(n);
      if (!g.crypto?.getRandomValues) throw new Error("无 getRandomValues");
      g.crypto.getRandomValues(out);
      return out;
    },
  };
}

export type { CryptoProvider as CryptoLike };