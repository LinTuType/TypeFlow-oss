import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import ToastHost from "./components/ToastHost";
import { applyPlatformClass } from "./lib/platform";
import "./styles/theme-v9.css";      // 原型 v9 规格（唯一事实源）
import "./styles/theme-v9-ext.css";  // 桥接层：门户类名 → 原型值 + 交互件补样式

// 应用平台字体策略
applyPlatformClass();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <ToastHost />
    </BrowserRouter>
  </React.StrictMode>,
);