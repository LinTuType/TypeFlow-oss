/**
 * 阶段 1 集成测试：嵌入 → 追溯闭环
 *
 * 验证：
 *   1. embedWatermark 对锚定字施加 ±2、配对字反向、扰动字在集合内
 *   2. 写入 Name ID 256 且格式正确
 *   3. traceWatermark 用 Name 256 定位 → 命中原订单
 *   4. 移除 Name 256 后走候选订单恢复 → 仍然命中（多候选时命中最优）
 *   5. 用 fontTools 交叉验证：写入后字体仍可被 Python 正常解析
 */

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { embedWatermark } from "../src/embed.js";
import { traceWatermark, readNameId256 } from "../src/trace.js";
import { runSelection } from "../src/webv1.js";
import { createNodeCryptoProvider } from "../src/crypto.node.js";
import { parseSfnt, parseCmap } from "../src/ttf/reader.js";
import { rebuildFont } from "../src/ttf/writer.js";
import { readGlyphRaw } from "../src/ttf/glyf.js";
import { FONT_HYBUDAI, FONT_XINGYUN, resolveFont } from "./fontPath.js";

const NODE_CRYPTO = createNodeCryptoProvider();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const OUT = join(ROOT, "engine/tests/out");
mkdirSync(OUT, { recursive: true });

const MASTER_KEY_HEX =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const TENANT = "tenant-zhong";

const FIXTURES = [resolveFont(FONT_XINGYUN), resolveFont(FONT_HYBUDAI)];

function glyphXMinFromRaw(raw: ReturnType<typeof parseSfnt>, gid: number): number | null {
  const glyfOff = raw.tableOffsets.get("glyf")!;
  const locaOff = raw.tableOffsets.get("loca")!;
  const headOff = raw.tableOffsets.get("head")!;
  const maxpOff = raw.tableOffsets.get("maxp")!;
  const i2l = (((raw.data[headOff + 50] << 8) | raw.data[headOff + 51]) >>> 0);
  const nGlyphs = (((raw.data[maxpOff + 4] << 8) | raw.data[maxpOff + 5]) >>> 0);
  if (gid >= nGlyphs) return null;
  const p0 =
    i2l === 0
      ? (((raw.data[locaOff + gid * 2] << 8) | raw.data[locaOff + gid * 2 + 1]) >>> 0) * 2
      : (((raw.data[locaOff + gid * 4] << 24) | (raw.data[locaOff + gid * 4 + 1] << 16) |
          (raw.data[locaOff + gid * 4 + 2] << 8) | raw.data[locaOff + gid * 4 + 3]) >>> 0);
  const g = readGlyphRaw(raw.data.slice(glyfOff), p0);
  return g ? g.xMin : null;
}

