/**
 * 签发页 —— 左表单 + 右文书（Navy 风格 · 对标原型 v9）
 *
 * 左侧：inline picker 式表单（客户 → 字体 → 授权方案 → 期限 → 价格 → 备注）
 *   三个选择项一律「点条目 → 就地向下展开」（右侧箭头指示展开/收起），
 *   展开体里可直接新建客户、导入本机字体，不必先离开本页。
 * 右侧：仿纸面授权书实时预览，填写时即更新，滚动吸附（sticky）
 *
 * 点击【签发】触发真实 issueOne() 五步流程（登记→订单→配方→本地嵌入→回执），
 * 进度条显示在表单下方；完成后右侧文书补齐订单号与双 SHA，
 * 可下载水印字体 / 打印授权书。字体本体始终不出本机。
 *
 * 排版：每个模块 = .issue-field（组间距 24px），控件自身不带 margin，
 * 行距只有一个决定点（theme-v9-ext.css）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { listLocalFonts, saveLocalFont, sha256Of, type LocalFont } from "../lib/localFonts";
import { listCustomers, saveCustomer, genCustomerId, type Customer } from "../lib/localCustomers";
import { invalidateFontFace } from "../lib/fontFace";
import { maybeFolderBackup } from "../lib/backupFolder";
import { issueOne, PHASE_LABEL, type IssueOutcome, type IssuePhase } from "../lib/issueFlow";
import { readFoundry, type Foundry } from "../lib/foundry";
import { durationText, termForMonths, type LicenseData } from "../lib/license";
import { toast } from "../lib/toast";
import IssueResult, { IssueDeliveries } from "../components/IssueResult";
import LicensePaper from "../components/LicensePaper";
import FontPicker from "../components/FontPicker";
import { assertSupportedTtf } from "@engine/ttf/reader.js";
import { visibleSchemes, schemeLabel } from "../lib/schemes";
import { AccordionPanel, Button, PageHeader, Spinner } from "../components/ui";
import { IconChevron, IconPencil, IconPlus } from "../components/Icon";
import NetLog from "../components/NetLog";

/**
 * 授权期限 = 选「时长」，不是填起止日期（2026-09-17 用户口径）。
 * 起算点固定是签发当天，用户只需要回答「授权多久」；到期日由 termForMonths() 算出来，
 * 在下拉里直接显示（省得心算），文书里仍是具体日期。
 * months = null 表示没有到期日（永久），签发时两个字段都不写。
 */
type TermOption = { key: string; label: string; desc: string; months: number | null };
const TERM_OPTIONS: TermOption[] = [
  { key: "permanent", label: "永久", desc: "不设到期日", months: null },
  { key: "12", label: "1 年", desc: "", months: 12 },
  { key: "18", label: "1 年 6 个月", desc: "", months: 18 },
  { key: "24", label: "2 年", desc: "", months: 24 },
  { key: "36", label: "3 年", desc: "", months: 36 },
  { key: "60", label: "5 年", desc: "", months: 60 },
  { key: "custom", label: "自定义时长", desc: "按年 / 月指定", months: null },
];

