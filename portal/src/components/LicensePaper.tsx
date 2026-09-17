/**
 * 授权书纸面预览 —— **屏幕出口**（打印出口在 lib/license.ts 的 buildLicenseHtml）
 *
 * 两个出口吃同一份 LicenseData：
 *   · 字段表 → licenseFields()（唯一数据源，两出口自动同步）
 *   · 正文   → licenseParagraph()
 *   · 编号   → licenseSubLine()
 * 想改文书内容？只改 lib/license.ts，别在这里另写一套。
 *
 * 未签发时传 outcome=null：仍渲染同一套结构，值走占位（「—」/「签发后生成编号」），
 * 所以「签发前看到的就是签发后拿到的那份」。
 */

import type { LicenseData } from "../lib/license";
import {
  licenseFields, licenseParagraph, licenseSealLines, licenseSubLine, licenseFooter,
  licenseScopeText, licenseTypeLabel,
} from "../lib/license";
import { licensorTitle, signatureLine, LICENSOR_PLACEHOLDER } from "../lib/foundry";
import ProcessSlot, { type PaperProcess } from "./ProcessSlot";

export default function LicensePaper({ data, process }: { data: LicenseData; process?: PaperProcess }) {
  const lines = licenseSealLines(data);
  const site = data.licensor.site.trim();
  const title = licensorTitle(data.licensor);
  const unset = title === LICENSOR_PLACEHOLDER;

  return (
    <div className="paper">
      <div className="paper-head">
        <div className={"paper-licensor" + (unset ? " unset" : "")}>{title}</div>
        {site && <div className="paper-licensor-site">{site}</div>}
      </div>

      {/* 标题 + 编号在左，过程槽在右（槽底边与编号行底边对齐；空闲时槽内为空） */}
      <div className="paper-top">
        <div>
          <h2>字体授权书</h2>
          <div className="paper-sub mono">{licenseSubLine(data)}</div>
        </div>
        {process && (
          <ProcessSlot lines={process.lines} done={process.done}>{process.actions}</ProcessSlot>
        )}
      </div>

      <hr className="rule" />

      <p className="paper-body">{licenseParagraph(data)}</p>

      <div className="facts">
        {licenseFields(data).map((f) => (
          <div className="fact" key={f.k}>
            <small>{f.k}</small>
            <b className={f.mono ? "mono hash-cell" : undefined}>{f.v}</b>
          </div>
        ))}
      </div>

      {/* 授权范围条款（与桌面版 PRESET_LICENSES[].text 同一份措辞）
          —— 位置在事实栏与署名之间：这块以后会开放给用户填较多文字，需要一块独立且宽松的空间 */}
      {licenseScopeText(data.licenseType) && (
        <div className="paper-sec">
          <div className="paper-sec-t">授权范围 · {licenseTypeLabel(data.licenseType)}</div>
          <p className="paper-scope">{licenseScopeText(data.licenseType)}</p>
        </div>
      )}

      <div className="sign">
        <div className="sign-who">
          <small>授权方</small>
          <div className="sign-name">{signatureLine(data.licensor)}</div>
          <div className="paper-sub mono">{data.issuedAt || "—"}</div>
        </div>
        {lines.length > 0 && (
          <div className={"seal" + (data.licensor.seal === "square" ? " sq" : "")}>
            {lines.map((l, i) => <i key={i}>{l}</i>)}
          </div>
        )}
      </div>

      <p className="paper-note">{licenseFooter()}</p>
    </div>
  );
}
