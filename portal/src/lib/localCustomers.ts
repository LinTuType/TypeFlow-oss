/**
 * 本地客户库（统一存储层）
 *
 * 客户资料**默认只存本机**，不上传、不登记元数据。
 * 底层使用统一 db.ts（数据库 typeflow，store customers）。
 *
 * 客户字段 —— 只收集签发授权书需要的最小信息：
 *   name   客户/公司名（授权书抬头，必填）
 *   email  交付邮箱（选填）
 *   note   备注（选填）
 */

import { STORE, dbGet, dbPut, dbDelete, dbGetAll, dbClear, openDb } from "./db";
import { CACHE_KEYS, invalidate, readThrough } from "./cache";

export interface Customer {
  id: string;          // 短随机 ID（不暴露任何信息）
  name: string;
  email?: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

/** 生成短随机 ID（客户表本地使用，无需系统级唯一） */
export function genCustomerId(): string {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return "cu_" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** 保存/更新客户（内置 updatedAt） */
export async function saveCustomer(c: Customer): Promise<void> {
  await dbPut(STORE.CUSTOMERS, { ...c, updatedAt: Date.now() });
  invalidate(CACHE_KEYS.localCustomers);
}

/** 列出全部客户（按最近更新倒序）—— 走缓存（概览 / 订单 / 客户 / 签发 / 设置都在读） */
export async function listCustomers(): Promise<Customer[]> {
  return readThrough(CACHE_KEYS.localCustomers, async () => {
    const all = await dbGetAll<Customer>(STORE.CUSTOMERS);
    all.sort((a, b) => b.updatedAt - a.updatedAt);
    return all;
  });
}

/** 删除客户 */
export async function removeCustomer(id: string): Promise<void> {
  await dbDelete(STORE.CUSTOMERS, id);
  invalidate(CACHE_KEYS.localCustomers);
}

/* ── 批量操作 ── */

/** 用一份备份替换整个客户库（恢复/导入时用）——先清空再写入 */
export async function replaceCustomers(items: Customer[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE.CUSTOMERS, "readwrite");
    const store = tx.objectStore(STORE.CUSTOMERS);
    store.clear();
    for (const c of items) store.put({ ...c, updatedAt: c.updatedAt || Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  invalidate(CACHE_KEYS.localCustomers);
}

/** 删除全部客户（清本地数据用） */
export async function clearAllCustomers(): Promise<void> {
  await dbClear(STORE.CUSTOMERS);
  invalidate(CACHE_KEYS.localCustomers);
}

/** 按 ID 取单个客户 */
export async function getCustomer(id: string): Promise<Customer | undefined> {
  return dbGet<Customer>(STORE.CUSTOMERS, id);
}