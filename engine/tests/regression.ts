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
import { createHash } from "node:crypto";
import { join } from "node:path";

import { embedWatermark, findExistingWatermark } from "../src/embed.js";
import { traceWatermark } from "../src/trace.js";
import { verifyOtfOutput } from "../src/cff/embed.js";
import { createNodeCryptoProvider } from "../src/crypto.node.js";
import { parseSfnt, parseCmap, assertSupportedFont, TtfParseError } from "../src/ttf/reader.js";
import { rebuildFont } from "../src/ttf/writer.js";
import { parseNameTable, looksLikeWatermark } from "../src/ttf/name.js";
import { assembleSfnt } from "../src/ttf/sfnt.js";
import {
  decodeSimpleGlyph,
  encodeGlyph,
  readLocaOffsets,
  type GlyphData,
} from "../src/ttf/glyf.js";
import { FONT_XINGYUN, FIXTURES_DIR, resolveFont } from "./fontPath.js";

const NODE_CRYPTO = createNodeCryptoProvider();
const be16 = (d: Uint8Array, o: number) => ((d[o] << 8) | d[o + 1]) >>> 0;

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
    assertSupportedFont(real);
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

// ───────────── P1-10：可变字体（fvar/gvar）受理 ─────────────

/**
 * 旧行为：`fvar/gvar` 明确拒绝。
 * 新行为（2026-09-18 实测后放开）：**受理**。理由不是"看起来没事"，而是有机械依据 ——
 * gvar 的增量叠加在**默认轮廓**上，默认轮廓整体平移 ⇒ 每个实例都整体平移，增量不必重算。
 * 实测：NotoSansSyriac（单轴）30/30、SFNS（四轴、7 个实例）280/280 逐点位移恰好 ±2。
 *
 * ⚠️ 成败点是 `hmtx.lsb` 必须同步（`sfnt.ts · rebuildHmtx` 已保证）：
 *    只改坐标不改 lsb 时，渲染/排版路径会按 `lsb − xMin` 把位移**抵消成 0**（实测）。
 */
function testVariableFontAccepted(): void {
  const mk = (tag: string, len = 4) => ({ tag, bytes: new Uint8Array(len) });
  const base = [mk("glyf"), mk("loca"), mk("head"), mk("maxp"), mk("hmtx"), mk("name")];
  let staticOk = false, fvarOk = false, gvarOk = false, bothOk = false, ttcRejected = false;
  try { assertSupportedFont(craftFont(base)); staticOk = true; } catch { /* 不算过 */ }
  try { assertSupportedFont(craftFont([...base, mk("fvar", 16)])); fvarOk = true; } catch { /* 不算过 */ }
  try { assertSupportedFont(craftFont([...base, mk("gvar", 20)])); gvarOk = true; } catch { /* 不算过 */ }
  try { assertSupportedFont(craftFont([...base, mk("fvar", 16), mk("gvar", 20)])); bothOk = true; } catch { /* 不算过 */ }
  // 反向：字体集合仍然明确拒绝（外壳维度不支持）
  const ttc = craftFont(base);
  new DataView(ttc.buffer, ttc.byteOffset, ttc.byteLength).setUint32(0, 0x74746366);
  try { assertSupportedFont(ttc); } catch (e) { ttcRejected = e instanceof TtfParseError && e.message.includes("字体集合"); }

  check("静态 TTF 受支持，fvar/gvar 已受理（默认轮廓平移 ⇒ 每个实例都平移）",
    staticOk && fvarOk && gvarOk && bothOk,
    `静态=${staticOk} fvar=${fvarOk} gvar=${gvarOk} 两者都有=${bothOk}`);
  check("字体集合（.ttc）仍明确拒绝", ttcRejected,
    ttcRejected ? "抛出 TtfParseError（人话文案）" : "未按预期拒绝");
}

// ───────────── Name ID 256 撞号：可变字体的轴实例名（2026-09-18 实测发现） ─────────────

/**
 * OpenType 规定 256–32767 是"字体自定义"区间，而**可变字体的轴实例名正好从这里开始** ——
 * 实测 `SourceHanSansSC-VF.otf` 的 `(3,1,1033,256)` 就是默认实例名 `Regular`（一直到 279）。
 *
 * 旧实现按编号判水印（`nameID === 256 && platformID === 3`）⇒ 后果有两个：
 *   ① **可变字体一台都签不了**：被判成"这份字体已经带水印"，直接拒绝；
 *   ② 写回时把**所有** 256 记录都删掉 ⇒ 顺手抹掉字体自带的实例名（字体菜单里那个实例就没名字了）。
 *
 * 现在改成**按内容判**（`looksLikeWatermark`：web 的 JSON 带 `schema:"typeflow"`，或桌面版的
 * `key=value` 含 `order_id=`），并且只删我们自己的那条、插在**最前面**（别的读取方按"第一条 256"取）。
 *
 * 这里用一个真实形态的样本：把字体里现成的 nameID 1（家族名）记录**就地改名成 256** ——
 * 于是字体有了一条"像实例名、但内容不是我们水印"的 256 记录。
 */
