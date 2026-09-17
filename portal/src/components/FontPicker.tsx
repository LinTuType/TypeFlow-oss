/**
 * 字体选取面板 —— 签发页与追溯页**共用**（同一个意图只有一份实现）
 *
 * 抽出来的原因：两页原来各写了一份「库列表 + 导入文件」，正是 §2.4 查出的
 * 「同一个意图存在两套实现」的形态。选取语言 = 规线列表 + 底部「导入字体」入口，
 * 字体本体只进本机 IndexedDB，不上传。
 */

import { useRef } from "react";
import type { LocalFont } from "../lib/localFonts";
import { Spinner } from "./ui";
import { IconUpload } from "./Icon";

export default function FontPicker({
  fonts, loading, busy, onPick, onImport,
}: {
  fonts: Array<Omit<LocalFont, "data">>;
  loading: boolean;
  busy: boolean;
  onPick: (id: string) => void;
  onImport: (f: File | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="picker-panel">
      <div className="picker-scroll">
        {loading ? (
          <div className="loading-block"><Spinner />载入…</div>
        ) : (
          fonts.map((f) => (
            <div key={f.id} className="picker-item" role="button" tabIndex={0}
              onClick={() => onPick(f.id)}>
              <span className="picker-item-t">{f.name}</span>
              <span className="picker-item-s mono">{(f.size / 1024 / 1024).toFixed(1)} MB · {f.sha256.slice(0, 10)}…</span>
            </div>
          ))
        )}
      </div>

      <input ref={fileRef} type="file" accept=".ttf,font/ttf" title="仅支持 TTF（暂不支持 OTF/CFF）" className="hidden-file"
        onChange={(e) => {
          onImport(e.target.files?.[0] ?? null);
          if (fileRef.current) fileRef.current.value = "";   // 同名文件二次选择也能触发
        }} />
      <button className="picker-add" disabled={busy} onClick={() => fileRef.current?.click()}>
        {busy ? <Spinner size={13} /> : <IconUpload size={14} />}导入字体
      </button>
    </div>
  );
}
