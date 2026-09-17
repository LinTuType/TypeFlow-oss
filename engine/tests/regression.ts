/**
 * 回归测试：上线前审核里两条 P0 的守门断言
 *
 *   P0-1 字形控制点：重编码必须保留 flags.bit0（on-curve）。丢掉它，每个被水印
 *        的汉字轮廓都会退化成折线 —— 实测 196 个字形 / 28355 个控制点全部归零，
 *        而且全流程不报错。
 *   P0-4 解析上界：cmap 的 count 与表目录的 length/offset 都能被伪造，不加校验
 *        就是「同步阻塞、不抛异常」的卡死（实测 60–90 秒，catch 不到）。
 *
 * 两条都是「动了引擎就必须重新证明」的回归面，故独立成文件并挂在 npm test 上。
 */

import { readFileSync } from "node:fs";

import { embedWatermark } from "../src/embed.js";
import { createNodeCryptoProvider } from "../src/crypto.node.js";
import { parseSfnt, parseCmap, assertSupportedTtf, TtfParseError } from "../src/ttf/reader.js";
import {
  decodeSimpleGlyph,
  encodeGlyph,
  readLocaOffsets,
  type GlyphData,
} from "../src/ttf/glyf.js";
import { FONT_XINGYUN, resolveFont } from "./fontPath.js";

const NODE_CRYPTO = createNodeCryptoProvider();

const FONT = resolveFont(FONT_XINGYUN);
const MASTER_KEY = new Uint8Array(
  Buffer.from("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", "hex"),
);
const TENANT = "tenant-zhong";

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`  ✔ ${name}${detail ? "  " + detail : ""}`); }
  else { fail++; console.log(`  ✘ ${name}${detail ? "  " + detail : ""}`); }
}

// ───────────────────────── P0-1 字形控制点 ─────────────────────────

/** 拼一个含控制点（off-curve）的简单字形：4 点，其中第 2、4 点是控制点 */
function glyphWithOffCurve(): Uint8Array {
  const g: GlyphData = {
    numberOfContours: 1,
    xMin: 0, yMin: 0, xMax: 30, yMax: 30,
    endPts: [3],
    instructions: new Uint8Array(0),
    flags: [],
    onCurve: [true, true, true, true],
    coords: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }, { x: 30, y: 30 }],
  };
  const bytes = encodeGlyph(g);
  // flags 起点 = header(10) + endPts(2) + instrLength(2) = 14
  const flagsOff = 14;
  bytes[flagsOff + 1] &= ~0x01; // 第 2 点 → 控制点
  bytes[flagsOff + 3] &= ~0x01; // 第 4 点 → 控制点
  return bytes;
}

function testOnCurveRoundTrip(): void {
  const src = glyphWithOffCurve();
  const dec = decodeSimpleGlyph(src, 0);
  check("解码出 on-curve 语义（含 2 个控制点）",
    dec !== null && dec.onCurve.filter((v) => !v).length === 2,
    dec ? `onCurve=${JSON.stringify(dec.onCurve)}` : "解码失败");
  if (!dec) return;

  // 走一次「位移 + 重编码」，与 writer 的路径一致
  const shifted: GlyphData = { ...dec, coords: dec.coords.map((c) => ({ x: c.x + 2, y: c.y })) };
  const re = decodeSimpleGlyph(encodeGlyph(shifted), 0);
  check("重编码后控制点仍是控制点（P0-1 回归）",
    re !== null && re.onCurve.join(",") === dec.onCurve.join(","),
    re ? `重编码 onCurve=${JSON.stringify(re.onCurve)}` : "重编码失败");
  check("位移 ±2 正确落到了坐标上",
    re !== null && re.coords.every((c, i) => c.x === dec.coords[i].x + 2 && c.y === dec.coords[i].y),
    re ? `x=${re.coords.map((c) => c.x).join(",")}` : "");
}

