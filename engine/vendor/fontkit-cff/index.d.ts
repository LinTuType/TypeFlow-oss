/**
 * vendor `fontkit-cff` 的最小类型声明。
 *
 * vendor 目录是**冻结的上游 JS**（ESM + 显式 .js 扩展名），本仓库不对其做类型检查。
 * 这里只声明 TS 侧实际用到的成员，让 `tsc --noEmit` 能干净通过；
 * 语义细节以 `../SOURCES.md` 登记的上游文件为准。
 */

/** CFFTop（restructure 的 VersionedStruct 实例） */
export const CFFTop: {
  /** 版本 → 字段定义。版本 2 的 `topDict` 用于算 Top DICT 自身字节长度（CFF2 头部要回填） */
  versions: Record<number, {
    topDict: {
      size(value: unknown, ctx: unknown, includePointers: boolean): number;
    };
  }>;
  toBuffer(value: unknown): Uint8Array;
  decode(stream: unknown, parent?: unknown): Record<string, unknown>;
};

/** CFFFont（CFF/CFF2 容器句柄） */
export const CFFFont: {
  decode(stream: unknown): unknown;
};

export const CFFIndex: unknown;
export const CFFOperand: unknown;

/** CFFGlyph：只用到 charstring → 路径的解析 */
export class CFFGlyph {
  constructor(id: number, codePoints: number[], font: unknown);
}

/** Path：只用到控制点包围盒（cbox） */
export class Path {
  get cbox(): { minX: number; minY: number; maxX: number; maxY: number };
}
