/**
 * name 表读写 — 阶段 1（Name ID 256 水印元数据）
 *
 * 只实现最小需求：读取现有 name（保留原样）并在 .names 后追加
 * Name ID 256 记录（platformID=3/encodingID=1/windows/0x0409），
 * 与桌面版 write_name_id_256 的 setName(text, 256, 3, 1, 0x0409) 等价。
 */

const be16 = (d: Uint8Array, o: number) => ((d[o] << 8) | d[o + 1]) >>> 0;
const be32 = (d: Uint8Array, o: number) =>
  (((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0);

export interface NameRecord {
  platformID: number;
  encodingID: number;
  languageID: number;
  nameID: number;
  value: string; // UTF-16BE 解码结果
  utf16be: Uint8Array; // 原始编码字节
}

/** 解析 name 表（format 0/1 通用） */
export function parseNameTable(raw: Uint8Array, offset: number, length: number): NameRecord[] {
  const format = be16(raw, offset);
  const count = be16(raw, offset + 2);
  const stringOffset = offset + be16(raw, offset + 4);
  const recs: NameRecord[] = [];
  for (let i = 0; i < count; i++) {
    const o = offset + 6 + i * 12;
    const platformID = be16(raw, o);
    const encodingID = be16(raw, o + 2);
    const languageID = be16(raw, o + 4);
    const nameID = be16(raw, o + 6);
    const strLen = be16(raw, o + 8);
    // 字符串偏移是 16 位无符号（name 表 record 字段），非 32 位
    const strOff = be16(raw, o + 10);
    const absOff = stringOffset + strOff;
    if (absOff + strLen > offset + length) continue;
    const bytes = raw.slice(absOff, absOff + strLen);
    recs.push({ platformID, encodingID, languageID, nameID, value: decodeUtf16be(bytes), utf16be: bytes });
  }
  const _ = format; // 占位：目前只读记录，写回始终用 format 0
  return recs;
}

function decodeUtf16be(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const c = (bytes[i] << 8) | bytes[i + 1];
    s += String.fromCharCode(c);
  }
  return s;
}

function encodeUtf16be(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out[i * 2] = (c >> 8) & 0xff;
    out[i * 2 + 1] = c & 0xff;
  }
  return out;
}

/**
 * 重建 name 表字节。
 * 保留除 256 外的全部既有记录（含 format 1 的 langTag 直接丢弃，行为等同重写 format 0）。
 * @param recs 既有记录（含旧 256 将被过滤）
 */
export function buildNameTable(
  recs: NameRecord[],
  nameId256Value: string | null,
): Uint8Array {
  const kept = recs.filter((r) => r.nameID !== 256);
  const names = kept.map((r) => r.utf16be);
  if (nameId256Value !== null) names.push(encodeUtf16be(nameId256Value));

  const count = names.length;
  const recordsLen = count * 12;
  const stringsLen = names.reduce((a, b) => a + b.length, 0);
  const storageStart = 6 + recordsLen; // format + count + stringOffset

  const out = new Uint8Array(storageStart + stringsLen);
  // format 0
  out[0] = 0; out[1] = 0;
  out[2] = (count >> 8) & 0xff; out[3] = count & 0xff;
  out[4] = (storageStart >> 8) & 0xff; out[5] = storageStart & 0xff;

  let stringBase = 0;
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 12;
    const rec = i < kept.length ? kept[i] : {
      platformID: 3,
      encodingID: 1,
      languageID: 0x0409,
      nameID: 256,
    };
    const bytes = names[i];
    // platform
    out[o] = (rec.platformID >> 8) & 0xff; out[o + 1] = rec.platformID & 0xff;
    out[o + 2] = (rec.encodingID >> 8) & 0xff; out[o + 3] = rec.encodingID & 0xff;
    out[o + 4] = (rec.languageID >> 8) & 0xff; out[o + 5] = rec.languageID & 0xff;
    out[o + 6] = (rec.nameID >> 8) & 0xff; out[o + 7] = rec.nameID & 0xff;
    out[o + 8] = (bytes.length >> 8) & 0xff; out[o + 9] = bytes.length & 0xff;
    out[o + 10] = (stringBase >> 8) & 0xff; out[o + 11] = stringBase & 0xff;
    out.set(bytes, storageStart + stringBase);
    stringBase += bytes.length;
  }
  return out;
}