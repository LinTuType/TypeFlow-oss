# 文镇 TypeFlow — 开源部分（引擎 + 门户）

这是「文镇 TypeFlow」网页版的**开源镜像**，只包含信任链需要公开核验的两部分：

- **`engine/`** — 水印引擎：读取 TTF 字体字节 → 修改字形坐标嵌入水印 → 写回。纯计算，无网络调用。
- **`portal/`** — 门户前端（React + Vite）：字体文件全程留在浏览器（IndexedDB），出网的只有哈希与订单信息。

**不在本仓库**：`worker/`（配方签发服务端，持有密钥与租户数据，暂不开源）。
「零上传」的证明不依赖对服务端的信任——门户页面上每一条证据（源码哈希、网络调用扫描）都在**浏览器里实时计算**，源码就是本仓库里的这些文件。

## 核对部署产物

线上信任页会展示参与自证的源码及其 SHA-256；`MANIFEST.md` 记录了本次导出对应的主仓库 commit 与逐文件哈希，可逐一对照：

```bash
shasum -a 256 engine/src/embed.ts
```

## 本地运行门户

```bash
npm install && npm install --prefix portal
npm run worker:dev:d1   # 云端 API（127.0.0.1:8787，本地 SQLite）
npm run portal:dev      # 门户（127.0.0.1:5173）
```

> `worker/` 不在本仓库内，完整可运行版本见文镇官网 lingtutype.cn/typeflow。

## 格式支持

仅支持 TTF（glyf 轮廓）；OTF/CFF 与可变字体暂不支持，工具会明确提示。
