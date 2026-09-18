/**
 * 开始使用 —— 首次登录的五步引导（独立页 /welcome）
 *
 * 形态：五步纵向列表，**当前步就地展开**它的操作区（复用设置页 `.settings` / `.setting-item`
 * 那一族语言，不发明新页型），底部「上一步 / 下一步 / 跳过引导」。
 *
 * 判定与出口（用户 2026-09-18 拍板）：
 *   · 「首次」以**首次登录**为准：登录/注册成功后若引导没放过，就进这一页（见 pages/Login.tsx）。
 *   · 每步的完成状态**从真实数据现算**（lib/onboarding.ts），所以在别处做完的事回到这里会自动打勾 ——
 *     不需要另存一份进度（存了就会不同步）。
 *   · 出口不止"一路做完"：跳过会写标记不再自动出现，设置页保留「重新显示引导」入口。
 *
 * 为什么前两步是「验证邮箱」与「绑定文件夹」：前者是签发的硬闸门（未验证会被 403 挡住），
 * 后者决定备份与字体来源 —— 两件都不做，用户会在最后一步撞墙、或者第一单的交付物不完整。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiAuth, getEmailVerified, setEmailVerified } from "../api/client";
import {
  allStepsDone, dismissOnboarding, readStartSteps, type StartKey, type StartStep,
} from "../lib/onboarding";
import { bindFolderAndRestore, finishRestore } from "../lib/restore";
import { importFontDetail, importFontFile } from "../lib/fontImport";
import { getFolderHandle, isFsaSupported, scanFontFolder } from "../lib/fsFolder";
import { readFoundry, writeFoundry } from "../lib/foundry";
import { toast } from "../lib/toast";
import { AccordionPanel, Button, PageHeader, Spinner } from "../components/ui";
import { IconChevron } from "../components/Icon";

/** 五步的静态文案（动态现状在 lib/onboarding.ts 的 detail 里） */
const STEP_TEXT: Record<StartKey, { title: string; desc: string }> = {
  verify: { title: "验证邮箱", desc: "验证邮件会发到你的注册邮箱，点邮件里的链接即完成" },
  folder: { title: "绑定本地文件夹", desc: "数据变更时自动把清单写进它；字体也能从这里扫描入库" },
  font: { title: "添加第一款字体", desc: "字体文件与字体名只存在这台设备上" },
  licensor: { title: "填写授权方", desc: "授权书的抬头、落款与印章都读它" },
  issue: { title: "签发第一单", desc: "客户、授权范围与期限在签发页填写" },
};

/** 步骤顺序（唯一来源）—— 与 onboarding.ts 的 key 一一对应 */
const STEP_ORDER: StartKey[] = ["verify", "folder", "font", "licensor", "issue"];

