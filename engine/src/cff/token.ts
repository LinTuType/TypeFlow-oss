/**
 * Type2 charstring 的记号级读写 —— 只做一件事：
 * 把「字形第一个建立起点、且带 x 的操作数」+shift。
 *
 * 为什么不是"解码轮廓再重编"：整字重编会丢 hinting（桌面版就是这么做的，
 * 实测 hintmask 覆盖率 64%）。只替换一个操作数的字节 ⇒ hint / subr / 掩码全部原样保留。
 *
 * ⚠️ 六个必须做对的地方（错了都**不报错**，只把坐标改歪）：
 *   1. `hintmask` / `cntrmask` 后面跟 `ceil(nStems/8)` 个**掩码字节**，它们是数据不是记号；
 *   2. **stem 个数 ≠ 操作数个数**（每个 stem 占 2 个操作数）；
 *   3. 操作数的**真值**必须解出来（只记字节区间 ⇒ 补丁会写成"±2 的一字节编码" ⇒ 起点变成 2）；
 *   4. 宽度前置是**一次性**标志（`hintmask` 会多次出现，不能按操作符编号复用）；且
 *      **它必须真的从参数里剥掉**——首个 stack-clearing 就是移动操作符时，不剥就把位移加到了字宽上；
 *   5. `sawCall` 一旦置位就不能被掩码类操作符重置，subr 里也可能有 stem/hint；
 *   6. CFF2 的 `blend` 只折叠它自己的区块（下方还可能有别的操作数），且编号区里的值是 16.16 定点数、不参与补丁。
 *
 * 验收断言只能是「**逐字形每一点位移 = ±2**」：看 xMin、看点数、看均值、看包围盒都会漏
 * （实测有两个坑点数完全正确、位移却是常数 −479 / −1416）。
 */

/** hstem vstem hstemhm vstemhm */
const STEM_OPS = new Set([1, 3, 18, 23]);
/** hintmask cntrmask（其后跟掩码字节） */
const MASK_OPS = new Set([19, 20]);
/** 建立起点/画线的移动类操作符 */
const MOVES = new Set([21, 22, 4, 5, 6, 7, 8, 24, 25, 26, 27, 30, 31]);
/** 其中「第一个坐标是 x」的那些；不含 vmoveto(4)/vlineto(7)/vvcurveto(26) */
const X_BEARING = new Set([21, 22, 5, 6, 8, 24, 25, 30, 31]);
/** 规范参数个数为偶数的 stack-clearing 操作符（宽度前置只可能出现在首个 stack-clearing 上） */
const EVEN_ARITY = new Set([1, 3, 18, 23, 19, 20, 21, 5, 8, 14, 24, 25]);

const OP_VSINDEX = 15;   // CFF2
const OP_BLEND = 16;     // CFF2
const OP_CALLSUBR = 10;
const OP_CALLGSUBR = 29;
const OP_ENDCHAR = 14;

const ceil8 = (n: number) => (n + 7) >> 3;

export interface PatchOpts {
  /** CFF2 容器？CFF2 没有宽度前置，坐标可能由 `blend` 产出 */
  isCFF2?: boolean;
  /**
   * CFF2：给定 vsindex 返回该编号区使用的**区域个数 k**。
   * 不提供时按 0 处理并在 `blend` 处**保守拒绝**（宁可该字形不进候选，也不要猜错位）。
   */
  regionCount?: (vsIndex: number) => number;
}

export interface PatchResult {
  ok: boolean;
  /** 新 charstring 字节（ok=true 时） */
  bytes?: Uint8Array;
  /** 失败原因 → 调用方把该字形排除出候选（D4），不是报错 */
  why?: string;
  /** 被改写的原值（ok=true 时，供断言核对） */
  oldVal?: number;
}

interface Arg {
  /** 操作数真值（16.16 定点数记为 NaN，表示"不参与补丁"） */
  v: number;
  start: number;
  end: number;
}

