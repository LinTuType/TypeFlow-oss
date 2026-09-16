/**
 * 《用户协议》与《隐私政策》—— 公开页面（不需要登录也能看，注册页会链接过来）。
 *
 * 措辞原则（对齐桌面版 docs/网站/docs.html 的免责声明，并补上网页版的三个差异）：
 *   ① 桌面版「纯离线、零上传」；网页版是「字体文件不上传，但订单元数据在云端」
 *   ② 平台签发的是嵌入配方，无法验证最终产物 —— 必须诚实写明
 *   ③ 数据可携（一键导出）与可删除（注销即删，含审计）
 *
 * ⚠️ 这是能读懂的诚实文案，不是法律意见。正式对外前建议请专业人士过一遍措辞。
 */

const STYLES = `
.legal { max-width: 720px; margin: 0 auto; padding: 48px 32px 96px; }
.legal .kicker { font-family: var(--mono); font-size: 11px; letter-spacing: .18em; color: var(--rust); }
.legal h1 { font-family: var(--serif); font-size: 30px; font-weight: 600; margin: 12px 0 4px; }
.legal .meta { font-family: var(--mono); font-size: 11.5px; color: var(--ink-300); margin-bottom: 28px; }
.legal h2 { font-family: var(--serif); font-size: 18px; font-weight: 600; margin: 34px 0 8px; padding-bottom: 6px; border-bottom: 1px solid var(--rule); }
.legal h3 { font-size: 14px; font-weight: 600; margin: 20px 0 6px; }
.legal p, .legal li { font-size: 13.5px; line-height: 1.9; color: var(--ink-2); }
.legal ul, .legal ol { padding-left: 22px; margin: 8px 0; }
.legal li { margin: 5px 0; }
.legal .hl { background: #F5F3EE; border-left: 2px solid var(--gold); padding: 10px 14px; margin: 12px 0; }
.legal .hl b { color: var(--ink); }
.legal a { color: var(--navy); }
.legal .back { font-size: 12.5px; display: inline-block; margin-bottom: 18px; }
@media print { .legal .back { display: none; } }
`;

function Shell({ kind, children }: { kind: "terms" | "privacy"; children: React.ReactNode }) {
  return (
    <div className="legal">
      <style>{STYLES}</style>
      <a className="back" href="/login">← 返回</a>
      <div className="kicker">文镇 TypeFlow · Web</div>
      <h1>{kind === "terms" ? "用户协议" : "隐私政策"}</h1>
      <div className="meta">版本 2026-09-16-v1 · 生效日期 2026-09-16 · 运营方：灵兔字形 Lingtu Type</div>
      {children}
    </div>
  );
}

/* ─────────────────────────── 用户协议 ─────────────────────────── */

export function Terms() {
  return (
    <Shell kind="terms">
      <p className="lead" style={{ fontSize: 15, color: "var(--ink-2)" }}>
        使用文镇网页版（下称"本服务"）之前，请先读一遍这份协议。它不长，也没有藏起来
        的条款——我们尽量用能读懂的话把边界写清楚。
      </p>

      <h2>一、本服务是什么、不是什么</h2>
      <p>
        本服务是一个<b>字体授权管理与水印追溯工作台</b>，面向独立字体设计师与小型字库工作室，
        覆盖字体登记、订单创建、水印配方签发、授权文书与泄露追溯。
      </p>
      <div className="hl">
        <b>核心机制（请务必理解）：</b>你的字体文件<b>不上传</b>。水印的全部嵌入计算都在
        你自己的浏览器里完成；云端只保存字体文件的 SHA-256 <b>哈希值</b>、订单元数据与
        签发记录。哈希无法还原出字体。
      </div>
      <p>
        本服务<b>不是</b> DRM（数字版权管理）系统：它不阻止任何人复制你的字体，
 也不监控互联网上的侵权内容。它提供的是<b>事后溯源能力</b>——当一份疑似泄露的字体
 出现在你面前时，帮你定位它最初来自哪一笔订单。
      </p>

      <h2>二、账号与密码</h2>
      <ul>
        <li>你负责保管自己的登录密码。我们只存储加盐并混入站点密钥后的慢哈希，
          <b>任何人都无法从存储值还原出你的密码</b>（包括我们）。</li>
        <li>会话令牌保存在你浏览器的 sessionStorage 里，关闭标签页即失效，有效期最长 14 天，
          你可以随时在设置页登出使其立即作废。</li>
        <li>目前尚未提供自助找回密码（需要邮件通道，在路线图上）。忘记密码请联系我们手工重置。</li>
      </ul>

      <h2>三、数据归属</h2>
      <ul>
        <li>你的客户名单、订单记录、授权文书、操作台账，<b>归你所有</b>。</li>
        <li>我们仅用这些数据向你提供本服务（签发、追溯、统计），不用于广告投放，
          不出售，不向第三方提供（法律法规要求除外）。</li>
        <li>你随时可以<b>一键导出</b>全部云端数据，也可以<b>注销账号</b>——注销会不可恢复地
          删除你的全部云端数据（含操作台账）。</li>
      </ul>

      <h2>四、水印溯源的效力边界（诚实条款）</h2>
      <div className="hl">
        <b>平台签发的是"嵌入配方"，无法验证你最终产出的字体文件内容。</b>
        我们不检查、不存储、也不为最终产物的正确性背书。
      </div>
      <ul>
        <li>水印可定位疑似泄露字体对应的原始订单与客户，为维权提供<b>技术线索</b>；</li>
        <li>追溯结果附带哈希校验，可作为电子证据材料，但其<b>证明力由有权机关依法认定</b>；</li>
        <li>我们不对维权结果作任何承诺，也不对盗版损失、维权失败及任何间接损失承担责任。</li>
      </ul>

      <h2>五、服务可用性与免责</h2>
      <ul>
        <li>本服务按"现状"提供。内测期间可能出现中断或数据异常，请定期使用导出功能自备份。</li>
        <li>云端数据不由我们做异地备份；因服务中断、数据丢失导致的直接或间接损失，
          在法律允许的最大范围内我们不承担责任。</li>
        <li>字体文件本体从不经过我们的服务器，因此<b>字体文件的保管责任完全在你</b>。</li>
      </ul>

      <h2>六、禁止行为</h2>
      <ul>
        <li>对本服务进行逆向工程、破解授权、自动化刷量；</li>
        <li>将水印与追溯能力用于非法追踪、侵犯他人隐私等非授权用途；</li>
        <li>上传你无权处理的字体哈希，或用本服务为盗版字体提供"合法外观"。</li>
      </ul>

      <h2>七、条款变更</h2>
      <p>
        条款更新时，本页顶部的版本号与日期会随之变化。重大变更会在你下次登录时提示重新确认；
        继续使用即视为接受修订后的条款。
      </p>

      <h2>八、注销与联系</h2>
      <p>
        你可以在「设置 → 账号与合规」中导出数据并注销账号。注销后，云端与你相关的全部记录
        （含操作台账）将被不可恢复地删除。有事请通过官网 <a href="https://lingtufont.cn">lingtufont.cn</a> 上的联系方式找我们。
      </p>
    </Shell>
  );
}

