/**
 * 管理门户 API client —— 对接本地/远程 Cloudflare Worker
 *
 * token 存 sessionStorage（会话级，关闭即失效）；接口地址：
 *   开发期走 Vite proxy（/api → http://127.0.0.1:8787）
 *   生产走同源（静态托管 + worker 同一域名）或配置变量
 */

const TOKEN_KEY = "typeflow_token";
const TENANT_KEY = "typeflow_tenant";   // 仅用于侧栏显示（谁登录了），不含任何敏感信息

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string): void {
  sessionStorage.setItem(TOKEN_KEY, t);
}
export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}
export function getTenant(): string | null {
  return sessionStorage.getItem(TENANT_KEY);
}
export function setTenant(name: string): void {
  sessionStorage.setItem(TENANT_KEY, name);
}

/** 通用请求：注入 token，统一解析 JSON；非 2xx 抛带 message 的 Error */
export async function api<T = any>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: any;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    // 401 = 会话过期或被吊销（服务端会话有 14 天有效期，登出也会立刻失效）。
    // 这不是业务错误，不该以红色提示的形式弹在界面里——直接回登录页。
    if (res.status === 401 && !window.location.pathname.startsWith("/login")) {
      clearToken();
      window.location.replace("/login");
      throw new Error("登录已过期，请重新登录");
    }
    throw new Error((data as { message?: string })?.message ?? `请求失败 (${res.status})`);
  }
  return data as T;
}

// ── 类型 ──
export interface TenantInfo { tenant_id: string; display_name?: string; email?: string }
export interface OrderInfo {
  order_id: string; status: string; font_id: string;
  /** 字体显示名（云端登记时的 display_name；未登记时为 null） */
  font_name?: string | null; created_at: number;
  client_ref?: string; license_type?: string; amount?: string; note?: string;
}
export interface FontInfo {
  font_id: string; display_name: string; original_filename: string;
  original_font_sha256: string; glyph_count: number; format: string;
}

// ── 业务接口 ──
export const apiAuth = {
  register: (email: string, password: string, display_name: string, accept_terms: boolean) =>
    api<{ success: boolean; tenant_id: string }>("POST", "/api/register", { email, password, display_name, accept_terms }),
  login: (email: string, password: string) =>
    api<{ success: boolean; token: string; tenant_id: string; expires_at: number }>("POST", "/api/login", { email, password }),
  /** 吊销服务端会话（不只是清本地 token） */
  logout: () => api<{ success: boolean }>("POST", "/api/logout"),
  /**
   * 忘记密码：无论邮箱存不存在，服务端都回同一句话（防账号枚举）。
   * 邮件通道未配置时 503，message 会说明。
   */
  forgotPassword: (email: string) =>
    api<{ success: boolean; message: string }>("POST", "/api/auth/forgot-password", { email }),
  /** 用邮件里的链接换新密码；成功后旧会话全部作废 */
  resetPassword: (token: string, password: string) =>
    api<{ success: boolean; message: string }>("POST", "/api/auth/reset-password", { token, password }),
  /** 邮箱验证（注册后邮件里的链接） */
  verifyEmail: (token: string) =>
    api<{ success: boolean; message: string }>("POST", "/api/auth/verify-email", { token }),
};

/** 账号与合规：条款补签 / 数据导出 / 注销 */
export const apiAccount = {
  /** 条款版本升级后补签（服务端记录时间戳） */
  acceptTerms: () => api<{ success: boolean; terms_version: string }>("POST", "/api/terms/accept"),
  /** 注销账号：不可恢复，需要密码确认 */
  remove: (password: string) =>
    api<{ success: boolean; deleted: boolean }>("POST", "/api/account/delete", { password }),
  /**
   * 导出云端全部数据（JSON 下载）。
   * 用原生 fetch 而不是 api()：响应是文件不是 JSON。
   */
  export: async () => {
    const res = await fetch("/api/account/export", {
      headers: { Authorization: `Bearer ${getToken() ?? ""}` },
    });
    if (!res.ok) {
      let msg = `导出失败 (${res.status})`;
      try { msg = ((await res.json()) as { message?: string }).message ?? msg; } catch { /* 忽略 */ }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `typeflow-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },
};

export const apiFonts = {
  list: () => api<{ fonts: FontInfo[] }>("GET", "/api/fonts"),
  register: (d: { display_name: string; original_filename: string; original_font_sha256: string; glyph_count: number }) =>
    api<{ success: boolean; font_id: string }>("POST", "/api/fonts/register", d),
};

export const apiOrders = {
  create: (d: { font_id: string; client_ref?: string; license_type?: string; bits_suffix?: string; amount?: string; note?: string }) =>
    api<{ success: boolean; order_id: string; status: string }>("POST", "/api/orders", d),
  prepare: (order_id: string) =>
    api<{ success: boolean; order_id: string; status: string; font_sha256?: string }>("POST", "/api/orders/prepare", { order_id }),
  issuanceRecipe: (order_id: string) =>
    api<any>("POST", "/api/orders/issuance-recipe", { order_id }),
  complete: (order_id: string, watermarked_sha256: string) =>
    api<{ success: boolean; status: string }>("POST", "/api/orders/complete", { order_id, watermarked_sha256 }),
  cancel: (order_id: string) =>
    api<{ success: boolean; status: string }>("POST", "/api/orders/cancel", { order_id }),
  list: () => api<{ orders: OrderInfo[] }>("GET", "/api/orders"),
};

// ── 审计日志（服务端操作台账，只读） ──
export interface AuditEntry {
  id: string; action: string; at: number;
  order_id?: string; meta?: Record<string, unknown>;
}
export const apiAudit = {
  list: () => api<{ events: AuditEntry[] }>("GET", "/api/audit"),
};

export const apiTrace = {
  candidates: (original_font_sha256: string) =>
    api<{ candidates: Array<{ order_id: string; font_sha256: string }> }>("POST", "/api/trace/candidates", { original_font_sha256 }),
  orderRecipe: (order_id: string) =>
    api<{ success: boolean; order_id: string; recipe: any }>("POST", "/api/trace/order-recipe", { order_id }),
};

export const apiDashboard = {
  stats: async () => {
    const [orders, fonts] = await Promise.all([apiOrders.list(), apiFonts.list()]);
    // 客户数 = 订单里出现过的非空 client_ref 去重（云端无客户库，口径同客户页）
    const clients = new Set(
      orders.orders.map((o) => (o.client_ref ?? "").trim()).filter(Boolean),
    );
    return {
      fonts_total: fonts.fonts.length,
      clients_total: clients.size,
      orders_total: orders.orders.length,
      orders_issued: orders.orders.filter((o) => o.status === "issued").length,
      orders_active: orders.orders.filter((o) => ["prepared", "recipe_issued"].includes(o.status)).length,
      orders_draft: orders.orders.filter((o) => o.status === "draft").length,
    };
  },
};

// ── 加密 vault（客户备份的 E2E 密文载体；服务端不解析内容） ──
export interface VaultState { exists: boolean; content?: string; updated_at?: number }
export interface VaultMeta { success: boolean; key: string; updated_at: number; deleted?: boolean }

export const apiVault = {
  /** 取密文（不存在时 exists=false） */
  get: (key: string) => api<VaultState>("GET", `/api/vault/${key}`),
  /** 覆盖存密文 */
  put: (key: string, content: string) =>
    api<VaultMeta>("PUT", `/api/vault/${key}`, { content }),
  /** 删除云端密文（清空备份） */
  del: (key: string) => api<VaultMeta>("DELETE", `/api/vault/${key}`),
};