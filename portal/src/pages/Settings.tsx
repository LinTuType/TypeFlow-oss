/**
 * 设置页 —— 原型 v9 结构：5 条线性分组行 + 右侧滑出抽屉（220ms）
 *
 *   厂牌信息 / 授权方案 / 本地数据与备份 / 密钥与隐私 / 操作记录
 *
 * 抽屉排版 = 小标签 + 衬线值（.drow），与签发页同语言；业务逻辑与迁移前一致。
 * 原则：不展示假功能。后端暂不提供的操作要么本地化，要么明确标注"内置/只读"。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ALGO_VERSION } from "@engine/webv1";
import { apiVault, apiAudit, apiAccount, type AuditEntry } from "../api/client";
import { clearToken } from "../api/client";
import { listLocalFonts, removeLocalFont } from "../lib/localFonts";
import { listCustomers, removeCustomer } from "../lib/localCustomers";
import {
  autoBackupEnabled, setAutoBackupEnabled, getBackupCode, setBackupCode,
  runFontsBackup, lastBackupAt, maybeAutoBackup, exportDataFile, importDataFile,
} from "../lib/backup";
import { isValidRecoveryCode } from "../lib/vault";
import {
  isFsaSupported, pickFontFolder, getFontDirHandle, clearFontDirHandle,
  checkDirPermission, scanFontFolder,
} from "../lib/fsFolder";
import { toast } from "../lib/toast";
import { PageHeader, Spinner, ConfirmButton } from "../components/ui";
import { IconTrash } from "../components/Icon";

/* 本地厂牌配置（v1 只存本机，不联网） */
const FOUNDRY_KEYS = {
  name: "typeflow_foundry_name",
  short: "typeflow_foundry_short",
  site: "typeflow_foundry_site",
};

/** 授权方案（v1 内置，写死） */
const BUILTIN_SCHEMES = [
  { value: "enterprise", label: "企业商用", desc: "企业内外部使用 · 永久" },
  { value: "personal_commercial", label: "个人商用", desc: "个人商业项目 · 永久" },
  { value: "personal", label: "个人版", desc: "个人非商用 · 永久" },
];

/** 审计动作文案 */
const AUDIT_LABEL: Record<string, string> = {
  register: "注册",
  login: "登录",
  font_register: "字体登记",
  order_create: "创建订单",
  order_prepare: "订单准备",
  recipe_issue: "签发配方",
  order_complete: "完成回执",
  order_cancel: "作废订单",
  trace_candidates: "追溯候选",
  trace_recipe: "追溯取配方",
  vault_get: "读取备份",
  vault_put: "写入备份",
  vault_delete: "删除备份",
};

type ItemKey = "brand" | "schemes" | "data" | "keys" | "audit" | "account";

const ITEM_META: { key: ItemKey; title: string; desc: string }[] = [
  { key: "brand", title: "厂牌信息", desc: "名称、简称与官网 · 用于授权书抬头" },
  { key: "schemes", title: "授权方案", desc: "v1 内置方案 · 不提供自定义" },
  { key: "data", title: "本地数据与备份", desc: "本机用量、云端备份状态与清空" },
  { key: "keys", title: "密钥与隐私", desc: "算法版本与隐私边界 · 只读" },
  { key: "audit", title: "操作记录", desc: "服务端审计台账 · 最近 50 条 · 只读" },
  { key: "account", title: "账号与合规", desc: "条款、云端数据导出与账号注销" },
];

/** drow 小标签 + 衬线值（原型 qrow） */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="drow"><small>{label}</small><b>{children}</b></div>
  );
}