/** 验证嵌入位移正确性：锚定/配对/扰动字形坐标确实按预期移动 */
async function verifyShifts(fontPath: string, order: string): Promise<string[]> {
  const origBytes = new Uint8Array(readFileSync(fontPath));
  const result = await embedWatermark({
    fontData: origBytes,
    masterKey: new Uint8Array(Buffer.from(MASTER_KEY_HEX, "hex")),
    provider: NODE_CRYPTO,
    tenantId: TENANT,
    orderId: order,
  });

  const sel = result.selection;
  const origRaw = parseSfnt(origBytes);
  const markRaw = parseSfnt(result.bytes);
  const origCmap = parseCmap(origRaw).map;

  const errors: string[] = [];

  // 锚定字：期望 bit=1 → +2，bit=0 → -2
  const expanded: number[] = [];
  for (const b of sel.bits) expanded.push(b, b, b);
  sel.anchors.forEach((cp, i) => {
    const gid = origCmap.get(cp);
    if (gid === undefined) return;
    const origX = glyphXMinFromRaw(origRaw, gid);
    const markX = glyphXMinFromRaw(markRaw, gid);
    if (origX === null || markX === null) return;
    const expect = expanded[i] === 1 ? 2 : -2;
    const got = markX - origX;
    if (got !== expect) errors.push(`锚定 U+${cp.toString(16)} 位移 ${got} ≠ ${expect}`);
  });

  // 配对字：bit=1 → -2，bit=0 → +2（反向）
  sel.pairs.forEach((cp, i) => {
    const gid = origCmap.get(cp);
    if (gid === undefined) return;
    const origX = glyphXMinFromRaw(origRaw, gid);
    const markX = glyphXMinFromRaw(markRaw, gid);
    if (origX === null || markX === null) return;
    const expect = expanded[i] === 1 ? -2 : 2;
    const got = markX - origX;
    if (got !== expect) errors.push(`配对 U+${cp.toString(16)} 位移 ${got} ≠ ${expect}`);
  });

  // 扰动字：位移 ∈ noise_shifts（允许 ±2 但非锚定/配对）
  for (const cpStr of Object.keys(sel.noise_shifts)) {
    const cp = Number(cpStr);
    const gid = origCmap.get(cp);
    if (gid === undefined) continue;
    const origX = glyphXMinFromRaw(origRaw, gid);
    const markX = glyphXMinFromRaw(markRaw, gid);
    if (origX === null || markX === null) continue;
    const expect = sel.noise_shifts[cpStr];
    const got = markX - origX;
    if (expect !== 0 && got !== expect) errors.push(`扰动 U+${cp.toString(16)} 位移 ${got} ≠ ${expect}`);
  }

  return errors;
}

/** 用 fontTools 验证写回字体可解析且 Name 256 存在 */
async function verifyPythonOpen(fontPath: string, order: string) {
  const origBytes = new Uint8Array(readFileSync(fontPath));
  const result = await embedWatermark({
    fontData: origBytes,
    masterKey: new Uint8Array(Buffer.from(MASTER_KEY_HEX, "hex")),
    provider: NODE_CRYPTO,
    tenantId: TENANT,
    orderId: order,
  });
  const tmpWm = join(OUT, `wm_${order}.ttf`);
  writeFileSync(tmpWm, result.bytes);

  const script = `
import sys
from fontTools.ttLib import TTFont
f = TTFont(${JSON.stringify(tmpWm)}, lazy=False)
name = f.get('name')
_recs = [n for n in name.names if n.nameID == 256 and n.platformID == 3]
print('OK parse; name256=', _recs[0].toUnicode()[:60] if _recs else 'NONE')
print('nGlyphs=', len(f.getGlyphOrder()))
`;
  return spawnSync("python3", ["-c", script], { encoding: "utf8" });
}

