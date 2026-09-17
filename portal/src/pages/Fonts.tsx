/**
 * 字体库 —— 原型 v9 结构：页头(搜索+添加字体) + 标本卡网格
 *
 * 卡片 = 内容本身的展示载体（font-tech / specimen / font-foot），
 * 操作按钮（追溯 / 签发 / 同步 / 删除）仅在悬停或键盘聚焦时出现（.mini）。
 * 「签发」跳转签发页并预选该字体（原型 prefill 行为）；业务逻辑与迁移前一致：
 * 本机存取（IndexedDB）、哈希同步（只发 64 字符）、真渲染字形。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiFonts, apiOrders, type FontInfo } from "../api/client";
import { listLocalFonts, saveLocalFont, removeLocalFont, sha256Of, type LocalFont } from "../lib/localFonts";
import { maybeFolderBackup } from "../lib/backupFolder";
import { invalidateFontFace } from "../lib/fontFace";
import { toast } from "../lib/toast";
import { assertSupportedTtf } from "@engine/ttf/reader.js";
import { Button, ConfirmButton, PageHeader, Spinner } from "../components/ui";
import { IconScanSearch, IconSpark, IconSync, IconTrash } from "../components/Icon";
import GlyphPreview from "../components/GlyphPreview";

type LocalMeta = Omit<LocalFont, "data">;

interface Row {
  key: string;          // sha256 前 16 位
  name: string;
  sha256: string;
  filename: string;
  size: number;
  glyphCount: number;   // 云端登记过则有值（0 = 未知）
  local: boolean;       // 本机有字体文件
  cloud: boolean;       // 云端已登记哈希
  cloudId?: string;     // 云端 font_id
  orderCount: number;
  /** 最近一单的时间（云端订单 created_at 最大值；0 = 还没签过） */
  lastOrderAt: number;
  savedAt?: number;
}

function mergeRows(local: LocalMeta[], cloud: FontInfo[], orders: Array<{ font_id: string; created_at: number }>): Row[] {
  const map = new Map<string, Row>();
  for (const f of cloud) {
    const sha = f.original_font_sha256 || "";
    const key = sha ? sha.slice(0, 16) : f.font_id.replace(/^font_/, "");
    map.set(key, {
      // 云端只存哈希与不透明 ID：文件名、字形数、字体名都只在本机
      // （display_name 是历史遗留列，2026-09-17 起不再写入）
      key, name: f.display_name || "（云端仅存哈希）", sha256: sha, filename: f.display_name || "",
      size: 0, glyphCount: 0, local: false, cloud: true, cloudId: f.font_id, orderCount: 0,
      lastOrderAt: 0,
    });
  }
  for (const l of local) {
    const key = l.sha256.slice(0, 16);
    const prev = map.get(key);
    map.set(key, {
      key,
      name: l.name || prev?.name || "未命名",
      sha256: l.sha256,
      filename: l.filename,
      size: l.size,
      glyphCount: l.glyphCount || prev?.glyphCount || 0,
      local: true,
      cloud: !!prev,
      cloudId: prev?.cloudId,
      orderCount: 0,
      lastOrderAt: 0,
      savedAt: l.savedAt,
    });
  }
  const rows = [...map.values()];
  for (const r of rows) {
    const mine = orders.filter((o) => o.font_id === r.cloudId || o.font_id === r.key);
    r.orderCount = mine.length;
    r.lastOrderAt = mine.reduce((mx, o) => Math.max(mx, o.created_at ?? 0), 0);
  }
  rows.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
  return rows;
}

