/**
 * 设置页 —— 5 条线性分组行，点击条目**就地向下展开**（原右侧滑出抽屉已退役）
 *
 *   厂牌信息 / 授权方案 / 数据与备份 / 密钥与隐私 / 账号与合规
 *   （操作记录不单独成区：云端段只报条数，完整台账随「导出数据」带走）
 *
 * 展开体排版 = 小标签 + 衬线值（.drow），与签发页同语言；业务逻辑与迁移前一致。
 * 原则：不展示假功能。后端暂不提供的操作要么本地化，要么明确标注"内置/只读"。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ALGO_VERSION } from "@engine/webv1";
import { apiAudit, apiAccount, apiFonts, apiOrders, apiAuth, type AuditEntry } from "../api/client";
import { clearToken, getEmailVerified, setEmailVerified } from "../api/client";
import { PAGE_KEYS, peekPage, rememberPage } from "../lib/cache";
import { listLocalFonts, removeLocalFont } from "../lib/localFonts";
import { listCustomers, removeCustomer } from "../lib/localCustomers";
import { listOrderNotes, clearAllOrderNotes } from "../lib/localOrders";
import { listTraceRecords, clearAllTraceRecords } from "../lib/traceHistory";
import { exportDataFile, importDataFile } from "../lib/backup";
import {
  isFsaSupported, getFolderHandle, clearFolderHandle,
  checkFolderPerm, scanFontFolder,
} from "../lib/fsFolder";
import {
  writeFolderBackup, getBackupFolderState, maybeFolderBackup,
  snapshotLocalData, hasSnapshot, restoreSnapshot,
} from "../lib/backupFolder";
// 绑定文件夹 + 接回旧备份：唯一实现在 lib/restore.ts（与「开始使用」引导共用）
import { bindFolderAndRestore, finishRestore } from "../lib/restore";
import { resetOnboarding } from "../lib/onboarding";
import { toast } from "../lib/toast";
import { readFoundry, writeFoundry, clearFoundry, type Foundry, type SealShape } from "../lib/foundry";
import { prepareSealImage, sealImageSizeText } from "../lib/sealImage";
import {
  listSchemes, saveSchemes, genSchemeKey, DEFAULT_SCHEMES, clearSchemes,
  type LicenseScheme,
} from "../lib/schemes";
import { AccordionPanel, Button, ConfirmButton, InfoI, KV, PageHeader, Spinner } from "../components/ui";
import { IconTrash, IconChevron, IconPencil, IconBan, IconPlus } from "../components/Icon";

/** 印章形状选项（文书落款用） */
const SEAL_OPTIONS: { value: SealShape; label: string }[] = [
  { value: "round", label: "圆形" },
  { value: "square", label: "方形" },
  { value: "none", label: "不盖章" },
];

type ItemKey = "brand" | "schemes" | "data" | "keys" | "account";

/** 设置页首屏要用的那批「计数 + 本地文件夹状态」—— 存成快照，切回来首帧即内容 */
interface SettingsSnap {
  fontCount: number;
  customerCount: number;
  noteCount: number;
  traceCount: number;
  schemeRefs: Set<string>;
  audit: AuditEntry[];
  cloudFonts: number | null;
  cloudOrders: number | null;
  folderName: string | null;
  folderPerm: "granted" | "prompt" | "denied" | null;
  lastFolderBk: number | null;
  canUndo: boolean;
}

const ITEM_META: { key: ItemKey; title: string; desc: string }[] = [
  { key: "brand", title: "厂牌信息", desc: "名称、简称与官网 · 用于授权书抬头" },
  { key: "schemes", title: "授权方案", desc: "内置三项可编辑 · 支持自定义与隐藏" },
  { key: "data", title: "数据与备份", desc: "本机数据、备份与导出 · 云端只存登记与订单号" },
  { key: "keys", title: "密钥与隐私", desc: "算法版本与隐私边界 · 只读" },
  { key: "account", title: "账号与合规", desc: "条款、数据可携与账号注销" },
];

/** drow 小标签 + 衬线值（原型 qrow） */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="drow"><small>{label}</small><b>{children}</b></div>
  );
}

/** 展开体里的分区小标题：把一串平铺的行切成可扫读的几段 */
function BodyHead({ children }: { children: React.ReactNode }) {
  return <div className="body-head">{children}</div>;
}