async function testNameId256Collision(): Promise<void> {
  const orig = new Uint8Array(readFileSync(resolveFont(FONT_XINGYUN)));
  const raw = parseSfnt(orig);
  const nameOff = raw.tableOffsets.get("name")!;
  const nameLen = raw.tableLengths.get("name")!;
  const recs = parseNameTable(raw.data, nameOff, nameLen);

  // 找一条 platformID=3 的记录，把它的 nameID 就地改成 256（内容保持原样 = 家族名，不是 JSON 也不是 key=value）
  const idx = recs.findIndex((r) => r.platformID === 3 && r.nameID !== 256);
  const before = recs[idx];
  const patchedName = raw.data.slice(nameOff, nameOff + nameLen);
  const recOff = 6 + idx * 12;                 // 记录在 name 表内的偏移
  patchedName[recOff + 6] = 0x01;              // nameID 高字节
  patchedName[recOff + 7] = 0x00;              // nameID = 256

  const fake = assembleSfnt(raw, { name: patchedName }, 0).bytes;
  const fakeRaw = parseSfnt(fake);
  const fakeRecs = parseNameTable(fakeRaw.data,
    fakeRaw.tableOffsets.get("name")!, fakeRaw.tableLengths.get("name")!);
  const injected = fakeRecs.find((r) => r.nameID === 256);

  check("构造样本：字体自带一条 nameID 256、内容不是水印的记录",
    !!injected && !looksLikeWatermark(injected.value),
    `值=「${(injected?.value ?? "").slice(0, 20)}」（原 nameID ${before.nameID}）`);

  check("① 带实例名式 256 记录的可变字体不被误判为已带水印",
    findExistingWatermark(fake) === null,
    findExistingWatermark(fake) ? "仍被当成水印 ⇒ 这类字体会一台都签不了" : "");

  let signed = true;
  let out: Uint8Array | null = null;
  try {
    const wm = await embedWatermark({
      fontData: fake, masterKey: MASTER_KEY, provider: NODE_CRYPTO, tenantId: TENANT, orderId: "ORD-NAME-1",
    });
    out = wm.bytes;
  } catch { signed = false; }
  check("① 该字体可以正常签发（不再被拒）", signed && out !== null);

  if (out) {
    const oRaw = parseSfnt(out);
    const oRecs = parseNameTable(oRaw.data, oRaw.tableOffsets.get("name")!, oRaw.tableLengths.get("name")!);
    const all256 = oRecs.filter((r) => r.nameID === 256);
    check("② 字体自带的 256 记录被保留（是追加而不是替换）",
      all256.length === 2 && all256.some((r) => r.value === injected!.value),
      `256 记录 ${all256.length} 条：${all256.map((r) => r.value.slice(0, 12)).join(" / ")}`);
    check("③ 我们的记录排在第一条（别的读取方按第一条 256 取）",
      all256.length > 0 && all256[0].value.startsWith("{"),
      (all256[0]?.value ?? "").slice(0, 40));
    check("③ 签发后的判重没被撞号破坏（还能读出订单号）",
      (() => { const w = findExistingWatermark(out!); return w !== null && w.orderId === "ORD-NAME-1"; })(),
      JSON.stringify(findExistingWatermark(out!)));
  }
}

// ───────── 追溯读 xMin 必须"从实际坐标算"（2026-09-18 用 111 份真实字体扫出来的） ─────────

/**
 * 背景：用本机 111 份真实字体跑「签发 → 追溯」，**51 份追溯不到**（用户在生产上遇到了同一件事）。
 * 根因之一：`glyfXMin` 读的是**字形头里缓存的 bbox 字段**，而我们的写回会用逐点重算的值覆盖它
 * （`encodeGlyph`）。于是对那些**缓存 bbox 本来就旧/错**的老中文字体（仿宋_GB2312、方正整套、
 * 思源黑体的静态 OTF… 实测有 `xMin=0 yMin=-36 xMax=256 yMax=-36` 这种 yMin==yMax 的不可能值），
 * 追溯端量到的「位移」= 重算值 − 陈旧值 = −26/−53 这种随机数 ⇒ 位解码全错 ⇒ 判成「无法确认」。
 *
 * 桌面版从一开始就按实际坐标算（`get_glyph_xmin`，注释写着「避免缓存值不准确」）；web 这边漏了。
 * 这条测试把它钉住：把缓存 bbox 改错之后，追溯**仍然必须命中**。
 */
