/**
 * OTF（CFF / CFF2）专项测试 — 批次 B
 *
 * 覆盖三层：
 *   1. **容器层**：读容器、算候选、重建容器表（CFF1 全量重编；CFF2 带 topDictLength 两遍编码）
 *   2. **补丁层**：断言是「**逐字形每一点位移 = ±2**」—— 不是 xMin、不是点数、不是均值。
 *      实测过三个"点数完全正确、位移却是常数"的静默错位（−479 / −1416 / 写到 dy 上），
 *      只有逐点断言能抓到。
 *   3. **端到端**：`embedWatermark` → `traceWatermark` 往返命中同一订单；重复签发被拒。
 *
 * 另有一条 **fontTools 交叉核验**（两种实现互相印证，与 `compare.ts` 同一路数）：
 * 逐字形比对目标/非目标字形的轮廓、表清单、cmap 的 GID 映射；**可变字体还要把每个实例都比一遍**
 * （默认 + 各轴极值/中间值）—— 这是这条测试里最硬的一条：轴实例由**独立实现**算出来。
 *
 * ── 仓库内 OTF 样本怎么来的 ──
 * 两份都由父仓库/本机的真样本用 fontTools 子集化而来，**码点集合与 `xingyun-subset.ttf` 完全一致**
 * （477 个码点），保证候选数口径与既有 TTF 样本可比：
 *
 *     python3 -c "
 *     from fontTools.ttLib import TTFont
 *     from fontTools import subset
 *     cps = sorted(TTFont('engine/tests/fixtures/xingyun-subset.ttf').getBestCmap())
 *     f = TTFont(真样本路径)                      # CFF1: tests/FOT-TsukuAOldMinPr6N-L.otf
 *                                                 # CFF2: ~/Library/Fonts/SourceHanSansSC-VF.otf
 *     o = subset.Options(); o.glyph_names = True; o.notdef_outline = True
 *     o.recalc_bounds = True; o.layout_features = ['*']; o.drop_tables = []
 *     o.desubroutinize = False
 *     s = subset.Subsetter(options=o); s.populate(unicodes=cps); s.subset(f)
 *     f.save('engine/tests/fixtures/<tsuku-subset.otf|sourcehan-cff2-subset.otf>')"
 *
 * CFF2 那份**保留了可变表**（fvar/HVAR/VVAR/avar/STAT/GDEF/GPOS/GSUB）—— 不然"可变 OTF 也能签"
 * 这件事就没有样本可验。
 */

import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { embedWatermark, buildNameId256 } from "../src/embed.js";
import { traceWatermark } from "../src/trace.js";
import { createNodeCryptoProvider } from "../src/crypto.node.js";
import {
  parseSfnt,
  assertSupportedFont,
  detectOutlineKind,
  TtfParseError,
} from "../src/ttf/reader.js";
import { extractCffTable, parseCff } from "../src/cff/table.js";
import { openCff } from "../src/cff/eligible.js";
import { patchCharString, encodeInt } from "../src/cff/token.js";
import { parseNameTable } from "../src/ttf/name.js";
import { assembleSfnt, rebuildHmtx, numGlyphsOf } from "../src/ttf/sfnt.js";
// 测试侧自带一份"参考读取器"（直接用 vendor 的 charstring 解释器取全部控制点），
// 以便做「逐点」断言；产品代码只暴露 xMin，不给测试开口子。
import { CFFFont, CFFGlyph } from "../vendor/fontkit-cff/index.js";
import { DecodeStream } from "../vendor/restructure/index.js";
import { FONT_TSURU_OTF, FONT_SOURCEHAN_CFF2,
  FONT_SOURCEHAN_CN, resolveFont } from "./fontPath.js";

const NODE_CRYPTO = createNodeCryptoProvider();
const MASTER_KEY = new Uint8Array(
  Buffer.from("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", "hex"),
);
const TENANT = "tenant-zhong";

