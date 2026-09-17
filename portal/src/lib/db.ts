/**
 * 统一本地存储层 —— 单库 7 表 + 连接单例
 *
 * 数据库 `typeflow`（版本 2），七个 store：
 *   fonts     - 字体本体与元数据          keyPath: id
 *   customers - 客户资料                 keyPath: id
 *   orders    - 本地订单关联（备注/客户ID） keyPath: orderId
 *   traces    - 追溯历史（报告号/判定/文件摘要） keyPath: id
 *   handles   - 字体文件夹句柄            无 keyPath（key-value）
 *   app       - 厂牌/备份设置/界面偏好     无 keyPath（key-value）
 *   meta      - schema 版本号等元数据     无 keyPath（key-value）
 *
 * 启动时自动清理三个旧库（typeflow_local_fonts / _customers / _fs），
 * 仅当无真实用户时可用此一次性迁移策略。
 */

const DB_NAME = "typeflow";
// v2：+traces（追溯历史落本机，批次 5.2）。onupgradeneeded 按 store 名补建，
// 老库（v1）升级时缺哪个补哪个，不需要数据迁移。
const DB_VERSION = 2;

/** 七个 store 的常量名 */
export const STORE = {
  FONTS: "fonts",
  CUSTOMERS: "customers",
  ORDERS: "orders",
  TRACES: "traces",
  HANDLES: "handles",
  APP: "app",
  META: "meta",
} as const;

/** 使用 keyPath 的有序 store（value 自身含主键） */
const KEYED: ReadonlySet<string> = new Set([STORE.FONTS, STORE.CUSTOMERS, STORE.ORDERS, STORE.TRACES]);

let dbPromise: Promise<IDBDatabase> | null = null;

/** 打开/获取数据库连接（单例，复用） */
export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of Object.values(STORE)) {
        if (!db.objectStoreNames.contains(name)) {
          if (KEYED.has(name)) {
            const kp = name === STORE.ORDERS ? "orderId" : "id";
            db.createObjectStore(name, { keyPath: kp });
          } else {
            db.createObjectStore(name);
          }
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/**
 * 一次性清理 P0/P3 遗留（无真实用户，见方案 P0 §2.5 / P3 退役）。
 * 应用启动时调用一次，幂等无害：
 *   - 旧 IndexedDB 库：typeflow_local_fonts / typeflow_local_customers / typeflow_fs
 *     （三库合一后的旧库；本函数无条件执行，不限首次建库）
 *   - 废弃 localStorage 键：恢复码 / 自动备份开关 / 上次备份时间（vault 整线退役）
 */
export function cleanupLegacyStorage(): void {
  try { indexedDB.deleteDatabase("typeflow_local_fonts"); } catch { /* ignore */ }
  try { indexedDB.deleteDatabase("typeflow_local_customers"); } catch { /* ignore */ }
  try { indexedDB.deleteDatabase("typeflow_fs"); } catch { /* ignore */ }
  const LEGACY_KEYS = ["typeflow_backup_code", "typeflow_autobackup", "typeflow_last_backup_at"];
  for (const k of LEGACY_KEYS) {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  }
}

/** 重置连接实例（仅测试用） */
export function resetDb(): void {
  dbPromise = null;
}

// ── 泛型 CRUD ──

/** 读取单条（keyed store 传主键值，kv store 传 key） */
export async function dbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result ?? undefined);
    req.onerror = () => reject(req.error);
  });
}

/**
 * 写入单条
 * - keyed store（fonts / customers / orders）：value 自身含主键，不必传 key
 * - kv store（handles / app / meta）：必须传 key
 */
export async function dbPut<T>(store: string, value: T, key?: IDBValidKey): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const s = tx.objectStore(store);
    if (key !== undefined) s.put(value, key);
    else s.put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 删除单条 */
export async function dbDelete(store: string, key: IDBValidKey): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 取全部记录（keyed store 返回完整对象，kv store 返回 value 数组） */
export async function dbGetAll<T>(store: string): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

/** 清空指定 store */
export async function dbClear(store: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}