/** 真实字体：被位移的字形，控制点数必须守恒 */
async function testRealFontOffCurve(): Promise<void> {
  const orig = new Uint8Array(readFileSync(FONT));
  const wm = await embedWatermark({
    fontData: orig, masterKey: MASTER_KEY, provider: NODE_CRYPTO, tenantId: TENANT, orderId: "ORD-REG-1",
  });

  const shape = (bytes: Uint8Array) => {
    const raw = parseSfnt(bytes);
    const glyfOff = raw.tableOffsets.get("glyf")!;
    const nGlyphs = (((raw.data[raw.tableOffsets.get("maxp")! + 4] << 8) |
      raw.data[raw.tableOffsets.get("maxp")! + 5]) >>> 0);
    const i2l = (((raw.data[raw.tableOffsets.get("head")! + 50] << 8) |
      raw.data[raw.tableOffsets.get("head")! + 51]) >>> 0);
    return { data: bytes.slice(glyfOff), loca: readLocaOffsets(raw.data, raw.tableOffsets.get("loca")!, i2l, nGlyphs), nGlyphs };
  };
  const a = shape(orig), b = shape(wm.bytes);

  let changed = 0, destroyed = 0, offBefore = 0, offAfter = 0;
  for (let gid = 0; gid < a.nGlyphs; gid++) {
    if (a.loca[gid] === a.loca[gid + 1]) continue; // 空字形
    const ga = decodeSimpleGlyph(a.data, a.loca[gid]);
    const gb = decodeSimpleGlyph(b.data, b.loca[gid]);
    if (!ga || !gb || ga.coords.length !== gb.coords.length) continue;
    if (!ga.coords.some((c, i) => c.x !== gb.coords[i].x || c.y !== gb.coords[i].y)) continue;
    changed++;
    const before = ga.onCurve.filter((v) => !v).length;
    const after = gb.onCurve.filter((v) => !v).length;
    offBefore += before; offAfter += after;
    if (before > 0 && after === 0) destroyed++;
  }
  check("真实字体：被位移字形的控制点数守恒（P0-1 回归）",
    changed > 100 && destroyed === 0,
    `改写 ${changed} 个字形，控制点 ${offBefore} → ${offAfter}，被清零 ${destroyed} 个`);
}

// ───────────────────────── P0-4 解析上界 ─────────────────────────

/** 拼最小 sfnt：header + 表目录 + 表数据 */
function craftFont(tables: Array<{ tag: string; bytes: Uint8Array }>): Uint8Array {
  const dirLen = 12 + tables.length * 16;
  let body = 0;
  for (const t of tables) body += (t.bytes.length + 3) & ~3;
  const out = new Uint8Array(dirLen + body);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x00010000);
  dv.setUint16(4, tables.length);
  let cursor = dirLen;
  tables.forEach((t, i) => {
    const rec = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[rec + k] = t.tag.charCodeAt(k);
    dv.setUint32(rec + 8, cursor);
    dv.setUint32(rec + 12, t.bytes.length);
    out.set(t.bytes, cursor);
    cursor += (t.bytes.length + 3) & ~3;
  });
  return out;
}

/** cmap 表：1 条记录 + 一个 format 12 子表头（16 字节），nGroups 可伪造 */
function craftCmap12(nGroups: number): Uint8Array {
  const cmap = new Uint8Array(12 + 16);
  const dv = new DataView(cmap.buffer);
  dv.setUint16(2, 1);         // numTables
  dv.setUint16(4, 3);         // platformID = Windows
  dv.setUint16(6, 10);        // encodingID = UCS-4
  dv.setUint32(8, 12);        // 子表偏移
  dv.setUint16(12, 12);       // format = 12
  dv.setUint32(16, 16);       // 子表声明长度 = 16（仅表头）
  dv.setUint32(24, nGroups);  // nGroups（伪造值）
  return cmap;
}

