/**
 * 订单列表页 —— 原型 v9 结构：页头(搜索+新建订单) + 线性表格 + 行点击模态框
 *
 * 列序对齐原型：订单编号 / 客户 / 字体 / 授权 / 金额 / 状态。
 * 状态 = 文字 + 小圆点（.status，仅待处理锈红）；详情在模态框中展示，
 * 未签发订单可在模态框内两段式作废。业务逻辑与迁移前一致。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiOrders, apiTrace, type OrderInfo } from "../api/client";
import { PAGE_KEYS, peekPage, rememberPage } from "../lib/cache";
import { listCustomers } from "../lib/localCustomers";
import { listOrderNotes, type LocalOrderNote } from "../lib/localOrders";
import { getLocalFont, getLocalFontData, listLocalFonts, sha256Of, containerExt, type FontContainer } from "../lib/localFonts";
import { localEmbed, downloadBytes } from "../lib/issuer";
import { buildDeliveryZip, deliveryPackageName } from "../lib/delivery";
import { deliveryMailto, type MailMeta } from "../lib/mailto";
import { readFoundry } from "../lib/foundry";
import { maybeFolderBackup } from "../lib/backupFolder";
import { toast } from "../lib/toast";
import { schemeLabel } from "../lib/schemes";
import { Modal,  Button, ConfirmButton, PageHeader, Spinner } from "../components/ui";
import LocalDataNotice from "../components/LocalDataNotice";
import { IconCopy, IconDownload, IconBan, IconMail, IconArchive, IconUnarchive } from "../components/Icon";

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
/** 状态筛选（F-10）：云端订单量上来后光靠关键字搜索翻不过来
 *
 * 「归档箱」不是状态 —— 归档与状态正交（归档的已签发单状态仍是已签发），
 * 它只是"从这个箱子里挪到那个箱子"。所以它的语义是**互斥的另一个视图**：
 * 选它只看归档的，选别的（含「全部」）一律不看归档的。 */
const STATUS_FILTERS: { key: string; label: string }[] = [
  { key: "", label: "全部" },
  { key: "pending", label: "进行中" },
  { key: "issued", label: "已签发" },
  { key: "canceled", label: "已作废" },
  { key: "archived", label: "归档箱" },
];

/** 归档箱的筛选项 key —— 上面那张表与过滤逻辑共用，别在两处各写一遍字面量 */
const ARCHIVE_KEY = "archived";

/** 是否在归档箱里（`archived_at` 有值即归档；与 status 无关） */
const isArchived = (o: OrderInfo): boolean => !!o.archived_at;

/** 授权方案文案 —— 统一读 lib/schemes.ts（设置页可编辑增删，未知 key 回落原文） */
const schemeName = (note: LocalOrderNote | undefined, fallback?: string): string =>
  note?.licenseType ? schemeLabel(note.licenseType) : schemeLabel(fallback ?? "");

/** 授权期限文案（本机订单关联；都缺省 = 永久） */
const termText = (note: LocalOrderNote | undefined): string => {
  if (!note?.licenseStart && !note?.licenseEnd) return "永久";
  const fmt = (ms?: number) => (ms ? new Date(ms).toLocaleDateString("sv-SE") : "—");
  return `${fmt(note?.licenseStart)} 至 ${fmt(note?.licenseEnd)}`;
};

/** 本页渲染所需的整套状态 —— 存成快照，从别的页切回来时首帧即内容 */
interface OrdersSnap {
  orders: OrderInfo[];
  clientNameById: Map<string, string>;
  clientEmailById: Map<string, string>;
  fontNameById: Map<string, string>;
  fontContainerById: Map<string, FontContainer>;
  localByOrderId: Map<string, LocalOrderNote>;
}

