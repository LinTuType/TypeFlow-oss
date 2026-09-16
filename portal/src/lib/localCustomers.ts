/**
 * 本地客户库（IndexedDB）
 *
 * 与字体文件同待遇：客户资料**默认只存本机**，不上传、不登记元数据。
 * 跨设备/防丢失由「加密备份」承担（可选）：用户用自己的恢复码把客户列表
 * 加密成密文，存到云端 vault（服务器拿不到明文）或导出成本地文件。
 *
 * 客户字段 —— 只收集签发授权书需要的最小信息：
 *   name   客户/公司名（授权书抬头，必填）
 *   email  交付邮箱（选填）
 *   note   备注（选填）
 */

const DB_NAME = "typeflow_local_customers";
const STORE = "customers";

export interface Customer {
  id: string;          // 短随机 ID（不暴露任何信息）
  name: string;
  email?: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** 生成短随机 ID（客户表本地使用，无需系统级唯一） */
export function genCustomerId(): string {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return "cu_" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** 保存/更新客户（内置 updatedAt） */
export async function saveCustomer(c: Customer): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ ...c, updatedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 列出全部客户（按最近更新倒序） */
export async function listCustomers(): Promise<Customer[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const all = req.result as Customer[];
      all.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(all);
    };
    req.onerror = () => reject(req.error);
  });
}

/** 删除客户 */
export async function removeCustomer(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 用一份备份替换整个客户库（恢复/导入时用）——先清空再写入 */
export async function replaceCustomers(items: Customer[]): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.clear();
    for (const c of items) store.put({ ...c, updatedAt: c.updatedAt || Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}