/** cmap 表：format 4，segCount 段，每段 start=0 / end=0xFFFF（段数组合法但展开量爆炸） */
function craftCmap4Seg(segCount: number): Uint8Array {
  const segCountX2 = segCount * 2;
  const subLen = 14 + segCountX2 + 2 + segCountX2 * 3;
  const cmap = new Uint8Array(12 + subLen);
  const dv = new DataView(cmap.buffer);
  dv.setUint16(2, 1);
  dv.setUint16(4, 3);
  dv.setUint16(6, 1);          // encodingID = BMP
  dv.setUint32(8, 12);
  const s = 12;
  dv.setUint16(s, 4);            // format 4
  dv.setUint16(s + 2, subLen);   // length
  dv.setUint16(s + 6, segCountX2);
  const endCodes = s + 14, startCodes = endCodes + segCountX2 + 2;
  const idDelta = startCodes + segCountX2, idRange = idDelta + segCountX2;
  for (let i = 0; i < segCount; i++) {
    dv.setUint16(endCodes + i * 2, 0xffff);
    dv.setUint16(startCodes + i * 2, 0x0000);
    dv.setUint16(idDelta + i * 2, 1);
    dv.setUint16(idRange + i * 2, 0);
  }
  return cmap;
}

/** 期望「抛 TtfParseError」且耗时低于上限（卡死也是一种失败） */
function expectFastThrow(name: string, bytes: Uint8Array, maxMs: number): void {
  const t0 = Date.now();
  let err: unknown = null;
  try { parseCmap(parseSfnt(bytes)); } catch (e) { err = e; }
  const ms = Date.now() - t0;
  const isParseError = err instanceof TtfParseError;
  check(name, isParseError && ms < maxMs,
    `${isParseError ? "抛出 TtfParseError" : err ? `抛了非 TtfParseError: ${String(err).slice(0, 60)}` : "未抛错"} 耗时 ${ms}ms（上限 ${maxMs}ms）`);
}

function testParseBounds(): void {
  // 1) format 12 声明 0xFFFFFFFF 组 —— 分组数组越界，应当场可 catch
  expectFastThrow("伪造 cmap format 12（nGroups=0xFFFFFFFF）快速失败",
    craftFont([{ tag: "cmap", bytes: craftCmap12(0xffffffff) }]), 500);

  // 2) format 4 段数组合法、但每段覆盖整个 BMP —— 靠展开计数上限兜底
  expectFastThrow("伪造 cmap format 4（每段覆盖整个 BMP）快速失败",
    craftFont([{ tag: "cmap", bytes: craftCmap4Seg(200) }]), 4000);

  // 3) 表目录自身越界
  const badDir = craftFont([{ tag: "cmap", bytes: craftCmap12(0) }]);
  new DataView(badDir.buffer).setUint16(4, 0xffff); // numTables 伪造成 65535
  const t0 = Date.now();
  let err: unknown = null;
  try { parseSfnt(badDir); } catch (e) { err = e; }
  check("伪造表目录（numTables=65535）快速失败",
    err instanceof TtfParseError && Date.now() - t0 < 200,
    `${err instanceof TtfParseError ? "抛出 TtfParseError" : "未按预期抛错"}`);

  // 4) 单张表的 length 伪造成天文数字
  const badLen = craftFont([{ tag: "cmap", bytes: craftCmap12(0) }]);
  new DataView(badLen.buffer).setUint32(12 + 12, 0xffffff00); // 表的 length 字段
  let err2: unknown = null;
  try { parseSfnt(badLen); } catch (e) { err2 = e; }
  check("伪造表长度（0xFFFFFF00）快速失败", err2 instanceof TtfParseError,
    err2 instanceof TtfParseError ? "抛出 TtfParseError" : "未按预期抛错");

  // 5) 反向回归：加了校验之后，真实字体不能反被拒
  const real = new Uint8Array(readFileSync(FONT));
  let realOk = true, mapSize = 0;
  try {
    assertSupportedTtf(real);
    mapSize = parseCmap(parseSfnt(real)).map.size;
  } catch { realOk = false; }
  // 阈值刻意取小：CI 用仓库内子集样本（477 条映射），本机用全量样本（9311 条）。
  // 这条要证的是「上界校验没把真实字体误拒」，不是字体有多大 ——
  // 写死 >5000 会退化成"只有全量样本才过得了"，CI 上必然假失败。
  check("真实字体仍正常解析（校验未误伤）", realOk && mapSize >= 200, `cmap 映射 ${mapSize} 条`);
}

