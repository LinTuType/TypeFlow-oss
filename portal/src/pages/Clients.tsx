/**
 * 客户页 —— 原型 v9 结构：页头(搜索+新建客户) + 线性表格 + 模态框编辑
 *
 * 客户资料默认只存本机（IndexedDB，与字体文件同待遇）：
 *   - 服务器零敏感数据：云端订单只存不透明 client_id（cu_xxx），无姓名
 *   - 防丢失 = 设置页「备份文件夹 / 导出 JSON」（本地业务数据不上云）
 * 表格列按本项目的真实数据模型：客户 / 联系方式 / 订单 / 最近授权 / 操作。
 * 订单数 = 云端订单里 client_id 等于该客户 ID 的条数。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiOrders, type OrderInfo } from "../api/client";
import { PAGE_KEYS, peekPage, rememberPage } from "../lib/cache";
import { listCustomers, saveCustomer, removeCustomer, replaceCustomers, genCustomerId, type Customer } from "../lib/localCustomers";
import { listOrderNotes, type LocalOrderNote } from "../lib/localOrders";
import { maybeFolderBackup } from "../lib/backupFolder";
import { toast } from "../lib/toast";
import { Modal,  Button, ConfirmButton, PageHeader, Spinner } from "../components/ui";
import { IconPencil, IconTrash } from "../components/Icon";

/** 客户列表 UI 行（额外带订单数，来自云端订单的 client_id 匹配） */
interface RowExt extends Customer {
  labelOrder: number;   // 该客户 ID 匹配的云端订单数
}

/** 本页渲染所需的整套状态 —— 存成快照，从别的页切回来时首帧即内容 */
interface ClientsSnap {
  customers: Customer[];
  orders: OrderInfo[];
  amountByOrderId: Map<string, string>;
  notesByOrderId: Map<string, LocalOrderNote>;
}