const fmtSize = (n: number) => (n ? (n / 1024 / 1024 >= 1 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`) : "—");

export default function Fonts() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [local, cloudRes, ordersRes] = await Promise.all([
        listLocalFonts(),
        api<{ fonts: FontInfo[] }>("GET", "/api/fonts"),
        apiOrders.list(),
      ]);
      setRows(mergeRows(local, cloudRes.fonts ?? [], ordersRes.orders ?? []));
    } catch (e) {
      toast.error("字体库加载失败", { detail: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /** 存入本机（默认动作：不联网、不登记、不产生任何请求） */
  const pickFont = async (f: File | null) => {
    if (!f) return;
    setBusy("pick");
    try {
      const buf = await f.arrayBuffer();
      assertSupportedTtf(new Uint8Array(buf));   // OTF/CFF 拒之门外（人话文案）
      const sha = await sha256Of(buf);
      const id = sha.slice(0, 16);
      // 换版本语义（5.6）：同名不同哈希 = 新版本，作为新字体登记，旧版本与历史订单不受影响
      const sameName = (await listLocalFonts()).find((x) => x.filename === f.name && x.sha256 !== sha);
      await saveLocalFont({
        id,
        name: f.name.replace(/\.(ttf|otf|woff2?)$/i, ""),
        filename: f.name,
        sha256: sha,
        glyphCount: 0,
        size: f.size,
        savedAt: Date.now(),
        data: buf,
      });
      invalidateFontFace(id);
      toast.success(`已存入本机：${f.name}`, {
        detail: sameName
          ? `检测到与「${sameName.name}」同名不同版本——已作为新字体登记，旧版本与它的历史订单不受影响`
          : "未上传、未同步——只保存在你的浏览器里，版本从此锁定",
      });
      await load();
    } catch (e) {
      toast.error("存入本机失败", { detail: (e as Error).message });
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  /** 仅同步哈希（可选：只发 64 个字符的哈希，字体名与文件都留在本机） */
  const syncHash = async (row: Row) => {
    setBusy(row.key);
    try {
      await apiFonts.register({ original_font_sha256: row.sha256 });
      toast.success(`已同步哈希：${row.name}`, {
        detail: "只发送了 64 个字符的 SHA-256——字体文件与字体名都留在本机",
      });
      await load();
    } catch (e) {
      toast.error("同步哈希失败", { detail: (e as Error).message });
    } finally { setBusy(null); }
  };

  const removeLocal = async (row: Row) => {
    setBusy(row.key);
    try {
      await removeLocalFont(row.key);
      invalidateFontFace(row.key);
      toast.info(`已从本机删除：${row.name}`, { detail: "云端哈希记录保留，不影响追溯" });
      await load();
      maybeFolderBackup();
    } catch (e) {
      toast.error("删除失败", { detail: (e as Error).message });
    } finally { setBusy(null); }
  };

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return rows;
    return rows.filter((r) =>
      r.name.toLowerCase().includes(k) || r.filename.toLowerCase().includes(k) || r.sha256.includes(k));
  }, [rows, q]);

  return (
    <>
      <PageHeader
        title="字体库"
        sub="管理字体原版、版本与签发历史，并从字体库直接发起签发或追溯。"
        actions={
          <>
            <input className="search" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="搜索字体" aria-label="搜索字体" />
            <input ref={fileRef} type="file" accept=".ttf,font/ttf" className="hidden-file"
              onChange={(e) => void pickFont(e.target.files?.[0] ?? null)} />
            <Button variant="primary" disabled={busy === "pick"} busy={busy === "pick"}
              onClick={() => fileRef.current?.click()}>
              添加字体
            </Button>
          </>
        }
      />

      {loading ? (
        <div className="loading-block"><Spinner />载入字体库…</div>
      ) : rows.length === 0 ? (
        <div className="empty">
          <div className="empty-title">还没有字体</div>
          <div className="empty-desc">点右上方「添加字体」，选择一个 TTF / OTF 即可开始。</div>
        </div>
      ) : (
        <div className="font-grid" style={{ marginTop: 8 }}>
          {filtered.map((r) => {
            const fmt = (r.filename.match(/\.([a-z]+)$/i)?.[1] ?? "FONT").toUpperCase();
            return (
              <article key={r.key} className="font-card" tabIndex={0}>
                <span className="font-tech">
                  {[
                    fmtSize(r.size),
                    r.glyphCount > 0 ? `${r.glyphCount.toLocaleString("zh-CN")} 字` : "",
                    r.cloud ? "已同步" : "本机 · 版本已锁定",
                  ].filter(Boolean).join(" · ")}
                </span>
                <div className="font-specimen">
                  <GlyphPreview fontId={r.key} local={r.local} height={112} sample="永" sub="永和九年，岁在癸丑 · Ag 0123" />
                </div>
                <div className="font-foot">
                  <div style={{ minWidth: 0 }}>
                    <div className="font-name-row">
                      <span className="font-name">{r.name}</span>
                      <span className="badge badge-neutral">{fmt}</span>
                    </div>
                    <div className="font-file mono">{r.filename}</div>
                    <div className="meta">
                      {r.orderCount
                        ? `${r.orderCount} 次签发 · 最近 ${new Date(r.lastOrderAt).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}`
                        : "还没有签发记录"}{r.savedAt ? ` · 入库 ${new Date(r.savedAt).toLocaleDateString("zh-CN")}` : ""}
                    </div>
                  </div>
                  {/* 悬停操作区：轻量图标（语义与侧栏导航同源：ScanSearch=追溯、FileSignature=签发、
                      RefreshCw=同步哈希、Trash2=删除）；平时隐藏，hover / 键盘聚焦出现 */}
                  <div className="mini">
                    <button title="追溯" aria-label="追溯" onClick={() => navigate("/trace")}>
                      <IconScanSearch size={15} />
                    </button>
                    {r.local && (
                      <button disabled={!!busy} title="签发" aria-label="签发"
                        onClick={() => navigate("/issue", { state: { fontId: r.key } })}>
                        <IconSpark size={15} />
                      </button>
                    )}
                    {r.local && !r.cloud && (
                      <button disabled={!!busy} title="同步哈希" aria-label="同步哈希到云端"
                        onClick={() => void syncHash(r)}>
                        <IconSync size={15} />
                      </button>
                    )}
                    {r.local && (
                      <ConfirmButton label="" confirmLabel="确认删除字体" title="删除字体" danger
                        disabled={!!busy} busy={busy === r.key}
                        icon={<IconTrash size={15} />}
                        onConfirm={() => void removeLocal(r)} />
                    )}
                  </div>
                </div>
              </article>
            );
          })}
          {filtered.length === 0 && (
            <div className="note" style={{ padding: "24px 2px", gridColumn: "1 / -1" }}>没有匹配的字体</div>
          )}
        </div>
      )}
    </>
  );
}