export default function Orders() {
  /** 上次离开本页时的整套状态 —— 有它首帧即内容 */
  const [init] = useState(() => peekPage<OrdersSnap>(PAGE_KEYS.orders) ?? null);
  const [orders, setOrders] = useState<OrderInfo[]>(init?.orders ?? []);
  const [clientNameById, setClientNameById] = useState<Map<string, string>>(init?.clientNameById ?? new Map());
  /** 客户库里的交付邮箱 —— 订单本地关联里没存邮箱的老订单，靠它落到收件人 */
  const [clientEmailById, setClientEmailById] = useState<Map<string, string>>(init?.clientEmailById ?? new Map());
  const [fontNameById, setFontNameById] = useState<Map<string, string>>(init?.fontNameById ?? new Map());
  /**
   * 本机字体的**轮廓容器** —— 只用来定交付文件的扩展名（`.ttf` / `.otf`）。
   * 单独一张表而不是把 `fontNameById` 改成对象：那个 map 的显示语义被 E2E 锁着，不动它。
   */
  const [fontContainerById, setFontContainerById] = useState<Map<string, FontContainer>>(init?.fontContainerById ?? new Map());
  const [localByOrderId, setLocalByOrderId] = useState<Map<string, LocalOrderNote>>(init?.localByOrderId ?? new Map());
  const [loading, setLoading] = useState(init === null);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      // 字体名一并取本机字体库（云端不存字体名，见下方 fontName 的说明）
      const [o, cs, notes, fonts] = await Promise.all([
        apiOrders.list(), listCustomers(), listOrderNotes(), listLocalFonts(),
      ]);
      const nextOrders = o.orders ?? [];
      const nextClientNames = new Map(cs.map((c) => [c.id, c.name]));
      const nextClientEmails = new Map(cs.map((c) => [c.id, c.email ?? ""]));
      const nextLocal = new Map(notes.map((n) => [n.orderId, n]));
      const nextFontNames = new Map(fonts.map((f) => [f.id, f.name]));
      const nextContainers = new Map(
        fonts.filter((f) => f.container).map((f) => [f.id, f.container as FontContainer]),
      );

      setOrders(nextOrders);
      setClientNameById(nextClientNames);
      setClientEmailById(nextClientEmails);
      setLocalByOrderId(nextLocal);
      setFontNameById(nextFontNames);
      setFontContainerById(nextContainers);
      rememberPage<OrdersSnap>(PAGE_KEYS.orders, {
        orders: nextOrders,
        clientNameById: nextClientNames,
        clientEmailById: nextClientEmails,
        fontNameById: nextFontNames,
        fontContainerById: nextContainers,
        localByOrderId: nextLocal,
      });
    } catch (e) {
      toast.error("订单加载失败", { detail: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /** 客户名解析：走本机订单关联（orderId → clientId → 姓名）——云端不记录客户 */
  const clientName = (o: OrderInfo) => {
    const cid = localByOrderId.get(o.order_id)?.clientId;
    return cid ? (clientNameById.get(cid) ?? "未识别客户") : "—";
  };

  /**
   * 字体名解析：**一律取本机字体库**。
   * 云端自 2026-09-17 起不再保存字体名（`display_name` 写空串）⇒ `order.font_name` 只会是空，
   * 直接用它会把这列显示成一串 sha16（`font_9ea2d420…`），客户和自己都认不出是哪款字。
   * 本机没有这份字体（换了浏览器 / 换了设备）时**不拿哈希顶上**——那一列写人话，
   * 完整 font_id 留在 title 与详情弹窗里；恢复本机数据后名字自动回来。
   */
  const localFontName = (o: OrderInfo) => fontNameById.get(o.font_id.replace(/^font_/, ""));
  /** 可检索的字体文本（含哈希，方便按 sha 片段搜） */
  const fontName = (o: OrderInfo) => localFontName(o) || o.font_name || o.font_id;
  /** 渲染用 */
  const fontLabel = (o: OrderInfo) => localFontName(o) || o.font_name || "字体不在本机";

  /** 本地过滤：归档箱 / 状态 + 订单号 / 字体 / 客户名
   *
   * ⚠️ 归档的"排除"必须发生在**状态筛选之前**、且不因 `statusFilter` 为空而跳过 ——
   * 否则「全部」会把归档单又混回来。 */
  const filtered = useMemo(() => {
    let list = statusFilter === ARCHIVE_KEY
      ? orders.filter(isArchived)
      : orders.filter((o) => !isArchived(o));
    if (statusFilter === "pending") list = list.filter((o) => ["draft", "prepared", "recipe_issued"].includes(o.status));
    else if (statusFilter && statusFilter !== ARCHIVE_KEY) list = list.filter((o) => o.status === statusFilter);
    const k = q.trim().toLowerCase();
    if (!k) return list;
    return list.filter((o) =>
      o.order_id.toLowerCase().includes(k) ||
      o.font_id.toLowerCase().includes(k) ||
      fontName(o).toLowerCase().includes(k) ||
      clientName(o).toLowerCase().includes(k),
    );
  }, [orders, q, statusFilter, clientNameById, localByOrderId, fontNameById]);

  const selOrder = orders.find((o) => o.order_id === sel) ?? null;
  const selNote = selOrder ? localByOrderId.get(selOrder.order_id)?.note : undefined;
  /** 金额 / 授权方案 / 期限都在本机订单关联（2026-09-17 起云端不含这些字段） */
  const noteOf = (o: OrderInfo) => localByOrderId.get(o.order_id);
  const orderAmount = (o: OrderInfo) => noteOf(o)?.amount;

  /**
   * 订单页的「邮件发给客户」链接 —— 文案与签发页共用 lib/mailto.ts，不另写一套。
   *
   * 收件人：优先用本机订单关联里存的邮箱（签发那一刻记下的），没有就按 clientId 回落客户库
   * （功能上线前签的那些订单走这条路）。两处都没有 ⇒ 收件人留空，用户在邮件里自己填。
   * 字体名同样一律取本机字体库；本机没有这份字体时写人话 —— 邮件是发给客户的，
   * 一串 sha16 对他没有意义。
   *
   * ⚠️ 这里只开邮件，**不顺手重算交付包**：重算是有哈希校验语义的动作（见 doRegenerate），
   * 把它绑进邮件会在重算失败时留下「邮件已发出去、附件却没有」的局面。
   */
  const mailUrl = useMemo(() => {
    if (!selOrder) return "";
    const note = localByOrderId.get(selOrder.order_id);
    const email = note?.clientEmail
      || (note?.clientId ? clientEmailById.get(note.clientId) ?? "" : "");
    const meta: MailMeta = {
      orderId: selOrder.order_id,
      fontName: localFontName(selOrder) || selOrder.font_name || "字体不在本机",
      licenseType: note?.licenseType ?? "",
      licenseStart: note?.licenseStart,
      licenseEnd: note?.licenseEnd,
      amount: note?.amount,
      licensor: readFoundry(),
      issuedAt: new Date(selOrder.updated_at ?? selOrder.created_at).toLocaleString("zh-CN"),
      // 交付文件名里的扩展名：优先订单关联里记的（签发那一刻的事实，换设备也在），
      // 其次按本机这份字体的容器，都没有才回落 ttf（见 MailMeta.fontExt 的说明）
      fontExt: containerExt(
        note?.fontContainer ?? fontContainerById.get(selOrder.font_id.replace(/^font_/, "")),
      ),
    };
    return deliveryMailto(meta, email).url;
  }, [selOrder, localByOrderId, clientEmailById, fontNameById, fontContainerById]);

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

  /** 复制签发配方（供「离线签发工具」使用；配方幂等可重放，仅含订单种子） */
  const [copyBusy, setCopyBusy] = useState(false);
  const doCopyRecipe = async () => {
    if (!selOrder) return;
    setCopyBusy(true);
    try {
      const res = await apiTrace.orderRecipe(selOrder.order_id);
      if (!res.recipe) throw new Error("该订单没有可用的配方");
      await navigator.clipboard.writeText(JSON.stringify(res.recipe, null, 2));
      toast.success("签发配方已复制", { detail: "打开离线签发工具，粘贴配方并选择该订单的原版字体即可" });
    } catch (e) {
      toast.error("复制失败", { detail: (e as Error).message });
    } finally {
      setCopyBusy(false);
    }
  };

  /**
   * 归入 / 移出归档箱。
   *
   * 这是"我不想在列表里看见它"，**不是删除**、也不是作废：云端记录原样留着、
   * 状态一个字不改、追溯照旧能命中它（归档 ≠ 这个水印不存在）。
   * 随时点「移出归档箱」就回来，所以是普通操作，不做二次确认。
   */
  const [archBusy, setArchBusy] = useState(false);
  const doArchive = async (archived: boolean) => {
    if (!selOrder) return;
    setArchBusy(true);
    try {
      await apiOrders.archive(selOrder.order_id, archived);
      toast.info(archived ? `已归入归档箱：${selOrder.order_id}` : `已移出归档箱：${selOrder.order_id}`, {
        detail: archived
          ? "云端记录保留，追溯不受影响；随时可在「归档箱」里移出"
          : "已回到订单列表",
      });
      await load();
    } catch (e) {
      toast.error(archived ? "归档失败" : "移出失败", { detail: (e as Error).message });
    } finally {
      setArchBusy(false);
    }
  };

  /** 可作废状态：未到 issued 都允许撤销 */
  const canCancel = !!selOrder && ["draft", "prepared", "recipe_issued"].includes(selOrder.status);

  /**
   * 「复制签发配方」在两种状态下分量不同：
   *   未签发完成（recipe_issued）时它是这张卡唯一的主要动作 ⇒ 保留文字 + primary；
   *   已签发时前面已有「重新生成交付包 / 邮件发给客户」⇒ 降为图标，动作行才排得下（不折行）。
   * 底部动作行的宽度账见 skill「弹窗的出口与动作行宽度」——加动作前先算。
   */
  const recipeIsPrimary = selOrder?.status === "recipe_issued";

  /**
   * 重新生成交付包（P1-1 剩余部分）
   *
   * 水印字体不落本地库，但嵌入是**确定性**的：「本机原版字体 + 云端配方」重算，
   * 得到的字节与当初签发的那份完全相同——所以「重新下载」不需要云端存字体。
   *
   * 三道前置，缺哪个就说清哪个（不给一句笼统的"失败"）：
   *   ① 订单已签发（未签发没有回执，重算出来也证明不了是同一份）；
   *   ② 这台设备上有该订单的原版字体（云端只有哈希，字体从来不上传）；
   *   ③ 云端有配方快照（订单详情里「复制签发配方」能拿到的前提）。
   * 重算后拿水印哈希与云端回执比对，一致才说"就是当初那一份"。
   */
  const [regenBusy, setRegenBusy] = useState(false);
  const doRegenerate = async () => {
    if (!selOrder) return;
    const order = selOrder;
    setRegenBusy(true);
    try {
      // ① 本机原版字体：本机 id = 云端 font_<sha16> 去掉前缀
      const localId = order.font_id.replace(/^font_/, "");
      const [localFont, data] = await Promise.all([getLocalFont(localId), getLocalFontData(localId)]);
      if (!data) {
        throw new Error(
          `这台设备上没有该订单的原版字体（${localId.slice(0, 10)}…）。` +
          "从备份恢复本机数据、或在「字体库」重新添加同一份字体文件后再试——云端只存哈希，字体从未上传。",
        );
      }
      // 防呆：拿错字体会算出一份"看着像却对不上"的交付物，先按哈希前缀卡住
      const sha = await sha256Of(data);
      if (!sha.startsWith(localId)) {
        throw new Error("本机这份字体的哈希与订单登记的不一致（可能只是同名文件），已中止——重算出错比不重算危险");
      }

      // ② 云端配方（幂等，只含订单种子，不含主密钥）
      const res = await apiTrace.orderRecipe(order.order_id);
      if (!res.recipe) throw new Error("该订单没有可用的配方快照，无法重算");

      // ③ 本地重算并组包（与当初签发同一条路径）
      const sign = await localEmbed(data, res.recipe);
      const name = clientName(order);
      const zip = buildDeliveryZip({
        orderId: order.order_id,
        // 字体名一律取本机字体库：云端自 2026-09-17 起不再保存字体名（display_name 写空串），
        // order.font_name 只会是空 —— 回落哈希前缀会让交付文件名与授权书上的「授权字体」
        // 变成一串 sha16，客户看不懂，也对不上当初送去的那份。
        fontName: localFont?.name || order.font_name || localId,
        clientRef: name === "—" || name === "未识别客户" ? "" : name,
        licenseType: noteOf(order)?.licenseType ?? "enterprise",
        licensor: readFoundry(),
        amount: noteOf(order)?.amount,
        // 原签发时间：issued 状态下 updated_at 就是完成时间
        issuedAt: new Date(order.updated_at ?? order.created_at).toLocaleString("zh-CN"),
        fontSha256: sha,
        watermarkedSha256: sign.watermarkedSha256,
        nModified: sign.nModified,
        watermarkedFont: sign.fontBytes,
      });
      downloadBytes(zip, deliveryPackageName(order.order_id), "application/zip");
      maybeFolderBackup();

      const receipt = order.watermarked_sha256;
      if (receipt && receipt !== sign.watermarkedSha256) {
        toast.warn("交付包已生成，但水印哈希与云端回执不一致", {
          detail: "请改用「复制签发配方」到离线签发工具重出，并把这一单反馈给我们",
        });
      } else {
        toast.success("交付包已重新生成", {
          detail: receipt
            ? "水印哈希与云端回执一致——这份就是当初那一份"
            : "与当初签发走同一条本地路径，内容一致",
        });
      }
    } catch (e) {
      toast.error("重新生成失败", { detail: (e as Error).message });
    } finally {
      setRegenBusy(false);
    }
  };

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

      <LocalDataNotice />

      {/* 状态筛选：下划线式三态 + 全部（与设置页印章形状同一套选择语言） */}
      <div className="choice" role="radiogroup" aria-label="按状态筛选订单" style={{ marginBottom: 18 }}>
        {STATUS_FILTERS.map((f) => (
          <button key={f.key} type="button" role="radio" aria-checked={statusFilter === f.key}
            className={statusFilter === f.key ? "on" : ""}
            onClick={() => setStatusFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading-block"><Spinner />载入订单…</div>
      ) : (
        <div className="table" style={{ marginTop: 8 }}>
          <div className="thead order-cols">
            <span>订单编号</span><span>客户</span><span>字体</span><span>授权</span><span>金额</span><span>状态</span>
          </div>
          {filtered.length === 0 ? (
            <div className="empty" style={{ padding: "40px 16px" }}>
              {statusFilter === ARCHIVE_KEY ? (
                <>
                  <div className="empty-title">归档箱是空的</div>
                  <div className="empty-desc">在订单详情里点「归入归档箱」，就能把不想看见的订单（比如测试单）挪到这里。</div>
                </>
              ) : (
                <>
                  <div className="empty-title">{q ? "没有匹配的订单" : "还没有订单"}</div>
                  <div className="empty-desc">去「签发」选择字体并填写客户，即可创建第一笔订单。</div>
                </>
              )}
            </div>
          ) : filtered.map((o) => (
            <div key={o.order_id} className="trow order-cols"
              onClick={() => setSel(o.order_id)} role="button" tabIndex={0}>
              <span className="mono" style={{ fontSize: 12 }}>{o.order_id}</span>
              <span>{clientName(o)}</span>
              <span className="ellipsis"
                title={localFontName(o) ? fontName(o) : `字体不在本机 · ${o.font_id}`}>
                {fontLabel(o)}
              </span>
              <span style={{ fontSize: 12 }}>{schemeName(noteOf(o))}</span>
              <span style={{ fontSize: 12 }}>{orderAmount(o) ? <>¥ {orderAmount(o)}</> : <span style={{ color: "var(--muted)" }}>—</span>}</span>
              <span className={`status ${STATUS_TONE[o.status] ?? ""}`}>
                {STATUS_LABEL[o.status] ?? o.status}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── 订单详情模态框（共用 Modal：Esc / 焦点圈定 / 滚动锁） ── */}
      {selOrder && (
        <Modal onClose={() => setSel(null)} label="订单详情">
          {() => (<>
            <h2 style={{ font: "600 20px/1.4 var(--serif)" }}>{selOrder.order_id}</h2>
            <div className="kv"><div className="kv-k">状态</div>
              <div className="kv-v">
                <span className={`status ${STATUS_TONE[selOrder.status] ?? ""}`}>
                  {STATUS_LABEL[selOrder.status] ?? selOrder.status}
                </span>
              </div>
            </div>
            <div className="kv"><div className="kv-k">字体</div>
              <div className="kv-v">
                <button className="kv-link" onClick={() => navigate("/fonts")}
                  title="到字体库查看">{fontLabel(selOrder)}</button>
                <span className="mono" style={{ display: "block", fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{selOrder.font_id}</span>
              </div>
            </div>
            <div className="kv"><div className="kv-k">被授权方</div>
              <div className="kv-v">
                {(() => {
                  const cid = localByOrderId.get(selOrder.order_id)?.clientId;
                  return cid ? (
                    <button className="kv-link" onClick={() => navigate("/customers", { state: { focusClientId: cid } })}
                      title="查看客户详情">{clientName(selOrder)}</button>
                  ) : <span style={{ color: "var(--muted)" }}>—</span>;
                })()}
              </div>
            </div>
            <div className="kv"><div className="kv-k">授权方案</div>
              <div className="kv-v">{schemeName(noteOf(selOrder))}</div>
            </div>
            <div className="kv"><div className="kv-k">授权期限</div>
              <div className="kv-v">{termText(noteOf(selOrder))}</div>
            </div>
            <div className="kv"><div className="kv-k">授权费用</div>
              <div className="kv-v">{orderAmount(selOrder) ? <>¥ {orderAmount(selOrder)}</> : "—"}</div>
            </div>
            <div className="kv"><div className="kv-k">创建时间</div>
              <div className="kv-v">{new Date(selOrder.created_at).toLocaleString("zh-CN")}</div>
            </div>
            {selNote && <div className="kv"><div className="kv-k">备注</div><div className="kv-v">{selNote}</div></div>}

            {selOrder.status === "recipe_issued" && (
              <div className="notice warn" style={{ marginTop: 14 }}>
                等待用户完成签发回执；如已本地生成水印字体，无需额外操作。
              </div>
            )}
            {selOrder.status === "issued" && (
              <div className="notice ok" style={{ marginTop: 14 }}>
                已签发完成。如需重新拿到交付文件，点下方「重新生成交付包」——用本机原版字体
                与云端配方重算，结果与当初一致（字体从未上传，换设备需先在本机字体库补上它）。
              </div>
            )}
            {selOrder.status === "canceled" && (
              <div className="notice warn" style={{ marginTop: 14 }}>
                该订单已作废，仅作记录保留；不参与追溯候选。
              </div>
            )}
            {isArchived(selOrder) && (
              <div className="notice" style={{ marginTop: 14 }}>
                该订单在归档箱里（{new Date(selOrder.archived_at!).toLocaleDateString("zh-CN")} 归档）。
                归档只是把它从订单列表移走——云端记录、状态与追溯都照旧；
                点下方「移出归档箱」即可放回列表。
              </div>
            )}

            <div className="modal-actions">
              {selOrder.status === "issued" && (
                <Button variant="primary" disabled={regenBusy} onClick={() => void doRegenerate()}>
                  <IconDownload size={14} />{regenBusy ? "重算中…" : "重新生成交付包"}
                </Button>
              )}
              {/* 邮件发给客户：只开邮件（预填好的），不顺手重算交付包 —— 见 mailUrl 的说明。
                  导航同步发生在点击手势里，用 location 赋值即可（比异步后再导航稳）。 */}
              {selOrder.status === "issued" && (
                <Button disabled={!mailUrl}
                  onClick={() => { if (mailUrl) window.location.href = mailUrl; }}>
                  <IconMail size={14} />邮件发给客户
                </Button>
              )}
              {/* 复制签发配方：已签发时降为图标（与归档、作废同一档：低频 + 有 title 提示），
                  未签发完成时它是唯一的主要动作，保留文字。 */}
              {["recipe_issued", "issued"].includes(selOrder.status) && (
                recipeIsPrimary ? (
                  <Button variant="primary" disabled={copyBusy} busy={copyBusy}
                    icon={<IconCopy size={14} />} onClick={() => void doCopyRecipe()}>
                    复制签发配方
                  </Button>
                ) : (
                  <Button className="btn-icon" disabled={copyBusy} busy={copyBusy}
                    icon={<IconCopy size={14} />} title="复制签发配方" aria-label="复制签发配方"
                    onClick={() => void doCopyRecipe()} />
                )
              )}
              {canCancel && (
                <ConfirmButton label="" confirmLabel="确认作废" title="作废订单"
                  danger disabled={cancelBusy} busy={cancelBusy}
                  icon={<IconBan size={13} />}
                  onConfirm={() => void doCancel()} />
              )}
              {/* 归档 / 还原：普通操作（随时可逆），所以不要二次确认。
                  图标化 —— 它是"整理"而非"交付"，不该和主按钮抢位置 */}
              <Button className="btn-icon" disabled={archBusy} busy={archBusy}
                icon={isArchived(selOrder) ? <IconUnarchive size={14} /> : <IconArchive size={14} />}
                title={isArchived(selOrder) ? "移出归档箱" : "归入归档箱"}
                aria-label={isArchived(selOrder) ? "移出归档箱" : "归入归档箱"}
                onClick={() => void doArchive(!isArchived(selOrder))} />
            </div>
          </>)}
        </Modal>
      )}
    </>
  );
}