export default function Clients() {
  const [init] = useState(() => peekPage<ClientsSnap>(PAGE_KEYS.clients) ?? null);
  const [customers, setCustomers] = useState<Customer[]>(init?.customers ?? []);
  const [orders, setOrders] = useState<OrderInfo[]>(init?.orders ?? []);
  /** 订单金额在本机订单关联里（5.6 起金额不出网） */
  const [amountByOrderId, setAmountByOrderId] = useState<Map<string, string>>(init?.amountByOrderId ?? new Map());
  /** 本机订单关联全量（orderId → clientId / note / amount）：云端不记录客户，聚合全靠它 */
  const [notesByOrderId, setNotesByOrderId] = useState<Map<string, LocalOrderNote>>(init?.notesByOrderId ?? new Map());
  const [loading, setLoading] = useState(init === null);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");
  /** 客户详情卡（列表点击出卡——对齐桌面版 DetailPanel，网页版用点击而非 hover） */
  const [detailId, setDetailId] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  // 表单（新增 / 编辑 共用，走模态框）
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState({ name: "", email: "", note: "" });
  const [formErr, setFormErr] = useState("");

  const load = useCallback(async () => {
    try {
      const [cs, os, notes] = await Promise.all([listCustomers(), apiOrders.list(), listOrderNotes()]);
      const nextOrders = os.orders ?? [];
      const nextAmount = new Map(notes.filter((n) => n.amount).map((n) => [n.orderId, n.amount!]));
      const nextNotes = new Map(notes.map((n) => [n.orderId, n]));

      setCustomers(cs);
      setOrders(nextOrders);
      setAmountByOrderId(nextAmount);
      setNotesByOrderId(nextNotes);
      rememberPage<ClientsSnap>(PAGE_KEYS.clients, {
        customers: cs, orders: nextOrders, amountByOrderId: nextAmount, notesByOrderId: nextNotes,
      });
    } catch (e) {
      toast.error("客户数据加载失败", { detail: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // 订单模态框里点客户名跳过来：直接打开该客户的详情卡
  useEffect(() => {
    const focus = (location.state as { focusClientId?: string } | null)?.focusClientId;
    if (focus) {
      setDetailId(focus);
      // 用掉 state，避免刷新后重复弹卡
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.state, location.pathname, navigate]);

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

  /** onDone：保存成功后如何关框。由 Modal 的 render prop 传入 close，
      好让退场动画播完再卸载；不传则退回立即关闭。 */
  const submitForm = async (onDone?: () => void) => {
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
      if (onDone) onDone(); else setEditingId(null);
      await load();
      maybeFolderBackup();
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
      maybeFolderBackup();
    } catch (e) {
      toast.error("删除失败", { detail: (e as Error).message });
    } finally { setBusy(null); }
  };

  /* ---------- 渲染数据 ---------- */

  const rows: RowExt[] = useMemo(
    () => customers.map((c) => ({
      ...c,
      // 订单数走本机订单关联（云端不记录客户）：orderId → clientId
      labelOrder: orders.filter((o) => notesByOrderId.get(o.order_id)?.clientId === c.id).length,
    })),
    [customers, orders, notesByOrderId],
  );

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return rows;
    return rows.filter((c) => c.name.toLowerCase().includes(k) || (c.email ?? "").toLowerCase().includes(k));
  }, [rows, q]);

  const detail = rows.find((c) => c.id === detailId) ?? null;
  /** 该客户的云端订单（新→旧），及累计金额（金额是展示用字符串，本地解析求和） */
  const detailOrders = useMemo(
    () => orders
      .filter((o) => notesByOrderId.get(o.order_id)?.clientId === detailId)
      .sort((a, b) => b.created_at - a.created_at),
    [orders, detailId, notesByOrderId],
  );
  const detailTotal = useMemo(
    () => detailOrders.reduce((sum, o) => {
      // 金额只在本机订单关联里（5.6 起金额不出网）——OrderInfo 上根本没有这个字段
      const a = amountByOrderId.get(o.order_id) ?? "";
      return sum + (Number(a.replace(/[^0-9.]/g, "")) || 0);
    }, 0),
    [detailOrders, amountByOrderId],
  );

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
            <Button variant="primary" onClick={startAdd}>新建客户</Button>
          </>
        }
      />

      {/* 线性表格（原型 client-cols；列按真实数据模型取 5 列） */}
      <div className="table" style={{ marginTop: 8 }}>
        <div className="thead client-cols">
          <span>客户</span><span>联系方式</span><span>订单</span><span>最近授权</span><span>操作</span>
        </div>
        {filtered.length === 0 ? (
          <div className="empty" style={{ padding: "40px 16px" }}>
            <div className="empty-title">{q ? "没有匹配的客户" : "还没有客户"}</div>
            <div className="empty-desc">添加客户后可在签发订单时直接选用，名称会写进授权书。</div>
          </div>
        ) : filtered.map((c) => (
          <div key={c.id} className="trow client-cols" role="button" tabIndex={0}
            onClick={() => setDetailId(c.id)}
            onKeyDown={(e) => { if (e.key === "Enter") setDetailId(c.id); }}>
            <b style={{ fontWeight: 500 }}>
              {c.name}
              <span style={{ display: "block", fontSize: 11, color: "var(--muted)", fontWeight: 400, marginTop: 2 }}>
                添于 {fmtDate(c.createdAt)}
              </span>
            </b>
            <span>{c.email || <span style={{ color: "var(--muted)" }}>—</span>}</span>
            <span>{c.labelOrder || <span style={{ color: "var(--muted)" }}>—</span>}</span>
            <span>{c.labelOrder > 0 ? fmtDate(c.updatedAt) : <span style={{ color: "var(--muted)" }}>—</span>}</span>
            {/* 行内操作：轻量图标（与追溯历史行同一套语言，hover 才显描边） */}
            <span className="row-acts" onClick={(e) => e.stopPropagation()}>
              <button className="btn btn-icon" disabled={!!busy} title="编辑客户"
                aria-label="编辑客户" onClick={() => startEdit(c)}>
                <IconPencil size={15} />
              </button>
              <ConfirmButton label="" confirmLabel="确认删除" title="删除客户"
                danger disabled={!!busy} busy={busy === `del:${c.id}`}
                icon={<IconTrash size={15} />}
                onConfirm={() => void delCustomer(c)} />
            </span>
          </div>
        ))}
      </div>

      {/* ── 客户详情卡（列表点击出卡；信息拼接全部在本地完成——姓名在本机，订单/金额在云端） ── */}
      {detail && (
        <Modal onClose={() => setDetailId(null)} label={`客户详情：${detail.name}`}>
          {(close) => (<>
            <h2>{detail.name}</h2>
            <div className="kv"><div className="kv-k">联系方式</div>
              <div className="kv-v">{detail.email || <span style={{ color: "var(--muted)" }}>—</span>}</div></div>
            {detail.note && <div className="kv"><div className="kv-k">备注</div><div className="kv-v">{detail.note}</div></div>}
            <div className="kv"><div className="kv-k">添加于</div>
              <div className="kv-v">{new Date(detail.createdAt).toLocaleDateString("zh-CN")}</div></div>

            <div className="body-head" style={{ marginTop: 22 }}>关联订单 · {detailOrders.length} 笔</div>
            {detailOrders.length === 0 ? (
              <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--muted)" }}>
                还没有关联订单——签发时选择这位客户即可自动关联（云端只记客户 ID，不记姓名）。
              </p>
            ) : (
              <div style={{ marginTop: 4 }}>
                {detailOrders.map((o) => (
                  <div className="kv" key={o.order_id}>
                    <div className="kv-k mono">{o.order_id}</div>
                    <div className="kv-v">
                      {amountByOrderId.get(o.order_id) ? <>¥ {amountByOrderId.get(o.order_id)}</> : <span style={{ color: "var(--muted)" }}>金额未填</span>}
                      <span style={{ display: "block", fontSize: 11, color: "var(--muted)", fontWeight: 400, marginTop: 2 }}>
                        {new Date(o.created_at).toLocaleDateString("zh-CN")} · {o.status === "issued" ? "已签发" : o.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="kv" style={{ marginTop: 10 }}>
              <div className="kv-k">累计授权费用</div>
              <div className="kv-v" style={{ font: "600 15px var(--serif)" }}>
                {detailTotal > 0 ? `¥ ${detailTotal.toLocaleString("zh-CN")}` : "—"}
              </div>
            </div>
            <div className="modal-actions">
              <Button onClick={close}>关闭</Button>
              {/* 编辑是「关掉本框、开另一个框」的切换，不能走 close（否则两层遮罩叠着淡） */}
              <Button variant="primary" onClick={() => { setDetailId(null); startEdit(detail); }}>编辑资料</Button>
            </div>
          </>)}
        </Modal>
      )}

      {/* ── 新建 / 编辑客户模态框（共用 Modal：Esc / 焦点圈定 / 滚动锁） ── */}
      {editingId && (
        <Modal onClose={cancelEdit} label={editingId === "new" ? "新建客户" : "编辑客户"}>
          {(close) => (<>
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
              <Button onClick={close}>取消</Button>
              <Button variant="primary" disabled={busy === "form"} onClick={() => void submitForm(close)}>
                {busy === "form" ? <Spinner /> : null}
                {editingId === "new" ? "创建客户" : "保存修改"}
              </Button>
            </div>
          </>)}
        </Modal>
      )}
    </>
  );
}