/**
 * 三份 OTF 样本，走**同一套**断言。
 *
 * ⚠️ 第三份（`sourcehan-cn-subset.otf`）是 2026-09-18 补的，**别删**：
 * 它带 **local subrs + global subrs**（679 + 351 条），而前两份都没有 ——
 * 当时的漏洞正是「fontkit 把子程序只解成 `{offset,length}` 描述符、写回时写成等长的零」，
 * 结果凡是用 `callsubr` 的真实字体产物全坏（fontTools 复画一半字形抛异常）。
 * 仓库样本当时**恰好都不带子程序**，所以整套测试全绿也照样漏过去。
 * 这个样本 + 本文件里的 fontTools 逐点交叉核验，就是钉这条回归的。
 */
const SAMPLES = [
  { label: "CFF1", path: resolveFont(FONT_TSURU_OTF), tag: "CFF " as const, order: "ORD-OTF-1" },
  { label: "CFF1+子程序", path: resolveFont(FONT_SOURCEHAN_CN), tag: "CFF " as const, order: "ORD-OTF-SUBR" },
  { label: "CFF2", path: resolveFont(FONT_SOURCEHAN_CFF2), tag: "CFF2" as const, order: "ORD-CFF2-1" },
];

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`  ✔ ${name}${detail ? "  " + detail : ""}`); }
  else { fail++; console.log(`  ✘ ${name}${detail ? "  " + detail : ""}`); }
}

/** 参考读取器：直接用 vendor 的解释器取某字形全部控制点的 x */
function refPointsX(bytes: Uint8Array, gid: number): number[] | null {
  const raw = parseSfnt(bytes);
  const t = extractCffTable(raw.data, raw.tableOffsets, raw.tableLengths)!;
  const font = CFFFont.decode(new DecodeStream(t.bytes)) as unknown as Record<string, unknown>;
  const r = parseCff(t.bytes, t.isCFF2);
  const duck = t.isCFF2
    ? { CFF2: font, _variationProcessor: { getBlendVector: (_v: unknown, i: number) => new Array(Math.max(0, r.regionCount(i))).fill(0) } }
    : { "CFF ": font, _variationProcessor: null };
  try {
    const g = new CFFGlyph(gid, [], duck) as unknown as { path: { commands: Array<{ args: number[] }> } };
    const xs: number[] = [];
    for (const c of g.path.commands) {
      for (let i = 0; i < c.args.length; i += 2) xs.push(c.args[i]);
    }
    return xs;
  } catch {
    return null;
  }
}

/** 取出 60 个高频字池 ∩ 汉字 的 gid（两处断言共用同一批） */
function pickTargets(path: string): { gids: number[]; numGlyphs: number } {
  const bytes = new Uint8Array(readFileSync(path));
  const raw = parseSfnt(bytes);
  const { font, cmap, eligible } = openCff(raw);
  const cjk = eligible.filter((cp) => cp >= 0x4e00 && cp <= 0x9fff).slice(0, 24);
  return { gids: cjk.map((cp) => cmap.get(cp)!).filter((g) => g !== undefined), numGlyphs: font.numGlyphs };
}

// ───────────────────────── 1. 容器层 ─────────────────────────