async function testStaleBboxDoesNotBreakTrace(): Promise<void> {
  const orig = new Uint8Array(readFileSync(join(FIXTURES_DIR, "xingyun-subset.ttf")));
  const raw = parseSfnt(orig);
  const glyfOff = raw.tableOffsets.get("glyf")!;
  const locaOff = raw.tableOffsets.get("loca")!;
  const headOff = raw.tableOffsets.get("head")!;
  const maxpOff = raw.tableOffsets.get("maxp")!;
  const n = be16(raw.data, maxpOff + 4);
  const i2l = be16(raw.data, headOff + 50);
  const glyphData = raw.data.slice(glyfOff, glyfOff + raw.tableLengths.get("glyf")!);
  const off = (g: number) =>
    i2l === 0
      ? be16(raw.data, locaOff + g * 2) * 2
      : ((raw.data[locaOff + g * 4] << 24) | (raw.data[locaOff + g * 4 + 1] << 16) |
         (raw.data[locaOff + g * 4 + 2] << 8) | raw.data[locaOff + g * 4 + 3]) >>> 0;

  let patched = 0;
  for (let g = 1; g < n; g += 3) {
    const p0 = off(g), p1 = off(g + 1);
    if (p0 === p1) continue;
    const nc = (((glyphData[p0] << 8) | glyphData[p0 + 1]) << 16) >> 16;
    if (nc <= 0) continue;
    // 只把**缓存 bbox** 的 xMin 改错 1000（点数据一个字不动 ⇒ 模拟「缓存不可信」）
    const xMin = ((glyphData[p0 + 2] << 8) | glyphData[p0 + 3]) & 0xffff;
    const bad = (xMin - 1000) & 0xffff;
    glyphData[p0 + 2] = (bad >> 8) & 0xff;
    glyphData[p0 + 3] = bad & 0xff;
    patched++;
  }
  const spoofed = assembleSfnt(raw, { glyf: glyphData }, 0).bytes;
  check("构造样本：把一批字形的缓存 bbox 改错（点数据不动）", patched >= 20, `${patched} 个字形`);

  const orderId = "ORD-BBOX-1";
  const wm = await embedWatermark({
    fontData: spoofed, masterKey: MASTER_KEY, provider: NODE_CRYPTO, tenantId: TENANT, orderId,
  });
  const tr = await traceWatermark({
    originalBytes: spoofed, suspiciousBytes: wm.bytes, masterKey: MASTER_KEY,
    provider: NODE_CRYPTO, tenantId: TENANT, candidateOrders: [orderId],
  });
  check("缓存 bbox 不可信的字体仍能追溯命中（读点，不读缓存）",
    tr.matchedOrder === orderId, `matched=${tr.matchedOrder} conf=${tr.confidence.toFixed(3)}`);
  check("判定为 high/trusted", tr.verdict.level === "high" || tr.verdict.level === "trusted", tr.verdict.level);
}

// ───────── OTF 产物结构自检：坏产物必须**拒绝签发**，绝不交付 ─────────

/**
 * 2026-09-18 用户报「OTF 签发能用、追溯不到」查出来的第二个 bug：
 * fontkit 的 CFF 写出对**部分真实字体**（带 local subrs 的 CID-keyed CFF，如 SourceHanSansCN-Regular.OTF）
 * 会把产物写坏 —— 独立实现 fontTools 复画时约**一半字形抛 `ValueError: not enough values to unpack`**，
 * 我们读 xMin 也有 90% 返回 null。这种字体**必须拒绝签发**，而不是交付一份坏字体。
 */
async function testOtfOutputGuard(): Promise<void> {
  const fixture = new Uint8Array(readFileSync(join(FIXTURES_DIR, "tsuku-subset.otf")));
  const wm = await embedWatermark({
    fontData: fixture, masterKey: MASTER_KEY, provider: NODE_CRYPTO, tenantId: TENANT, orderId: "ORD-GUARD-1",
  });
  const good = verifyOtfOutput(fixture, wm.bytes);
  check("我们自己的 OTF 产物通过结构自检（不误伤）", good.ok,
    `原件读不出 ${(good.inBadRate * 100).toFixed(0)}% → 产物 ${(good.outBadRate * 100).toFixed(0)}%（抽样 ${good.sampled}）`);

  // 拿一个 TTF 冒充「OTF 产物」：自检自己跑不起来 ⇒ 必须走 fail-closed（拒绝而不是放行）
  let refused = false;
  const ttfBytes = new Uint8Array(readFileSync(join(FIXTURES_DIR, "xingyun-subset.ttf")));
  try { verifyOtfOutput(fixture, ttfBytes); } catch { refused = true; }
  check("自检跑不起来时 fail closed（拒绝，而不是放行）", refused);
}


