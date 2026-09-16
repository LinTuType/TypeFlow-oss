/**
 * 一体签发流程（字体库页与订单页共用）
 *
 * 全流程五步，字体本体始终不离开本机：
 *   1. 登记哈希元数据（幂等，返回云端 font_id）
 *   2. 创建订单
 *   3. 云端签发配方（只含订单种子，不含主密钥）
 *   4. 本地嵌入（字体从 IndexedDB 取，WebCrypto 计算）
 *   5. 完成回执（只回传水印产出的哈希）
 *
 * 注意 step 1 返回的 font_id 是 `font_<sha16>`，step 2 必须用它，
 * 否则 worker 校验字体存在性时会 404。
 */

import { apiFonts, apiOrders } from "../api/client";
import { getLocalFontData, type LocalFont } from "./localFonts";
import { localEmbed, type SignResult } from "./issuer";
import { maybeAutoBackup } from "./backup";

export interface IssueOptions {
  clientRef?: string;
  licenseType?: string;
  /** 授权费用（展示用字符串，云端仅存储回显） */
  amount?: string;
  note?: string;
}

export interface IssueOutcome {
  orderId: string;
  fontId: string;      // 云端 font_id（font_<sha16>）
  fontName: string;
  clientRef: string;
  licenseType: string;
  sign: SignResult;
  issuedAt: string;
}

/** 签发进度阶段（供 UI 进度条与网络日志提示用） */
export type IssuePhase =
  | "register"    // 登记哈希元数据
  | "order"       // 创建订单
  | "recipe"      // 云端签发配方
  | "embed"       // 本地嵌入水印
  | "complete";   // 完成回执

/** 对本地库中的一个字体执行一次完整签发 */
export async function issueOne(
  font: Omit<LocalFont, "data">,
  opts: IssueOptions = {},
  onPhase?: (phase: IssuePhase) => void,
): Promise<IssueOutcome> {
  // 1. 登记哈希元数据（同哈希重复登记幂等）
  onPhase?.("register");
  const reg = await apiFonts.register({
    display_name: font.name,
    original_filename: font.filename,
    original_font_sha256: font.sha256,
    glyph_count: font.glyphCount,
  });

  // 2. 创建订单（必须用云端返回的 font_id）
  onPhase?.("order");
  const order = await apiOrders.create({
    font_id: reg.font_id,
    client_ref: opts.clientRef || undefined,
    license_type: opts.licenseType || undefined,
    amount: opts.amount || undefined,
    note: opts.note || undefined,
  });

  // 3. 云端签发配方
  onPhase?.("recipe");
  const recipeRes = await apiOrders.issuanceRecipe(order.order_id);
  const recipe = recipeRes.recipe ?? recipeRes;

  // 4. 本地嵌入（字体本体只在这一步被读取，且不出本机）
  onPhase?.("embed");
  const data = await getLocalFontData(font.id);
  if (!data) throw new Error("本地字体数据丢失，请在字体库重新添加该字体");
  const sign = await localEmbed(data, recipe);

  // 5. 完成回执（回传产出哈希，非字体文件）
  onPhase?.("complete");
  await apiOrders.complete(order.order_id, sign.watermarkedSha256);

  // 数据变更点：触发自动加密备份（节流在 backup 内部，失败静默）
  maybeAutoBackup();

  return {
    orderId: order.order_id,
    fontId: reg.font_id,
    fontName: font.name,
    clientRef: opts.clientRef ?? "",
    licenseType: opts.licenseType ?? "enterprise",
    sign,
    issuedAt: new Date().toLocaleString("zh-CN"),
  };
}