function testContainer(s: (typeof SAMPLES)[number]): number[] {
  const bytes = new Uint8Array(readFileSync(s.path));
  const kind = assertSupportedFont(bytes);
  check(`${s.label}：样本被识别为 ${s.tag === "CFF2" ? "cff2" : "cff"} 容器`,
    kind === (s.tag === "CFF2" ? "cff2" : "cff"),
    `detect=${detectOutlineKind(parseSfnt(bytes))}`);

  const raw = parseSfnt(bytes);
  const t = extractCffTable(raw.data, raw.tableOffsets, raw.tableLengths)!;
  check(`${s.label}：表标签是 '${s.tag}'`, t.tag === s.tag, t.tag);

  const { font, cmap, eligible } = openCff(raw);
  check(`${s.label}：候选数足以支撑 60 锚定 + 60 配对 + 100 扰动`,
    eligible.length >= 220, `候选 ${eligible.length} / cmap ${cmap.size} / 字形 ${font.numGlyphs}`);
  const cjk = eligible.filter((cp) => cp >= 0x4e00 && cp <= 0x9fff).length;
  check(`${s.label}：候选里汉字占多数（水印只在汉字上执行）`, cjk >= 200, `汉字候选 ${cjk}`);

  // 重建一次（不改任何 charstring）：结构必须原样
  const same: Uint8Array[] = [];
  for (let g = 0; g < font.numGlyphs; g++) same.push(font.getCharString(g));
  const rebuilt = font.rebuild(same);
  const back = parseCff(rebuilt, s.tag === "CFF2");
  check(`${s.label}：原样重建后字形数不变`, back.numGlyphs === font.numGlyphs, `${font.numGlyphs} → ${back.numGlyphs}`);
  let identical = 0, changed = 0;
  for (let g = 0; g < font.numGlyphs; g += 7) {
    const a = font.getCharString(g), b = back.getCharString(g);
    if (a.length === b.length && a.every((v, i) => v === b[i])) identical++; else changed++;
  }
  check(`${s.label}：原样重建后未改字形 charstring 逐字节一致`, changed === 0,
    `抽样 ${identical + changed} 个，一致 ${identical}`);

  return pickTargets(s.path).gids;
}

// ───────────────────────── 2. 补丁层（逐点断言） ─────────────────────────

function testPatchEveryPoint(s: (typeof SAMPLES)[number], gids: number[]): void {
  const orig = new Uint8Array(readFileSync(s.path));
  const raw = parseSfnt(orig);
  const { font } = openCff(raw);
  const target = new Set(gids);

  const before = new Map<number, number[]>();
  for (const g of gids) {
    const p = refPointsX(orig, g);
    if (p) before.set(g, p);
  }

  const charStrings: Uint8Array[] = [];
  let patched = 0;
  for (let g = 0; g < font.numGlyphs; g++) {
    const cs = font.getCharString(g);
    if (target.has(g)) {
      const r = patchCharString(cs, 2, { isCFF2: font.isCFF2, regionCount: (v) => font.regionCount(v) });
      if (r.ok) { charStrings.push(r.bytes!); patched++; continue; }
      console.log(`    ${s.label} gid ${g} 未补丁：${r.why}`);
    }
    charStrings.push(cs);
  }
  check(`${s.label}：目标字形全部补丁成功`, patched === gids.length, `${patched}/${gids.length}`);

  const out = assembleSfnt(raw, {
    [s.tag]: font.rebuild(charStrings),
    hmtx: rebuildHmtx(raw, (g) => (target.has(g) ? 2 : 0), numGlyphsOf(raw)),
  }, patched).bytes;

  let everyPoint = 0, bad = 0;
  const samples: string[] = [];
  for (const g of gids) {
    const a = before.get(g);
    const b = refPointsX(out, g);
    if (!a || !b || a.length !== b.length) {
      bad++;
      if (samples.length < 3) samples.push(`gid ${g}: 点数 ${a?.length}→${b?.length}`);
      continue;
    }
    const dx = a.map((x, i) => b[i] - x);
    if (dx.every((d) => Math.abs(d - 2) < 1e-9)) everyPoint++;
    else {
      bad++;
      if (samples.length < 3) samples.push(`gid ${g}: 位移集合 ${[...new Set(dx.map((d) => Math.round(d)))].slice(0, 4).join(",")}`);
    }
  }
  check(`${s.label}：**逐字形每一点**位移恰好 +2`, bad === 0,
    `通过 ${everyPoint} / 异常 ${bad}` + (samples.length ? `  ${samples.join(" | ")}` : ""));

  // 未改字形逐字节不变
  const outRaw = parseSfnt(out);
  const back = parseCff(extractCffTable(outRaw.data, outRaw.tableOffsets, outRaw.tableLengths)!.bytes, s.tag === "CFF2");
  let same = 0, diff = 0;
  for (let g = 0; g < font.numGlyphs; g++) {
    if (target.has(g)) continue;
    const a = font.getCharString(g), b = back.getCharString(g);
    if (a.length === b.length && a.every((v, i) => v === b[i])) same++; else diff++;
  }
  check(`${s.label}：未改字形 charstring 逐字节保持一致`, diff === 0, `相同 ${same} / 不同 ${diff}`);

  // hmtx.lsb 同步（不变量 D5）
  const r1 = parseSfnt(orig), r2 = parseSfnt(out);
  const rd = (r: typeof r1, g: number) => {
    const off = r.tableOffsets.get("hmtx")!, hhea = r.tableOffsets.get("hhea")!;
    const n = ((r.data[hhea + 34] << 8) | r.data[hhea + 35]) >>> 0;
    const o = g < n ? off + g * 4 + 2 : off + n * 4 + (g - n) * 2;
    return ((r.data[o] << 8) | r.data[o + 1]) >>> 0;
  };
  let lsbOk = true;
  for (const g of gids) if (rd(r2, g) !== rd(r1, g) + 2) lsbOk = false;
  for (let g = 0; g < font.numGlyphs && lsbOk; g++) {
    if (target.has(g)) continue;
    if (rd(r2, g) !== rd(r1, g)) lsbOk = false;
  }
  check(`${s.label}：hmtx.lsb 目标 +2、非目标未动`, lsbOk, lsbOk ? "" : "不变量 D5 被破坏");
}

