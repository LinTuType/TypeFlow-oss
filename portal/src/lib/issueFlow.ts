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
import { maybeFolderBackup } from "./backupFolder";
import { saveOrderNote } from "./localOrders";

export interface IssueOptions {
  /** 客户名（授权书抬头显示；仅本机用途，不上云） */
  clientRef?: string;
  /** 客户 ID（cu_ 开头不透明串；与本地客户库主键对应，云端只收这个） */
  clientId?: string;
  /** 交付邮箱（本机字段，云端不存）—— 签发后「邮件发给客户」的收件人 */
  clientEmail?: string;
  licenseType?: string;
  /** 授权期限起止（ms）；都缺省 = 永久。文书约定只存本机，不上云 */
  licenseStart?: number;
  licenseEnd?: number;
  /** 授权费用（展示用字符串，云端仅存储回显） */
  amount?: string;
  /** 备注（仅写本机 orders store，不上云——云端零姓名，备注最可能含人名与商业细节） */
  note?: string;
}

export interface IssueOutcome {
  orderId: string;
  fontId: string;      // 云端 font_id（font_<sha16>）
  fontName: string;
  clientRef: string;   // 客户名（授权书抬头，仅本机）
  clientId: string;    // 客户 ID（空串 = 未关联客户库）
  clientEmail: string; // 交付邮箱（空串 = 没填/没建档，邮件收件人留空）
  licenseType: string;
  licenseStart?: number;
  licenseEnd?: number;
  amount?: string;     // 授权费用（写进授权书；只存本机）
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

/**
 * 阶段顺序 + 展示文案。
 * label 要短：过程槽在授权书右上角，宽度只容得下一行约 37 字符（11px mono）。
 */
export const PHASE_LABEL: Array<{ phase: IssuePhase; label: string }> = [
  { phase: "register", label: "登记哈希元数据" },
  { phase: "order", label: "创建订单" },
  { phase: "recipe", label: "取得云端签发配方" },
  { phase: "embed", label: "本地嵌入水印" },
  { phase: "complete", label: "提交完成回执" },
];

/** 实际流程（对外入口是文件末尾的 issueOne —— 它在失败时补上已创建的订单号） */
async function runIssueFlow(
  font: Omit<LocalFont, "data">,
  opts: IssueOptions = {},
  onPhase?: (phase: IssuePhase) => void,
  onOrderCreated?: (orderId: string) => void,
): Promise<IssueOutcome> {
  // 1. 登记哈希元数据（同哈希重复登记幂等）
  // 只发哈希：字体名（= 文件名去扩展名，可能含客户代号）留在本机，云端不保存它
  onPhase?.("register");
  const reg = await apiFonts.register({ original_font_sha256: font.sha256 });

  // 2. 创建订单（必须用云端返回的 font_id；云端只收 client_id，不收姓名与备注）
  onPhase?.("order");
  // 授权方案 / 期限 / 费用全部不出网——云端订单只要订单号 + 客户不透明 ID + 哈希；
  // 这些字段随订单号存本机 orders store（saveOrderNote），文书渲染也只读本机
  const order = await apiOrders.create({
    font_id: reg.font_id,
    client_id: opts.clientId || undefined,
  });
  onOrderCreated?.(order.order_id);   // 让外层能在中途失败时把订单号报给用户

  if (opts.note || opts.clientId || opts.amount || opts.licenseType || opts.clientEmail) {
    await saveOrderNote({
      orderId: order.order_id, clientId: opts.clientId || undefined,
      clientEmail: opts.clientEmail || undefined,
      note: opts.note || undefined, amount: opts.amount,
      licenseType: opts.licenseType || undefined,
      licenseStart: opts.licenseStart, licenseEnd: opts.licenseEnd,
      // 轮廓容器记在本机订单关联里：订单页重发邮件时可能本机已经没有这份字体了，
      // 而邮件正文点名的交付文件名（.ttf / .otf）必须与当初交付的一致。
      fontContainer: font.container,
    });
  }

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

  // 数据变更点：触发文件夹自动备份（P2 主路径，内部节流、失败静默）
  maybeFolderBackup();

  return {
    orderId: order.order_id,
    fontId: reg.font_id,
    fontName: font.name,
    clientRef: opts.clientRef ?? "",
    clientId: opts.clientId ?? "",
    clientEmail: opts.clientEmail ?? "",
    licenseType: opts.licenseType ?? "enterprise",
    licenseStart: opts.licenseStart,
    licenseEnd: opts.licenseEnd,
    amount: opts.amount,
    sign,
    issuedAt: new Date().toLocaleString("zh-CN"),
  };
}

/**
 * 对本地库中的一个字体执行一次完整签发（字体库页与订单页共用入口）。
 *
 * 失败时把**已经创建的订单号**带进错误信息：订单在云端确实存在了，用户需要知道
 * 去订单页作废它 —— 否则它会一直停在「等待回执」，而直接重试只会再建一张新单。
 * 幂等键要等 worker 侧支持，先把「发生了什么、该去哪儿」讲清楚。
 */
export async function issueOne(
  font: Omit<LocalFont, "data">,
  opts: IssueOptions = {},
  onPhase?: (phase: IssuePhase) => void,
): Promise<IssueOutcome> {
  let createdOrderId: string | undefined;
  try {
    return await runIssueFlow(font, opts, onPhase, (id) => { createdOrderId = id; });
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    throw new Error(createdOrderId
      ? `${msg}｜订单 ${createdOrderId} 已创建但未完成签发，可在订单页作废后重新发起`
      : msg);
  }
}