/* ─────────────────────────── 隐私政策 ─────────────────────────── */

export function Privacy() {
  return (
    <Shell kind="privacy">
      <p className="lead" style={{ fontSize: 15, color: "var(--ink-2)" }}>
        我们收集的数据少到可以直接列出来。下面每一项都说明它是什么、为什么需要、放在哪。
      </p>

      <h2>一、我们收集什么</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <tbody>
          {[
            ["注册邮箱", "创建账号与登录", "必填"],
            ["工作室名称", "授权书抬头与界面显示", "必填"],
            ["客户与订单信息", "授权管理与追溯", "你主动录入"],
            ["字体文件 SHA-256 哈希", "字体登记与泄露比对", "登记时自动计算"],
            ["操作审计日志", "安全与纠纷排查", "自动记录，最近 200 条"],
            ["加密备份（可选）", "换设备时恢复客户资料", "你开启后自动"],
          ].map(([a, b, c]) => (
            <tr key={a}>
              <td style={{ padding: "7px 8px", borderBottom: "1px solid var(--rule)", width: 150 }}>{a}</td>
              <td style={{ padding: "7px 8px", borderBottom: "1px solid var(--rule)", color: "var(--ink-2)" }}>{b}</td>
              <td style={{ padding: "7px 8px", borderBottom: "1px solid var(--rule)", color: "var(--ink-300)", width: 90 }}>{c}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>二、我们不收集什么（同样重要）</h2>
      <ul>
        <li><b>你的字体文件</b>——一个字节都不上传，水印嵌入全部在本机浏览器完成；</li>
        <li>水印后的字体文件；</li>
        <li>你电脑上的任何其他文件；</li>
        <li>广告与行为分析追踪器——本服务一个都没有。</li>
      </ul>

      <h2>三、密码与密钥的处理方式</h2>
      <ul>
        <li>密码：加盐并混入站点密钥（pepper）后做 100,000 轮 PBKDF2 派生，只存最终哈希。
          <b>我们无法还原你的密码</b>，员工也一样；</li>
        <li>会话令牌：数据库只存令牌的 SHA-256，浏览器关闭即失效；</li>
        <li>主密钥：用于签发水印配方的密钥以 AES-256-GCM 加密托管，明文不落库；</li>
        <li>加密备份：字体清单与厂牌信息用<b>你自己的恢复码</b>加密后存储，服务器不可读。</li>
      </ul>

      <h2>四、存放位置、时长与谁能看到</h2>
      <ul>
        <li>存放位置：Cloudflare D1（当前区域：北美西部）， HTTPS 全程加密；</li>
        <li>保存时长：直到你注销账号。注销会<b>不可恢复地删除全部相关记录</b>（含审计）；</li>
        <li>谁能看到：只有持你凭证的你。平台方在故障排查时技术上可以接触存储内容，
          但<b>无法还原你的密码</b>，也无法解密你用恢复码加密的备份；</li>
        <li>第三方：Cloudflare（托管与数据库）。除此之外没有其他处理方。</li>
      </ul>

      <h2>五、你的权利</h2>
      <ul>
        <li><b>可携带</b>：设置页一键导出全部云端数据（JSON）；</li>
        <li><b>可删除</b>：注销账号即永久删除，无需理由、无需申请；</li>
        <li><b>可查询</b>：设置页的操作记录台账向你完整开放。</li>
      </ul>

      <h2>六、会话与本地存储</h2>
      <p>
        登录令牌保存在浏览器的 sessionStorage（<b>关闭标签页即失效</b>），不用于跨站追踪；
        厂牌信息、字体清单等保存在你浏览器的 IndexedDB，属于你的本机数据，
        清除浏览器数据即消失。
      </p>

      <p style={{ marginTop: 28, fontSize: 12.5, color: "var(--ink-300)" }}>
        本政策与《<a href="/terms">用户协议</a>》配合阅读。对条款有疑问，通过官网
        <a href="https://lingtufont.cn"> lingtufont.cn </a>上的联系方式找我们。
      </p>
    </Shell>
  );
}