// ───────────────────────── 3. 端到端（签发 → 追溯） ─────────────────────────

async function testEndToEnd(s: (typeof SAMPLES)[number]): Promise<void> {
  const orig = new Uint8Array(readFileSync(s.path));

  const wm = await embedWatermark({
    fontData: orig, masterKey: MASTER_KEY, provider: NODE_CRYPTO, tenantId: TENANT, orderId: s.order,
  });

  check(`${s.label}：算法版本号是 web-v2（v1 清单已冻结声明 out_of_scope.cff_otf）`,
    wm.selection.manifest === "web-v2", wm.selection.manifest);
  check(`${s.label}：锚定/配对/扰动数量与 TTF 侧一致`,
    wm.selection.anchors.length === 60 && wm.selection.pairs.length === 60 && wm.selection.noises.length === 100,
    `${wm.selection.anchors.length}/${wm.selection.pairs.length}/${wm.selection.noises.length}`);

  const expected256 = buildNameId256("web-v2", s.order, wm.selection.font_sha256, "");
  check(`${s.label}：产物写入 Name 256（判重与第二通道依赖它）`, wm.nameId256 === expected256, wm.nameId256.slice(0, 50));
  // 改完的产物容器类型不能变（OTF 进就 OTF 出）
  check(`${s.label}：产物仍是同一容器`, assertSupportedFont(wm.bytes) === (s.tag === "CFF2" ? "cff2" : "cff"),
    assertSupportedFont(wm.bytes));

  // ⚠️ Name ID 256 不是我们的专属编号：可变字体的轴实例名正好从这个编号开始
  //    （CFF2 样本的 (3,1,1033,256) = 默认实例名）。写回只删我们自己那条，字体自带的一条不少。
  const count256 = (b: Uint8Array) => {
    const r = parseSfnt(b);
    return parseNameTable(r.data, r.tableOffsets.get("name")!, r.tableLengths.get("name")!)
      .filter((n) => n.nameID === 256).length;
  };
  const nBefore = count256(orig);
  check(`${s.label}：签发后字体自带的 nameID 256 记录一条不少（我们的插在最前）`,
    count256(wm.bytes) === nBefore + 1, `${nBefore} → ${count256(wm.bytes)}`);

  let reErr: unknown = null;
  try {
    await embedWatermark({ fontData: wm.bytes, masterKey: MASTER_KEY, provider: NODE_CRYPTO, tenantId: TENANT, orderId: s.order + "-2" });
  } catch (e) { reErr = e; }
  check(`${s.label}：已带水印的产物重复签发被拒并指出原订单`,
    reErr instanceof Error && reErr.message.includes(s.order),
    reErr instanceof Error ? reErr.message.slice(0, 40) : "未抛错（会静默毁掉前一份订单的可追溯性）");

  const tr = await traceWatermark({
    originalBytes: orig, suspiciousBytes: wm.bytes, masterKey: MASTER_KEY,
    provider: NODE_CRYPTO, tenantId: TENANT, candidateOrders: [s.order],
  });
  check(`${s.label}：追溯命中同一订单`, tr.matchedOrder === s.order, `matched=${tr.matchedOrder}`);
  check(`${s.label}：追溯置信度 ≥ 0.9`, tr.confidence >= 0.9, `conf=${tr.confidence.toFixed(3)}`);
  check(`${s.label}：追溯判定为 high/trusted`, tr.verdict.level === "high" || tr.verdict.level === "trusted", tr.verdict.level);

  const trNo = await traceWatermark({
    originalBytes: orig, suspiciousBytes: orig, masterKey: MASTER_KEY,
    provider: NODE_CRYPTO, tenantId: TENANT, candidateOrders: [s.order],
  });
  check(`${s.label}：原始字体自身不被误判为水印版`, trNo.confidence < 0.9, `conf=${trNo.confidence.toFixed(3)}`);
}

