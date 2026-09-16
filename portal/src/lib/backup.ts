/**
 * 本地数据备份与导入导出
 *
 * 自动加密备份：
 *   - 字体清单（元数据）+ 厂牌配置，用恢复码 E2E 加密后存云端 vault（key=fonts）；
 *     客户库的加密备份由客户页独立管理（key=customers），互不干扰。
 *   - 触发：开启时立即一次；之后签发完成/删除字体等变更点静默触发，
 *     同一天内不重复（24h 节流）；打开设置页时也检查一次。
 *   - 字体文件本体不出本机，备份只含清单——恢复时用于核对缺失，本体从字体库页重新添加。
 *
 * 导入导出（本地 JSON 文件）：
 *   - 导出：客户库 + 厂牌信息 + 字体清单（元数据）。客户资料为明文，文件请妥善保管。
 *   - 导入：恢复客户库与厂牌信息；字体清单仅作核对，不做本地写入。
 */

import { listLocalFonts } from "./localFonts";
import { listCustomers, replaceCustomers, type Customer } from "./localCustomers";
import { encryptVault } from "./vault";
import { apiVault } from "../api/client";

const CODE_KEY = "typeflow_backup_code";
const AUTO_KEY = "typeflow_autobackup";
const LAST_KEY = "typeflow_last_backup_at";
const FOUNDRY_KEYS = {
  name: "typeflow_foundry_name",
  short: "typeflow_foundry_short",
  site: "typeflow_foundry_site",
};
const DAY_MS = 24 * 3600 * 1000;

/* ---------- 自动备份开关与恢复码 ---------- */
export function autoBackupEnabled(): boolean {
  return localStorage.getItem(AUTO_KEY) === "1";
}
export function setAutoBackupEnabled(v: boolean): void {
  if (v) localStorage.setItem(AUTO_KEY, "1");
  else localStorage.removeItem(AUTO_KEY);
}
export function getBackupCode(): string {
  return localStorage.getItem(CODE_KEY) ?? "";
}
export function setBackupCode(code: string): void {
  localStorage.setItem(CODE_KEY, code);
}

function readFoundry() {
  return {
    name: localStorage.getItem(FOUNDRY_KEYS.name) ?? "",
    short: localStorage.getItem(FOUNDRY_KEYS.short) ?? "",
    site: localStorage.getItem(FOUNDRY_KEYS.site) ?? "",
  };
}
export function writeFoundry(f: { name: string; short: string; site: string }): void {
  localStorage.setItem(FOUNDRY_KEYS.name, f.name);
  localStorage.setItem(FOUNDRY_KEYS.short, f.short);
  localStorage.setItem(FOUNDRY_KEYS.site, f.site);
}

export interface FontsBackupPayload {
  fonts: Array<{ id: string; name: string; filename: string; sha256: string; glyphCount: number; size: number; savedAt: number }>;
  foundry: { name: string; short: string; site: string };
  exported_at: string;
}

/** 收集字体清单 + 厂牌配置 */
export async function collectFontsBackup(): Promise<FontsBackupPayload> {
  return {
    fonts: await listLocalFonts(),
    foundry: readFoundry(),
    exported_at: new Date().toISOString(),
  };
}

/** 加密并写入云端 vault（fonts）；返回云端 updated_at */
export async function runFontsBackup(code: string): Promise<number> {
  const cipher = await encryptVault(code, await collectFontsBackup());
  const res = await apiVault.put("fonts", cipher);
  localStorage.setItem(LAST_KEY, String(res.updated_at));
  return res.updated_at;
}

export function lastBackupAt(): number | null {
  const v = localStorage.getItem(LAST_KEY);
  return v ? Number(v) : null;
}

/** 变更点静默触发：开启中 + 有恢复码 + 距上次超过 24h 才真正执行；任何失败静默吞掉 */
export function maybeAutoBackup(): void {
  if (!autoBackupEnabled() || !getBackupCode()) return;
  const last = lastBackupAt();
  if (last && Date.now() - last < DAY_MS) return;
  void runFontsBackup(getBackupCode()).catch(() => void 0);
}

/* ---------- 导入导出（本地 JSON 文件） ---------- */
export interface ExportFile {
  app: "typeflow";
  v: 1;
  exported_at: string;
  customers: Customer[];
  foundry: { name: string; short: string; site: string };
  fonts: Array<{ name: string; filename: string; sha256: string }>;   // 仅清单，本体不出本机
}

export async function buildExportFile(): Promise<ExportFile> {
  return {
    app: "typeflow",
    v: 1,
    exported_at: new Date().toISOString(),
    customers: await listCustomers(),
    foundry: readFoundry(),
    fonts: (await listLocalFonts()).map((f) => ({ name: f.name, filename: f.filename, sha256: f.sha256 })),
  };
}

/** 导出为下载文件；返回文件名 */
export async function exportDataFile(): Promise<string> {
  const data = await buildExportFile();
  const name = `typeflow-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  return name;
}

/** 从 JSON 文件导入：恢复客户库（整表替换）与厂牌信息；返回统计 */
export async function importDataFile(file: File): Promise<{ customers: number; fonts: number }> {
  const raw = JSON.parse(await file.text()) as ExportFile;
  if (raw?.app !== "typeflow" || raw?.v !== 1 || !Array.isArray(raw.customers)) {
    throw new Error("文件格式无法识别（需要文镇导出的 JSON 备份）");
  }
  await replaceCustomers(raw.customers);
  if (raw.foundry) writeFoundry(raw.foundry);
  return { customers: raw.customers.length, fonts: raw.fonts?.length ?? 0 };
}
