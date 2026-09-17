/**
 * 概览（Navy 风格）—— 主页
 *
 * 对标原型 v9「概览」页：
 *   · 宋体大字问候标题 + 摘要句
 *   · lead 统计句（字体/客户/订单）+ 待办高亮
 *   · 双栏：最近订单（线性列表） + 继续工作（入口卡）
 *   · 非卡片化，去 Section 阴影包裹
 *
 * 数据源与旧仪表盘一致：apiDashboard.stats() + apiOrders.list()
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiDashboard, apiOrders, type OrderInfo } from "../api/client";
import { getTenant } from "../api/client";
import { listCustomers } from "../lib/localCustomers";
import { listOrderNotes } from "../lib/localOrders";
import { listLocalFonts } from "../lib/localFonts";
import { schemeLabel } from "../lib/schemes";
import { toast } from "../lib/toast";
import { PageHeader, Spinner } from "../components/ui";
import { IconSpark, IconScanSearch, IconLayers } from "../components/Icon";

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  prepared: "已准备",
  recipe_issued: "等回执",
  issued: "已签发",
  canceled: "已取消",
};
/** 实底状态胶囊（原型 v9）：已签发=navy、等处理=琥珀、取消=中性 */
const STATUS_PILL: Record<string, string> = {
  draft: "pending",
  prepared: "pending",
  recipe_issued: "pending",
  issued: "issued",
  canceled: "neutral",
};
/** 授权方案文案 —— 统一读 lib/schemes.ts；订单的方案 key 在本机关联（2026-09-17 起云端不含） */

/** 等处理（草稿/准备/等回执）的订单 = 待办 */
function isPending(o: OrderInfo) {
  return o.status === "draft" || o.status === "prepared" || o.status === "recipe_issued";
}

export default function Overview() {
  const [stats, setStats] = useState<{
    fonts_total: number;
    clients_total: number;
    orders_total: number;
    orders_issued: number;
    orders_active: number;
    orders_draft: number;
  } | null>(null);
  const [orders, setOrders] = useState<OrderInfo[]>([]);
  const [clientNameById, setClientNameById] = useState<Map<string, string>>(new Map());
  const [fontNameById, setFontNameById] = useState<Map<string, string>>(new Map());
  const [licenseTypeByOrderId, setLicenseTypeByOrderId] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const who = getTenant() ?? "灵兔字形";

  const load = async () => {
    try {
      const [s, o, cs, notes, fonts] = await Promise.all([
        apiDashboard.stats(), apiOrders.list(), listCustomers(), listOrderNotes(), listLocalFonts(),
      ]);
      setStats(s);
      setOrders(o.orders ?? []);
      setClientNameById(new Map(cs.map((c) => [c.id, c.name])));
      setLicenseTypeByOrderId(new Map(notes.filter((n) => n.licenseType).map((n) => [n.orderId, n.licenseType as string])));
      // 字体名取本机字体库（云端自 2026-09-17 起不存字体名 ⇒ order.font_name 恒为空）
      setFontNameById(new Map(fonts.map((f) => [f.id, f.name])));
    } catch (e) {
      toast.error("统计加载失败", { detail: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const pending = orders.filter(isPending);
  const recent = orders.slice(0, 5);

  /* 问候语：按时间段切换 */
  const hour = new Date().getHours();
  const greeting = hour < 6 ? "夜深了" : hour < 12 ? "上午好" : hour < 18 ? "下午好" : "晚上好";

  const activeN = stats?.orders_active ?? 0;

  return (
    <>
      {/* 页头：宋体大字 + 摘要 */}
      <header className="page-head">
        <div className="page-head-text">
          <h1 className="title serif">{greeting}，{who}</h1>
          <p className="page-sub">
            集中查看最近订单、待处理事项和常用操作，继续尚未完成的字体授权工作。
          </p>
        </div>
        <div className="page-head-actions">
          <Link to="/trace" className="btn btn-outline btn-md">开始追溯</Link>
          <Link to="/issue" className="btn btn-primary btn-md">新建签发</Link>
        </div>
      </header>

      {/* lead 统计句（原型 v9：完整形态，数字可点跳转） */}
      <div className="lead">
        <p>
          你的资料库中有{" "}
          <Link to="/fonts"><b>{stats?.fonts_total ?? "—"}</b> 款字体</Link>、
          <Link to="/clients"><b>{stats?.clients_total ?? "—"}</b> 位客户</Link>和{" "}
          <Link to="/orders"><b>{stats?.orders_total ?? "—"}</b> 笔订单</Link>，其中{" "}
          {activeN > 0 ? (
            <Link to="/orders" style={{ color: "var(--rust)" }}><b>{activeN} 笔订单</b></Link>
          ) : (
            <span>暂无待办</span>
          )}{" "}
          等待处理。
        </p>
      </div>

      {loading ? (
        <div className="loading-block"><Spinner />载入订单…</div>
      ) : (
        <div className="overview-grid">
          {/* 左：最近订单（线性三列行） */}
          <section>
            <div className="kicker">RECENT</div>
            <h2 className="section-title">最近订单</h2>
            {recent.length === 0 ? (
              <div className="empty">
                <div className="empty-title">还没有订单</div>
                <div className="empty-desc">去「签发」创建第一笔授权订单。</div>
              </div>
            ) : (
              <div className="recent-list">
                {recent.map((o) => (
                  <Link key={o.order_id} to="/orders" className="recent-row">
                    <span>
                      <span className="order-id">{o.order_id}</span>
                      <span className="order-title">{fontNameById.get(o.font_id.replace(/^font_/, "")) || o.font_name || o.font_id} · {o.client_id ? clientNameById.get(o.client_id) ?? "未识别客户" : "未关联客户"}</span>
                    </span>
                    <span className="meta">{schemeLabel(licenseTypeByOrderId.get(o.order_id) ?? "")}</span>
                    <span className={`pill pill-${STATUS_PILL[o.status] ?? "neutral"}`}>
                      {STATUS_LABEL[o.status] ?? o.status}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* 右：继续工作（线性行，原型 v9） */}
          <aside>
            <div className="kicker">CONTINUE</div>
            <h2 className="section-title">继续工作</h2>
            <div className="continue-list">
              <Link to="/issue" className="continue-row">
                <span className="ci"><IconSpark size={15} /></span>
                <span><b>创建一次签发</b><small>选择字体、客户与授权数据</small></span>
              </Link>
              <Link to="/trace" className="continue-row">
                <span className="ci"><IconScanSearch size={15} /></span>
                <span><b>分析可疑字体</b><small>比较原版并寻找订单来源</small></span>
              </Link>
              <Link to="/fonts" className="continue-row">
                <span className="ci"><IconLayers size={15} /></span>
                <span><b>查看字体库</b><small>检查版本、样张与签发历史</small></span>
              </Link>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}