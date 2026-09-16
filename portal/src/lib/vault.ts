/**
 * vault 密钥体系（客户资料 E2E 加密的浏览器侧实现）
 *
 * 只做一件事：用户用「恢复码」加密/解密自己的数据。
 *   - 恢复码 = 160 位随机（防混淆字符集），只存在于用户手里；
 *     服务器存的永远是密文，且服务端无法解密（密钥不在云端）。
 *   - 忘记/丢失恢复码 = 永久无法解密 —— 这是必然代价，UI 必须讲清楚。
 *
 * 加密格式（JSON，base64 字段）：
 *   { v: 1, kdf: "sha256", iv: <base64>, ct: <base64> }
 *   密钥 = SHA-256(恢复码)（恢复码本身就是高熵，无需 PBKDF2 慢哈希）
 */

/** Crockford Base32 字符集：32 个字符，去掉 I/L/O/U 防混淆 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/* ---------- base64 助手（浏览器全局 btoa/atob 处理二进制） ---------- */
function b64(buf: Uint8Array): string {
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) {
    s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  }
  return btoa(s);
}
function unb64(b: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b);
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 生成恢复码：20 随机字节 → 32 位无歧义字符，每 8 位一组 */
export function generateRecoveryCode(): string {
  const bytes = new Uint8Array(20); // 160 bits
  crypto.getRandomValues(bytes);
  const chars: string[] = [];
  let bit = 0;
  for (let i = 0; i < 32; i++) {
    let v = 0;
    for (let b = 0; b < 5; b++, bit++) {
      const byteIdx = bit >> 3;
      const r = bytes[byteIdx];
      v = (v << 1) | ((r >> (7 - (bit & 7))) & 1);
    }
    chars.push(ALPHABET[v]);
    if (i === 7 || i === 15 || i === 23) chars.push("-");   // 每 8 位插分隔符
  }
  return chars.join("");
}

/** 恢复码 → AES-GCM 密钥（SHA-256 派生；恢复码高熵可直派） */
async function codeToKey(code: string): Promise<CryptoKey> {
  const normalized = code.replace(/[^0-9A-Z]/gi, "").toUpperCase();
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** 加密任意结构化数据 → 密文字符串（可存 vault / 导出文件） */
export async function encryptVault(code: string, plain: unknown): Promise<string> {
  const key = await codeToKey(code);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plainBytes = new TextEncoder().encode(JSON.stringify(plain));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plainBytes);
  return JSON.stringify({ v: 1, kdf: "sha256", iv: b64(iv), ct: b64(new Uint8Array(ct)) });
}

/** 解密密文字符串 → 结构化数据；恢复码错误/数据损坏抛错 */
export async function decryptVault(code: string, payload: string): Promise<unknown> {
  const parsed = JSON.parse(payload) as { v?: number; kdf?: string; iv?: string; ct?: string };
  if (parsed?.v !== 1 || parsed?.kdf !== "sha256" || !parsed.iv || !parsed.ct) {
    throw new Error("备份文件格式无法识别");
  }
  const key = await codeToKey(code);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(parsed.iv) },
      key,
      unb64(parsed.ct),
    );
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new Error("恢复码错误或备份已损坏——请检查你抄写的恢复码");
  }
}

/** 检查一个恢复码输入是否满足格式（32 位 + 分隔符，宽松校验） */
export function isValidRecoveryCode(code: string): boolean {
  const digits = code.replace(/[^0-9A-Z]/gi, "").toUpperCase();
  return digits.length === 32;
}