/**
 * 客户页 —— 原型 v9 结构：页头(搜索+新建客户) + 线性表格 + 模态框编辑
 *
 * 客户资料默认只存本机（IndexedDB，与字体文件同待遇）：
 *   - 服务器零敏感数据：云端只存订单的 client_ref（客户名文本），无客户库
 *   - 防丢失 = 可选的 E2E 加密备份（恢复码加密 → 云端 vault 只见密文）
 * 表格列按本项目的真实数据模型：客户 / 联系方式 / 订单 / 最近授权 / 操作。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiOrders, apiVault, type VaultState } from "../api/client";
import { listCustomers, saveCustomer, removeCustomer, replaceCustomers, genCustomerId, type Customer } from "../lib/localCustomers";
import { generateRecoveryCode, encryptVault, decryptVault, isValidRecoveryCode } from "../lib/vault";
import { toast } from "../lib/toast";
import {
  PageHeader, Spinner, ConfirmButton,
} from "../components/ui";
import { IconTrash, IconDownload, IconUpload, IconShield, IconCheckCircle, IconCopy, IconChevron } from "../components/Icon";

const VAULT_KEY = "customers";
const BACKUP_SCHEMA = "typeflow/customers/v1";

/** 客户列表 UI 行（额外带订单数，来自云端订单的 client_ref 匹配） */
interface RowExt extends Customer {
  labelOrder: number;   // 该客户名匹配的云端订单数
}