// ───────────────────────── 4. 拒绝面 ─────────────────────────

function testRejections(): void {
  const base = new Uint8Array(readFileSync(SAMPLES[0].path));
  const mk = (magic: number) => {
    const b = new Uint8Array(base);
    new DataView(b.buffer, b.byteOffset, b.byteLength).setUint32(0, magic);
    return b;
  };
  const cases: Array<[string, number, string]> = [
    ["字体集合 .ttc", 0x74746366, "字体集合"],
    ["WOFF", 0x774f4646, "WOFF"],
    ["WOFF2", 0x774f4632, "WOFF2"],
  ];
  for (const [label, magic, needle] of cases) {
    let msg = "";
    try { assertSupportedFont(mk(magic)); } catch (e) { msg = e instanceof TtfParseError ? e.message : String(e); }
    check(`拒绝 ${label}（人话 + 给出可做的下一步）`, msg.includes(needle), msg.slice(0, 50));
  }
}

// ───────────────────────── 5. fontTools 交叉核验（含多实例） ─────────────────────────

function testFontToolsCrossCheck(s: (typeof SAMPLES)[number]): void {
  const orig = new Uint8Array(readFileSync(s.path));
  const raw = parseSfnt(orig);
  const { font, cmap, eligible } = openCff(raw);
  const gids = eligible.filter((cp) => cp >= 0x4e00 && cp <= 0x9fff).slice(0, 6).map((cp) => cmap.get(cp)!);

  const target = new Set(gids);
  const charStrings: Uint8Array[] = [];
  for (let g = 0; g < font.numGlyphs; g++) {
    const cs = font.getCharString(g);
    if (target.has(g)) {
      const r = patchCharString(cs, 2, { isCFF2: font.isCFF2, regionCount: (v) => font.regionCount(v) });
      if (r.ok) { charStrings.push(r.bytes!); continue; }
    }
    charStrings.push(cs);
  }
  const out = assembleSfnt(raw, { [s.tag]: font.rebuild(charStrings) }, gids.length).bytes;

  const dir = mkdtempSync(join(tmpdir(), "tf-cff-"));
  const outPath = join(dir, "wm.otf");
  writeFileSync(outPath, Buffer.from(out));

  // 实例列表：可变字体才有（从 CFF2 的 fvar 读轴；独立于我们的实现）
  const py = `
import json, sys
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen
orig, prod, gids_json = sys.argv[1], sys.argv[2], sys.argv[3]
gids = set(json.loads(gids_json))
a, b = TTFont(orig), TTFont(prod)
res = {}
res["tables_same"] = set(a.keys()) == set(b.keys())
ta = getattr(a.get("CFF "), "cff", None); tb = getattr(b.get("CFF "), "cff", None)
if ta is None:
    ta = a["CFF2"].cff; tb = b["CFF2"].cff
res["glyphs_same"] = a["maxp"].numGlyphs == b["maxp"].numGlyphs
res["names_same"] = list(ta.topDictIndex[0].CharStrings.keys()) == list(tb.topDictIndex[0].CharStrings.keys())
ca, cb = a.getBestCmap(), b.getBestCmap()
res["cmap_gid_changes"] = sum(1 for cp in ca if a.getGlyphID(ca[cp]) != b.getGlyphID(cb[cp]))
# 实例列表：默认 + 每条轴的最大/最小/中间
locs = [None]
if "fvar" in a:
    for ax in a["fvar"].axes:
        locs += [{ax.axisTag: ax.maxValue}, {ax.axisTag: ax.minValue}, {ax.axisTag: (ax.minValue + ax.maxValue) / 2}]
na, nb = a.getGlyphOrder(), b.getGlyphOrder()
per_loc = []
for loc in locs:
    ga = a.getGlyphSet(location=loc) if loc else a.getGlyphSet()
    gb = b.getGlyphSet(location=loc) if loc else b.getGlyphSet()
    moved = unchanged = bad = 0
    for gid in range(len(na)):
        p1 = RecordingPen(); ga[na[gid]].draw(p1)
        p2 = RecordingPen(); gb[nb[gid]].draw(p2)
        x1 = [p[0] for op, args in p1.value for p in args if isinstance(p, tuple)]
        x2 = [p[0] for op, args in p2.value for p in args if isinstance(p, tuple)]
        if len(x1) != len(x2):
            bad += 1; continue
        ds = {round(u - v, 4) for u, v in zip(x2, x1)}
        if gid in gids:
            if ds == {2.0}: moved += 1
            else: bad += 1
        else:
            # 空字形点集为空 ⇒ 位移集合也是空集，同样算"未动"（否则会被误报成异常）
            if ds == {0.0} or len(ds) == 0: unchanged += 1
            else: bad += 1
    label = "默认" if loc is None else ",".join("%s=%g" % kv for kv in sorted(loc.items()))
    per_loc.append({"label": label, "moved": moved, "unchanged": unchanged, "bad": bad})
res["per_loc"] = per_loc
res["n_targets"] = len(gids)
print(json.dumps(res))
`;
  let res: any = null;
  let pyErr = "";
  try {
    const outJson = execFileSync("python3", ["-c", py, s.path, outPath, JSON.stringify(gids)], { encoding: "utf8" });
    res = JSON.parse(outJson.trim().split("\n").pop()!);
  } catch (e) {
    pyErr = (e as Error).message.split("\n")[0];
  }
  if (!res) {
    check(`${s.label}：fontTools 交叉核验可运行`, false, `python3 + fontTools 不可用：${pyErr.slice(0, 80)}`);
    return;
  }
  check(`${s.label}：交叉核验表清单一致`, res.tables_same === true);
  check(`${s.label}：交叉核验字形数与字形名序列一致`, res.glyphs_same === true && res.names_same === true);
  check(`${s.label}：交叉核验 cmap 的 GID 映射零变化`, res.cmap_gid_changes === 0, `变化 ${res.cmap_gid_changes} 个`);

  const locs: Array<{ label: string; moved: number; unchanged: number; bad: number }> = res.per_loc;
  let allOk = true;
  const detail: string[] = [];
  for (const L of locs) {
    const ok = L.moved === res.n_targets && L.bad === 0 && L.unchanged > 0;
    if (!ok) allOk = false;
    detail.push(`${L.label}: +2×${L.moved}/${res.n_targets} 未动${L.unchanged} 异常${L.bad}`);
  }
  check(`${s.label}：交叉核验**每个实例**都「目标整体 +2、其余逐点未动」（${locs.length} 个实例）`,
    allOk, detail.join(" | "));
}

