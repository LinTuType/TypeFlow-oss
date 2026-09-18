/**
 * 印章图片 —— 上传后在浏览器里转成 data URL，只存本机
 *
 * 三条约束各自对应一种会出事的场景，不是洁癖：
 *   · **拒 SVG**：data URL 里的 SVG 可以带脚本。这段图片会被写进打印窗口，也会被写进
 *     交付包里的「字体授权书.html」—— 一份发给客户的文书不该携带可执行内容。
 *   · **压到 512px 以内**：印章在文书里只占 64px 高。原始扫描件 2000px 宽带不来任何
 *     额外信息，却会把 localStorage（整站 5MB）和备份 JSON 一起拖大。
 *   · **上限 700KB**：写满 localStorage 会抛异常；对「本机数据 + 备份文件」也是固定开销。
 *
 * 图片只在这里处理一次：设置页上传时调 prepareSealImage()，之后两个出口
 * （屏幕预览 components/LicensePaper.tsx、打印/交付包 lib/license.ts · buildLicenseHtml）
 * 都只是把这段 data URL 放进 `<img src>`，不再做任何加工。
 */

/** 处理后长边上限（px）—— 文书里印章渲染高度 64px，512 已远超够用 */
export const SEAL_MAX_EDGE = 512;
/** data URL 字符数上限（≈ 存储占用）。localStorage 按字符计，base64 比二进制大 1/3 */
export const SEAL_MAX_DATAURL = 700 * 1024;
/** 上传原文件的体积上限 —— 超过它就先让用户自己压，别在浏览器里硬啃 */
export const SEAL_MAX_INPUT = 4 * 1024 * 1024;
/** 原图已够小又是 PNG ⇒ 原样保留（重编码只会掉质量、涨体积） */
const KEEP_AS_IS_MAX = 200 * 1024;

/** 可接受的输入格式。**没有 SVG** —— 原因见文件头 */
const OK_TYPES = ["image/png", "image/jpeg", "image/webp"];

export interface SealImage {
  /** 可直接放进 `<img src>` 与 localStorage 的 data URL */
  dataUrl: string;
  width: number;
  height: number;
  /** data URL 字符数（展示用，≈ 本地存储占用） */
  bytes: number;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("文件读取失败"));
    r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片无法解码，文件可能已损坏或格式实际不符"));
    img.src = src;
  });
}

/**
 * 处理一枚待上传的印章图片：校验格式 → 读尺寸 → 超限则等比缩放 → 产出 data URL。
 * 失败一律抛人话错误（调用方直接把它塞进 toast 的 detail）。
 */
export async function prepareSealImage(file: File): Promise<SealImage> {
  const type = (file.type || "").toLowerCase();
  if (!OK_TYPES.includes(type)) {
    throw new Error(type.includes("svg")
      ? "不支持 SVG —— 授权书会把这段图片嵌进发给客户的文书里，可执行内容不进文书；请导出成 PNG 再上传"
      : "只支持 PNG / JPEG / WebP 三种格式");
  }
  if (file.size > SEAL_MAX_INPUT) {
    throw new Error(`图片 ${(file.size / 1024 / 1024).toFixed(1)}MB，超过 ${SEAL_MAX_INPUT / 1024 / 1024}MB，请先压缩`);
  }

  const raw = await fileToDataUrl(file);
  const img = await loadImage(raw);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) throw new Error("图片尺寸读不出来，文件可能已损坏");

  // 已经够小、又已经是 PNG：原样用。重编码一遍只会掉质量
  if (type === "image/png" && Math.max(w, h) <= SEAL_MAX_EDGE && raw.length <= KEEP_AS_IS_MAX) {
    return { dataUrl: raw, width: w, height: h, bytes: raw.length };
  }

  const scale = Math.min(1, SEAL_MAX_EDGE / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("本浏览器不支持图片处理，无法上传印章");
  ctx.drawImage(img, 0, 0, tw, th);

  // 输出格式：JPEG 保持 JPEG（扫描件转 PNG 会膨胀好几倍），其余一律 PNG（保住透明底）
  const outType = type === "image/jpeg" ? "image/jpeg" : "image/png";
  const dataUrl = canvas.toDataURL(outType, 0.92);
  if (dataUrl.length > SEAL_MAX_DATAURL) {
    throw new Error(
      `处理后仍有 ${Math.round(dataUrl.length / 1024)}KB，超过 ${Math.round(SEAL_MAX_DATAURL / 1024)}KB`
      + " —— 把印章裁到只剩章面，或导出成透明底 PNG 再试",
    );
  }
  return { dataUrl, width: tw, height: th, bytes: dataUrl.length };
}

/** 字节数 → 人话（设置页预览旁边那行小字） */
export function sealImageSizeText(bytes: number): string {
  return bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;
}