/**
 * 编码一个 Type2 整数操作数。
 * @returns 字节数组；无法无损编码（超出 int16 范围）时返回 null
 */
export function encodeInt(v: number): Uint8Array | null {
  if (v >= -107 && v <= 107) return new Uint8Array([v + 139]);
  if (v >= 108 && v <= 1131) {
    const d = v - 108;
    return new Uint8Array([(d >> 8) + 247, d & 0xff]);
  }
  if (v <= -108 && v >= -1131) {
    const d = -v - 108;
    return new Uint8Array([251 - (d >> 8), d & 0xff]);
  }
  if (v >= -32768 && v <= 32767) {
    return new Uint8Array([28, (v >> 8) & 0xff, v & 0xff]);
  }
  // 超过 int16：Type2 只剩 16.16 定点（255）可表示，那会丢精度 ⇒ 拒绝
  return null;
}

/**
 * 给一个 charstring 打上 x 位移。
 *
 * @param buf   charstring 字节（CFF1 / CFF2 均可）
 * @param shift ±2
 * @param opts  `isCFF2` / `regionCount`
 */
export function patchCharString(
  buf: Uint8Array,
  shift: number,
  opts: PatchOpts = {},
): PatchResult {
  const isCFF2 = opts.isCFF2 === true;
  let i = 0;
  let args: Arg[] = [];
  let nStems = 0;
  let sawFirstClear = false;
  /** 宽度前置是「一次性」标志，不能按操作符编号复用（`hintmask` 会多次出现） */
  let pendingWidth = false;
  let pendingWidthOp = -1;
  /** 一旦进入 subr，本层的 stem 计数与移动判定就不可靠了；此标志**不被掩码重置** */
  let sawCall = false;
  let vsIndex = 0;

  while (i < buf.length) {
    const b = buf[i];

    // Type2 charstring 里 30 = vhcurveto（实数只存在于 CFF DICT），所以 30 走操作符分支
    if (b <= 31 && b !== 28) {
      let op = b;
      let len = 1;
      if (b === 12) {
        op = 1200 + buf[i + 1];
        len = 2;
      }
      const nArgs = args.length;

      // 首个 stack-clearing 操作符可能带一个前置字宽
      if (!sawFirstClear && (STEM_OPS.has(op) || MASK_OPS.has(op) || MOVES.has(op) || op === OP_ENDCHAR)) {
        sawFirstClear = true;
        pendingWidth = !isCFF2 && (EVEN_ARITY.has(op) ? nArgs % 2 === 1 : nArgs % 2 === 0);
        pendingWidthOp = op;
      }
      const widthAdj = pendingWidth && op === pendingWidthOp ? 1 : 0;
      pendingWidth = false; // ← 只生效一次
      pendingWidthOp = -1;

      if (STEM_OPS.has(op)) {
        nStems += (nArgs - widthAdj) / 2; // 每个 stem 占 2 个操作数
        args = [];
      } else if (MASK_OPS.has(op)) {
        if (sawCall) return { ok: false, why: "subr 参与 hint，stem 数不可靠" };
        nStems += (nArgs - widthAdj) / 2;
        i += len + ceil8(nStems); // 跳过掩码字节
        args = [];
        continue; // ← 不再重置 sawCall
      } else if (isCFF2 && op === OP_VSINDEX) {
        vsIndex = args[0]?.v ?? 0;
        args = [];
        i += len;
        continue;
      } else if (isCFF2 && op === OP_BLEND) {
        const n = args[args.length - 1]?.v ?? 0;
        if (!(n > 0)) return { ok: false, why: "blend 的值个数非法" };
        const kExact = opts.regionCount ? opts.regionCount(vsIndex) : -1;
        if (kExact < 0) return { ok: false, why: "无法确定 blend 的区域个数" };
        const base = args.length - 1 - n * (kExact + 1);
        if (base < 0) return { ok: false, why: "blend 栈结构无法解析" };
        // 交叉互校（仅在可校验时）：区块刚好占满整个操作数区 ⇒ 可反推 k 与 regionCount 对照
        if (base === 0) {
          if ((args.length - 1) % n !== 0) {
            return { ok: false, why: "blend 区块长度与值个数不整除" };
          }
          const kHeur = (args.length - 1) / n - 1;
          if (kHeur !== kExact) {
            return { ok: false, why: `blend 区域数互校不一致（regionCount=${kExact} 区块反推=${kHeur}）` };
          }
        }
        // 保留：区块下方的操作数 + n 个「默认值」；丢弃：n×k 个增量与栈顶的 n
        args = [...args.slice(0, base), ...args.slice(base, base + n)];
        i += len;
        continue;
      } else if (op === OP_CALLSUBR || op === OP_CALLGSUBR) {
        sawCall = true;
        args = [];
        i += len;
        continue;
      } else if (MOVES.has(op)) {
        if (sawCall) return { ok: false, why: "首个移动藏在 subr 里" };
        if (!X_BEARING.has(op)) return { ok: false, why: `首个移动不带 x（op ${op}）` };
        // ⚠️ 宽度前置必须在这里剥掉：首个 stack-clearing 就是移动操作符时，
        //    不剥就等于把位移加到字宽上（坐标全歪，且不报错）。
        const nums = widthAdj === 1 ? args.slice(1) : args;
        if (nums.length === 0) return { ok: false, why: "移动操作符无参数" };
        const t = nums[0];
        if (!Number.isFinite(t.v)) return { ok: false, why: "目标操作数为 16.16 定点数" };
        const bytes = encodeInt(t.v + shift);
        if (bytes === null) return { ok: false, why: "位移后超出 int16 可无损编码范围" };
        const out = new Uint8Array(buf.length - (t.end - t.start) + bytes.length);
        out.set(buf.subarray(0, t.start), 0);
        out.set(bytes, t.start);
        out.set(buf.subarray(t.end), t.start + bytes.length);
        return { ok: true, bytes: out, oldVal: t.v };
      } else {
        args = [];
      }
      i += len;
      continue;
    }

    // ── 操作数：真值必须解出来（只记字节区间 ⇒ 补丁会写成"±2 的一字节编码"，起点变成 2）──
    let v: number;
    let end: number;
    if (b === 28) {
      v = (((buf[i + 1] << 8) | buf[i + 2]) << 16) >> 16;
      end = i + 3;
    } else if (b === 255) {
      v = NaN; // 16.16 定点数：不参与补丁（A.1.3）
      end = i + 5;
    } else if (b <= 246) {
      v = b - 139;
      end = i + 1;
    } else if (b <= 250) {
      v = (b - 247) * 256 + buf[i + 1] + 108;
      end = i + 2;
    } else {
      v = -(b - 251) * 256 - buf[i + 1] - 108;
      end = i + 2;
    }
    args.push({ v, start: i, end });
    i = end;
  }
  return { ok: false, why: "没找到移动操作符" };
}

/**
 * 候选滤取（D4）：**非空（有移动操作符）且首个移动带 x** 才进候选。
 * `shift = 0` 只判可行性（字节不变，所以不会污染原文）。
 *
 * 与 TTF 侧"空字形不进候选"同一机制；不可补丁的字形直接不进候选，而不是抛错。
 * 返回按码点升序（与 TTF 侧 `eligibleCodepoints` 口径一致）。
 */
export function cffEligibleCodepoints(
  cmap: Map<number, number>,
  getCharString: (gid: number) => Uint8Array,
  opts: PatchOpts,
): number[] {
  const out: number[] = [];
  for (const [cp, gid] of cmap) {
    if (patchCharString(getCharString(gid), 0, opts).ok) out.push(cp);
  }
  return out.sort((a, b) => a - b);
}
