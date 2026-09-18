import * as r from '../restructure/index.js';

export default class CFFIndex {
  constructor(type) {
    this.type = type;
  }

  getCFFVersion(ctx) {
    while (ctx && !ctx.hdrSize) {
      ctx = ctx.parent;
    }

    return ctx ? ctx.version : -1;
  }

  /**
   * 编码侧取版本号。
   * 与 decode 的 `getCFFVersion` 同源，但多一条：Struct.encode 造出来的 ctx 上没有 `hdrSize`，
   * 值对象挂在 `ctx.val` 上（`CFFTop` 的版本 1 与 2 都有 `hdrSize` 字段）。
   */
  static versionOf(ctx) {
    let c = ctx;
    while (c) {
      if (c.hdrSize) {
        return c.version;
      }

      if (c.val && c.val.hdrSize) {
        return c.val.version;
      }

      c = c.parent;
    }

    return -1;
  }

  decode(stream, parent) {
    let version = this.getCFFVersion(parent);
    let count = version >= 2
      ? stream.readUInt32BE()
      : stream.readUInt16BE();

    if (count === 0) {
      return [];
    }

    let offSize = stream.readUInt8();
    let offsetType;
    if (offSize === 1) {
      offsetType = r.uint8;
    } else if (offSize === 2) {
      offsetType = r.uint16;
    } else if (offSize === 3) {
      offsetType = r.uint24;
    } else if (offSize === 4) {
      offsetType = r.uint32;
    } else {
      throw new Error(`Bad offset size in CFFIndex: ${offSize} ${stream.pos}`);
    }

    let ret = [];
    let startPos = stream.pos + ((count + 1) * offSize) - 1;

    let start = offsetType.decode(stream);
    for (let i = 0; i < count; i++) {
      let end = offsetType.decode(stream);

      if (this.type != null) {
        let pos = stream.pos;
        stream.pos = startPos + start;

        parent.length = end - start;
        ret.push(this.type.decode(stream, parent));
        stream.pos = pos;
      } else {
        ret.push({
          offset: startPos + start,
          length: end - start
        });
      }

      start = end;
    }

    stream.pos = startPos + start;
    return ret;
  }

  size(arr, parent) {
    // 与 encode 配对：CFF2 的计数是 4 字节（CFF1 是 2 字节）。
    // 漏了这里会让上层 toBuffer 分配的缓冲区少 2 字节/INDEX ⇒ 写入越界。
    let size = CFFIndex.versionOf(parent) >= 2 ? 4 : 2;
    if (arr.length === 0) {
      return size;
    }

    let type = this.type || new r.Buffer;

    // find maximum offset to detminine offset type
    let offset = 1;
    for (let i = 0; i < arr.length; i++) {
      let item = arr[i];
      offset += type.size(item, parent);
    }

    let offsetType;
    if (offset <= 0xff) {
      offsetType = r.uint8;
    } else if (offset <= 0xffff) {
      offsetType = r.uint16;
    } else if (offset <= 0xffffff) {
      offsetType = r.uint24;
    } else if (offset <= 0xffffffff) {
      offsetType = r.uint32;
    } else {
      throw new Error("Bad offset in CFFIndex");
    }

    size += 1 + offsetType.size() * (arr.length + 1);
    size += offset - 1;

    return size;
  }

  encode(stream, arr, parent) {
    // ⚠️ 本仓库唯一的语义修补（见 ../SOURCES.md「第三方修补」）：
    // CFF2 的 INDEX 计数是 **uint32**（CFF1 是 uint16）。decode 侧本来就这么读
    // （`getCFFVersion(parent) >= 2`），编码侧此前漏了 —— 上游的 CFFSubset 写死 version 1，
    // 这条 CFF2 写出路径**从未被任何人跑过**，所以没人发现。
    // 编码侧拿不到 version 的原因见下面的 versionOf()：ctx 链上要连 ctx.val 一起找。
    if (CFFIndex.versionOf(parent) >= 2) {
      stream.writeUInt32BE(arr.length);
    } else {
      stream.writeUInt16BE(arr.length);
    }
    if (arr.length === 0) {
      return;
    }

    let type = this.type || new r.Buffer;

    // find maximum offset to detminine offset type
    let sizes = [];
    let offset = 1;
    for (let item of arr) {
      let s = type.size(item, parent);
      sizes.push(s);
      offset += s;
    }

    let offsetType;
    if (offset <= 0xff) {
      offsetType = r.uint8;
    } else if (offset <= 0xffff) {
      offsetType = r.uint16;
    } else if (offset <= 0xffffff) {
      offsetType = r.uint24;
    } else if (offset <= 0xffffffff) {
      offsetType = r.uint32;
    } else {
      throw new Error("Bad offset in CFFIndex");
    }

    // write offset size
    stream.writeUInt8(offsetType.size());

    // write elements
    offset = 1;
    offsetType.encode(stream, offset);

    for (let size of sizes) {
      offset += size;
      offsetType.encode(stream, offset);
    }

    for (let item of arr) {
      type.encode(stream, item, parent);
    }

    return;
  }
}
