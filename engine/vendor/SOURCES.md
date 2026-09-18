# vendor 来源登记（SOURCES）

本目录是**冻结的第三方源码副本**，不是依赖管理（根 `package.json` 的 `dependencies` 仍为空）。
引入原因见 `docs/字体格式支持_实现方案与代码_2026-09-18.md` §4 D1：
CFF/CFF2 的 INDEX 偏移编码、指针相对基址、CFF2 的 `length` 前缀是最易错的一层，
用成熟实现（PDFKit 在用）并把版本冻结在本目录，胜过自己重写一遍。

**升级纪律**：只允许手工替换文件并同步更新本文件的哈希；不得引入 npm 依赖或上游漂移。
每次改动都要重跑 `engine/tests/cff-stage1.ts` 与金标哈希断言。

---

## 1. fontkit → `engine/vendor/fontkit-cff/`

| 项 | 值 |
|---|---|
| 包 | `fontkit` |
| 版本 | **2.0.4** |
| 来源 | npm registry（`https://registry.npmjs.org/fontkit/-/fontkit-2.0.4.tgz`） |
| 仓库 | `git://github.com/foliojs/fontkit.git` |
| 作者 | Devon Govett `<devongovett@gmail.com>` |
| 许可证 | **MIT**（依据：`package.json` 的 `"license": "MIT"`；README 末节「License → MIT」） |

### ⚠️ 许可证核实的如实记录

**上游发布的 2.0.4 tarball 里没有 LICENSE / COPYING 文件**（包内顶层仅
`README.md` / `dist` / `package.json` / `src`，已用 `npm pack` 解包逐项确认）。
`raw.githubusercontent.com/foliojs/fontkit/{master,main}/LICENSE` 均返回 404。

因此本目录的 `LICENSE` 是**按上游声明补全的标准 MIT 文本**（版权人取 `package.json` 的 `author`），
不是从上游逐字复制的文件。若日后上游补发 LICENSE 文本，应替换并要求逐字一致。

### 收录的文件（逐文件 sha256 见 `SHA256SUMS`）

上游路径 → 本地路径，全部**逐字未改**，仅重写 import 说明符（见下）：

| 上游（`fontkit/src/`） | 本地 |
|---|---|
| `cff/CFFCharsets.js` | `CFFCharsets.js` |
| `cff/CFFDict.js` | `CFFDict.js` |
| `cff/CFFEncodings.js` | `CFFEncodings.js` |
| `cff/CFFFont.js` | `CFFFont.js` |
| `cff/CFFIndex.js` | `CFFIndex.js` |
| `cff/CFFOperand.js` | `CFFOperand.js` |
| `cff/CFFPointer.js` | `CFFPointer.js` |
| `cff/CFFPrivateDict.js` | `CFFPrivateDict.js` |
| `cff/CFFStandardStrings.js` | `CFFStandardStrings.js` |
| `cff/CFFTop.js` | `CFFTop.js` |
| `tables/variations.js` | `variations.js`（**裁剪**，见下） |

### 改动一：import 说明符重写（机械）

上游是省略扩展名的 ESM（`from 'restructure'`、`from './CFFIndex'`），本项目要求显式扩展名。
逐条替换为：
`'restructure'` → `'../restructure/index.js'`；`'fast-deep-equal'` → `'./fast-deep-equal.js'`；
`'./X'` → `'./X.js'`；`'../tables/variations'` → `'./variations.js'`。

### 改动二：`variations.js` 裁剪

上游该文件顶部 `import {Feature} from './opentype'`，而 `Feature` 只被文件末尾的
`FeatureVariations` 用到（CFF 写回不需要）。保留整份会把 opentype 表族拖进打包树。
裁掉的仅 `FeatureVariations` / `FeatureTableSubstitution` / `ConditionSet` 三组声明；
**`ItemVariationStore` 及其依赖 `VariationRegionList` / `ItemVariationData` / `DeltaSet` 逐字未改**。

---

## ⚠️ 第三方修补（**语义改动，仅此一处**）

> 与上面的机械改动分开列：上面三条只动 import 说明符、模块格式与裁剪，**不改行为**；
> 这一条改的是行为，必须逐字核对。

### `cff/CFFIndex.js` — CFF2 的 INDEX 计数位宽

