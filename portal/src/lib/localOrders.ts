/**
 * 本地订单关联（orders store）
 *
 * 云端订单不含客户名与备注（方案 P1 后 client_id 替换 client_ref，note 退回本机），
 * 客户名与备注由此模块管理：order_id → { clientId, note }。
 * 换设备后导入客户备份，名字按 clientId 自动对上。
 *
 * 底层使用统一 db.ts（数据库 typeflow，store orders），keyPath = orderId。
 */

import { STORE, dbGet, dbPut, dbDelete, dbGetAll, openDb, dbClear } from "./db";

export interface LocalOrderNote {
  /** 云端订单 ID（ORD-YYYYMMDD-NNN） */
  orderId: string;
  /** 客户 ID（cu_xxxx，对应 customers store 的主键） */
  clientId?: string;
  /**
   * 交付邮箱 —— 只存本机，用于订单页重发交付邮件（「拉起本地邮件」的收件人）。
   * 客户库里有这份邮箱，这里再存一份是为了订单页不必依赖客户库仍存在。
   */
  clientEmail?: string;
  /** 自由备注（≤500 字符） */
  note?: string;
  /** 授权费用（展示用字符串，如 "1,299"）——报价属商业细节，只在本机（5.6 拍板） */
  amount?: string;
  /** 授权方案 key（与云端同名字段一并退回本机；历史订单渲染文书用它） */
  licenseType?: string;
  /** 授权期限起止（ms）；都缺省 = 永久。期限是文书约定，不是技术锁，只存本机 */
  licenseStart?: number;
  licenseEnd?: number;
  updatedAt: number;
}

/** 保存订单本地关联（内置 updatedAt） */
export async function saveOrderNote(
  o: Omit<LocalOrderNote, "updatedAt">,
): Promise<void> {
  await dbPut(STORE.ORDERS, { ...o, updatedAt: Date.now() });
}

/** 取某订单的本地关联 */
export async function getOrderNote(orderId: string): Promise<LocalOrderNote | undefined> {
  return dbGet<LocalOrderNote>(STORE.ORDERS, orderId);
}

/** 列出所有本地订单关联 */
export async function listOrderNotes(): Promise<LocalOrderNote[]> {
  return dbGetAll<LocalOrderNote>(STORE.ORDERS);
}

/** 删除一条订单关联 */
export async function removeOrderNote(orderId: string): Promise<void> {
  await dbDelete(STORE.ORDERS, orderId);
}

/** 清空全部订单关联 */
export async function clearAllOrderNotes(): Promise<void> {
  const all = await listOrderNotes();
  await Promise.all(all.map((o) => removeOrderNote(o.orderId).catch(() => void 0)));
}

/** 用一份备份替换整个订单关联表（导入时用）——先清空再写入 */
export async function replaceOrderNotes(items: LocalOrderNote[]): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE.ORDERS, "readwrite");
    const store = tx.objectStore(STORE.ORDERS);
    store.clear();
    for (const n of items) store.put({ ...n, updatedAt: n.updatedAt || Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}