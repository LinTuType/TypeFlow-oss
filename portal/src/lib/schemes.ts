/**
 * 授权方案 —— 一份数据，三处消费（签发页选择 / 设置页管理 / 授权书渲染）
 *
 * 背景：方案文案原先写死在 Issue.tsx、Settings.tsx、license.ts 三个地方，
 * 「开放编辑增删」后三处必须读同一份，否则改了设置页、签发页还是旧菜单。
 *
 * 存储：localStorage 单 key（仿 foundry.ts），只存本机不上云；随本机段备份搬运。
 * 云端订单从来只存 license_type 字符串（现已退回本机），不认识文案——
 * 所以增删改方案对云端零影响。
 *
 * 跨端契约（收窄）：三个内置项的**默认值**与桌面版 config.py PRESET_LICENSES 逐字一致；
 * 用户改过措辞后仅本机生效——授权书本来就在本机渲染，这是用户自己的选择。
 *
 * 删除 = 隐藏（软删除）：不再出现在签发选项，但文案保留——
 * 否则删掉方案后，历史订单的授权书「授权范围」小节就渲染不出来了。
 */

/** 内置项的 key（与桌面版 PRESET_LICENSES 对齐，勿改） */
export const BUILTIN_KEYS = ["enterprise", "personal_commercial", "personal"] as const;

export interface LicenseScheme {
  /** 内置 = BUILTIN_KEYS 之一；自定义 = custom_<随机> */
  key: string;
  label: string;
  /** 一句话说明（签发页选择行 / 设置页列表用） */
  desc: string;
  /** 授权范围条款全文（写进授权书「授权范围」小节） */
  scopeText: string;
  builtin: boolean;
  /** 软删除：不出现在签发选项，文案仍可渲染历史订单 */
  hidden?: boolean;
}

/** 内置默认值 —— label/scopeText 与桌面版逐字一致，改动即破坏跨端契约 */
export const DEFAULT_SCHEMES: LicenseScheme[] = [
  {
    key: "enterprise",
    label: "企业商用",
    desc: "企业内外部使用",
    scopeText:
      "可用于企业自身及为企业客户完成的商业项目，包括企业品牌视觉、广告、产品包装、线上/线下宣传物等。",
    builtin: true,
  },
  {
    key: "personal_commercial",
    label: "个人商用",
    desc: "个人商业项目",
    scopeText:
      "可用于个人客户或本人直接承接的商业项目，如为个人客户设计的海报、LOGO、宣传品等。不得授权或转让给企业用户使用。",
    builtin: true,
  },
  {
    key: "personal",
    label: "个人版",
    desc: "个人非商用",
    scopeText:
      "仅限个人非商业用途，如个人作品展示、学习交流、家庭打印等。不得用于任何商业目的（包括但不限于广告、产品包装、商业发布物等）。",
    builtin: true,
  },
];

const SCHEMES_KEY = "tf.schemes.v1";

function norm(list: unknown): LicenseScheme[] {
  if (!Array.isArray(list)) return DEFAULT_SCHEMES.map((s) => ({ ...s }));
  return list
    .filter((s): s is LicenseScheme =>
      !!s && typeof s === "object" && typeof (s as LicenseScheme).key === "string" &&
      typeof (s as LicenseScheme).label === "string")
    .map((s) => ({ ...s, builtin: !!s.builtin }));
}

/** 全量方案（含隐藏项）——设置页管理用 */
export function listSchemes(): LicenseScheme[] {
  if (typeof localStorage === "undefined") return DEFAULT_SCHEMES.map((s) => ({ ...s }));
  try {
    const raw = localStorage.getItem(SCHEMES_KEY);
    if (!raw) return DEFAULT_SCHEMES.map((s) => ({ ...s }));
    return norm(JSON.parse(raw));
  } catch {
    return DEFAULT_SCHEMES.map((s) => ({ ...s }));
  }
}

/** 签发选项 = 未隐藏项（保持内置在前、自定义追加在后） */
export function visibleSchemes(): LicenseScheme[] {
  return listSchemes().filter((s) => !s.hidden);
}

/** 按 key 取方案（含隐藏）——历史订单文书渲染用 */
export function getScheme(key: string): LicenseScheme | undefined {
  return listSchemes().find((s) => s.key === key);
}

/** 整表写入（设置页保存 / 备份导入共用） */
export function saveSchemes(list: LicenseScheme[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SCHEMES_KEY, JSON.stringify(norm(list)));
}

/** 是否与出厂默认完全一致（一致时不落 localStorage，避免无意义覆写） */
export function isDefault(list: LicenseScheme[]): boolean {
  if (list.length !== DEFAULT_SCHEMES.length) return false;
  return list.every((s, i) => {
    const d = DEFAULT_SCHEMES[i];
    return s.key === d.key && s.label === d.label && s.desc === d.desc &&
      s.scopeText === d.scopeText && s.builtin === d.builtin && !s.hidden;
  });
}

/**
 * 清除本机方案覆盖（「清除本地数据」用）——回到内置三项。
 * 与 saveSchemes(DEFAULT_SCHEMES) 的区别：这里是删 key，不留下与默认等价的残留。
 */
export function clearSchemes(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(SCHEMES_KEY);
}

/** 新自定义方案的 key */
export function genSchemeKey(): string {
  const rnd = crypto.getRandomValues(new Uint8Array(8));
  return "custom_" + Array.from(rnd, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 授权书渲染的文案解析：内置默认 → 本机覆盖 → 回落 key 本身。
 * 云端旧数据里可能出现任何 key，显示原文比显示「—」诚实。
 */
export function schemeLabel(key: string): string {
  return getScheme(key)?.label ?? (key || "—");
}