// ───────────────────────── 6. 补丁器的"静默错位"守门 ─────────────────────────

function testSilentMisplacementGuards(): void {
  check("encodeInt 跨档位编码正确",
    encodeInt(107)!.length === 1 && encodeInt(109)!.length === 2 && encodeInt(1133)!.length === 3,
    `107→${encodeInt(107)!.length}字节 109→${encodeInt(109)!.length}字节 1133→${encodeInt(1133)!.length}字节`);
  check("encodeInt 超出 int16 时明确拒绝（不静默降精度）", encodeInt(40000) === null);

  // CFF1 的宽度前置：首个 stack-clearing 就是移动操作符时，必须把宽度剥掉再取 dx。
  //   编码 [w=500, dx=30, dy=40, rmoveto] → rmoveto 有 3 个操作数（奇数）⇒ 按规范首位是字宽。
  const cs = new Uint8Array([0xf8, 0x88 /* 500 */, 0xa9 /* 30 */, 0xb3 /* 40 */, 21]);
  const r = patchCharString(cs, 2, { isCFF2: false });
  check("CFF1 首个操作符即 rmoveto 时，位移落在 dx 而不是字宽上",
    r.ok && r.oldVal === 30 && r.bytes!.length === 5 && r.bytes![2] === 0xab /* 32 */,
    r.ok ? `oldVal=${r.oldVal} 产物字节=${[...r.bytes!].join(",")}` : `拒绝：${r.why}`);

  // 掩码字节必须被跳过，且 stem 数跨 ceil 边界（9 个 stem ⇒ ceil(9/8)=2 字节掩码）
  const bytes: number[] = [];
  for (let i = 0; i < 18; i++) bytes.push(140);   // 9 组 stem 的操作数（值 1）
  bytes.push(23);                                  // vstemhm → nStems = 9
  bytes.push(19);                                  // hintmask
  bytes.push(0x40, 0x00);                          // 掩码字节（2 个）
  bytes.push(146, 148);                            // dx=7, dy=9
  bytes.push(21);                                  // rmoveto
  const r2 = patchCharString(new Uint8Array(bytes), 2, { isCFF2: false });
  check("hintmask 的掩码字节被正确跳过（stem 数跨 ceil 边界）",
    r2.ok && r2.oldVal === 7 && r2.bytes!.length === bytes.length,
    r2.ok ? `oldVal=${r2.oldVal} 长度 ${bytes.length}→${r2.bytes!.length}` : `拒绝：${r2.why}`);
}