export default function Settings() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [openItem, setOpenItem] = useState<ItemKey | null>(null);
  const close = () => setOpenItem(null);

  // 厂牌
  const [foundry, setFoundry] = useState({ name: "", short: "", site: "" });

  // 本地数据
  const [fontCount, setFontCount] = useState(0);
  const [customerCount, setCustomerCount] = useState(0);
  const [vaultExists, setVaultExists] = useState(false);

  // 审计日志（服务端操作台账；读取失败不影响页面）
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  // 自动加密备份（字体清单 + 厂牌 → vault fonts）
  const [autoOn, setAutoOn] = useState(false);
  const [lastBk, setLastBk] = useState<number | null>(null);
  const [showCodeInput, setShowCodeInput] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [bkBusy, setBkBusy] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  // 字体库文件夹（File System Access API · Chromium）
  const fsSupported = isFsaSupported();
  const [dirName, setDirName] = useState<string | null>(null);
  const [dirPerm, setDirPerm] = useState<"granted" | "prompt" | "denied" | null>(null);
  const [scanBusy, setScanBusy] = useState(false);

  // 账号与合规（批次 4）
  const [showDelInput, setShowDelInput] = useState(false);
  const [delPass, setDelPass] = useState("");

  const load = useCallback(async () => {
    setFoundry({
      name: localStorage.getItem(FOUNDRY_KEYS.name) ?? "",
      short: localStorage.getItem(FOUNDRY_KEYS.short) ?? "",
      site: localStorage.getItem(FOUNDRY_KEYS.site) ?? "",
    });
    try {
      const [lf, cs, v, a, fv] = await Promise.all([
        listLocalFonts(),
        listCustomers(),
        apiVault.get("customers").catch(() => ({ exists: false })),
        apiAudit.list().catch(() => ({ events: [] as AuditEntry[] })),
        apiVault.get("fonts").catch(() => ({ exists: false, updated_at: undefined })),
      ]);
      setFontCount(lf.length);
      setCustomerCount(cs.length);
      setVaultExists(!!v.exists);
      setAudit(a.events ?? []);
      setLastBk(fv.exists ? fv.updated_at ?? lastBackupAt() : lastBackupAt());
      setAutoOn(autoBackupEnabled());
      maybeAutoBackup();
      if (fsSupported) {
        const h = await getFontDirHandle();
        if (h) {
          setDirName(h.name);
          setDirPerm(await checkDirPermission(h));
        } else {
          setDirName(null);
          setDirPerm(null);
        }
      }
    } catch {
      /* 本地库读取失败不影响页面渲染 */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /** 保存厂牌到本地（授权书抬头用） */
  const saveFoundry = () => {
    localStorage.setItem(FOUNDRY_KEYS.name, foundry.name.trim());
    localStorage.setItem(FOUNDRY_KEYS.short, foundry.short.trim());
    localStorage.setItem(FOUNDRY_KEYS.site, foundry.site.trim());
    toast.success("厂牌信息已保存（本机）", { detail: "将用于授权书抬头与印章落款" });
    close();
  };

  /** 清除全部本地数据（字体库 + 客户库；云端不动） */
  const clearLocal = async () => {
    setBusy(true);
    try {
      const [lf, cs] = await Promise.all([listLocalFonts(), listCustomers()]);
      await Promise.all([
        ...lf.map((f) => removeLocalFont(f.id).catch(() => void 0)),
        ...cs.map((c) => removeCustomer(c.id).catch(() => void 0)),
      ]);
      toast.success("已清除本地数据", { detail: `删除 ${lf.length} 个字体、${cs.length} 位客户` });
      await load();
    } catch (e) {
      toast.error("清除失败", { detail: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  /** ── 自动加密备份 ── */
  const doBackupNow = async (code: string) => {
    setBkBusy(true);
    try {
      const at = await runFontsBackup(code);
      setLastBk(at);
      toast.success("已加密备份到云端", { detail: "字体清单与厂牌配置（密文，服务器不可读）" });
    } catch (e) {
      toast.error("备份失败", { detail: (e as Error).message });
    } finally {
      setBkBusy(false);
    }
  };

  const enableAuto = () => {
    if (!isValidRecoveryCode(codeInput)) {
      toast.warn("请输入完整恢复码（32 位）");
      return;
    }
    setBackupCode(codeInput);
    setAutoBackupEnabled(true);
    setAutoOn(true);
    setShowCodeInput(false);
    setCodeInput("");
    void doBackupNow(getBackupCode());
  };

  const disableAuto = () => {
    setAutoBackupEnabled(false);
    setAutoOn(false);
    toast.info("已关闭自动备份", { detail: "云端已有密文保留，不再自动更新" });
  };

  /** ── 导入导出 ── */
  const doExport = async () => {
    try {
      const name = await exportDataFile();
      toast.success(`已导出 ${name}`, { detail: "客户资料为明文，请妥善保管该文件" });
    } catch (e) {
      toast.error("导出失败", { detail: (e as Error).message });
    }
  };

  const doImport = async (f: File) => {
    setBkBusy(true);
    try {
      const r = await importDataFile(f);
      toast.success("导入完成", { detail: `恢复 ${r.customers} 位客户与厂牌信息；${r.fonts} 条字体清单已核对（字体本体请在字体库重新添加）` });
      await load();
    } catch (e) {
      toast.error("导入失败", { detail: (e as Error).message });
    } finally {
      setBkBusy(false);
    }
  };

  /** ── 字体库文件夹 ── */
  const doBindFolder = async () => {
    try {
      const name = await pickFontFolder();
      setDirName(name);
      setDirPerm("granted");
      toast.success(`已绑定字体库文件夹「${name}」`, { detail: "可扫描导入；跨会话首次使用需重新授权" });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg && !msg.includes("abort")) toast.error("绑定失败", { detail: msg });
    }
  };

  const doScanFolder = async () => {
    setScanBusy(true);
    try {
      const r = await scanFontFolder();
      toast.success(
        r.added.length > 0 ? `新增 ${r.added.length} 个字体` : "文件夹内没有新字体",
        { detail: `共 ${r.total} 个字体文件，${r.skipped} 个已存在；新字体连同文件本体已导入` },
      );
      await load();
      setDirPerm("granted");
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("重新授权")) {
        setDirPerm("prompt");
        toast.warn(msg);
      } else {
        toast.error("扫描失败", { detail: msg });
      }
    } finally {
      setScanBusy(false);
    }
  };

  const doReauthFolder = async () => {
    const h = await getFontDirHandle();
    if (!h) return;
    const perm = await checkDirPermission(h, true);
    setDirPerm(perm);
    if (perm === "granted") toast.success("已重新授权", { detail: "本会话内可正常扫描" });
  };

  const doUnbindFolder = async () => {
    await clearFontDirHandle();
    setDirName(null);
    setDirPerm(null);
    toast.info("已解除文件夹绑定");
  };

  /** ── 账号与合规（批次 4） ── */
  const doCloudExport = async () => {
    setBusy(true);
    try {
      await apiAccount.export();
      toast.success("云端数据已导出", { detail: "包含账号、字体登记、订单与审计台账（JSON）" });
    } catch (e) {
      toast.error("导出失败", { detail: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const doDeleteAccount = async () => {
    setBusy(true);
    try {
      await apiAccount.remove(delPass);
      toast.success("账号已注销", { detail: "云端数据已全部删除；字体文件本体从未上传，仍在你本机" });
      // 会话已随账号一起吊销，清掉本地残留并回登录页
      clearToken();
      window.location.replace("/login");
    } catch (e) {
      toast.error("注销失败", { detail: (e as Error).message });
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <>
        <PageHeader title="设置" sub="配置厂牌信息、授权方案、本地数据与密钥。" />
        <div className="loading-block"><Spinner />载入设置…</div>
      </>
    );
  }

  /* ── 抽屉内部内容（按 openItem 切换） ── */
  const drawerBody = (() => {
    switch (openItem) {
      case "brand":
        return (
          <>
            <Row label="说明">作为授权方抬头，用于授权书与印章落款</Row>
            <div className="drow"><small>授权方名称</small>
              <input className="q" value={foundry.name} placeholder="如：文镇字库"
                onChange={(e) => setFoundry({ ...foundry, name: e.target.value })} aria-label="授权方名称" /></div>
            <div className="drow"><small>授权方简称</small>
              <input className="q" value={foundry.short} placeholder="如：文镇"
                onChange={(e) => setFoundry({ ...foundry, short: e.target.value })} aria-label="授权方简称" /></div>
            <div className="drow"><small>官网地址</small>
              <input className="q" value={foundry.site} placeholder="https://…"
                onChange={(e) => setFoundry({ ...foundry, site: e.target.value })} aria-label="官网地址" /></div>
            <Row label="存储方式">当前设备本地保存</Row>
            <div className="drawer-actions">
              <button className="btn btn-outline btn-md" onClick={close}>取消</button>
              <button className="btn btn-primary btn-md" onClick={saveFoundry}>保存</button>
            </div>
          </>
        );
      case "schemes":
        return (
          <>
            <Row label="说明">以下方案为 v1 内置，暂不提供自定义</Row>
            {BUILTIN_SCHEMES.map((s) => <Row key={s.value} label={s.label}>{s.desc}</Row>)}
          </>
        );
      case "data":
        return (
          <>
            <Row label="说明">本地数据仅存储于本机；清除操作不影响云端订单与备份</Row>
            <Row label="字体库">{fontCount} 个字体文件（IndexedDB）</Row>
            <Row label="客户库">{customerCount} 位客户（IndexedDB）</Row>
            <Row label="自动加密备份">
              {autoOn ? <>已开启 · 每日至多一次</> : <span className="warn" style={{ color: "var(--rust)" }}>未开启</span>}
            </Row>
            {autoOn ? (
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                <button className="btn btn-sm" disabled={bkBusy}
                  onClick={() => void doBackupNow(getBackupCode())}>立即备份</button>
                <button className="btn btn-sm" onClick={disableAuto}>关闭自动备份</button>
              </div>
            ) : showCodeInput ? (
              <div className="drow"><small>恢复码（保存在本机，用于备份加密；请确保已在客户页生成并妥善抄写）</small>
                <input className="q" value={codeInput} placeholder="32 位恢复码"
                  onChange={(e) => setCodeInput(e.target.value)} aria-label="恢复码" /></div>
            ) : null}
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              {!autoOn && !showCodeInput && (
                <button className="btn btn-sm" onClick={() => setShowCodeInput(true)}>开启自动备份</button>
              )}
              {showCodeInput && (
                <button className="btn btn-primary btn-sm" disabled={bkBusy} onClick={enableAuto}>确认开启</button>
              )}
            </div>
            <Row label="上次备份">
              {lastBk ? new Date(lastBk).toLocaleString("zh-CN") : "尚未备份"}
            </Row>
            <Row label="云端备份内容">字体清单与厂牌配置（密文）· 字体本体不出本机</Row>
            <Row label="字体库文件夹">
              {fsSupported
                ? dirName
                  ? dirPerm === "granted"
                    ? <>已绑定「{dirName}」</>
                    : <span style={{ color: "var(--rust)" }}>已绑定「{dirName}」· 本会话需重新授权</span>
                  : "未绑定（Chrome / Edge 可绑定本地文件夹）"
                : "需要 Chrome / Edge 浏览器支持（File System Access API）"}
            </Row>
            {fsSupported && (
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                {!dirName ? (
                  <button className="btn btn-primary btn-sm" onClick={() => void doBindFolder()}>绑定文件夹</button>
                ) : dirPerm !== "granted" ? (
                  <button className="btn btn-primary btn-sm" onClick={() => void doReauthFolder()}>重新授权</button>
                ) : (
                  <>
                    <button className="btn btn-sm" disabled={scanBusy} onClick={() => void doScanFolder()}>
                      {scanBusy ? "扫描中…" : "扫描文件夹"}</button>
                    <button className="btn btn-sm" onClick={() => void doUnbindFolder()}>解除绑定</button>
                  </>
                )}
              </div>
            )}
            <Row label="导出 / 导入">导出为 JSON 文件（客户资料为明文，请妥善保管）；导入恢复客户库与厂牌信息</Row>
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <button className="btn btn-sm" disabled={bkBusy} onClick={() => void doExport()}>导出数据</button>
              <button className="btn btn-sm" disabled={bkBusy} onClick={() => importInputRef.current?.click()}>导入数据</button>
              <input ref={importInputRef} type="file" accept=".json,application/json" hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void doImport(f); e.target.value = ""; }} />
            </div>
            <Row label="客户库加密备份">
              {vaultExists ? "已启用（恢复码加密，换设备可在客户页恢复）" : "未启用 —— 客户页「Advanced · 防换设备丢失」可开启"}
            </Row>
            <div className="drawer-actions">
              <ConfirmButton label="清除本地数据" confirmLabel="确认清除"
                danger disabled={busy} busy={busy}
                icon={<IconTrash size={14} />} onConfirm={() => void clearLocal()} />
            </div>
          </>
        );
      case "keys":
        return (
          <>
            <Row label="说明">只读信息，本机不保存密钥</Row>
            <Row label="算法版本"><span className="mono" style={{ fontSize: 14 }}>{ALGO_VERSION}</span>（已冻结，改动需升版本号）</Row>
            <Row label="主密钥">仅存云端（AES-256-GCM 加密托管）；浏览器只拿订单派生种子，永不接触主密钥</Row>
            <Row label="字体隐私">字体文件从不离开本机</Row>
            <Row label="出网项">仅字体哈希与订单元数据，可在「安全与信任」页自行验证</Row>
          </>
        );
      case "audit":
        return (
          <>
            <Row label="说明">关键操作均在服务端记录审计事件，含操作类型、时间与关联订单；仅限本人查阅，不可修改</Row>
            {audit.length === 0 ? (
              <Row label="暂无记录">完成签发、登记等操作后会出现。</Row>
            ) : (
              audit.map((e) => (
                <Row key={e.id} label={AUDIT_LABEL[e.action] ?? e.action}>
                  {new Date(e.at).toLocaleString("zh-CN")}
                  {e.order_id ? <span className="mono" style={{ marginLeft: 8, fontSize: 12 }}>{e.order_id}</span> : null}
                </Row>
              ))
            )}
          </>
        );
      case "account":
        return (
          <>
            <Row label="条款">已确认《用户协议》与《隐私政策》 · <a href="/terms" target="_blank" rel="noreferrer">查看全文</a></Row>
            <Row label="数据可携">云端全部数据（账号 / 字体登记 / 订单 / 审计）打包为 JSON 下载</Row>
            <div style={{ marginTop: 10 }}>
              <button className="btn btn-sm" disabled={busy} onClick={() => void doCloudExport()}>
                {busy ? "导出中…" : "导出云端数据"}
              </button>
            </div>
            <Row label="注销账号">
              不可恢复：删除全部云端数据（字体登记、订单、审计与本账号），
              字体文件本体因从未上传而不受影响
            </Row>
            {!showDelInput ? (
              <div style={{ marginTop: 10 }}>
                <button className="btn btn-sm" onClick={() => setShowDelInput(true)}>
                  注销账号…</button>
              </div>
            ) : (
              <>
                <div className="drow">
                  <small>输入登录密码确认（此操作不可撤销）</small>
                  <input className="q" type="password" value={delPass} placeholder="登录密码"
                    onChange={(e) => setDelPass(e.target.value)} aria-label="确认密码" />
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                  <button className="btn btn-sm" onClick={() => { setShowDelInput(false); setDelPass(""); }}>取消</button>
                  <button className="btn btn-sm" style={{ color: "var(--rust)", borderColor: "var(--rust)" }}
                    disabled={busy || !delPass} onClick={() => void doDeleteAccount()}>
                    永久删除我的账号</button>
                </div>
              </>
            )}
          </>
        );
      default:
        return null;
    }
  })();

  const openMeta = ITEM_META.find((m) => m.key === openItem);

  return (
    <>
      <PageHeader title="设置" sub="配置厂牌信息、授权方案、本地数据与密钥。" />

      {/* 原型 v9：线性分组行，点击行打开右侧抽屉 */}
      <div className="settings">
        {ITEM_META.map((m) => (
          <button className="setting" key={m.key} onClick={() => setOpenItem(m.key)}>
            <b>{m.title}</b>
            <small>{m.desc}</small>
          </button>
        ))}
      </div>

      {/* 右侧滑出抽屉（220ms；backdrop 点击关闭） */}
      <div
        className={`drawer-back${openItem ? " open" : ""}`}
        onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      >
        <aside className="drawer" role="dialog" aria-label={openMeta?.title ?? "设置"}>
          <div className="drawer-head">
            <h2>{openMeta?.title}</h2>
            <button className="drawer-x" onClick={close} aria-label="关闭">×</button>
          </div>
          <div className="drawer-body">{drawerBody}</div>
        </aside>
      </div>
    </>
  );
}