export default function Issue() {
  const [localFonts, setLocalFonts] = useState<Array<Omit<LocalFont, "data">>>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [foundry, setFoundry] = useState<Foundry>({ name: "", short: "", site: "", seal: "round" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<IssueOutcome | null>(null);
  const [phase, setPhase] = useState<IssuePhase | null>(null);
  const [phaseDone, setPhaseDone] = useState(false);

  // 表单
  const [clientRef, setClientRef] = useState("");
  const [clientId, setClientId] = useState("");
  const [fontId, setFontId] = useState<string | null>(null);
  const [licenseType, setLicenseType] = useState("enterprise");
  const [termKey, setTermKey] = useState("permanent");
  /** **已确定**的自定义时长（年 / 月）—— 只有 termKey === "custom" 时才会被读 */
  const [termYears, setTermYears] = useState("");
  const [termMonths, setTermMonths] = useState("");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");

  // 内联选择面板（同时只展开一个）
  const [openPicker, setOpenPicker] = useState<"customer" | "font" | "license" | "term" | "note" | null>(null);

  // 展开体里的两个入口：新建客户 / 导入字体
  const [clientFormOpen, setClientFormOpen] = useState(false);
  const [clientForm, setClientForm] = useState({ name: "", email: "" });
  const [clientBusy, setClientBusy] = useState(false);
  const [fontBusy, setFontBusy] = useState(false);

  /**
   * 「自定义时长」要第二拍：**点选不收起，填完年 / 月按「确定」才生效**。
   * 所以输入框读写的是**草稿**（termDraft），已确定的年 / 月另存一份 state ——
   * 否则「已经是自定义、再回来编辑」时，改一下输入框就直接改了生效值，「取消」根本无从回滚
   * （E2E 抓到过：取消后期限仍变成 9 年）。取消 / 点别处 = 丢弃草稿，生效值分毫未动。
   */
  const [termDraft, setTermDraft] = useState<{ y: string; m: string } | null>(null);

  const togglePicker = (k: "customer" | "font" | "license" | "term" | "note") => {
    if (openPicker === k) setClientFormOpen(false);   // 收起时把内联新建表单复位
    const next = openPicker === k ? null : k;
    if (next !== "term") setTermDraft(null);          // 离开期限面板 = 丢弃尚未确定的自定义草稿
    setOpenPicker(next);
  };

  const load = useCallback(async () => {
    // 厂牌（授权方）也在这里读：从设置页改完厂牌回到本页，文书抬头即更新
    setFoundry(readFoundry());
    try {
      const [lf, cs] = await Promise.all([listLocalFonts(), listCustomers()]);
      setLocalFonts(lf);
      setCustomers(cs);
    } catch (e) {
      toast.error("数据加载失败", { detail: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /* 字体库「签发」跳转预选（原型 prefill 行为） */
  const location = useLocation();
  useEffect(() => {
    const fid = (location.state as { fontId?: string } | null)?.fontId;
    if (fid) setFontId(fid);
  }, [location.state]);

  const selFont = useMemo(
    () => localFonts.find((f) => f.id === fontId) ?? null,
    [localFonts, fontId],
  );

  const typeLabel = schemeLabel(licenseType);

  /**
   * 期限时长（月）。null = 永久（不写到期的两个字段）。
   * 「自定义时长」是把年 / 月两个输入折成月数：18 个月 → 1 年 6 个月，
   * 不必让用户自己换算成天数或去挑日期。
   */
  /** 已确定的自定义月数 —— 签发、选择行、文书都只认它 */
  const committedMonths = (): number =>
    (parseInt(termYears, 10) || 0) * 12 + (parseInt(termMonths, 10) || 0);

  /** 输入框当前显示的月数：编辑中读草稿，不在编辑时回落到已确定值 */
  const draftMonths = (): number => termDraft
    ? (parseInt(termDraft.y, 10) || 0) * 12 + (parseInt(termDraft.m, 10) || 0)
    : committedMonths();

  const termMonthsTotal = (): number | null => {
    if (termKey === "permanent") return null;
    if (termKey === "custom") return committedMonths() > 0 ? committedMonths() : null;
    return TERM_OPTIONS.find((o) => o.key === termKey)?.months ?? null;
  };

  /** 选择行上显示的期限文案（文书里另有具体起止日期） */
  const termText = (): string => {
    if (termKey === "custom") {
      const total = termMonthsTotal();
      return total == null ? "自定义时长" : durationText(total);
    }
    return TERM_OPTIONS.find((o) => o.key === termKey)?.label ?? "永久";
  };

  /** 各档位/自定义的到期日预览文案 —— 让「1 年 6 个月」落成一个能对上的日子 */
  const endPreview = (months: number | null): string => {
    if (months == null || months <= 0) return "";
    return new Date(termForMonths(months).licenseEnd as number).toLocaleDateString("sv-SE");
  };

  const termMs = (): { licenseStart?: number; licenseEnd?: number } => termForMonths(termMonthsTotal());

  /** 改输入框 = 只改草稿（初值取已确定值，所以「已是自定义」再进来能接着改） */
  const editDraft = (patch: Partial<{ y: string; m: string }>) =>
    setTermDraft((d) => ({ y: termYears, m: termMonths, ...d, ...patch }));

  /** 「确定」= 草稿落成生效值，并收起面板 */
  const confirmCustom = () => {
    const d = termDraft ?? { y: termYears, m: termMonths };
    setTermYears(d.y);
    setTermMonths(d.m);
    setTermKey("custom");
    setTermDraft(null);
    setOpenPicker(null);
  };

  /** 「取消」= 丢弃草稿；点别处（togglePicker 里）走的是同一条路 */
  const cancelCustom = () => { setTermDraft(null); setOpenPicker(null); };

  const termReady = termKey === "permanent" || termMonthsTotal() != null;
  const canIssue = !busy && !!fontId && termReady;

  /**
   * 文书数据 —— 屏幕预览与交付包里那份 PDF 的唯一来源。
   * 未签发时字段为空串，由 licenseFields() 统一给占位，所以填表时右侧就是
   * 「客户拿到手的那一份」的实时样子，而不是另一套排版。
   */
  const licenseData: LicenseData = useMemo(() => ({
    orderId: outcome?.orderId ?? "",
    fontName: selFont?.name ?? "",
    licensor: foundry,
    licensee: clientRef,
    licenseType,
    ...(outcome ? { licenseStart: outcome.licenseStart, licenseEnd: outcome.licenseEnd } : termMs()),
    amount: price.trim() || undefined,
    issuedAt: outcome?.issuedAt ?? "",
    fontSha256: outcome?.sign.fontSha256 ?? "",
    watermarkedSha256: outcome?.sign.watermarkedSha256 ?? "",
  }), [outcome, selFont, foundry, clientRef, licenseType, price, termKey, termYears, termMonths]);

  /** 展开体里新建客户（只存本机；云端订单仍只带不透明 client_id） */
  const createClient = async () => {
    const name = clientForm.name.trim();
    if (!name) { toast.warn("请先填写客户名"); return; }
    setClientBusy(true);
    try {
      const now = Date.now();
      const c: Customer = {
        id: genCustomerId(), name,
        email: clientForm.email.trim() || undefined,
        createdAt: now, updatedAt: now,
      };
      await saveCustomer(c);
      maybeFolderBackup();
      setCustomers((prev) => [c, ...prev]);
      setClientRef(name);
      setClientId(c.id);
      setClientForm({ name: "", email: "" });
      setClientFormOpen(false);
      setOpenPicker(null);
      toast.success(`已新建客户：${name}`, { detail: "客户资料只存本机，不上云" });
    } catch (e) {
      toast.error("新建客户失败", { detail: (e as Error).message });
    } finally {
      setClientBusy(false);
    }
  };

  /** 展开体里导入本机字体（与字体库同一条路径：本体只进 IndexedDB，不联网） */
  const importFont = async (f: File | null) => {
    if (!f) return;
    setFontBusy(true);
    try {
      const buf = await f.arrayBuffer();
      assertSupportedTtf(new Uint8Array(buf));   // OTF/CFF 拒之门外（人话文案）
      const sha = await sha256Of(buf);
      const id = sha.slice(0, 16);
      await saveLocalFont({
        id,
        name: f.name.replace(/\.(ttf|otf|woff2?)$/i, ""),
        filename: f.name, sha256: sha, glyphCount: 0, size: f.size,
        savedAt: Date.now(), data: buf,
      });
      invalidateFontFace(id);
      maybeFolderBackup();
      await load();
      setFontId(id);            // 导入即选中：少一步
      setOpenPicker(null);
      toast.success(`已导入本机：${f.name}`, { detail: "未上传、未同步——只保存在你的浏览器里" });
    } catch (e) {
      toast.error("导入字体失败", { detail: (e as Error).message });
    } finally {
      setFontBusy(false);
    }
  };

  /** 触发真实签发流程 */
  const startIssue = async () => {
    if (!selFont) return;
    setBusy(true);
    setPhase(null);
    setPhaseDone(false);
    setOpenPicker(null);
    try {
      const out = await issueOne(
        selFont,
        {
          clientRef: clientRef.trim() || undefined,
          // 勾选了客户库里的客户才带 client_id；手工输入的名字只写授权书抬头，不上云
          clientId: clientId || undefined,
          licenseType, ...termMs(),
          amount: price.trim() || undefined, note: note.trim() || undefined,
        },
        setPhase,
      );
      setOutcome(out);
      setPhaseDone(true);
      toast.success(`${out.orderId} 签发完成`, { detail: "水印字体已在本机生成，可在右侧预览并下载" });
      await load();
    } catch (e) {
      toast.error("签发失败", { detail: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  /**
   * 过程槽的日志行：已推进到的阶段依次列出（最后一条由 ProcessSlot 标成"当前行"）。
   * 五步走完就不再追加 —— 槽切到 done 态，同一位置换成交付动作。
   */
  const procLines = useMemo(() => {
    const all = PHASE_LABEL.map((p) => p.label);
    if (phaseDone) return all;
    const i = phase ? PHASE_LABEL.findIndex((p) => p.phase === phase) : -1;
    return i >= 0 ? all.slice(0, i + 1) : [];
  }, [phase, phaseDone]);

  return (
    <>
      <PageHeader
        title="签发"
        sub="选字体 → 填客户与授权方案 → 右侧实时预览授权书 → 签发。字体全程不出本机。"
      />

      <div className="issue-layout">
        {/* ── 左：表单（原型 v9 pick / money / textnote；选择项就地向下展开） ── */}
        <section>
          {/* 选择客户 */}
          <div className="issue-field">
            <button className={`pick${clientRef ? "" : " empty"}`}
              aria-expanded={openPicker === "customer"}
              onClick={() => togglePicker("customer")}>
              <span className="pick-text">
                <small>签发给</small>
                <b>{clientRef || "选择客户"}</b>
              </span>
              <IconChevron size={16} className="pick-chev" />
            </button>
            <AccordionPanel open={openPicker === "customer"}>
              <div className="picker-panel">
                {/* 直接填写抬头（不建档）：与列表并列，避免同一个客户名在页面上出现两遍 */}
                <div className="picker-manual">
                  <div className="field-label">或直接填写抬头（不建档）</div>
                  <input
                    className="line-input"
                    value={clientRef}
                    onChange={(e) => { setClientRef(e.target.value); setClientId(""); }}
                    placeholder="客户 / 公司名（写入授权书抬头）"
                    aria-label="被授权方名称"
                  />
                </div>
                <div className="picker-scroll">
                  {customers.length === 0 ? (
                    <div className="picker-empty">客户库为空 —— 可在下方新建，或直接填写抬头。</div>
                  ) : (
                    customers.map((c) => (
                      <div key={c.id} className="picker-item" role="button" tabIndex={0}
                        onClick={() => { setClientRef(c.name); setClientId(c.id); setOpenPicker(null); }}>
                        <span className="picker-item-t">{c.name}</span>
                        {c.email && <span className="picker-item-s mono">{c.email}</span>}
                      </div>
                    ))
                  )}
                </div>

                {/* 新建客户：就地展开小表单，不弹窗 */}
                {!clientFormOpen ? (
                  <button className="picker-add" onClick={() => setClientFormOpen(true)}>
                    <IconPlus size={14} />新建客户
                  </button>
                ) : (
                  <div className="picker-form">
                    <input className="line-input" value={clientForm.name} placeholder="客户 / 公司名" autoFocus
                      onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })} aria-label="新客户名称" />
                    <input className="line-input" value={clientForm.email} placeholder="联系方式（选填）"
                      onChange={(e) => setClientForm({ ...clientForm, email: e.target.value })} aria-label="新客户联系方式" />
                    <div className="picker-form-actions">
                      <Button size="sm"
                        onClick={() => { setClientFormOpen(false); setClientForm({ name: "", email: "" }); }}>取消</Button>
                      <Button variant="primary" size="sm" disabled={clientBusy || !clientForm.name.trim()}
                        onClick={() => void createClient()}>
                        {clientBusy ? <Spinner size={12} /> : null}创建客户
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </AccordionPanel>
          </div>

          {/* 选择字体 */}
          <div className="issue-field">
            <button className={`pick${selFont ? "" : " empty"}`}
              aria-expanded={openPicker === "font"}
              onClick={() => togglePicker("font")}>
              <span className="pick-text">
                <small>授权字体</small>
                <b>{selFont ? selFont.name : localFonts.length ? "选择字体" : "本机库为空"}</b>
              </span>
              <IconChevron size={16} className="pick-chev" />
            </button>
            <AccordionPanel open={openPicker === "font"}>
              <FontPicker
                fonts={localFonts} loading={loading} busy={fontBusy}
                onPick={(id) => { setFontId(id); setOpenPicker(null); }}
                onImport={(f) => void importFont(f)}
              />
            </AccordionPanel>
          </div>

          {/* 授权范围 + 授权期限 —— **同行两栏**（.issue-pair）
              两者都是「这份授权的限定条件」，拼一行省下约 110px，填写顺序不变；
              两个展开体各自跨满两栏，选项文字不会被压窄。 */}
          <div className="issue-field issue-pair">
            {/* 授权范围（设置页可编辑增删，这里跟 lib/schemes.ts 实时同步） */}
            <button className="pick"
              aria-expanded={openPicker === "license"}
              onClick={() => togglePicker("license")}>
              <span className="pick-text">
                <small>授权范围</small>
                <b>{typeLabel}</b>
              </span>
              <IconChevron size={16} className="pick-chev" />
            </button>

            {/* 授权期限：选「多久」，不是选日期 —— 起算点固定 = 签发当天（用户口径 2026-09-17） */}
            <button className="pick"
              aria-expanded={openPicker === "term"}
              onClick={() => togglePicker("term")}>
              <span className="pick-text">
                <small>授权期限</small>
                <b>{termText()}</b>
              </span>
              <IconChevron size={16} className="pick-chev" />
            </button>

            <AccordionPanel open={openPicker === "license"}>
              <div className="license-list">
                {visibleSchemes().map((o) => (
                  <label key={o.key} className={`license-row${licenseType === o.key ? " active" : ""}`}>
                    <input type="radio" name="license" value={o.key} checked={licenseType === o.key}
                      onChange={() => { setLicenseType(o.key); setOpenPicker(null); }} />
                    <span style={{ flex: 1 }}>
                      <span className="license-row-t">{o.label}</span>
                      <span className="license-row-s">{o.desc}</span>
                    </span>
                    {licenseType === o.key && <span className="license-row-dot" />}
                  </label>
                ))}
              </div>
            </AccordionPanel>

            <AccordionPanel open={openPicker === "term"}>
              {/* 每档直接把到期日算出来写在下面：选「1 年 6 个月」时不用自己心算到哪天。
                  预设档点选即收起（与「授权范围」一致）；只有「自定义时长」留在展开态 ——
                  后面还有年 / 月要填，填完按「确定」才生效、才收起。 */}
              <div className="license-list">
                {TERM_OPTIONS.map((o) => {
                  const isCustom = o.key === "custom";
                  // 编辑自定义期间，高亮跟着「自定义时长」走，预设档不再抢高亮
                  const active = isCustom
                    ? termKey === "custom" || termDraft !== null
                    : termKey === o.key && termDraft === null;
                  const end = endPreview(isCustom
                    ? (termDraft !== null || termKey === "custom" ? draftMonths() : 0)
                    : o.months);
                  return (
                    <label key={o.key} className={`license-row${active ? " active" : ""}`}>
                      <input type="radio" name="term" value={o.key} checked={active}
                        onChange={() => {
                          if (isCustom) {
                            // 不收起：下面要填年 / 月。草稿以已确定值为初值，点第二次不会重置已填内容
                            setTermDraft((d) => d ?? { y: termYears, m: termMonths });
                          } else {
                            setTermKey(o.key); setTermDraft(null); setOpenPicker(null);
                          }
                        }} />
                      <span style={{ flex: 1 }}>
                        <span className="license-row-t">{o.label}</span>
                        <span className="license-row-s">{end ? `至 ${end}` : o.desc}</span>
                      </span>
                      {active && <span className="license-row-dot" />}
                    </label>
                  );
                })}
                {(termDraft !== null || termKey === "custom") && (
                  <div className="picker-form">
                    <div className="term-custom">
                      <input className="line-input" inputMode="numeric" placeholder="0"
                        value={termDraft ? termDraft.y : termYears} aria-label="授权年数" autoFocus
                        onChange={(e) => editDraft({ y: e.target.value.replace(/\D/g, "") })} />
                      <span>年</span>
                      <input className="line-input" inputMode="numeric" placeholder="0"
                        value={termDraft ? termDraft.m : termMonths} aria-label="授权月数"
                        onChange={(e) => editDraft({ m: e.target.value.replace(/\D/g, "") })} />
                      <span>个月</span>
                    </div>
                    <div className="note">
                      {draftMonths() > 0
                        ? `自签发之日起算，至 ${endPreview(draftMonths())} 止。`
                        : "填年或月数，自签发之日起算。"}
                    </div>
                    {/* 有开始就要有结束：填完点「确定」才生效并收起；
                        「取消」/ 点别处 = 丢弃草稿，已生效的期限分毫未动。 */}
                    <div className="picker-form-actions">
                      <Button size="sm" onClick={cancelCustom}>取消</Button>
                      <Button variant="primary" size="sm" disabled={draftMonths() <= 0}
                        onClick={confirmCustom}>
                        确定
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </AccordionPanel>
          </div>

          {/* 授权费用 —— 整行（金额是必填主字段，不与人挤半栏） */}
          <div className="issue-field">
            <div className="field-label">授权费用</div>
            <div className="money">
              <span>¥</span>
              <input value={price} placeholder="1,299" inputMode="decimal"
                onChange={(e) => setPrice(e.target.value)} aria-label="授权价格" />
            </div>
          </div>

          {/* 备注 —— 可选补充：默认只占一行「添加备注」入口，点开才在**整行**宽度里写。
              曾经与费用并排半栏，用户反馈"空间小了点"；改成展开入口后
              ① 不填时不占版面 ② 真要写的时候拿到整行宽度 ③ 填过的内容直接显示在入口上。
              与「授权范围 ∥ 授权期限」共用 openPicker（同刻只展开一个）。 */}
          <div className="issue-field">
            <button className={`note-pick${note.trim() ? " filled" : ""}`}
              aria-expanded={openPicker === "note"}
              aria-label={note.trim() ? "编辑备注" : "添加备注"}
              onClick={() => togglePicker("note")}>
              {note.trim() ? <IconPencil size={14} /> : <IconPlus size={14} />}
              <span className="note-pick-t">{note.trim() || "添加备注"}</span>
            </button>
            <AccordionPanel open={openPicker === "note"}>
              <textarea className="textnote" value={note} rows={3} placeholder="添加备注……"
                onChange={(e) => setNote(e.target.value)} aria-label="备注" />
            </AccordionPanel>
          </div>

          {/* 动作（「保存草稿」假按钮已摘：云端虽有 draft 状态，门户没有创建路径——不展示做不到的功能） */}
          <div className="issue-actions">
            <Button variant="primary" style={{ flex: 1 }} disabled={!canIssue}
              onClick={() => void startIssue()}>
              {busy ? <Spinner /> : null}
              {busy ? "签发中…" : "生成签发文件"}
            </Button>
          </div>

          {/* 结果摘要（完成即出现）。下载入口不在这里 —— 在右侧授权书右上角的过程槽里 */}
          {outcome && <IssueResult outcome={outcome} />}

          {/* 网络日志（默认折叠） */}
          <NetLog />
        </section>

        {/* ── 右：文书预览 —— 屏幕出口（与交付包里的 字体授权书.html 吃同一份数据）
               右上角过程槽：进行中逐行写下，完成后同一位置换成交付动作 ── */}
        <section className="paper-stick">
          <LicensePaper data={licenseData} process={{
            lines: procLines,
            done: !!outcome,
            actions: outcome ? <IssueDeliveries outcome={outcome} /> : null,
          }} />
        </section>
      </div>
    </>
  );
}