// ───────────────────────── 7. TTF 路径不受影响 ─────────────────────────

async function testTtfUnaffected(): Promise<void> {
  const orig = new Uint8Array(readFileSync(resolveFont("xingyun-Regular.ttf")));
  const wm = await embedWatermark({
    fontData: orig, masterKey: MASTER_KEY, provider: NODE_CRYPTO, tenantId: TENANT, orderId: "ORD-TTF-1",
  });
  check("TTF 路径算法版本号仍是 web-v1（已签发订单的 order_root 不受影响）",
    wm.selection.manifest === "web-v1", wm.selection.manifest);
  check("TTF 产物 Name 256 的 algo_version 仍是 web-v1",
    (() => { try { return JSON.parse(wm.nameId256).algo_version === "web-v1"; } catch { return false; } })());
}

// ───────────────────────── 主流程 ─────────────────────────
(async () => {
  for (const s of SAMPLES) console.log(`\n样本 [${s.label}]：${s.path}`);

  console.log("\n── 1. 容器层 ──");
  const gidMap = new Map<string, number[]>();
  for (const s of SAMPLES) gidMap.set(s.label, testContainer(s));

  console.log("\n── 2. 补丁层（逐点断言） ──");
  for (const s of SAMPLES) testPatchEveryPoint(s, gidMap.get(s.label)!);

  console.log("\n── 3. 端到端（签发 → 追溯） ──");
  for (const s of SAMPLES) await testEndToEnd(s);

  console.log("\n── 4. 拒绝面 ──");
  testRejections();

  console.log("\n── 5. fontTools 交叉核验（含多实例） ──");
  for (const s of SAMPLES) testFontToolsCrossCheck(s);

  console.log("\n── 6. 补丁器静默错位守门 ──");
  testSilentMisplacementGuards();

  console.log("\n── 7. TTF 路径不受影响 ──");
  await testTtfUnaffected();

  console.log(`\n通过 ${pass} / ${pass + fail}`);
  process.exit(fail > 0 ? 1 : 0);
})();
