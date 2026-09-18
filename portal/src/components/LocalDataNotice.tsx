/**
 * 「本机数据不在这个浏览器里」提示条
 *
 * 触发条件见 lib/restore.ts：本机字体库 / 客户库 / 订单关联三段全空，而云端有数据
 * —— 换浏览器或换设备的典型状态。此时字体卡片与订单列表都只剩一串 sha16。
 *
 * 两个动作都只读本机磁盘（绑定过的备份文件夹 / 用户手上的备份 zip），不发请求；
 * 恢复走 applyExportFile，与设置页「导入数据」是同一条路径。
 *
 * 挂在缺失直接显现的三页：概览、字体库、订单。
 */

import { useEffect, useRef, useState } from "react";
import { toast } from "../lib/toast";
import { Button } from "./ui";
import { isFsaSupported, pickFolder } from "../lib/fsFolder";
import {
  detectLocalDataGap, restoreFromFolder, restoreFromFile, finishRestore,
  takeRestoreFlash, restoreSummary, type LocalDataGap,
} from "../lib/restore";

export default function LocalDataNotice() {
  const [gap, setGap] = useState<LocalDataGap | null>(null);
  const [busy, setBusy] = useState<"folder" | "file" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      // 上一轮恢复刚 reload 回来：先把结果播报掉
      const flash = takeRestoreFlash();
      if (flash) {
        toast.success(restoreSummary(flash), {
          detail: flash.source === "folder"
            ? `读自文件夹「${flash.folderName ?? ""}」——字体名、客户与授权方案已就位`
            : "字体名、客户与授权方案已就位",
        });
      }
      const g = await detectLocalDataGap();
      if (alive) setGap(g);
    })();
    return () => { alive = false; };
  }, []);

  if (!gap?.shouldPrompt) return null;

  const doFolder = async () => {
    setBusy("folder");
    try {
      // 换浏览器后句柄已随 IndexedDB 一起没了，必须重新选一次目录（浏览器会停在上次的位置）
      await pickFolder();
      finishRestore(await restoreFromFolder());
    } catch (e) {
      const msg = (e as Error).message;
      if (msg && !msg.includes("abort")) toast.error("恢复失败", { detail: msg });
      setBusy(null);
    }
  };

  const doFile = async (f: File | null) => {
    if (!f) return;
    setBusy("file");
    try {
      finishRestore(await restoreFromFile(f));
    } catch (e) {
      toast.error("恢复失败", { detail: (e as Error).message });
      setBusy(null);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const fsa = isFsaSupported();

  return (
    <div className="notice warn" style={{ marginBottom: 20 }}>
      <div>
        本机数据不在这个浏览器里。云端有 {gap.cloudFonts} 份字体登记、{gap.cloudOrders} 笔订单，
        字体名、客户与授权方案随本机保存 —— 从备份恢复一次就能对上号。
      </div>
      <div className="btn-row" style={{ marginTop: 10 }}>
        {fsa && (
          <Button variant="primary" size="sm" busy={busy === "folder"} disabled={!!busy}
            onClick={() => void doFolder()}>从备份文件夹恢复</Button>
        )}
        <Button variant={fsa ? "secondary" : "primary"} size="sm"
          busy={busy === "file"} disabled={!!busy}
          onClick={() => fileRef.current?.click()}>导入备份文件</Button>
        <input ref={fileRef} type="file" accept=".zip,.json,application/zip,application/json"
          className="hidden-file" onChange={(e) => void doFile(e.target.files?.[0] ?? null)} />
      </div>
    </div>
  );
}
