/**
 * 签发页 —— 左表单 + 右文书（Navy 风格 · 对标原型 v9）
 *
 * 左侧：inline picker 式表单（客户 → 字体 → 授权方案 → 期限 → 价格 → 备注）
 * 右侧：仿纸面授权书实时预览，填写时即更新，滚动吸附（sticky）
 *
 * 点击【签发】触发真实 issueOne() 五步流程（登记→订单→配方→本地嵌入→回执），
 * 进度条显示在表单下方；完成后右侧文书补齐订单号与双 SHA，
 * 可下载水印字体 / 打印授权书。字体本体始终不出本机。
 *
 * 选择客户/字体用页面内展开面板（picker-panel），不弹窗。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { listLocalFonts, type LocalFont } from "../lib/localFonts";
import { listCustomers, type Customer } from "../lib/localCustomers";
import { issueOne, type IssueOutcome, type IssuePhase } from "../lib/issueFlow";
import { buildLicenseHtml, printLicenseHtml } from "../lib/issuer";
import { toast } from "../lib/toast";
import IssueResult from "../components/IssueResult";
import IssueProgress from "../components/IssueProgress";
import { PageHeader, Spinner } from "../components/ui";
import { IconPrint } from "../components/Icon";
import NetLog from "../components/NetLog";

/** 授权方案文案 */
const LICENSE_OPTIONS = [
  { value: "enterprise", label: "企业商用", desc: "企业内外部使用" },
  { value: "personal_commercial", label: "个人商用", desc: "个人商业项目" },
  { value: "personal", label: "个人版", desc: "个人非商用" },
];

