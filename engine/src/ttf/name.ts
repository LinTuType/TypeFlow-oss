/**
 * name 表读写 — 阶段 1（Name ID 256 水印元数据）
 *
 * 只实现最小需求：读取现有 name（保留原样）并在 .names **最前面**插入
 * Name ID 256 记录（platformID=3/encodingID=1/windows/0x0409），
 * 与桌面版 write_name_id_256 的 setName(text, 256, 3, 1, 0x0409) 等价。
 *
 * ⚠️ **Name ID 256 不是我们的专属编号**（2026-09-18 实测踩到）：
 * OpenType 规定 256–32767 是"字体自定义"区间，而**可变字体的轴实例名正好从这里开始** ——
 * 实测 `SourceHanSansSC-VF.otf` 的 `(3,1,1033,256)` 就是它默认实例的名字 `Regular`，
 * 一直到 279。所以：
 *   1. **判断"这条记录是不是我们的水印"必须按内容**（`looksLikeWatermark`），不能按编号；
 *      否则可变字体会被误判成"已经带水印"，一台都签不了。
 *   2. **只删我们自己的那条**（旧写法是把所有 256 记录都删掉 ⇒ 会顺手抹掉字体自带的实例名）。
 *   3. 我们的记录插在**最前面**：别的读取方（含桌面版 `read_name_id_256`）是按"第一条 256"取的，
 *      放最前后它们仍然读得到我们的记录，而字体自带的那条原样留在后面。
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

/** 水印记录用的 name 记录三元组（写入与识别都以它为准） */
export const WATERMARK_NAME_ID = 256;
export const WATERMARK_PLATFORM = 3;
export const WATERMARK_ENCODING = 1;
export const WATERMARK_LANGUAGE = 0x0409;

/**
 * 这条 nameID 256 记录的**内容**是不是我们的水印？
 *
 * 两种历史形态都认：
 *   - **web 版**：单行 JSON，带 `"schema":"typeflow"`
 *   - **桌面版**：`key=value` 换行文本（`build_name_record_text`），至少含 `order_id=`
 *
 * 其余一律不算 —— 最典型的就是可变字体的轴实例名（`Regular` / `SourceHanSansSCVF-Bold` …）。
 */
export function looksLikeWatermark(value: string): boolean {
  const v = value.trim();
  if (v.startsWith("{")) {
    try {
      const meta = JSON.parse(v) as { schema?: unknown };
      return meta !== null && typeof meta === "object" && meta.schema === "typeflow";
    } catch {
      return false;
    }
  }
  return /(^|\n)\s*order_id\s*=/.test(v);
}

/** 从水印记录里尽力取出订单号（取不到返回 null） */
export function orderIdOfWatermark(value: string): string | null {
  const v = value.trim();
  if (v.startsWith("{")) {
    try {
      const meta = JSON.parse(v) as { order_id?: unknown };
      return typeof meta.order_id === "string" ? meta.order_id : null;
    } catch {
      return null;
    }
  }
  const m = /(^|\n)\s*order_id\s*=\s*(.+)/.exec(v);
  return m ? m[2].trim() : null;
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
 *
 * - 保留除**我们那条水印**以外的全部既有记录（含字体自带的 256 实例名；format 1 的 langTag 丢弃，行为等同重写 format 0）
 * - 水印记录（若给值）插在**最前面**
 *
 * @param recs 既有记录（其中我们自己的旧水印会被替换/过滤）
 */
export function buildNameTable(
  recs: NameRecord[],
  nameId256Value: string | null,
): Uint8Array {
  /** 字体自带（不是我们的）的 256 记录 —— 有它才需要"插到最前"来压过它 */
  const hasOwn256 = recs.some(
    (r) => r.nameID === WATERMARK_NAME_ID && !looksLikeWatermark(r.value),
  );
  const kept = recs.filter((r) => !(r.nameID === WATERMARK_NAME_ID && looksLikeWatermark(r.value)));

  type Item = { platformID: number; encodingID: number; languageID: number; nameID: number; bytes: Uint8Array };
  const items: Item[] = kept.map((r) => ({
    platformID: r.platformID,
    encodingID: r.encodingID,
    languageID: r.languageID,
    nameID: r.nameID,
    bytes: r.utf16be,
  }));
  if (nameId256Value !== null) {
    const own: Item = {
      platformID: WATERMARK_PLATFORM,
      encodingID: WATERMARK_ENCODING,
      languageID: WATERMARK_LANGUAGE,
      nameID: WATERMARK_NAME_ID,
      bytes: encodeUtf16be(nameId256Value),
    };
    // ⚠️ 只在**真有撞号**时才插到最前；没有撞号时追加（= 历史行为，产物逐字节不变）。
    //    这条"按需才动"很要紧：`watermarked_sha256` 是云端回执、订单页重算时要逐字节比对，
    //    无条件改记录顺序会让**已签发订单**的重算结果对不上。
    if (hasOwn256) items.unshift(own); else items.push(own);
  }

  const count = items.length;
  const storageStart = 6 + count * 12; // format + count + stringOffset
  const stringsLen = items.reduce((a, b) => a + b.bytes.length, 0);

  const out = new Uint8Array(storageStart + stringsLen);
  // format 0
  out[0] = 0; out[1] = 0;
  out[2] = (count >> 8) & 0xff; out[3] = count & 0xff;
  out[4] = (storageStart >> 8) & 0xff; out[5] = storageStart & 0xff;

  let stringBase = 0;
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 12;
    const it = items[i];
    out[o] = (it.platformID >> 8) & 0xff; out[o + 1] = it.platformID & 0xff;
    out[o + 2] = (it.encodingID >> 8) & 0xff; out[o + 3] = it.encodingID & 0xff;
    out[o + 4] = (it.languageID >> 8) & 0xff; out[o + 5] = it.languageID & 0xff;
    out[o + 6] = (it.nameID >> 8) & 0xff; out[o + 7] = it.nameID & 0xff;
    out[o + 8] = (it.bytes.length >> 8) & 0xff; out[o + 9] = it.bytes.length & 0xff;
    out[o + 10] = (stringBase >> 8) & 0xff; out[o + 11] = stringBase & 0xff;
    out.set(it.bytes, storageStart + stringBase);
    stringBase += it.bytes.length;
  }
  return out;
}