export default function Settings() {
  /**
   * 上次离开本页时的整套计数与本地文件夹状态 —— 有它首帧即内容，不再整页一句「载入设置…」。
   * 文件夹权限这类值仍然会在挂载后重算一次（`load()` 照旧跑），快照只是首帧的顶替品。
   */
  const [init] = useState(() => peekPage<SettingsSnap>(PAGE_KEYS.settings) ?? null);
  const [loading, setLoading] = useState(init === null);
  const [busy, setBusy] = useState(false);
  const [openItem, setOpenItem] = useState<ItemKey | null>(null);
  const close = () => setOpenItem(null);

  // 账号：邮箱验证状态 + 重发验证邮件（未验证会被服务端挡在签发之外）
  const [mailBusy, setMailBusy] = useState(false);
  /** null = 本会话还不知道（没登录过）；登录时写进 sessionStorage，这里读一次 */
  const [emailVerified, setEmailVerifiedState] = useState<boolean | null>(() => getEmailVerified());

  // 厂牌（授权方：抬头 / 落款 / 印章都读它，见 lib/foundry.ts）
  const [foundry, setFoundry] = useState<Foundry>({ name: "", short: "", site: "", seal: "round", sealImage: "" });
  /** 印章图片上传：隐藏的 file input，由「上传图片」按钮触发（不弹窗、不开新面板） */
  const sealFileRef = useRef<HTMLInputElement>(null);
  const [sealBusy, setSealBusy] = useState(false);

  // 授权方案（可编辑增删；schemes.ts 是唯一数据源，签发页与文书实时跟这里同步）
  const [schemes, setSchemes] = useState<LicenseScheme[]>([]);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ label: "", desc: "", scopeText: "" });
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ label: "", desc: "", scopeText: "" });
  /** 已被本机历史订单引用的方案 key（引用中的自定义方案只能隐藏、不能删） */
  const [schemeRefs, setSchemeRefs] = useState<Set<string>>(init?.schemeRefs ?? new Set());

  // 本地数据
  const [fontCount, setFontCount] = useState(init?.fontCount ?? 0);
  const [customerCount, setCustomerCount] = useState(init?.customerCount ?? 0);
  const [noteCount, setNoteCount] = useState(init?.noteCount ?? 0);
  const [traceCount, setTraceCount] = useState(init?.traceCount ?? 0);

  // 云端条数（账号与合规 / 数据与备份里逐项说明用；取不到显示 —，不影响页面）
  const [cloudFonts, setCloudFonts] = useState<number | null>(init?.cloudFonts ?? null);
  const [cloudOrders, setCloudOrders] = useState<number | null>(init?.cloudOrders ?? null);

  // 审计日志（服务端操作台账；读取失败不影响页面）
  const [audit, setAudit] = useState<AuditEntry[]>(init?.audit ?? []);

  // 导入 / 撤销导入（走快照）共用 busy 与文件选择
  const [bkBusy, setBkBusy] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  // 本地文件夹（统一绑定：备份目标 + 字体添加入口，File System Access API）
  const fsSupported = isFsaSupported();
  const [folderName, setFolderName] = useState<string | null>(init?.folderName ?? null);
  const [folderPerm, setFolderPerm] = useState<"granted" | "prompt" | "denied" | null>(init?.folderPerm ?? null);
  const [lastFolderBk, setLastFolderBk] = useState<number | null>(init?.lastFolderBk ?? null);
  const [scanBusy, setScanBusy] = useState(false);
  const [bkBusy2, setBkBusy2] = useState(false);
  const [canUndo, setCanUndo] = useState(init?.canUndo ?? false);

  // 账号与合规（批次 4）
  const [showDelInput, setShowDelInput] = useState(false);
  const [delPass, setDelPass] = useState("");

  const load = useCallback(async () => {
    setFoundry(readFoundry());
    setSchemes(listSchemes());
    try {
      const [lf, cs, notes, tr, a, cf, co] = await Promise.all([
        listLocalFonts(),
        listCustomers(),
        listOrderNotes(),
        listTraceRecords(),
        apiAudit.list().catch(() => ({ events: [] as AuditEntry[] })),
        apiFonts.list().catch(() => ({ fonts: [] })),
        apiOrders.list().catch(() => ({ orders: [] })),
      ]);
      const next: SettingsSnap = {
        fontCount: lf.length,
        customerCount: cs.length,
        noteCount: notes.length,
        traceCount: tr.length,
        schemeRefs: new Set(notes.map((n) => n.licenseType).filter((k): k is string => !!k)),
        audit: a.events ?? [],
        cloudFonts: (cf.fonts ?? []).length,
        cloudOrders: (co.orders ?? []).length,
        folderName: init?.folderName ?? null,
        folderPerm: init?.folderPerm ?? null,
        lastFolderBk: init?.lastFolderBk ?? null,
        canUndo: false,
      };

      setFontCount(next.fontCount);
      setCustomerCount(next.customerCount);
      setNoteCount(next.noteCount);
      setSchemeRefs(next.schemeRefs);
      setTraceCount(next.traceCount);
      setAudit(next.audit);
      setCloudFonts(next.cloudFonts);
      setCloudOrders(next.cloudOrders);
      if (fsSupported) {
        const h = await getFolderHandle();
        if (h) {
          next.folderName = h.name;
          next.folderPerm = await checkFolderPerm(h);
        } else {
          next.folderName = null;
          next.folderPerm = null;
        }
        setFolderName(next.folderName);
        setFolderPerm(next.folderPerm);
        const bs = await getBackupFolderState();
        next.lastFolderBk = bs?.lastBackupAt ?? null;
        setLastFolderBk(next.lastFolderBk);
      }
      next.canUndo = await hasSnapshot();
      setCanUndo(next.canUndo);
      rememberPage(PAGE_KEYS.settings, next);
    } catch {
      /* 本地库读取失败不影响页面渲染 */
    } finally {
      setLoading(false);
    }
  }, [fsSupported, init]);

  useEffect(() => { void load(); }, [load]);

  /** 保存厂牌到本地（授权书抬头 / 落款 / 印章都读它） */
  const saveFoundry = () => {
    try {
      writeFoundry({
        name: foundry.name.trim(),
        short: foundry.short.trim(),
        site: foundry.site.trim(),
        seal: foundry.seal,
        // 空串 = 明确清除（「移除印章图片」写的就是它）；不传才是「不动这一项」
        sealImage: foundry.sealImage ?? "",
      });
    } catch (e) {
      toast.error("厂牌信息未能保存", { detail: (e as Error).message });
      return;   // 写失败就不关面板：留在这里让用户先换张小图
    }
    maybeFolderBackup();
    toast.success("厂牌信息已保存（本机）", {
      detail: foundry.name.trim()
        ? "将用于授权书抬头、落款与印章"
        : "尚未填写授权方名称——授权书抬头会显示「（未设置授权方）」",
    });
    close();
  };

  /**
   * 上传印章图片。加工只发生在这一刻（lib/sealImage.ts：校格式 / 缩到 512px / 控体积），
   * 处理完先落 state 出预览，点「保存」才写本机 —— 与厂牌其它字段同一节奏，可随时反悔。
   */
  const pickSeal = async (f: File | null) => {
    if (!f) return;
    setSealBusy(true);
    try {
      const img = await prepareSealImage(f);
      setFoundry((prev) => ({ ...prev, sealImage: img.dataUrl }));
      toast.success(`印章图片已就绪（${img.width}×${img.height} · ${sealImageSizeText(img.bytes)}）`, {
        detail: "点「保存」写入本机 —— 之后授权书的落款印章都用它",
      });
    } catch (e) {
      toast.error("印章图片不可用", { detail: (e as Error).message });
    } finally {
      setSealBusy(false);
    }
  };

  /** 移除印章图片（保存后生效）：落款回到文字印章 */
  const removeSeal = () => {
    setFoundry((prev) => ({ ...prev, sealImage: "" }));
    toast.success("已移除印章图片", { detail: "点「保存」后授权书落款回到文字印章" });
  };

  /** ── 授权方案：保存 = 整表写回 schemes.ts（localStorage），签发页/文书即时生效 ── */
  const commitSchemes = (list: LicenseScheme[], what: string) => {
    saveSchemes(list);
    setSchemes(list);
    maybeFolderBackup();
    toast.success(`授权方案已${what}（本机）`, { detail: "签发页选项与授权书「授权范围」小节同步更新" });
  };

  const openEdit = (s: LicenseScheme) => {
    setEditKey(s.key);
    setAddOpen(false);
    setEditForm({ label: s.label, desc: s.desc, scopeText: s.scopeText });
  };

  const saveEdit = () => {
    if (!editKey) return;
    const label = editForm.label.trim();
    if (!label) { toast.warn("方案名称不能为空"); return; }
    commitSchemes(
      schemes.map((s) => s.key === editKey
        ? { ...s, label, desc: editForm.desc.trim(), scopeText: editForm.scopeText.trim() }
        : s),
      "保存",
    );
    setEditKey(null);
  };

  const restoreBuiltin = (key: string) => {
    const d = DEFAULT_SCHEMES.find((s) => s.key === key);
    if (!d) return;
    commitSchemes(schemes.map((s) => s.key === key ? { ...d } : s), "恢复默认");
  };

  const hideScheme = (key: string) =>
    commitSchemes(schemes.map((s) => s.key === key ? { ...s, hidden: true } : s), "隐藏");

  const unhideScheme = (key: string) =>
    commitSchemes(schemes.map((s) => s.key === key ? { ...s, hidden: false } : s), "恢复显示");

  const deleteScheme = (key: string) => {
    commitSchemes(schemes.filter((s) => s.key !== key), "删除");
    if (editKey === key) setEditKey(null);
  };

  const addCustom = () => {
    const label = addForm.label.trim();
    if (!label) { toast.warn("请先填写方案名称"); return; }
    const s: LicenseScheme = {
      key: genSchemeKey(), label,
      desc: addForm.desc.trim() || "自定义方案",
      scopeText: addForm.scopeText.trim(),
      builtin: false,
    };
    commitSchemes([...schemes, s], "新增");
    setAddOpen(false);
    setAddForm({ label: "", desc: "", scopeText: "" });
  };

  /** 清除全部本地数据（字体库 + 客户库 + 订单关联 + 厂牌 + 方案 + 追溯；云端不动） */
  const clearLocal = async () => {
    setBusy(true);
    try {
      const [lf, cs, notes] = await Promise.all([listLocalFonts(), listCustomers(), listOrderNotes()]);
      await Promise.all([
        ...lf.map((f) => removeLocalFont(f.id).catch(() => void 0)),
        ...cs.map((c) => removeCustomer(c.id).catch(() => void 0)),
        clearAllTraceRecords().catch(() => void 0),
        clearAllOrderNotes().catch(() => void 0),
      ]);
      // 厂牌与授权方案在 localStorage，同属「本地数据」：金额、期限、客户关联、
      // 授权方信息若残留，共用设备上等于没清干净
      clearFoundry();
      clearSchemes();
      // 「开始使用」引导的标记也清掉：本地清空之后回到初始状态，下次登录重新走一遍引导
      resetOnboarding();
      toast.success("已清除本地数据", {
        detail: `删除 ${lf.length} 个字体、${cs.length} 位客户、${notes.length} 条订单关联（金额/期限/备注）与全部追溯历史；授权方信息与授权方案已恢复默认。云端登记不受影响；若绑定过备份文件夹，绑定回来即可恢复`,
      });
      await load();
    } catch (e) {
      toast.error("清除失败", { detail: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  /** ── 导入导出 ── */
  const doExport = async () => {
    try {
      const r = await exportDataFile();
      toast.success(`已导出 ${r.name}`, {
        detail: (r.cloud
          ? "含本机数据（客户 / 厂牌 / 订单关联 / 追溯历史）与云端段（登记 / 订单 / 审计）"
          : "云端段本次未取到（离线或会话过期），只导出了本机数据")
          + `，并带字体本体 ${r.fonts} 个——换机导入这一份即完整恢复；客户资料为明文，请妥善保管`,
      });
    } catch (e) {
      toast.error("导出失败", { detail: (e as Error).message });
    }
  };

  const doImport = async (f: File) => {
    setBkBusy(true);
    try {
      // 导入 = 整表替换 → 先把当前数据快照，点错可一键撤销
      await snapshotLocalData();
      const r = await importDataFile(f);
      setCanUndo(true);
      maybeFolderBackup();
      toast.success("导入完成", {
        detail: `恢复 ${r.customers} 位客户、${r.orders} 条订单关联、${r.traces} 份追溯报告与厂牌信息；` +
          (r.fontsRestored > 0
            ? `字体本体已回灌 ${r.fontsRestored} 个（按哈希校验）`
            : `${r.fonts} 条字体清单已核对（此备份不含字体本体，请在字体库重新添加）`),
      });
      await load();
    } catch (e) {
      // 导入是整表替换、且分几张表各自落盘：写到一半失败会留下「元数据已替换、
      // 字体本体还是半套」的中间态。所以失败即自动还原快照；还原本身也可能失败，
      // 那就把「撤销上次导入」入口放出来，让用户还能手动点一次。
      let recovered = false;
      try {
        if (await hasSnapshot()) { await restoreSnapshot(); recovered = true; await load(); }
      } catch { /* 还原失败：下面的文案会如实说明 */ }
      setCanUndo(await hasSnapshot());
      toast.error("导入失败", {
        detail: (e as Error).message + (recovered ? "；已自动还原到导入前的数据" : "；撤销入口已就绪，可手动还原"),
      });
    } finally {
      setBkBusy(false);
    }
  };

  /** 撤销上次导入（自动快照还原） */
  const doUndoImport = async () => {
    setBkBusy(true);
    try {
      const n = await restoreSnapshot();
      if (n === null) { toast.info("没有可撤销的导入"); return; }
      setCanUndo(false);
      toast.success("已撤销上次导入", { detail: `客户库回退到导入前（${n} 位客户）` });
      await load();
    } catch (e) {
      toast.error("撤销失败", { detail: (e as Error).message });
    } finally {
      setBkBusy(false);
    }
  };

  /** ── 本地文件夹（统一：备份目标 + 字体添加入口 + 换机后的恢复来源） ── */
  const doBindFolder = async () => {
    try {
      // 绑定 + 接回旧备份的逻辑在 lib/restore.ts（与「开始使用」引导共用同一处）：
      // 「先探旧备份、再决定写不写」这条安全线只在那里实现一次。
      const r = await bindFolderAndRestore();
      setFolderName(r.name);
      setFolderPerm("granted");
      if (r.restored) {
        finishRestore(r.restored);   // 接回了旧备份：结果经 sessionStorage 传递，并 reload
        return;
      }
      setLastFolderBk(Date.now());
      toast.success(`已绑定本地文件夹「${r.name}」`, { detail: "字体从这里扫描入库并锁定版本；数据变更会自动备份（清单 + 字体本体）" });
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
      setFolderPerm("granted");
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("重新授权")) {
        setFolderPerm("prompt");
        toast.warn(msg);
      } else {
        toast.error("扫描失败", { detail: msg });
      }
    } finally {
      setScanBusy(false);
    }
  };

  const doBackupNowFolder = async () => {
    setBkBusy2(true);
    try {
      const at = await writeFolderBackup();
      setLastFolderBk(at);
      toast.success("已备份到文件夹", { detail: "客户 / 厂牌 / 订单关联 / 字体清单已写入" });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("重新授权")) {
        setFolderPerm("prompt");
        toast.warn(msg);
      } else {
        toast.error("备份失败", { detail: msg });
      }
    } finally {
      setBkBusy2(false);
    }
  };

  const doReauthFolder = async () => {
    const h = await getFolderHandle();
    if (!h) return;
    const perm = await checkFolderPerm(h, true);
    setFolderPerm(perm);
    if (perm === "granted") toast.success("已重新授权", { detail: "可继续扫描字体与自动备份" });
  };

  const doUnbindFolder = async () => {
    await clearFolderHandle();
    setFolderName(null);
    setFolderPerm(null);
    setLastFolderBk(null);
    toast.info("已解除本地文件夹绑定");
  };

  /** ── 账号与合规（批次 4） ── */
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

  /**
   * 重发验证邮件。未验证的账号会被服务端挡在签发之外，这里是用户唯一的出路，
   * 所以除了限流提示，其余一律给明确结果。
   */
  const doResendVerification = async () => {
    setMailBusy(true);
    try {
      const r = await apiAuth.resendVerification();
      if (r.already_verified) {
        setEmailVerified(true);
        setEmailVerifiedState(true);
        toast.info("该邮箱已验证", { detail: "不需要再验证" });
      } else {
        toast.success("验证邮件已发送", { detail: "请查收注册邮箱里的验证链接（也看看垃圾邮件箱）" });
      }
    } catch (e) {
      toast.error("发送失败", { detail: (e as Error).message });
    } finally {
      setMailBusy(false);
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

  /* ── 展开体内容（按条目 key 切换；6 块都常挂载，收起时由 .acc-panel 裁切） ── */
  const renderBody = (key: ItemKey) => {
    switch (key) {
      case "brand":
        return (
          <>
            <Row label="说明">作为授权方，写进授权书抬头、落款与印章</Row>
            <div className="drow"><small>授权方名称</small>
              <input className="q" value={foundry.name} placeholder="如：文镇字库"
                onChange={(e) => setFoundry({ ...foundry, name: e.target.value })} aria-label="授权方名称" /></div>
            <div className="drow"><small>授权方简称</small>
              <input className="q" value={foundry.short} placeholder="如：文镇"
                onChange={(e) => setFoundry({ ...foundry, short: e.target.value })} aria-label="授权方简称" /></div>
            <div className="drow"><small>官网地址</small>
              <input className="q" value={foundry.site} placeholder="https://…"
                onChange={(e) => setFoundry({ ...foundry, site: e.target.value })} aria-label="官网地址" /></div>
            <div className="drow"><small>印章形状</small>
              <div className="choice" role="radiogroup" aria-label="印章形状">
                {SEAL_OPTIONS.map((o) => (
                  <button key={o.value} type="button" role="radio"
                    aria-checked={foundry.seal === o.value}
                    className={foundry.seal === o.value ? "on" : ""}
                    onClick={() => setFoundry({ ...foundry, seal: o.value })}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            {/* 印章图片：上传后替代文字印章（不叠加）。加工在 lib/sealImage.ts，只存本机 */}
            <div className="drow"><small>印章图片<InfoI>有图片印章时，授权书落款盖这枚图片章，
              文字印章让位（两者不叠加）；选「不盖章」则两者都不盖。图片只存本机，随本机备份搬运。</InfoI></small>
              <div className="seal-set">
                {foundry.sealImage
                  ? <img className="seal-img sm" src={foundry.sealImage} alt="印章预览" />
                  : <b className="seal-set-none">文字印章</b>}
                <div className="seal-set-act">
                  <Button size="sm" disabled={sealBusy} onClick={() => sealFileRef.current?.click()}>
                    {sealBusy ? <Spinner size={12} /> : null}
                    {foundry.sealImage ? "更换图片" : "上传图片"}
                  </Button>
                  {foundry.sealImage && <Button size="sm" onClick={removeSeal}>移除</Button>}
                </div>
              </div>
            </div>
            <input ref={sealFileRef} type="file" hidden
              accept="image/png,image/jpeg,image/webp" aria-label="上传印章图片"
              onChange={(e) => { void pickSeal(e.target.files?.[0] ?? null); e.target.value = ""; }} />
            {!foundry.name.trim() && (
              <p className="note">未填授权方名称时，授权书抬头会显示「（未设置授权方）」——
                不会回落成平台名。文书上出现平台名，等于用我们的名义替你做授权。</p>
            )}
            <Row label="存储方式">当前设备本地保存，随本机备份搬运</Row>
            <div className="panel-actions">
              <Button onClick={close}>取消</Button>
              <Button variant="primary" onClick={saveFoundry}>保存</Button>
            </div>
          </>
        );
      case "schemes":
        return (
          <>
            <Row label="说明">方案文案写进授权书「授权范围」小节；内置三项默认与桌面版逐字一致，改动只影响本机</Row>
            {schemes.map((s) => {
              const def = DEFAULT_SCHEMES.find((d) => d.key === s.key);
              const changed = !!def &&
                (s.label !== def.label || s.desc !== def.desc || s.scopeText !== def.scopeText);
              const referenced = schemeRefs.has(s.key);
              return (
                <div className="drow" key={s.key}>
                  {editKey === s.key ? (
                    <div className="picker-form" style={{ borderTop: 0, background: "none", padding: 0, width: "100%" }}>
                      <input className="line-input" value={editForm.label} placeholder="方案名称" autoFocus
                        onChange={(e) => setEditForm({ ...editForm, label: e.target.value })} aria-label="方案名称" />
                      <input className="line-input" value={editForm.desc} placeholder="一句话说明（签发页选择行显示）"
                        onChange={(e) => setEditForm({ ...editForm, desc: e.target.value })} aria-label="方案说明" />
                      <textarea className="textnote" style={{ minHeight: 88, marginTop: 12 }} rows={3}
                        value={editForm.scopeText} placeholder="授权范围条款全文（留空则授权书不渲染该小节）"
                        onChange={(e) => setEditForm({ ...editForm, scopeText: e.target.value })} aria-label="授权范围条款" />
                      <div className="picker-form-actions">
                        <Button size="sm" onClick={() => setEditKey(null)}>取消</Button>
                        <Button variant="primary" size="sm" onClick={saveEdit}>保存</Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", marginBottom: 7 }}>
                        <small style={{ marginBottom: 0 }}>
                          {s.label}
                          {!s.builtin && <span style={{ color: "var(--muted)" }}> · 自定义</span>}
                          {s.hidden && <span style={{ color: "var(--rust)" }}> · 已隐藏</span>}
                          <span style={{ color: "var(--muted)" }}> · {s.desc}</span>
                        </small>
                        <div className="row-acts">
                          {changed && <Button size="sm" onClick={() => restoreBuiltin(s.key)}>恢复默认</Button>}
                          {s.hidden && <Button size="sm" onClick={() => unhideScheme(s.key)}>恢复显示</Button>}
                          {!s.hidden && (
                            <button className="btn btn-icon" title="隐藏方案"
                              onClick={() => hideScheme(s.key)}>
                              <IconBan size={15} />
                            </button>
                          )}
                          {!s.builtin && !s.hidden && !referenced && (
                            <ConfirmButton label="" confirmLabel="确认删除" title="删除方案" danger
                              icon={<IconTrash size={15} />} onConfirm={() => deleteScheme(s.key)} />
                          )}
                          {!s.hidden && (
                            <button className="btn btn-icon" title="编辑方案"
                              onClick={() => openEdit(s)}>
                              <IconPencil size={15} />
                            </button>
                          )}
                        </div>
                      </div>
                      <b style={{ font: "400 13px/1.75 var(--sans)", color: s.hidden ? "var(--muted)" : "var(--sub)" }}>
                        {s.scopeText || "（未设授权范围条款——授权书不渲染该小节）"}
                        {s.hidden && "　隐藏后不再出现在签发选项；历史订单的授权书仍按此条款渲染。"}
                      </b>
                      {!s.builtin && referenced && !s.hidden && (
                        <span className="note">已有订单使用此方案——只能隐藏，不能删除（删除会让旧授权书失去条款）。</span>
                      )}
                    </>
                  )}
                </div>
              );
            })}

            {addOpen ? (
              <div className="picker-form" style={{ marginTop: 8 }}>
                <input className="line-input" value={addForm.label} placeholder="方案名称（如：展会授权）" autoFocus
                  onChange={(e) => setAddForm({ ...addForm, label: e.target.value })} aria-label="新方案名称" />
                <input className="line-input" value={addForm.desc} placeholder="一句话说明（选填）"
                  onChange={(e) => setAddForm({ ...addForm, desc: e.target.value })} aria-label="新方案说明" />
                <textarea className="textnote" style={{ minHeight: 88, marginTop: 12 }} rows={3}
                  value={addForm.scopeText} placeholder="授权范围条款全文（选填；留空则授权书不渲染该小节）"
                  onChange={(e) => setAddForm({ ...addForm, scopeText: e.target.value })} aria-label="新方案条款" />
                <div className="picker-form-actions">
                  <Button size="sm" onClick={() => { setAddOpen(false); setAddForm({ label: "", desc: "", scopeText: "" }); }}>取消</Button>
                  <Button variant="primary" size="sm" disabled={!addForm.label.trim()} onClick={addCustom}>创建方案</Button>
                </div>
              </div>
            ) : (
              <button className="picker-add" style={{ marginTop: 20 }} onClick={() => { setAddOpen(true); setEditKey(null); }}>
                <IconPlus size={14} />自定义方案
              </button>
            )}
            <div className="note" style={{ marginTop: 18 }}>
              隐藏 ≠ 删除：被历史订单引用的方案只能隐藏，条款文案保留供旧授权书渲染。
              方案只存本机，随「导出数据」搬运；云端订单不含授权方案。
            </div>
          </>
        );
      case "data":
        return (
          <>
            <BodyHead>本机数据 · 只在这台设备</BodyHead>
            <KV k="字体库" v={`${fontCount} 个文件`} />
            <KV k="客户库" v={`${customerCount} 位客户`} />
            <KV k="订单备注" v={`${noteCount} 条`} />
            <KV k="追溯历史" v={`${traceCount} 份报告`} />
            {/* 引导入口：清掉「已放过」的标记，并把用户直接送过去 —— 当初跳过的人、换设备的人
                都能再走一遍（用户 2026-09-18 口径：完成后从设置页可重新打开） */}
            <KV k="开始使用引导" v={
              <Link to="/welcome" className="kv-link" onClick={() => resetOnboarding()}>重新显示</Link>
            } />
            <div className="note">客户姓名、订单备注与追溯报告只在本机，云端没有这一项。</div>

            <BodyHead>云端登记 · 只有哈希与订单号</BodyHead>
            <KV k="字体登记" v={cloudFonts === null ? "—" : `${cloudFonts} 条`} />
            <KV k="订单" v={cloudOrders === null ? "—" : `${cloudOrders} 笔`} />
            <KV k={<>操作记录
              <InfoI>云端按设计不保存客户姓名与备注，也不保存字体文件本体 —— 所以这里永远没有「客户」这一项。
                关键操作在服务端留痕（仅限本人查阅、不可修改），完整记录随「导出数据」带走，这里只看条数。</InfoI>
            </>} v={`${audit.length} 条`} />

            <BodyHead>备份
              <InfoI>备份写入绑定的文件夹：typeflow-data.json（明文清单，含客户资料）+
                typeflow-fonts/（字体本体，添加时写入）。请放在你自己可控的位置（网盘 / 移动硬盘 / Time Machine）。
                换机或换浏览器后，绑定回这个文件夹即可读回字体名、客户与授权方案；也可以用「导出数据」出一个 zip。</InfoI>
            </BodyHead>
            <KV k="绑定文件夹"
              v={!fsSupported ? "浏览器不支持"
                : folderName ? `「${folderName}」`
                  : "未绑定"} />
            {fsSupported && folderPerm === "prompt" && (
              <div className="note" style={{ color: "var(--rust)" }}>本会话需要重新授权才能继续扫描与自动备份。</div>
            )}
            {fsSupported && (
              <div className="btn-row">
                {!folderName ? (
                  <Button variant="primary" size="sm" disabled={bkBusy2} onClick={() => void doBindFolder()}>绑定文件夹</Button>
                ) : folderPerm !== "granted" ? (
                  <Button variant="primary" size="sm" onClick={() => void doReauthFolder()}>重新授权</Button>
                ) : (
                  <>
                    <Button size="sm" disabled={scanBusy} onClick={() => void doScanFolder()}>
                      {scanBusy ? "扫描中…" : "扫描字体"}</Button>
                    <Button size="sm" disabled={bkBusy2} onClick={() => void doBackupNowFolder()}>
                      {bkBusy2 ? "备份中…" : "立即备份"}</Button>
                    <Button size="sm" onClick={() => void doUnbindFolder()}>解除绑定</Button>
                  </>
                )}
              </div>
            )}
            {fsSupported && folderName && lastFolderBk && folderPerm === "granted" && (
              <div className="note">上次自动备份 {new Date(lastFolderBk).toLocaleString("zh-CN")}</div>
            )}

            <BodyHead>导出 / 导入
              <InfoI>一个 zip 文件带走两段：本机段（客户 / 厂牌 / 字体清单 / 订单备注，可再导入恢复）
                + 云端段（账号 / 字体登记 / 订单配方 / 审计，只读凭证）。导入兼容 zip 与旧版 JSON。</InfoI>
            </BodyHead>
            <div className="btn-row">
              <Button variant="primary" size="sm" disabled={bkBusy} onClick={() => void doExport()}>导出数据</Button>
              <Button size="sm" disabled={bkBusy} onClick={() => importInputRef.current?.click()}>导入数据</Button>
              {canUndo && (
                <Button size="sm" disabled={bkBusy} onClick={() => void doUndoImport()}>撤销上次导入</Button>
              )}
              <input ref={importInputRef} type="file" accept=".zip,.json,application/zip,application/json" hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void doImport(f); e.target.value = ""; }} />
            </div>

            <BodyHead>危险操作</BodyHead>
            <div className="note">清除后本机数据不可恢复；云端订单与字体登记不受影响。</div>
            <div className="btn-row">
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
      case "account":
        return (
          <>
            <Row label="邮箱验证">
              {emailVerified === true
                ? "已验证"
                : emailVerified === false
                  ? "未验证——签发前需要先验证邮箱"
                  : "—"}
            </Row>
            <div className="btn-row">
              <Button size="sm" disabled={mailBusy} busy={mailBusy}
                onClick={() => void doResendVerification()}>
                重新发送验证邮件
              </Button>
            </div>

            <Row label="条款">已确认《用户协议》与《隐私政策》 · <a href="/terms" target="_blank" rel="noreferrer">查看全文</a></Row>

            <BodyHead>数据可携</BodyHead>
            <div className="note">全部数据可从一个文件带走，入口在「数据与备份 → 导出数据」。</div>

            <BodyHead>危险操作</BodyHead>
            <div className="note">
              注销不可恢复：删除全部云端数据（字体登记、订单、审计与本账号）；
              字体文件本体因从未上传而不受影响。
            </div>
            {!showDelInput ? (
              <div className="btn-row">
                <Button size="sm" onClick={() => setShowDelInput(true)}>注销账号…</Button>
              </div>
            ) : (
              <>
                <div className="drow">
                  <small>输入登录密码确认（此操作不可撤销）</small>
                  <input className="q" type="password" value={delPass} placeholder="登录密码"
                    onChange={(e) => setDelPass(e.target.value)} aria-label="确认密码" />
                </div>
                <div className="btn-row">
                  <Button size="sm" onClick={() => { setShowDelInput(false); setDelPass(""); }}>取消</Button>
                  <Button variant="danger" size="sm"
                    disabled={busy || !delPass} onClick={() => void doDeleteAccount()}>
                    永久删除我的账号</Button>
                </div>
              </>
            )}
          </>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <PageHeader title="设置" sub="配置厂牌信息、授权方案、本地数据与密钥。" />

      {/* 线性分组行：点击条目 → 就地向下展开（右侧箭头指示展开/收起） */}
      <div className="settings">
        {ITEM_META.map((m) => {
          const open = openItem === m.key;
          return (
            <div className={`setting-item${open ? " open" : ""}`} key={m.key}>
              <button className="setting" aria-expanded={open}
                onClick={() => setOpenItem(open ? null : m.key)}>
                <span className="setting-text">
                  <b>{m.title}</b>
                  <small>{m.desc}</small>
                </span>
                <IconChevron size={16} className="setting-chev" />
              </button>
              <AccordionPanel open={open}>
                <div className="setting-body">{renderBody(m.key)}</div>
              </AccordionPanel>
            </div>
          );
        })}
      </div>
    </>
  );
}