export default function Issue() {
  const [localFonts, setLocalFonts] = useState<Array<Omit<LocalFont, "data">>>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<IssueOutcome | null>(null);
  const [phase, setPhase] = useState<IssuePhase | null>(null);
  const [phaseDone, setPhaseDone] = useState(false);

  // 表单
  const [clientRef, setClientRef] = useState("");
  const [fontId, setFontId] = useState<string | null>(null);
  const [licenseType, setLicenseType] = useState("enterprise");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");

  // 内联选择面板
  const [openPicker, setOpenPicker] = useState<"customer" | "font" | "license" | null>(null);

  const load = useCallback(async () => {
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

  const typeLabel = LICENSE_OPTIONS.find((o) => o.value === licenseType)?.label ?? "—";
  const canIssue = !busy && !!fontId;

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
        { clientRef, licenseType, amount: price.trim() || undefined, note: note.trim() || undefined },
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

  /** 打印 / 另存 PDF（用统一授权书模板） */
  const doPrint = () => {
    if (!outcome) return;
    const html = buildLicenseHtml({
      orderId: outcome.orderId,
      fontName: outcome.fontName,
      clientRef: outcome.clientRef,
      licenseType: outcome.licenseType,
      fontSha256: outcome.sign.fontSha256,
      watermarkedSha256: outcome.sign.watermarkedSha256,
      issuedAt: outcome.issuedAt,
    });
    printLicenseHtml(html);
  };

  return (
    <>
      <PageHeader
        title="签发"
        sub="选字体 → 填客户与授权方案 → 右侧实时预览授权书 → 签发。字体全程不出本机。"
      />

      <div className="issue-layout">
        {/* ── 左：表单（原型 v9 pick / money / textnote） ── */}
        <section>
          {/* 选择客户 */}
          <div>
            <div className="field-label">签发给</div>
            <button className={`pick${clientRef ? "" : " empty"}`}
              onClick={() => setOpenPicker(openPicker === "customer" ? null : "customer")}>
              <span>{clientRef || "选择客户"}</span>
              <b>›</b>
            </button>
            {openPicker === "customer" && (
              <div className="picker-panel">
                <div style={{ maxHeight: 200, overflowY: "auto" }}>
                  {customers.length === 0 ? (
                    <div className="empty" style={{ padding: "20px 12px" }}>
                      <div className="empty-desc">客户库为空，可直接在下方输入客户名。</div>
                    </div>
                  ) : (
                    customers.map((c) => (
                      <div key={c.id} className="picker-item" role="button" tabIndex={0}
                        onClick={() => { setClientRef(c.name); setOpenPicker(null); }}>
                        <span className="picker-item-t">{c.name}</span>
                        {c.email && <span className="picker-item-s mono">{c.email}</span>}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
            <input
              className="line-input"
              value={clientRef}
              onChange={(e) => setClientRef(e.target.value)}
              placeholder="客户 / 公司名（写入授权书抬头）"
              aria-label="被授权方名称"
              style={{ marginBottom: 20 }}
            />
          </div>

          {/* 选择字体 */}
          <div>
            <div className="field-label">授权字体</div>
            <button className={`pick${selFont ? "" : " empty"}`}
              onClick={() => setOpenPicker(openPicker === "font" ? null : "font")}>
              <span>{selFont ? selFont.name : localFonts.length ? "选择字体" : "本机库为空"}</span>
              <b>›</b>
            </button>
            {openPicker === "font" && (
              <div className="picker-panel">
                <div style={{ maxHeight: 240, overflowY: "auto" }}>
                  {loading ? (
                    <div className="loading-block"><Spinner />载入…</div>
                  ) : localFonts.length === 0 ? (
                    <div className="empty" style={{ padding: "24px 12px" }}>
                      <div className="empty-desc">本机字体库为空，先去「字体库」添加。</div>
                    </div>
                  ) : (
                    localFonts.map((f) => (
                      <div key={f.id} className="picker-item" role="button" tabIndex={0}
                        onClick={() => { setFontId(f.id); setOpenPicker(null); }}>
                        <span className="picker-item-t">{f.name}</span>
                        <span className="picker-item-s mono">{(f.size / 1024 / 1024).toFixed(1)} MB · {f.sha256.slice(0, 10)}…</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 授权方案 */}
          <div>
            <div className="field-label">授权范围</div>
            <button className="pick"
              onClick={() => setOpenPicker(openPicker === "license" ? null : "license")}>
              <span>{typeLabel}</span>
              <b>›</b>
            </button>
            {openPicker === "license" && (
              <div className="license-list" style={{ marginBottom: 20 }}>
                {LICENSE_OPTIONS.map((o) => (
                  <label key={o.value} className={`license-row${licenseType === o.value ? " active" : ""}`}>
                    <input type="radio" name="license" value={o.value} checked={licenseType === o.value}
                      onChange={() => { setLicenseType(o.value); setOpenPicker(null); }} />
                    <span style={{ flex: 1 }}>
                      <span className="license-row-t">{o.label}</span>
                      <span className="license-row-s">{o.desc}</span>
                    </span>
                    {licenseType === o.value && <span className="license-row-dot" />}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* 授权费用 */}
          <div>
            <div className="field-label">授权费用</div>
            <div className="money">
              <span>¥</span>
              <input value={price} placeholder="1,299" inputMode="decimal"
                onChange={(e) => setPrice(e.target.value)} aria-label="授权价格" />
            </div>
          </div>

          {/* 备注 */}
          <div>
            <div className="field-label">备注</div>
            <textarea className="textnote" value={note} rows={2} placeholder="添加备注……"
              onChange={(e) => setNote(e.target.value)} aria-label="备注" />
          </div>

          <p className="issue-safe">字体不会离开你的电脑，云端只收哈希与订单号，可自行验证。</p>

          {/* 动作 */}
          <div style={{ display: "flex", gap: 10, margin: "20px 0 16px" }}>
            <button className="btn btn-outline btn-md" style={{ flex: 1 }} disabled={busy}
              onClick={() => toast.info("草稿功能待后端支持")}>
              保存草稿
            </button>
            <button className="btn btn-primary btn-md" style={{ flex: 2 }} disabled={!canIssue}
              onClick={() => void startIssue()}>
              {busy ? <Spinner /> : null}
              {busy ? "签发中…" : "生成签发文件"}
            </button>
          </div>

          {/* 进度条 + 结果 */}
          <IssueProgress phase={phase} done={phaseDone} />
          {outcome && <IssueResult outcome={outcome} />}

          {/* 网络日志（默认折叠） */}
          <NetLog />
        </section>

        {/* ── 右：文书预览（原型 v9 paper：mono 品牌行 + serif 大标题 + 正文 + facts 网格 + 印章） ── */}
        <section>
          <div className="paper">
            <div className="paper-brand mono">TYPEFLOW · 文镇</div>
            <h2>字体软件授权书</h2>
            <div className="paper-sub mono">{outcome ? `NO. ${outcome.orderId}` : "签发后生成编号"}</div>

            <hr className="rule" />

            <p className="paper-body">
              兹证明，本字体{selFont ? `「${selFont.name}」` : ""}已由授权方依据订单完成唯一水印标识签发，
              用于{typeLabel}授权范围。如需验证来源，可通过追溯功能匹配订单。
              本授权书经本地生成，字体未经第三方服务器处理。
            </p>

            <div className="facts">
              <div className="fact"><small>被授权方</small><b>{clientRef || "（未署名）"}</b></div>
              <div className="fact"><small>授权版本</small><b>{typeLabel}</b></div>
              <div className="fact"><small>授权期限</small><b>永久</b></div>
              <div className="fact"><small>签发时间</small><b>{outcome?.issuedAt ?? "—"}</b></div>
              <div className="fact"><small>原版 SHA-256</small><b className="mono" style={{ fontSize: 11, wordBreak: "break-all" }}>{outcome?.sign.fontSha256.slice(0, 32) ?? "—"}</b></div>
              <div className="fact"><small>水印 SHA-256</small><b className="mono" style={{ fontSize: 11, wordBreak: "break-all" }}>{outcome?.sign.watermarkedSha256.slice(0, 32) ?? "—"}</b></div>
            </div>

            <div className="sign">
              <div>
                <div className="paper-sub mono" style={{ marginBottom: 6 }}>文镇 TYPEFLOW · 本地签发</div>
                <button className="btn btn-outline btn-sm" disabled={!outcome} onClick={doPrint}>
                  <IconPrint size={14} />打印 / 另存 PDF
                </button>
              </div>
              <div className="seal">文镇<br />印</div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}