// ───────── P1-9 / P1-11：重复签发保护与 sfnt 目录参数 ─────────

/** 一次嵌入同时验两件事：目录查找参数合规 + 重复签发被挡 */
async function testReSignAndHeader(): Promise<void> {
  const orig = new Uint8Array(readFileSync(FONT));
  const wm = await embedWatermark({
    fontData: orig, masterKey: MASTER_KEY, provider: NODE_CRYPTO, tenantId: TENANT, orderId: "ORD-RE-1",
  });

  // P1-11：numTables / searchRange / entrySelector / rangeShift（此前三处恒写 0）
  const dv = new DataView(wm.bytes.buffer, wm.bytes.byteOffset, wm.bytes.byteLength);
  const n = dv.getUint16(4);
  const pow2 = 2 ** Math.floor(Math.log2(n));
  const got = { searchRange: dv.getUint16(6), entrySelector: dv.getUint16(8), rangeShift: dv.getUint16(10) };
  check("sfnt 目录查找参数按规范填写",
    got.searchRange === pow2 * 16 && got.entrySelector === Math.log2(pow2) && got.rangeShift === n * 16 - pow2 * 16,
    `n=${n} got=${JSON.stringify(got)}`);

  // P1-9：把已签发的字节再签一次，必须被拒绝并指出原订单
  let err: unknown = null;
  try {
    await embedWatermark({
      fontData: wm.bytes, masterKey: MASTER_KEY, provider: NODE_CRYPTO, tenantId: TENANT, orderId: "ORD-RE-2",
    });
  } catch (e) { err = e; }
  check("已带水印的字体重复签发 → 被拒绝并指出原订单号",
    err instanceof Error && err.message.includes("ORD-RE-1"),
    err instanceof Error ? err.message.slice(0, 40) : "未抛错（会静默毁掉前一份订单的可追溯性）");
}

// ───────────── P1-10：可变字体 ─────────────

function testVariableFontRejected(): void {
  const mk = (tag: string, len = 4) => ({ tag, bytes: new Uint8Array(len) });
  const base = [mk("glyf"), mk("loca"), mk("head"), mk("maxp")];
  let staticOk = true, fvarRejected = false, gvarRejected = false;
  try { assertSupportedTtf(craftFont(base)); } catch { staticOk = false; }
  try { assertSupportedTtf(craftFont([...base, mk("fvar", 16)])); }
  catch (e) { fvarRejected = e instanceof TtfParseError && e.message.includes("可变字体"); }
  try { assertSupportedTtf(craftFont([...base, mk("gvar", 20)])); }
  catch (e) { gvarRejected = e instanceof TtfParseError && e.message.includes("可变字体"); }
  check("静态 TTF 仍受支持、fvar/gvar 明确拒绝（此前会静默交付错乱轮廓）",
    staticOk && fvarRejected && gvarRejected,
    `静态=${staticOk} fvar=${fvarRejected} gvar=${gvarRejected}`);
}

// ───────────────────────── 主流程 ─────────────────────────
(async () => {
  console.log("\n── P0-1 字形控制点 ──");
  testOnCurveRoundTrip();
  await testRealFontOffCurve();

  console.log("\n── P0-4 解析上界 ──");
  testParseBounds();

  console.log("\n── P1-9 / P1-10 / P1-11 签发保护与字体结构 ──");
  await testReSignAndHeader();
  testVariableFontRejected();

  console.log(`\n通过 ${pass} / ${pass + fail}`);
  process.exit(fail > 0 ? 1 : 0);
})();