export default function Clients() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<Array<{ client_ref?: string; status: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");

  // 表单（新增 / 编辑 共用，走模态框）
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState({ name: "", email: "", note: "" });
  const [formErr, setFormErr] = useState("");

  // 加密备份
  const [vault, setVault] = useState<VaultState | null>(null);
  const [recovery, setRecovery] = useState("");
  const [showNewCode, setShowNewCode] = useState<string | null>(null);
  const restFileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [cs, os] = await Promise.all([listCustomers(), apiOrders.list()]);
      setCustomers(cs);
      setOrders(os.orders ?? []);
      const v = await apiVault.get(VAULT_KEY);
      setVault(v);
    } catch (e) {
      toast.error("客户数据加载失败", { detail: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /* ---------- 客户 CRUD ---------- */

  const startAdd = () => {
    setEditingId("new");
    setForm({ name: "", email: "", note: "" });
    setFormErr("");
  };

  const startEdit = (c: Customer) => {
    setEditingId(c.id);
    setForm({ name: c.name, email: c.email ?? "", note: c.note ?? "" });
    setFormErr("");
  };

  const cancelEdit = () => { setEditingId(null); setFormErr(""); };

  const submitForm = async () => {
    const name = form.name.trim();
    if (!name) { setFormErr("客户名必填"); return; }
    setBusy("form");
    try {
      const now = Date.now();
      if (editingId === "new") {
        const c: Customer = { id: genCustomerId(), name, email: form.email.trim() || undefined, note: form.note.trim() || undefined, createdAt: now, updatedAt: now };
        await saveCustomer(c);
        toast.success(`已添加客户：${name}`);
      } else if (editingId) {
        await saveCustomer({ id: editingId, name, email: form.email.trim() || undefined, note: form.note.trim() || undefined, createdAt: customers.find((x) => x.id === editingId)?.createdAt ?? now, updatedAt: now });
        toast.success(`已更新：${name}`);
      }
      setEditingId(null);
      await load();
    } catch (e) {
      toast.error("保存失败", { detail: (e as Error).message });
    } finally { setBusy(null); }
  };

  const delCustomer = async (c: Customer) => {
    setBusy(`del:${c.id}`);
    try {
      await removeCustomer(c.id);
      toast.info(`已删除：${c.name}`);
      await load();
    } catch (e) {
      toast.error("删除失败", { detail: (e as Error).message });
    } finally { setBusy(null); }
  };

  /* ---------- 加密备份 ---------- */

  /** 生成恢复码（只显示这一次；之后只能靠用户保存的副本） */
  const genCode = () => {
    setShowNewCode(generateRecoveryCode());
    toast.info("恢复码已生成，请立即抄写或复制保存", { detail: "只显示这一次，刷新后不再出现" });
  };

  /** 用当前恢复码加密客户列表 → 上传云端 vault */
  const backupNow = async () => {
    const code = recovery.trim();
    if (!isValidRecoveryCode(code)) { toast.warn("请输入完整恢复码（32 位）"); return; }
    if (customers.length === 0) { toast.warn("客户库是空的，没有可备份的内容"); return; }
    setBusy("backup");
    try {
      const cipher = await encryptVault(code, { schema: BACKUP_SCHEMA, items: customers });
      await apiVault.put(VAULT_KEY, cipher);
      toast.success("已加密备份到云端", { detail: "服务器只保存密文，解密口令在你手里" });
      await load();
    } catch (e) {
      toast.error("备份失败", { detail: (e as Error).message });
    } finally { setBusy(null); }
  };

  /** 导出加密备份为本地文件（.tfw，可离线保存） */
  const exportFile = async () => {
    const code = recovery.trim();
    if (!isValidRecoveryCode(code)) { toast.warn("请输入恢复码以加密导出"); return; }
    if (customers.length === 0) { toast.warn("客户库是空的，没有可导出的内容"); return; }
    setBusy("export");
    try {
      const cipher = await encryptVault(code, { schema: BACKUP_SCHEMA, items: customers });
      const blob = new Blob([cipher], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `typeflow-customers-backup-${new Date().toISOString().slice(0, 10)}.tfw`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success("已导出加密备份文件", { detail: "文件是密文，输入恢复码才能恢复" });
    } catch (e) {
      toast.error("导出失败", { detail: (e as Error).message });
    } finally { setBusy(null); }
  };

  /** 从本地文件恢复（解密 → 替换整个客户库） */
  const importFile = async (f: File | null) => {
    if (!f) return;
    const code = recovery.trim();
    if (!isValidRecoveryCode(code)) { toast.warn("先输入恢复码，再导入备份文件"); return; }
    setBusy("import");
    try {
      const cipher = await f.text();
      const data = await decryptVault(code, cipher) as { schema?: string; items?: Customer[] };
      if (data.schema !== BACKUP_SCHEMA || !Array.isArray(data.items)) {
        throw new Error("文件不是有效的文镇客户备份");
      }
      await replaceCustomers(data.items);
      toast.success(`已从备份恢复 ${data.items.length} 位客户`, { detail: "本机客户库已替换为备份内容" });
      await load();
    } catch (e) {
      toast.error("恢复失败", { detail: (e as Error).message });
    } finally {
      setBusy(null);
      if (restFileRef.current) restFileRef.current.value = "";
    }
  };

  /** 换设备/丢数据恢复：从云端拉密文 → 解密 → 替换本地库 */
  const restoreCloud = async () => {
    const code = recovery.trim();
    if (!isValidRecoveryCode(code)) { toast.warn("请输入恢复码（32 位）"); return; }
    if (!vault?.exists || !vault.content) { toast.warn("云端还没有备份，先用「加密备份到云端」"); return; }
    setBusy("restore");
    try {
      const data = await decryptVault(code, vault.content) as { schema?: string; items?: Customer[] };
      if (data.schema !== BACKUP_SCHEMA || !Array.isArray(data.items)) {
        throw new Error("云端备份不是有效的客户备份");
      }
      // 仅在确认恢复码正确后才替换本地
      await replaceCustomers(data.items);
      toast.success(`已从云端恢复 ${data.items.length} 位客户`);
      await load();
    } catch (e) {
      toast.error("恢复失败", { detail: (e as Error).message });
    } finally { setBusy(null); }
  };

  /** 删除云端密文（关闭备份） */
  const clearCloud = async () => {
    setBusy("clear");
    try {
      await apiVault.del(VAULT_KEY);
      toast.info("已删除云端备份", { detail: "本机客户库不受影响" });
      await load();
    } catch (e) {
      toast.error("删除失败", { detail: (e as Error).message });
    } finally { setBusy(null); }
  };

  /* ---------- 渲染数据 ---------- */

  const rows: RowExt[] = useMemo(
    () => customers.map((c) => ({
      ...c,
      labelOrder: orders.filter((o) => (o.client_ref ?? "") === c.name).length,
    })),
    [customers, orders],
  );

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return rows;
    return rows.filter((c) => c.name.toLowerCase().includes(k) || (c.email ?? "").toLowerCase().includes(k));
  }, [rows, q]);

  const fmtDate = (t: number) => new Date(t).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });

  if (loading) {
    return (
      <>
        <PageHeader title="客户" sub="维护客户资料、联系方式和授权历史，快速关联已有订单。" />
        <div className="loading-block"><Spinner />载入客户…</div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="客户"
        sub="维护客户资料、联系方式和授权历史，快速关联已有订单。"
        actions={
          <>
            <input className="search" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="搜索客户" aria-label="搜索客户" />
            <button className="btn btn-primary btn-md" onClick={startAdd}>新建客户</button>
          </>
        }
      />

      {/* 线性表格（原型 client-cols；列按真实数据模型取 5 列） */}
      <div className="table" style={{ marginTop: 8 }}>
        <div className="thead client-cols" style={{ gridTemplateColumns: "1.1fr 1.2fr .4fr .9fr .8fr" }}>
          <span>客户</span><span>联系方式</span><span>订单</span><span>最近授权</span><span>操作</span>
        </div>
        {filtered.length === 0 ? (
          <div className="empty" style={{ padding: "40px 16px" }}>
            <div className="empty-title">{q ? "没有匹配的客户" : "还没有客户"}</div>
            <div className="empty-desc">添加客户后可在签发订单时直接选用，名称会写进授权书。</div>
          </div>
        ) : filtered.map((c) => (
          <div key={c.id} className="trow client-cols" style={{ gridTemplateColumns: "1.1fr 1.2fr .4fr .9fr .8fr" }}>
            <b style={{ fontWeight: 500 }}>
              {c.name}
              <span style={{ display: "block", fontSize: 11, color: "var(--muted)", fontWeight: 400, marginTop: 2 }}>
                添于 {fmtDate(c.createdAt)}
              </span>
            </b>
            <span>{c.email || <span style={{ color: "var(--muted)" }}>—</span>}</span>
            <span>{c.labelOrder || <span style={{ color: "var(--muted)" }}>—</span>}</span>
            <span>{c.labelOrder > 0 ? fmtDate(c.updatedAt) : <span style={{ color: "var(--muted)" }}>—</span>}</span>
            <span style={{ display: "flex", gap: 6 }}>
              <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => startEdit(c)}>编辑</button>
              <ConfirmButton label="删除" confirmLabel="确认删除"
                danger disabled={!!busy} busy={busy === `del:${c.id}`}
                icon={<IconTrash size={13} />}
                onConfirm={() => void delCustomer(c)} />
            </span>
          </div>
        ))}
      </div>

      {/* ── 加密备份：Advanced 折叠区（默认收起） ── */}
      <details className="adv-collapse">
        <summary>
          <span className="adv-summary-kicker">ADVANCED</span>
          <span className="adv-summary-label">加密备份 · 防换设备丢失</span>
          <IconChevron size={14} className="adv-chevron" />
        </summary>
        <div className="adv-body">
          <div style={{ marginBottom: 14 }}>
            <div className="notice">
              <strong style={{ color: "var(--danger)" }}>恢复码丢失 = 备份永远打不开</strong>
              。备份用你自己的恢复码加密，服务器只存密文——所以密码必须抄好。
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 18, alignItems: "start" }}>
            {/* 左：云端备份状态 + 操作 */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <IconShield size={16} style={{ color: "var(--ok)" }} />
                {vault?.exists ?
                  <span className="badge badge-ok"><b>云端备份已开启</b></span>
                  : <span className="badge badge-neutral"><b>未开启云端备份</b></span>}
                {vault?.updated_at && (
                  <span style={{ fontSize: 12, color: "var(--ink-500)" }}>
                    上次备份 {new Date(vault.updated_at).toLocaleString("zh-CN")}
                  </span>
                )}
              </div>

              <div className="notice" style={{ padding: "10px 14px" }}>
                客户资料默认只存这台设备。开启备份后，换电脑 / 清缓存也能通过恢复码找回
                —— 代价是恢复码必须由你自己妥善保存。
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="btn btn-outline btn-sm" disabled={!!busy || customers.length === 0} onClick={() => void backupNow()}>
                  {busy === "backup" ? <Spinner /> : <IconUpload size={15} />}
                  加密备份到云端
                </button>
                <button className="btn btn-outline btn-sm" disabled={!!busy || customers.length === 0} onClick={() => void exportFile()}>
                  {busy === "export" ? <Spinner /> : <IconDownload size={15} />}
                  导出加密备份文件
                </button>
                <button className="btn btn-outline btn-sm" disabled={!!busy || !vault?.exists} onClick={() => void restoreCloud()}>
                  {busy === "restore" ? <Spinner /> : <IconCheckCircle size={15} />}
                  从云端恢复
                </button>
                {vault?.exists && (
                  <ConfirmButton label="删除云端备份" confirmLabel="确认删除"
                    danger disabled={!!busy} busy={busy === "clear"}
                    icon={<IconTrash size={14} />}
                    onConfirm={() => void clearCloud()} />
                )}
              </div>

              <input ref={restFileRef} type="file" accept=".tfw,application/json" className="hidden-file"
                onChange={(e) => void importFile(e.target.files?.[0] ?? null)} />
            </div>

            {/* 右：恢复码 */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, borderLeft: "1px solid var(--line)", paddingLeft: 18 }}>
              <div className="field-label" style={{ fontSize: 12.5, color: "var(--ink-500)" }}>恢复码</div>
              <input
                className="input mono" placeholder="粘贴或输入 32 位恢复码"
                value={recovery}
                spellCheck={false} autoComplete="off"
                onChange={(e) => setRecovery(e.target.value.toUpperCase())}
              />
              {showNewCode && (
                <div className="notice warn" style={{ padding: "10px 14px" }}>
                  <div style={{ fontWeight: 600, marginBottom: 6, color: "var(--warn)" }}>新恢复码（只显示这一次）</div>
                  <div className="mono" style={{ fontSize: 14, letterSpacing: 1.2, wordBreak: "break-all", color: "var(--ink-700)" }}>
                    {showNewCode}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button className="btn btn-sm btn-outline"
                      onClick={() => { void navigator.clipboard?.writeText(showNewCode ?? ""); toast.success("已复制恢复码"); }}>
                      <IconCopy size={13} />复制
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setShowNewCode(null)}>我已保存</button>
                  </div>
                </div>
              )}
              <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={genCode}>生成新恢复码</button>
              <div style={{ fontSize: 11.5, color: "var(--ink-500)", lineHeight: 1.6 }}>
                一份恢复码 = 一把钥匙，用于加密和解密你的备份。
                请抄写到纸上或密码管理器；不要截图发聊天工具。
              </div>
            </div>
          </div>
        </div>
      </details>

      {/* ── 新建 / 编辑客户模态框（原型 .modal 语言） ── */}
      {editingId && (
        <div className="modal-back open" onClick={(e) => { if (e.target === e.currentTarget) cancelEdit(); }}>
          <div className="modal" role="dialog" aria-label={editingId === "new" ? "新建客户" : "编辑客户"}>
            <h2>{editingId === "new" ? "新建客户" : "编辑客户"}</h2>
            <div className="flabel">客户名称</div>
            <input className="f" autoFocus placeholder="例如：林川工作室" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="客户名称" />
            <div className="flabel">联系方式</div>
            <input className="f" placeholder="name@example.com" value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })} aria-label="联系方式" />
            <div className="flabel">备注</div>
            <textarea className="f" placeholder="授权范围、对接人等（可选）" value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })} aria-label="备注" />
            {formErr && <div style={{ color: "var(--danger)", fontSize: 12.5, margin: "-6px 0 10px" }}>{formErr}</div>}
            <div className="modal-actions">
              <button className="btn btn-outline btn-md" onClick={cancelEdit}>取消</button>
              <button className="btn btn-primary btn-md" disabled={busy === "form"} onClick={() => void submitForm()}>
                {busy === "form" ? <Spinner /> : null}
                {editingId === "new" ? "创建客户" : "保存修改"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
