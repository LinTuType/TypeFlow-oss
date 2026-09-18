/**
 * 首次使用引导 —— 只做两件事：记「引导是否已经放过」，以及**从真实数据推导五步的状态**
 *
 * 为什么不落库步骤进度：每一步"做没做"在别处都有权威事实 —— 文件夹句柄、本机字体库、
 * 厂牌、本机订单关联。再存一份进度就多一个会不同步的状态（用户在第 2 步之外把字体加了，
 * 回来这里却还没打勾）。所以只有「要不要自动进引导」这一个标记落在本机 localStorage。
 *
 * 判定口径（用户 2026-09-18 拍板）：**首次登录算首次** —— 登录/注册成功后若标记未设置，进 /welcome；
 * 完成或跳过后写标记，之后不再自动出现；设置页有「重新显示引导」把它清掉。
 */

import { getEmailVerified } from "../api/client";
import { getFolderHandle } from "./fsFolder";
import { readFoundry } from "./foundry";
import { listLocalFonts } from "./localFonts";
import { listOrderNotes } from "./localOrders";

/** localStorage 键：写过 = 不再自动进引导（完成与跳过都写） */
export const ONBOARDING_KEY = "typeflow_start_dismissed";

export type StartKey = "verify" | "folder" | "font" | "licensor" | "issue";

export interface StartStep {
  key: StartKey;
  /** 这一步是否已经满足 —— 每次都从真实数据现算，不做缓存 */
  done: boolean;
  /** 现状的人话摘要（动态值，如「已绑定「我的字体」」）；标题与解释在页面上是静态文案 */
  detail: string;
}

/** 引导是否已经放过（设置页「重新显示引导」会清掉它） */
export function isOnboardingDismissed(): boolean {
  if (typeof localStorage === "undefined") return true;   // 非浏览器环境（单测）：当作已放过，不打扰
  return localStorage.getItem(ONBOARDING_KEY) === "1";
}

/** 完成 / 跳过 —— 之后不再自动进引导 */
export function dismissOnboarding(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(ONBOARDING_KEY, "1");
}

/** 设置页「重新显示引导」：清掉标记，下次登录重新走一遍 */
export function resetOnboarding(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(ONBOARDING_KEY);
}

/**
 * 五步的当前状态。
 * ⚠️ 全程容错：任何一步读不出来（IndexedDB 被禁、权限被撤）都算「未完成」，
 * 而不是让整页崩掉 —— 引导页崩了比引导页不完整糟糕得多。
 */
export async function readStartSteps(): Promise<StartStep[]> {
  const verified = getEmailVerified() === true;
  const folder = await getFolderHandle().catch(() => null);
  const fonts = await listLocalFonts().catch(() => []);
  const orders = await listOrderNotes().catch(() => []);
  const foundry = readFoundry();
  const name = foundry.name.trim();

  return [
    {
      key: "verify",
      done: verified,
      // 这里只给「做没做」，不说怎么做 —— 怎么做的说明在页面上的静态文案里，避免两句半截话拼在一起
      detail: verified ? "已验证" : "尚未验证",
    },
    {
      key: "folder",
      done: !!folder,
      detail: folder ? `已绑定「${folder.name}」` : "选一个本机文件夹",
    },
    {
      key: "font",
      done: fonts.length > 0,
      detail: fonts.length > 0 ? `本机已有 ${fonts.length} 款字体` : "还没有字体",
    },
    {
      key: "licensor",
      done: !!name,
      detail: name ? `抬头：${name}` : "还没有填授权方名称",
    },
    {
      key: "issue",
      done: orders.length > 0,
      detail: orders.length > 0 ? `已签发 ${orders.length} 笔` : "还没有订单",
    },
  ];
}

/** 五步是否全部满足 */
export function allStepsDone(steps: StartStep[]): boolean {
  return steps.length > 0 && steps.every((s) => s.done);
}
