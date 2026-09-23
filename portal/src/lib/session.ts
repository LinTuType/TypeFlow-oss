import { apiAuth, clearToken, clearTenant, clearEmailVerified } from "../api/client";

/**
 * 退出登录 —— 桌面侧栏与窄屏「更多」菜单共用
 *
 * 原先这段写在 Sidebar.tsx 里，菜单也要用它，所以抽出来（别写第二份）。
 * 只负责清干净，跳转由调用方 navigate 决定（replace 到 /login）。
 */
export async function logoutSession(): Promise<void> {
  // 先吊销服务端会话（批次 2 起 token 是可吊销的）；网络失败也要放人走，
  // 否则用户会卡在一个"点了没反应"的界面上
  try {
    await apiAuth.logout();
  } catch {
    /* 忽略：本地清干净即可 */
  }
  clearToken();
  // 显示名与验证状态也要清：只清 token 的话，下一位登录者进来看见的是
  // 上一位的用户名（侧栏问候语），共用设备的场景尤其明显
  clearTenant();
  clearEmailVerified();
}
