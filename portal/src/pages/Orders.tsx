/**
 * 订单列表页 —— 原型 v9 结构：页头(搜索+新建订单) + 线性表格 + 行点击模态框
 *
 * 列序对齐原型：订单编号 / 客户 / 字体 / 授权 / 金额 / 状态。
 * 状态 = 文字 + 小圆点（.status，仅待处理锈红）；详情在模态框中展示，
 * 未签发订单可在模态框内两段式作废。业务逻辑与迁移前一致。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiOrders, type OrderInfo } from "../api/client";
import { toast } from "../lib/toast";
import { PageHeader, Spinner, ConfirmButton } from "../components/ui";

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  prepared: "已准备",
  recipe_issued: "等待回执",
  issued: "已签发",
  canceled: "已取消",
};
/** 状态语言（§06）：仅待处理用锈红，已签发深蓝，其余中性 */
const STATUS_TONE: Record<string, string> = {
  draft: "pending",
  prepared: "pending",
  recipe_issued: "pending",
  issued: "issued",
  canceled: "",
};
/** 授权方案文案（与 Issue 页 LICENSE_OPTIONS 一致） */
const LICENSE_LABEL: Record<string, string> = {
  enterprise: "企业商用",
  personal_commercial: "个人商用",
  personal: "个人版",
};

export default function Orders() {
  const [orders, setOrders] = useState<OrderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const o = await apiOrders.list();
      setOrders(o.orders ?? []);
    } catch (e) {
      toast.error("订单加载失败", { detail: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /** 本地过滤：订单号 / 字体 / 客户 */
  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return orders;
    return orders.filter((o) =>
      o.order_id.toLowerCase().includes(k) ||
      o.font_id.toLowerCase().includes(k) ||
      (o.font_name ?? "").toLowerCase().includes(k) ||
      (o.client_ref ?? "").toLowerCase().includes(k),
    );
  }, [orders, q]);

  const selOrder = orders.find((o) => o.order_id === sel) ?? null;

  /** 作废订单（仅未签发可取消；确认+ 级操作） */
  const [cancelBusy, setCancelBusy] = useState(false);
  const doCancel = async () => {
    if (!selOrder) return;
    setCancelBusy(true);
    try {
      await apiOrders.cancel(selOrder.order_id);
      toast.info(`已作废：${selOrder.order_id}`, { detail: "云端记录保留，状态标记为已取消" });
      await load();
    } catch (e) {
      toast.error("作废失败", { detail: (e as Error).message });
    } finally {
      setCancelBusy(false);
    }
  };

  /** 可作废状态：未到 issued 都允许撤销 */
  const canCancel = !!selOrder && ["draft", "prepared", "recipe_issued"].includes(selOrder.status);

  return (
    <>
      <PageHeader
        title="订单"
        sub="查看授权状态、签发记录、交付文件与订单金额。"
        actions={
          <>
            <input className="search" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="搜索订单" aria-label="搜索订单" />
            <Link to="/issue" className="btn btn-primary btn-md">新建订单</Link>
          </>
        }
      />

      {loading ? (
        <div className="loading-block"><Spinner />载入订单…</div>
      ) : (
        <div className="table" style={{ marginTop: 8 }}>
          <div className="thead order-cols">
            <span>订单编号</span><span>客户</span><span>字体</span><span>授权</span><span>金额</span><span>状态</span>
          </div>
          {filtered.length === 0 ? (
            <div className="empty" style={{ padding: "40px 16px" }}>
              <div className="empty-title">{q ? "没有匹配的订单" : "还没有订单"}</div>
              <div className="empty-desc">去「签发」选择字体并填写客户，即可创建第一笔订单。</div>
            </div>
          ) : filtered.map((o) => (
            <div key={o.order_id} className="trow order-cols"
              onClick={() => setSel(o.order_id)} role="button" tabIndex={0}>
              <span className="mono" style={{ fontSize: 12 }}>{o.order_id}</span>
              <span>{o.client_ref || <span style={{ color: "var(--muted)" }}>—</span>}</span>
              <span className="ellipsis">{o.font_name || o.font_id}</span>
              <span style={{ fontSize: 12 }}>{LICENSE_LABEL[o.license_type ?? ""] ?? o.license_type ?? "—"}</span>
              <span style={{ fontSize: 12 }}>{o.amount ? <>¥ {o.amount}</> : <span style={{ color: "var(--muted)" }}>—</span>}</span>
              <span className={`status ${STATUS_TONE[o.status] ?? ""}`}>
                {STATUS_LABEL[o.status] ?? o.status}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── 订单详情模态框（原型 .modal 语言） ── */}
      {selOrder && (
        <div className="modal-back open" onClick={(e) => { if (e.target === e.currentTarget) setSel(null); }}>
          <div className="modal" role="dialog" aria-label="订单详情">
            <h2 style={{ font: "600 20px/1.4 var(--serif)" }}>{selOrder.order_id}</h2>
            <div className="kv"><div className="kv-k">状态</div>
              <div className="kv-v">
                <span className={`status ${STATUS_TONE[selOrder.status] ?? ""}`}>
                  {STATUS_LABEL[selOrder.status] ?? selOrder.status}
                </span>
              </div>
            </div>
            <div className="kv"><div className="kv-k">字体</div>
              <div className="kv-v">{selOrder.font_name || <span style={{ color: "var(--muted)" }}>未命名</span>}
                <span className="mono" style={{ display: "block", fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{selOrder.font_id}</span>
              </div>
            </div>
            <div className="kv"><div className="kv-k">被授权方</div><div className="kv-v">{selOrder.client_ref || "—"}</div></div>
            <div className="kv"><div className="kv-k">授权方案</div>
              <div className="kv-v">{LICENSE_LABEL[selOrder.license_type ?? ""] ?? selOrder.license_type ?? "—"}</div>
            </div>
            <div className="kv"><div className="kv-k">授权费用</div>
              <div className="kv-v">{selOrder.amount ? <>¥ {selOrder.amount}</> : "—"}</div>
            </div>
            <div className="kv"><div className="kv-k">创建时间</div>
              <div className="kv-v">{new Date(selOrder.created_at).toLocaleString("zh-CN")}</div>
            </div>
            {selOrder.note && <div className="kv"><div className="kv-k">备注</div><div className="kv-v">{selOrder.note}</div></div>}

            {selOrder.status === "recipe_issued" && (
              <div className="notice warn" style={{ marginTop: 14 }}>
                等待用户完成签发回执；如已本地生成水印字体，无需额外操作。
              </div>
            )}
            {selOrder.status === "issued" && (
              <div className="notice ok" style={{ marginTop: 14 }}>
                已签发完成。如需验证字体来源，可用「追溯」功能。
              </div>
            )}
            {selOrder.status === "canceled" && (
              <div className="notice warn" style={{ marginTop: 14 }}>
                该订单已作废，仅作记录保留；不参与追溯候选。
              </div>
            )}

            <div className="modal-actions">
              <button className="btn btn-outline btn-md" onClick={() => setSel(null)}>关闭</button>
              {canCancel && (
                <ConfirmButton label="作废订单" confirmLabel="确认作废"
                  danger disabled={cancelBusy} busy={cancelBusy}
                  onConfirm={() => void doCancel()} />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
