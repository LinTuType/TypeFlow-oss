# TypeFlow 开源自证清单（MANIFEST）

本仓库由文镇 TypeFlow 主仓库（私有）按开源范围导出生成：**引擎（engine/）+ 门户前端（portal/）**。
签发服务端（worker/）暂不公开；「零上传」的可核验证据链全部在浏览器侧，不依赖对服务端的信任。

| 项 | 值 |
|---|---|
| 主仓库 commit | `69bd52e9160e4f205caa1b00d87ada27a9be14a5`（branch main，工作树干净） |
| 导出时间 | 2026-09-16T02:04:31.491Z |
| 文件数 | 73 |

逐文件 SHA-256（与信任页「源码自证」实时算出的哈希对照）：

| 文件 | SHA-256 |
|---|---|
| LICENSE | `37b726a6c9fec5e7b9570b182158ad3f38c5f12bfb840d9323f821243df4707a` |
| engine/src/crypto.node.ts | `9f23c16b9eee92d92de9b92e5ff952f22f119414851d25da0feee7bfc6334ced` |
| engine/src/crypto.ts | `9ea2e2ada02048735633355a2ed1a9b61b2a37205bfc26722b5ebdce59c84d14` |
| engine/src/embed.ts | `db89161174dbe0bc854765b11c5e911f05323c92e7c67e824d1dcdb8f946b0f2` |
| engine/src/pool.data.generated.ts | `1c851a32fb47a044bbb7624e8cf8e0fefde7a6dd4b44d4072e19f571dce4df6a` |
| engine/src/pool.ts | `53a157748769abfd740cf9c7f651aff1901c78350614e1d6aa712e631bdfac1e` |
| engine/src/trace.ts | `08d5c2802e5a7fa1b180eb14071f0288691ee4c523fd778ae0a554b6b406a705` |
| engine/src/ttf/glyf.ts | `8254c95ef1bb9a3fe1df7a4ce9d7a58c5c2ea401cbfa3ddd5de0701d65856eef` |
| engine/src/ttf/name.ts | `6e0eea9a85094589d7ffdb27374b9017cdc7658922effa0f4936f02da047e4ae` |
| engine/src/ttf/reader.ts | `f9547b59f9deb17377a29178173bf624308580ae4286274873cd05b80486d4e2` |
| engine/src/ttf/writer.ts | `ddb29bb46627bf75dc5e8b406a71e4ab409b3e068054193549a0cf77b78057a5` |
| engine/src/webv1.ts | `527a502d9c0de462eef0c51aa4d4d36be875124639bfd8c2b6962cd8f4c46e74` |
| engine/tests/attack_util.ts | `25004489ba64550216f48218d36dad42c3a4cff8f3715f164c54cab0b497dc2f` |
| engine/tests/browser.ts | `ad825b3bacb552d0d62b1332a3a3e1a8b03e76a7f1c9228c57dd14e4390c8b07` |
| engine/tests/compare.ts | `d39e2c3b09b880c69c7f2515f1a6e52ebe06418075e281b559472e7ac3c0770c` |
| engine/tests/e2e-local-signer.ts | `46f1b7f88bd75cd92b60ecb7909d28ba35e8a8ef52649b354bb4e66fc0402d63` |
| engine/tests/e2e-portal.ts | `e08b40523f2499aff7d7fcf86137966509be3462e5eb5d3686c77ecaa655af5c` |
| engine/tests/e2e-trace.ts | `0c052421647e8b537639f189148d4f0ddb5e6f6ecd70da8a11c5a8b059154c1a` |
| engine/tests/recipe-mode.ts | `180c6d9d71f30215f276ad00ab06366906f9515acf7ee1449e771fa4d619b3ef` |
| engine/tests/smoke-browser-bundle.ts | `5e69abac011363150bd2f4121ec097e1bf5a857fa59aa404c52a48c26a6d54bc` |
| engine/tests/stage1.ts | `4329a1ab9f046870c288f11e4a3f2a494cd7591fd11c2bb05f23626c2ad2623b` |
| engine/tests/stage2.ts | `a77c7f59253efaa1c43812b21ee9c9aa2ab8dce61b9f104bf77e114bb593906e` |
| engine/tests/webcrypto-consistency.ts | `e56f9152c5969154f39b70ba8aac3000b01bbf7a3ceded4ac2dc5c5f440a73e4` |
| package.json | `9c7f7ef377fb46ce602e71828569ecaaafe44a0db71a0961e9bc0f717c9df5d5` |
| portal/index.html | `da4b0970a2d06d913acb4ff605015cc70f85752a7c5e7bba020fdfe7172928e1` |
| portal/package.json | `c8294fdd4a89e8c3cca0365cf1080b9ecf87dc9603754412a8d531674f6a57e9` |
| portal/public/logo.svg | `e676bfb35b7130e39b3a8a93a6de024c3e8a6dc214001a8b3fdec6455d5c979e` |
| portal/public/typeflow-local-signer.html | `c699dd5df99d0d8fb0900f194b7ed5be43025f78488bb2194157aec5f5da67d7` |
| portal/src/.DS_Store | `5c33ac2e9b6882b1018ab53a27228a293d4fdf911ed8e8c02178be0e8deae0b4` |
| portal/src/App.tsx | `9ef0bf07836d14b19dcb55e5fcb0edba099dcb8a1ea929cc745e2037c07e19e4` |
| portal/src/api/client.ts | `b7972d15d6f0dcfee8c1912a992d732a1931e0eea8be5a187f08c7d39fff8994` |
| portal/src/components/AppShell.tsx | `449ee72394f43cc9c54e17085ebd218b9d7380a2dbb8fc4ba84280f02e2ace85` |
| portal/src/components/GlyphPreview.tsx | `4e57fbab5ac0ec8cf0f51a067d816f1a470631dc8b75ec1a3ac499deb282c8f8` |
| portal/src/components/Icon.tsx | `86067db9e616fa815aa5c91757dba3af5ed2b38979ce00380d7c00390e9140ce` |
| portal/src/components/IssueProgress.tsx | `df9be04047d3fc766d359c434abdc30fb91bb26f1d851f017af5fa4107ab4620` |
| portal/src/components/IssueResult.tsx | `9d2781d365882386260a7bca65bf1c2870e73a1489a3c68f29707e48f7f16a99` |
| portal/src/components/NetLog.tsx | `cd3a350221cf7626f70d517e23cd77dd5a8ba8f7b3b308b90307162b4afcfdf4` |
| portal/src/components/Sidebar.tsx | `9dc54781fbd31f0f51d0e12f002c99feef81af0df9667c6ece85751652bd0520` |
| portal/src/components/ToastHost.tsx | `8c80bcb617ce8a9e8a4ddb1d1d4b3fabb83de0eb23c299c8a1144d1979304c1b` |
| portal/src/components/TraceReport.tsx | `de3c6e64e1b16b94a74e0b7908bb7ef93cf85f016fe67e10d067dd59035b4947` |
| portal/src/components/TrustPanel.tsx | `c4ecf06a08a6dfb9c095a6f97092c1f1873c1548d22d28c8225982a95f99d925` |
| portal/src/components/ui.tsx | `11122d7bc08e20a0e606c5e8660c4685df2d55ba365b371899cea3625c8e04c8` |
| portal/src/lib/backup.ts | `1c202826f12065c545d620406555a2fddd55a75dd2388cf4cfa30a76187a1d68` |
| portal/src/lib/fontFace.ts | `b6442e04d4b5bb00e82374d6b7e1a465def3a25fac6ff89efd0855c422380c27` |
| portal/src/lib/fsFolder.ts | `054953b156bc8b9d2d2b7e81a164fe0e04949f1319e6730829a87441bdb2a05a` |
| portal/src/lib/issueFlow.ts | `d45610d8660195e826301fa814e8766e149767e770ce6f6140c9272011e4bb16` |
| portal/src/lib/issuer.ts | `70e7bbc073fa2532ac5410db29aa55a05a3a5a628b710b49aad96bb2af962fdc` |
| portal/src/lib/localCustomers.ts | `31bf54fa2aefef7ecfcdeb2b93a9ad9c698febd7b8fe93b4bbdf0fc5ab5f4e4f` |
| portal/src/lib/localFonts.ts | `1ad06d4af875723c656f5d6a5ead89444d12f0d0a3e891ee707b3aa8fd9602bc` |
| portal/src/lib/platform.ts | `ffe6b429ca5ae6c3002d07f7e77f742ebdeacb26766d8692f9d5c8f14afe1e96` |
| portal/src/lib/toast.ts | `136804c357a9bb4773ae4e6907759ebade963baf0ae1978b465788fa225cc60d` |
| portal/src/lib/trace.ts | `d36e1c95c519ecce876cc940241ea18423d8973d0115e4571f5c18ef1f0747ae` |
| portal/src/lib/trust.ts | `e8413b89de19fee9b8772cda7eab221bfb402d7649248c0fc6c0cbc4ec4baca7` |
| portal/src/lib/vault.ts | `4e913aa397ff6f91373aad5a81c33eeb11131ca9836a7f24e808a593cedc187a` |
| portal/src/main.tsx | `d4f896b8431e2995744daea33b9566e37ac5ac8735d501aa8d8cda2bd413c624` |
| portal/src/pages/Clients.tsx | `28f5f1e99b34c5805dd9c8c6bd2d05225489cfefc702bf236a6c5ae765cbe229` |
| portal/src/pages/Fonts.tsx | `52a8fe4d9961fd68d49e98ba21cc7f29ba3f1484eac4bab8016f5404a549df94` |
| portal/src/pages/Issue.tsx | `8573e7824269b968c214a2a555ad39f93259513f1f9a7de8b7717290dd28bdc8` |
| portal/src/pages/Legal.tsx | `edf07795eaf2a67581773d9d2fd0f7a9c73d4a5c6dea41cb5e8a45be4a1e3441` |
| portal/src/pages/Login.tsx | `6435535c015a8db3c2b5ca9d316c8e46095da454bab71814d2dac7a51287f5ea` |
| portal/src/pages/Orders.tsx | `da4808f4c3599c2bba5e01f644ae44d458d26146c2922eed267555ddc2763fa5` |
| portal/src/pages/Overview.tsx | `e598cdb748b54d3147eebe52c890516caba61b14d4095f79079f337b8554c15d` |
| portal/src/pages/Security.tsx | `209cc486a8419c7041a6f347c8ba98f777d99b24d80e38b057064d4e16feead6` |
| portal/src/pages/Settings.tsx | `e08d51c51d5f5623cebeee6572559d6dfad58e92fbfb4aba21fce0540c235af0` |
| portal/src/pages/Trace.tsx | `11aa880d01df7b6e471f44731eb69a58200ddb52920d399d85da6c47363956e9` |
| portal/src/styles/theme-navy.css | `dc3272072c5f9c8e1553313d56e801a268c87ed44afc9b49397ecdb828485ec8` |
| portal/src/styles/theme-v9-ext.css | `3fdd812c1f81fd26fa9b1b37f21d7ed29f4fda4602b9600680af359d165c96ae` |
| portal/src/styles/theme-v9.css | `60e7214d7c79d4e468b908b3404d087c8d8a61e3de5114a6c7c8f286858aad98` |
| portal/src/vite-env.d.ts | `65996936fbb042915f7b74a200fcdde7e410f32a669b1ab9597cfaa4b0faddb5` |
| portal/tsconfig.json | `8f2c000dd69ebc121b15206fe406135410a3e2217c19c48bc5350e71301d5596` |
| portal/vite.config.ts | `f7f264e642501b7f683abb9f33be9cb63b4d83528f80290f62e7d5c0f5f77e54` |
| scripts/oss/README.md | `478195e7899e723c52a8fd9a78b5ebd92ad9bbbc42a59a1f0cbcdcc8e9041f4f` |
| tsconfig.json | `0aadf9c7deaf9e0c31d7adb1ad8aa09a63d501c52f6830927eab9555dea9d10a` |

重新生成：在主仓库运行 `npm run oss:export`。
