/**
 * vendor `restructure` 的最小类型声明（上游是带显式 .js 扩展名的 ESM，无自带 .d.ts）。
 * 只声明 TS 侧用到的 `DecodeStream`。
 */
export class DecodeStream {
  constructor(buffer: unknown, ...rest: unknown[]);
  pos: number;
  readonly length: number;
  readUInt8(): number;
  readUInt16BE(): number;
  readUInt32BE(): number;
  readInt8(): number;
  readInt16BE(): number;
  readInt32BE(): number;
  readBuffer(length: number): Uint8Array;
  readString(length: number, encoding?: string): string;
}

export class EncodeStream {
  constructor(buffer: unknown);
  pos: number;
  writeUInt8(v: number): void;
  writeUInt16BE(v: number): void;
  writeUInt32BE(v: number): void;
  writeInt16BE(v: number): void;
  writeInt32BE(v: number): void;
}

export const PropertyDescriptor: unknown;
export function resolveLength(length: unknown, stream: unknown, parent: unknown): number;
export const uint8: unknown;
export const uint16: unknown;
export const uint24: unknown;
export const uint32: unknown;
export const int8: unknown;
export const int16: unknown;
export const fixed32: unknown;
export const Struct: unknown;
export const VersionedStruct: unknown;
export const Array: unknown;
export const LazyArray: unknown;
export const Pointer: unknown;
export const String: unknown;
export const Buffer: unknown;
export const Enum: unknown;
export const Bitfield: unknown;
export const Boolean: unknown;
export const Optional: unknown;
export const Reserved: unknown;
export const Fixed: unknown;
