/**
 * Node 实现：node:crypto — 阶段 3
 *
 * 仅用于测试/参考一致性（compare.ts 等）。不要被浏览器 bundle 引用。
 */

import { createHmac, createHash, randomBytes } from "node:crypto";
import type { CryptoProvider } from "./crypto.js";

/** Node crypto provider（同步封装为 async，与 WebCrypto 接口一致） */
export function createNodeCryptoProvider(): CryptoProvider {
  return {
    async hmacSha256(key, msg) {
      return new Uint8Array(
        createHmac("sha256", Buffer.from(key)).update(Buffer.from(msg)).digest(),
      );
    },
    async sha256(data) {
      return new Uint8Array(createHash("sha256").update(Buffer.from(data)).digest());
    },
    async randomBytes(n) {
      return new Uint8Array(randomBytes(n));
    },
  };
}