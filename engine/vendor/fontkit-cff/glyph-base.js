/**
 * `Glyph` 基类的**最小替身** —— 本仓库对 vendor 的第三处改动。
 *
 * 上游 `glyph/Glyph.js` 只被 `CFFGlyph` 用来拿到 `id / codePoints / _font` 与 `path`。
 * 但那份基类顺带 import 了 `unicode-properties`（仅为了算 `isMark`）与 `../decorators`
 * 的 `@cache` **装饰器**。后者在 esbuild/浏览器打包下需要额外配置，前者会带进一整份
 * Unicode 属性表 —— 而我们只要轮廓包围盒。
 *
 * 所以这里提供同形状的最小基类：`(id, codePoints, font)` + `_getPath()` + `path` getter。
 * **`CFFGlyph._getPath()` 一字未改**，bias / subr / hintmask / blend 的解析全部照搬上游。
 *
 * ⚠️ 只实现了 `CFFGlyph` 实际用到的成员；`getName()` 之类上游 `Glyph` 的方法**没有**，
 *    误用会直接抛错（这是有意的：宁可炸，也不要静默给错值）。
 */
import Path from './Path.js';

export default class GlyphBase {
  constructor(id, codePoints, font) {
    this.id = id;
    this.codePoints = codePoints || [];
    this._font = font;
  }

  _getPath() {
    return new Path();
  }

  get path() {
    if (this._path === undefined) {
      this._path = this._getPath();
    }

    return this._path;
  }
}