export default function Welcome() {
  const navigate = useNavigate();
  const [steps, setSteps] = useState<StartStep[] | null>(null);
  /** 当前展开的步；null = 全部收起（全做完了） */
  const [open, setOpen] = useState<number | null>(null);
  /** 用户是否手动点过步骤行 —— 点过之后不再自动跳到"第一个未完成" */
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState("");
  const [folderName, setFolderName] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", short: "", site: "" });
  const fontRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setSteps(await readStartSteps());
    const h = await getFolderHandle().catch(() => null);
    setFolderName(h?.name ?? null);
  }, []);

  useEffect(() => {
    void (async () => {
      const f = readFoundry();
      setForm({ name: f.name, short: f.short, site: f.site });
      await refresh();
    })();
  }, [refresh]);

  /** 数据到手后定位到**第一个未完成**的步骤（用户手动点过就不抢） */
  useEffect(() => {
    if (touched || !steps) return;
    const i = steps.findIndex((s) => !s.done);
    setOpen(i >= 0 ? i : null);
  }, [steps, touched]);

  const stepOf = (k: StartKey) => steps?.find((s) => s.key === k);
  const doneCount = steps?.filter((s) => s.done).length ?? 0;

  const leave = (to: string) => {
    dismissOnboarding();
    navigate(to, { replace: true });
  };

  /* ── 各步的就地操作 ── */

  /** 第 1 步：发验证邮件。已验证时服务端只会回 already_verified（不再发信），顺手把陈旧状态同步过来 */
  const doVerify = async () => {
    setBusy("verify");
    try {
      const r = await apiAuth.resendVerification();
      if (r.already_verified) {
        setEmailVerified(true);
        toast.success("邮箱已验证", { detail: "签发不会再被挡住" });
      } else {
        toast.success("验证邮件已发出", { detail: "点邮件里的链接即完成；回来后点同名的按钮可同步状态" });
      }
      await refresh();
    } catch (e) {
      toast.error("发信失败", { detail: (e as Error).message });
    } finally {
      setBusy("");
    }
  };

  /** 第 2 步：绑定文件夹（复用 lib/restore 里那一处 —— 含"先探旧备份"的安全线） */
  const doBind = async () => {
    setBusy("folder");
    try {
      const r = await bindFolderAndRestore();
      if (r.restored) {
        // 接回了旧备份：结果经 sessionStorage 传递（reload 会清页面状态）
        finishRestore(r.restored);
        return;
      }
      toast.success(`已绑定「${r.name}」`, { detail: "之后数据变更会自动备份；换设备时在同一个文件夹上绑定即可接回" });
      await refresh();
    } catch (e) {
      const msg = (e as Error).message;
      if (msg && !msg.includes("abort")) toast.error("绑定失败", { detail: msg });
    } finally {
      setBusy("");
    }
  };

  /** 第 3 步：添加字体（入库逻辑在 lib/fontImport —— 与字体库页同一处） */
  const doImport = async (f: File | null) => {
    if (!f) return;
    setBusy("font");
    try {
      const r = await importFontFile(f);
      toast.success(`已存入本机：${f.name}`, { detail: importFontDetail(r) });
      await refresh();
    } catch (e) {
      toast.error("存入本机失败", { detail: (e as Error).message });
    } finally {
      setBusy("");
      if (fontRef.current) fontRef.current.value = "";
    }
  };

  /** 第 3 步的另一条路：从已绑定的文件夹扫描 */
  const doScan = async () => {
    setBusy("scan");
    try {
      const r = await scanFontFolder();
      toast.success(r.added.length > 0 ? `新增 ${r.added.length} 个字体` : "文件夹内没有新字体", {
        detail: `共 ${r.total} 个字体文件，${r.skipped} 个已存在`,
      });
      await refresh();
    } catch (e) {
      toast.error("扫描失败", { detail: (e as Error).message });
    } finally {
      setBusy("");
    }
  };

  /** 第 4 步：授权方（只做基础三项；官网与印章图片在设置页） */
  const doSaveFoundry = () => {
    const name = form.name.trim();
    if (!name) { toast.warn("请先填写授权方名称"); return; }
    try {
      writeFoundry({ name, short: form.short.trim(), site: form.site.trim() });
    } catch (e) {
      toast.error("未能保存", { detail: (e as Error).message });
      return;
    }
    toast.success("已保存（本机）", { detail: "授权书抬头、落款与印章都会读它" });
    void refresh();
  };

  /* ── 渲染 ── */

  const bodyOf = (k: StartKey, s: StartStep | undefined) => {
    if (k === "verify") {
      return (
        <>
          <p className="note">
            验证邮件里有一条链接，点开即完成。如果已经点过，再点一次下面的按钮只会同步状态 —— 不会重复发信。
          </p>
          <div className="btn-row">
            <Button size="sm" variant={s?.done ? "secondary" : "primary"} disabled={busy === "verify"}
              onClick={() => void doVerify()}>
              {busy === "verify" ? <Spinner size={12} /> : null}
              {s?.done ? "同步验证状态" : "发验证邮件"}
            </Button>
            {s?.done && <span className="welcome-ok">已完成</span>}
          </div>
        </>
      );
    }

    if (k === "folder") {
      if (!isFsaSupported()) {
        return (
          <>
            <p className="note">
              这个浏览器不支持直接绑定文件夹。同一个备份也可以走「导出 / 导入」：
              在设置页 →「数据与备份」里导出一份 zip，随时能再导入回来。
            </p>
            <div className="btn-row">
              <Button size="sm" onClick={() => leave("/settings")}>去设置页</Button>
            </div>
          </>
        );
      }
      return (
        <>
          <p className="note">
            文件夹里会写入一份清单和字体本体，之后由你自己的工具（网盘 / 移动硬盘）保管。
            换设备时在同一个文件夹上再绑一次，本机数据就回来了。
          </p>
          <div className="btn-row">
            <Button size="sm" variant={s?.done ? "secondary" : "primary"} disabled={busy === "folder"}
              onClick={() => void doBind()}>
              {busy === "folder" ? <Spinner size={12} /> : null}
              {folderName ? `更换文件夹（当前「${folderName}」）` : "选择文件夹"}
            </Button>
          </div>
        </>
      );
    }

    if (k === "font") {
      return (
        <>
          <input ref={fontRef} type="file" hidden accept=".ttf,.otf,font/ttf,font/otf" aria-label="选择字体文件"
            onChange={(e) => void doImport(e.target.files?.[0] ?? null)} />
          <p className="note">
            选一个 TTF / OTF 文件即可入库 —— 文件在本机读取、在本机计算哈希，版本从此锁定（同名换版会作为新字体登记）。
          </p>
          <div className="btn-row">
            <Button size="sm" variant={s?.done ? "secondary" : "primary"} disabled={busy !== ""}
              onClick={() => fontRef.current?.click()}>
              {busy === "font" ? <Spinner size={12} /> : null}
              选择字体文件
            </Button>
            {folderName && (
              <Button size="sm" disabled={busy !== ""} onClick={() => void doScan()}>
                {busy === "scan" ? <Spinner size={12} /> : null}
                从「{folderName}」扫描
              </Button>
            )}
          </div>
        </>
      );
    }

    if (k === "licensor") {
      return (
        <>
          <div className="drow"><small>授权方名称</small>
            <input className="q" value={form.name} placeholder="如：云间字库" aria-label="引导·授权方名称"
              onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="drow"><small>授权方简称</small>
            <input className="q" value={form.short} placeholder="如：云间（用于文字印章）" aria-label="引导·授权方简称"
              onChange={(e) => setForm({ ...form, short: e.target.value })} /></div>
          <div className="drow"><small>官网地址</small>
            <input className="q" value={form.site} placeholder="https://…（选填）" aria-label="引导·官网地址"
              onChange={(e) => setForm({ ...form, site: e.target.value })} /></div>
          <div className="btn-row">
            <Button size="sm" variant="primary" onClick={doSaveFoundry}>保存</Button>
          </div>
          <p className="note">印章图片（上传公章替代文字印）在设置页 →「厂牌信息」里。</p>
        </>
      );
    }

    // issue
    const blocked = !stepOf("verify")?.done || !stepOf("font")?.done;
    return (
      <>
        <p className="note">
          签发会一次走完五步：登记哈希 → 创建订单 → 取云端配方 → 本机嵌入水印 → 提交回执。
          字体全程不出本机；授权书与交付包在签发完成后立即生成。
        </p>
        {blocked && (
          <p className="note">
            还差前面两步（邮箱验证 / 添加字体）—— 没做完的话，签发会被挡回来。
          </p>
        )}
        <div className="btn-row">
          <Button size="sm" variant="primary" onClick={() => leave("/issue")}>去签发</Button>
        </div>
      </>
    );
  };

  const allDone = steps ? allStepsDone(steps) : false;

  return (
    <>
      <PageHeader
        title="开始使用"
        sub="五步把工作台准备好。之后随时可以从设置页 →「数据与备份」重新打开这份引导。"
      />

      {!steps ? (
        <div className="loading-block"><Spinner />载入本机状态…</div>
      ) : (
        <>
          <div className="settings">
            {STEP_ORDER.map((k, i) => {
              const s = stepOf(k);
              const text = STEP_TEXT[k];
              const isOpen = open === i;
              return (
                <div className={"setting-item" + (isOpen ? " open" : "")} key={k}>
                  <button className="setting" aria-expanded={isOpen}
                    onClick={() => { setTouched(true); setOpen(isOpen ? null : i); }}>
                    <span className={"step-mark" + (s?.done ? " done" : "")}>{s?.done ? "✓" : i + 1}</span>
                    <span className="setting-text">
                      <b>{text.title}</b>
                      <small>{s?.detail} · {text.desc}</small>
                    </span>
                    <IconChevron size={16} className="setting-chev" />
                  </button>
                  <AccordionPanel open={isOpen}>
                    <div className="setting-body">{bodyOf(k, s)}</div>
                  </AccordionPanel>
                </div>
              );
            })}
          </div>

          <div className="welcome-foot">
            <Button size="sm" disabled={open === null || open === 0}
              onClick={() => { setTouched(true); setOpen(Math.max(0, (open ?? 0) - 1)); }}>
              上一步
            </Button>
            {open === STEP_ORDER.length - 1 ? (
              <Button size="sm" variant="primary" onClick={() => leave("/")}>完成</Button>
            ) : (
              <Button size="sm" disabled={open === null}
                onClick={() => { setTouched(true); setOpen(Math.min(STEP_ORDER.length - 1, (open ?? 0) + 1)); }}>
                下一步
              </Button>
            )}
            <span className="welcome-progress">{doneCount} / {STEP_ORDER.length} 已完成{allDone ? " · 都好了" : ""}</span>
            <button className="kv-link" onClick={() => leave("/")}>跳过引导</button>
          </div>
        </>
      )}
    </>
  );
}