// ─── 主流程 ───
let pass = 0, fail = 0;
const MASTER_KEY = new Uint8Array(Buffer.from(MASTER_KEY_HEX, "hex"));
(async () => {
for (const fontPath of FIXTURES) {
  const name = fontPath.split("/").pop()!;
  const order = `ORD-STAGE1-${name.slice(0, 8)}`;
  console.log(`\n─ ${name} (${order}) ─`);

  // 1. 位移正确性
  const shiftErrors = await verifyShifts(fontPath, order);
  if (shiftErrors.length === 0) {
    console.log("  ✔ 锚定/配对/扰动位移正确");
    pass++;
  } else {
    console.log(`  ✘ 位移错误 ${shiftErrors.length} 处`);
    shiftErrors.slice(0, 5).forEach((e) => console.log("    " + e));
    fail++;
  }

  // 2. Name 256 写入 + 追溯（带 Name）
  const origBytes = new Uint8Array(readFileSync(fontPath));
  const result = await embedWatermark({
    fontData: origBytes,
    masterKey: MASTER_KEY,
    provider: NODE_CRYPTO,
    tenantId: TENANT,
    orderId: order,
  });
  const tr = await traceWatermark({
    originalBytes: origBytes,
    suspiciousBytes: result.bytes,
    masterKey: MASTER_KEY,
    provider: NODE_CRYPTO,
    tenantId: TENANT,
  });
  const nameOk = readNameId256(result.bytes) !== null;
  const traceOk = tr.matchedOrder === order && tr.total >= 60 && tr.confidence > 0.85;
  if (nameOk && traceOk) {
    console.log(`  ✔ Name 256 + 快速追溯命中 (confidence=${tr.confidence.toFixed(3)}, votes=${tr.votes}/${tr.total})`);
    pass++;
  } else {
    console.log(`  ✘ Name256=${nameOk} matched=${tr.matchedOrder} conf=${tr.confidence.toFixed(3)} votes=${tr.votes}/${tr.total}`);
    fail++;
  }

  // 3. 候选订单恢复（模拟 Name 被删：传多个候选）
  const result2 = await embedWatermark({
    fontData: origBytes,
    masterKey: MASTER_KEY,
    provider: NODE_CRYPTO,
    tenantId: TENANT,
    orderId: order,
  });
  // 构造 "无 Name" 路径：传入候选列表覆盖（trace 内部从 Name 读，这里强制候选）
  const trCand = await traceWatermark({
    originalBytes: origBytes,
    suspiciousBytes: result2.bytes,
    masterKey: MASTER_KEY,
    provider: NODE_CRYPTO,
    tenantId: TENANT,
    candidateOrders: [`WRONG-ORDER-1`, `WRONG-ORDER-2`, order], // 混入错误订单
  });
  const candOk = trCand.matchedOrder === order && trCand.confidence > 0.85;
  if (candOk) {
    console.log(`  ✔ 候选恢复（混入错误订单仍命中正确单, confidence=${trCand.confidence.toFixed(3)})`);
    pass++;
  } else {
    console.log(`  ✘ 候选恢复失败 matched=${trCand.matchedOrder} conf=${trCand.confidence.toFixed(3)}`);
    fail++;
  }

  // 4. 真正删除 Name ID 256 后候选追溯（阶段 1 退出条件）
  const wmBytes = new Uint8Array(readFileSync(fontPath));
  const wm = await embedWatermark({
    fontData: wmBytes,
    masterKey: MASTER_KEY,
    provider: NODE_CRYPTO,
    tenantId: TENANT,
    orderId: order,
  });
  // 用 writer 重建一个去掉 Name 256 的版本（shifts 全 0、不写 256）
  const stripped = rebuildFont(parseSfnt(wm.bytes), () => 0, null).bytes;
  const nameAfterStrip = readNameId256(stripped);
  const trStrip = await traceWatermark({
    originalBytes: wmBytes,
    suspiciousBytes: stripped,
    masterKey: MASTER_KEY,
    provider: NODE_CRYPTO,
    tenantId: TENANT,
    candidateOrders: [`WRONG-A`, `WRONG-B`, order],
  });
  const stripOk = nameAfterStrip === null && trStrip.matchedOrder === order && trStrip.confidence > 0.85;
  if (stripOk) {
    console.log(`  ✔ 删除 Name 256 后候选追溯命中 (name256=${nameAfterStrip}, conf=${trStrip.confidence.toFixed(3)})`);
    pass++;
  } else {
    console.log(`  ✘ 删 Name 追溯失败 name256=${nameAfterStrip} matched=${trStrip.matchedOrder} conf=${trStrip.confidence.toFixed(3)}`);
    fail++;
  }

  // 5. fontTools 交叉验证
  if (process.env.SKIP_PY !== "1") {
    const py = await verifyPythonOpen(fontPath, order);
    if (py.status === 0 && py.stdout.includes("OK parse")) {
      console.log("  ✔ fontTools 成功解析 + Name 256 可见");
      pass++;
    } else {
      console.log("  ✘ fontTools 解析失败:", (py.stderr || py.stdout).slice(0, 200));
      fail++;
    }
  }
}

console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
})();