/**
 * 批次 A 的机器证明 + **交付回执的可重算性**。
 *
 * 金标是怎么来的：先 `git show HEAD:engine/src/ttf/writer.ts`（连 `name.ts` 一起）拉出**重构前**的
 * 实现，与重构后在同一批输入上逐字节比（两组样本 × 2 种位移 × name 有/无 = 8 组，全等），
 * 确认等价后才把当前产物哈希固化下来。见 `.local/compare-writers.ts`、`.local/compare-writers2.ts`。
 *
 * ⚠️ **`named` 那一组不能删**：它锁的是"云端回执能重算出来" ——
 * `watermarked_sha256` 存在云端作完成凭据，订单页「重新生成交付包」会重算并逐字节比对；
 * 一旦写回路径的字节变了，**已签发订单**的重算就会对不上、页面会报"哈希与回执不一致"。
 * （2026-09-18 给 name 表加"字体自带 256 记录"支持时，正是靠这一组才发现：无条件把我们的记录
 *   插到最前会改变所有字体的产物字节 ⇒ 改成"只在真有撞号时才插到最前"。）
 *
 * 为什么用仓库内 fixture 而不是 `resolveFont`：后者在本机给全量样本、在 CI 给子集样本，
 * 哈希会随环境变，金标就失去意义。
 * 这里的位移函数必须与固化时完全一致（改它就等于换金标）。
 */
const GOLD_SHIFTS = (g: number): number => (g % 7 === 0 ? 2 : g % 11 === 0 ? -2 : 0);
const GOLD_NAME = '{"schema":"typeflow","algo_version":"web-v1","order_id":"ORD-X"}';
const GOLD_HASHES: Record<string, { anon: { bytes: number; sha256: string }; named: { bytes: number; sha256: string } }> = {
  "xingyun-subset.ttf": {
    anon: { bytes: 231360, sha256: "fea4ca01394b234a23f9b582fa46fdd467f5b2eba08f3684d03d8ccc8a20747a" },
    named: { bytes: 231500, sha256: "b5f173d364a4c19a3a0de5f8183d79bb431970af8bc7860e4cdab3704378a659" },
  },
  "hybudai-subset.ttf": {
    anon: { bytes: 689912, sha256: "108802391f709d86431e6e5ca0d7a87d20146effc2b78da7529e3f62121a33fe" },
    named: { bytes: 690052, sha256: "73faab0aa142eefb8ab8b0e1696e8672f5e7ba587d6fab1b3c4d3fe02445f1e7" },
  },
};

function testTtfGoldHashes(): void {
  for (const [file, gold] of Object.entries(GOLD_HASHES)) {
    const data = new Uint8Array(readFileSync(join(FIXTURES_DIR, file)));
    const raw = parseSfnt(data);
    for (const [label, spec, name] of [["匿名", gold.anon, null], ["带 name", gold.named, GOLD_NAME]] as const) {
      const out = rebuildFont(raw, GOLD_SHIFTS, name).bytes;
      const actual = createHash("sha256").update(Buffer.from(out)).digest("hex");
      check(`金标哈希：${file}［${label}］（TTF 写出路径逐字节未变）`,
        out.length === spec.bytes && actual === spec.sha256,
        `${out.length} 字节 / ${actual.slice(0, 16)}…` +
        (actual === spec.sha256 ? "" : `  期望 ${spec.bytes} / ${spec.sha256.slice(0, 16)}…`));
    }
  }
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
  testVariableFontAccepted();

  console.log("\n── 批次 A 金标：TTF 写出路径逐字节未变 ──");
  testTtfGoldHashes();

  console.log("\n── Name ID 256 撞号（可变字体轴实例名） ──");
  await testNameId256Collision();

  console.log("\n── 追溯读 xMin：读点而不是读缓存 bbox ──");
  await testStaleBboxDoesNotBreakTrace();

  console.log("\n── OTF 产物结构自检（坏产物拒绝签发） ──");
  await testOtfOutputGuard();

  console.log(`\n通过 ${pass} / ${pass + fail}`);
  process.exit(fail > 0 ? 1 : 0);
})();
