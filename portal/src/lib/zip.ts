/**
 * 最小 ZIP 读写（store 方式，零依赖）
 *
 * 为什么自己写：门户只依赖 react / react-router / lucide，引一个 zip 库要多背
 * 几十 KB。交付包与数据备份里的文件（字体二进制 + JSON）用 store（不压缩）
 * 没有损失，而实现只有一百多行、格式完全可控。
 *
 * 兼容性：文件名统一声明为 UTF-8（通用标志位 bit 11），Windows 10 1803+ /
 * macOS / 7-Zip / Bandizip 都能正确显示中文名。
 * 读取侧（5.6 新增）：与写入侧对称——EOCD → 中央目录 → 按局部头重定位数据。
 * 只支持 store；遇到 deflate 会明确报错（我们自己写出的文件不会出现）。
 */

/** CRC-32 查表（IEEE 802.3，ZIP 规范要求） */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** 包内路径。用 "/" 分隔可建目录；中文名走 UTF-8 标志位 */
  name: string;
  data: Uint8Array;
}

/** DOS 时间格式（高 16 位日期 / 低 16 位时间）。固定用一个稳定时间戳，便于测试比对 */
function dosDateTime(d: Date): { time: number; date: number } {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time: time & 0xffff, date: date & 0xffff };
}

/** 打包为 ZIP 字节（store 方式） */
export function buildZip(entries: ZipEntry[], now = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(now);

  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const crc = crc32(e.data);
    const size = e.data.length;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);   // 局部文件头签名
    lv.setUint16(4, 20, true);           // 解压所需版本 2.0
    lv.setUint16(6, 0x0800, true);       // 通用标志：bit 11 = 文件名为 UTF-8
    lv.setUint16(8, 0, true);            // 压缩方式 0 = store
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);        // 压缩后大小（store 下等于原始大小）
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);           // 扩展字段长度
    local.set(nameBytes, 30);

    locals.push(local, e.data);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);   // 中央目录签名
    cv.setUint16(4, 20, true);           // 创建者版本
    cv.setUint16(6, 20, true);           // 解压所需版本
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);           // 扩展字段
    cv.setUint16(32, 0, true);           // 注释
    cv.setUint16(34, 0, true);           // 起始磁盘号
    cv.setUint16(36, 0, true);           // 内部属性
    cv.setUint32(38, 0, true);           // 外部属性
    cv.setUint32(42, offset, true);      // 局部头偏移
    central.set(nameBytes, 46);

    centrals.push(central);
    offset += local.length + size;
  }

  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);     // 中央目录结束记录
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const total = offset + cdSize + eocd.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

/* ─────────────────────── 读取（5.6：数据备份导入用） ─────────────────────── */

/**
 * 解析 ZIP（仅 store 方式——本模块写出的交付包与备份都满足）。
 * 流程：尾部找 EOCD（容忍注释）→ 中央目录逐条 → 按局部头重定位数据起点
 * （局部头的文件名/扩展字段长度可能与中央目录不同，不能直接用中央目录的偏移）。
 */
export function readZip(buf: Uint8Array): Map<string, Uint8Array> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const scanFrom = Math.max(0, buf.length - 22 - 65535);
  let eocd = -1;
  for (let i = buf.length - 22; i >= scanFrom; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("不是合法 ZIP：找不到中央目录结束记录");

  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = new Map<string, Uint8Array>();

  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("ZIP 中央目录条目签名错误");
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    if (method !== 0) throw new Error(`ZIP 条目「${name}」使用了压缩——本读取器仅支持 store 方式`);

    const lNameLen = dv.getUint16(localOffset + 26, true);
    const lExtraLen = dv.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    out.set(name, buf.slice(dataStart, dataStart + compSize));

    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