| 项 | 内容 |
|---|---|
| 位置 | `CFFIndex.size()` 与 `CFFIndex.encode()`，各一行；另新增静态方法 `CFFIndex.versionOf()` |
| 症状 | **`CFFTop.toBuffer({version: 2, ...})` 的产物回读即崩**：`Bad offset size in CFFIndex` |
| 根因 | CFF2 的 INDEX 计数是 **uint32**、CFF1 是 uint16。**decode 侧本来就对**（`getCFFVersion(parent) >= 2` 时读 uint32），encode/size 侧写死 2 字节 |
| 为什么上游没发现 | 上游自己的 `CFFSubset` 写死 `version: 1`；这条 CFF2 写出路径**从未被任何人跑过** |
| 为什么扫一下 ctx 不够 | `CFFIndex.getCFFVersion(ctx)` 走 `ctx.parent` 找 `hdrSize`，但 `Struct.encode` 造出的 ctx 上没有 `hdrSize`，值对象挂在 `ctx.val` 上 ⇒ 新增 `versionOf()` 同时检查 `ctx.hdrSize` 与 `ctx.val.hdrSize` |
| 对 CFF1 的影响 | 无。`versionOf` 对 CFF1 返回 1 ⇒ 仍走 uint16 分支（既有 CFF1 测试与金标断言覆盖） |
| 证据 | `.local/probe-vendor-cff2.mjs`（修补前：回读崩）；`.local/probe-cff2-reencode.mjs`（修补后：字形数/FDArray/FDSelect/vstore 全对、抽检 charstring 逐字节一致）；`engine/tests/cff-stage1.ts`（纳入回归） |

这是本仓库对 vendor 的**唯一**语义修补。若将来升级 fontkit，必须先确认上游是否已自行修复；
若已修复，应**撤销本修补**并逐字采用上游实现。

---

## 收录文件清单

### 改动三：`fast-deep-equal.js` 转成 ESM

| 项 | 值 |
|---|---|
| 包 / 版本 | `fast-deep-equal` **3.1.3** |
| 作者 | Evgeny Poberezkin |
| 许可证 | MIT（上游**附有** LICENSE，逐字复制为 `LICENSE.fast-deep-equal`） |
| 收录文件 | 上游 `index.js`（CommonJS，46 行）→ 本地 `fast-deep-equal.js` |
| 改动 | **仅两处**：首行 `module.exports = function equal(a, b) {` → `function equal(a, b) {`；末尾追加 `export default equal;`。**函数体逐字未改**。 |

**为什么要转**：上游是 CJS，而本项目根 `package.json` 是 `"type": "module"`。先试过原样收成 `.cjs`（Node 与 esbuild 都认，
`npm test` 也全绿），但**门户的 Vite dev server 不做 `.cjs` → ESM 的默认导出互操作**，浏览器里直接白屏
（`does not provide an export named 'default'`）。这是只有把门户真正跑起来才会暴露的坑 ——
`vite build` 与引擎侧的 esbuild 都发现不了。注意 `.cjs` 在 `vite build`（Rollup）下是好的，**只有 dev server 不行**。

### 改动四：`cff/CFFIndex.js` — CFF2 的 INDEX 计数位宽（**语义修补**，见下一节）

---

## 2. restructure → `engine/vendor/restructure/`

| 项 | 值 |
|---|---|
| 包 / 版本 | `restructure` **3.0.2** |
| 作者 | Devon Govett `<devongovett@gmail.com>` |
| 许可证 | MIT（上游**附有** LICENSE，逐字复制到 `restructure/LICENSE`） |
| 依赖 | 无（已核对 `package.json` 无 `dependencies`） |
| 收录 | 上游 ESM 入口 `index.js` + `src/**`（17 个文件），**逐字未改** |

上游 ESM 形态本身就带显式 `.js` 扩展名，故**无需任何重写**。

---

## 3. 打包约束（不要"修"掉）

- vendor 目录是 **ESM + 显式 `.js` 扩展名**，可直接被 esbuild 打包
  （`resolveExtensions: [".ts", ".js", ".mjs"]`，见 `build-browser.mjs`）。
- 根 `package.json` 有 `"type": "module"`，所以 `.js` 会被 Node 当 ESM 读。
- **vendor 代码不发任何网络请求**（无 `fetch` / `XMLHttpRequest` / `WebSocket` / `import()`），
  因此信任页的"源码可扫出网调用"自证仍然成立。
  `npm run smoke` 会检查浏览器 bundle 的零 Node 依赖；出网扫描走信任页那条既有链路。
