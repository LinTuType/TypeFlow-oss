# TypeFlow 开源自证清单（MANIFEST）

本仓库由文镇 TypeFlow 主仓库（私有）按开源范围导出生成：**引擎（engine/）+ 门户前端（portal/）**。
签发服务端（worker/）暂不公开；「零上传」的可核验证据链全部在浏览器侧，不依赖对服务端的信任。

| 项 | 值 |
|---|---|
| 主仓库 commit | `0630dc10c7b5d93f4eb5e82b80c7f1c65937ea70`（branch main，工作树干净） |
| 导出时间 | 2026-09-17T16:31:54.034Z |
| 文件数 | 89 |

逐文件 SHA-256（与信任页「源码自证」实时算出的哈希对照）：

| 文件 | SHA-256 |
|---|---|
| LICENSE | `37b726a6c9fec5e7b9570b182158ad3f38c5f12bfb840d9323f821243df4707a` |
| engine/src/crypto.node.ts | `9f23c16b9eee92d92de9b92e5ff952f22f119414851d25da0feee7bfc6334ced` |
| engine/src/crypto.ts | `9ea2e2ada02048735633355a2ed1a9b61b2a37205bfc26722b5ebdce59c84d14` |
| engine/src/embed.ts | `dd1d8aefd9e27465b3f35937bb4df7e93b02dce6f4a89830ff104e7ca6d5f0ca` |
| engine/src/pool.data.generated.ts | `1c851a32fb47a044bbb7624e8cf8e0fefde7a6dd4b44d4072e19f571dce4df6a` |
| engine/src/pool.ts | `53a157748769abfd740cf9c7f651aff1901c78350614e1d6aa712e631bdfac1e` |
| engine/src/trace.ts | `cb8be7e5afe592a2ccdd8c9ca40804f267993ac42e29e3d2ffea10ae660b0897` |
| engine/src/ttf/glyf.ts | `9d005d699a78ba065ac1246571fb2671cd6cf1deea96a7951246e8e318749630` |
| engine/src/ttf/name.ts | `6e0eea9a85094589d7ffdb27374b9017cdc7658922effa0f4936f02da047e4ae` |
| engine/src/ttf/reader.ts | `a7e0471a9c8bbd97e82f19de7c0143cdceccade62eb2d18f87d7d4c382d994e7` |
| engine/src/ttf/writer.ts | `1e3bcbf16e9936fbca7598cbdfa1ea737abca2a395abe0d0bb733f95592f9854` |
| engine/src/webv1.ts | `527a502d9c0de462eef0c51aa4d4d36be875124639bfd8c2b6962cd8f4c46e74` |
| engine/tests/attack_util.ts | `25004489ba64550216f48218d36dad42c3a4cff8f3715f164c54cab0b497dc2f` |
| engine/tests/browser.ts | `ad825b3bacb552d0d62b1332a3a3e1a8b03e76a7f1c9228c57dd14e4390c8b07` |
| engine/tests/compare.ts | `7626da16140f2b91f2b15d53718312c54eb0955ec20678a1c1cb796350da8723` |
| engine/tests/e2e-local-signer.ts | `19c6fa63951ca87b494e091dd2bf84dad2ba51cc38e8f0f0006508de2f413cc0` |
| engine/tests/e2e-portal.ts | `4a8e11165a67b2819375d88eb28077896084c90e7c2610fb59a953c155ea60c3` |
| engine/tests/fixtures/hybudai-subset.ttf | `c7ba0d8fad728f232966ea122af60e37ace567fdf4de1297dc081d78ecc5dba1` |
| engine/tests/fixtures/xingyun-subset.ttf | `dd46e1bcc01487cf4476f61464e6a0ecb8d154f049d9f1ad3086ae67673158d0` |
| engine/tests/fontPath.ts | `d12c11503ee356466589089ac4f7bae90718dbd379282e74885011122910acb4` |
| engine/tests/recipe-mode.ts | `8d691daac2f67d7a9c3e0b112077cad442d92d64c746945df8941b8be7daf538` |
| engine/tests/regression.ts | `5709cc139af7baa23d7ed0c48dc4df14fc5d8e399d25e4a701dc4f12321b9602` |
| engine/tests/smoke-browser-bundle.ts | `4d0ea122b10fb5a98e52b0610330f3f462c94914ba54feb9668955149fc71085` |
| engine/tests/stage1.ts | `91df6c54a3f60fea81806f529fa84910fc93022f16015a223feb7480572432bd` |
| engine/tests/stage2.ts | `ea9edfeba2a014a8a2845e1d52ad792685dd04734ca95a025b22e85e4e0c371a` |
| engine/tests/webcrypto-consistency.ts | `d28ca9870a20a9dbff6c332e9a7895bc64d074a8e0d222996242ebdf15f77ebc` |
| package.json | `e75dbcad4253556bd34894676064bd79eed0c2aa7a8a8497b3eb7867762e222f` |
| portal/index.html | `07ba8d3957b09dcfde42d873c36afa03645aa4e4f76b371bec724af05d8b3eed` |
| portal/package.json | `eb905dd65eb551e2bb0fc6e88f86916d1f0aa5ad90eeafa275cb1064dc0e8121` |
| portal/public/logo.svg | `e676bfb35b7130e39b3a8a93a6de024c3e8a6dc214001a8b3fdec6455d5c979e` |
| portal/public/typeflow-local-signer.html | `77a5020fa52f7e5e60f38394a6216d7e0c708b260460cc47ca45e17849864b3a` |
| portal/src/App.tsx | `b3dbd03d949556f41e153eb4fb10b01610433aaf4e9a0bf39799d9090f2bb6b6` |
| portal/src/api/client.ts | `1981e322003d36784dcc5fb68ea32eb39da52b72f0206a36d72921cfac91cb88` |
| portal/src/components/AppShell.tsx | `00fa8958bd14881f85d54e423e14d2cee9d7eb6bca4f45f0334412cd0881820f` |
| portal/src/components/ErrorBoundary.tsx | `3d71bed023439924bf6b59b9cbf018d5aa9c0d180e37f02fd7709d1afe10783c` |
| portal/src/components/FontPicker.tsx | `64e7215e83874dcf388632270a938acf81a8ea85938fcf89e200f1e2a04c913c` |
| portal/src/components/GlyphPreview.tsx | `4e57fbab5ac0ec8cf0f51a067d816f1a470631dc8b75ec1a3ac499deb282c8f8` |
| portal/src/components/Icon.tsx | `e5d5091c8b84f44c00854481622c2f44f28020022d6729a3b5080d958865c45c` |
| portal/src/components/IssueResult.tsx | `b3eb631cfdb6a9219ab654a8c3849088e903339dd6f45ba1d74d9ca990377ed5` |
| portal/src/components/LicensePaper.tsx | `77bb1211e6b1d751c40d6d1755131ae5c2f6808efaa35cd153c5714fa269250c` |
| portal/src/components/NetLog.tsx | `cd3a350221cf7626f70d517e23cd77dd5a8ba8f7b3b308b90307162b4afcfdf4` |
| portal/src/components/PageStage.tsx | `09f3c35eae01b2edc55a92f84f2752cc19c70ee265aaff94cd760ec91c7dff51` |
| portal/src/components/ProcessSlot.tsx | `62610cd55bacbe5767da877514831830394f4ff29fda84612f9afa1037dad713` |
| portal/src/components/Sidebar.tsx | `000e0efe69d1f3087e106bf7b290fee8aff5d4cf70933364fdcfabf6065caddb` |
| portal/src/components/ToastHost.tsx | `c916c32c3a7cc0eef9153761d085ccb5ddfca1785a1d876d99e874ddf0599df3` |
| portal/src/components/TraceReport.tsx | `28747ac059d24bad3d84a6fc7075f7aa20e4dc04804d45ae5d0490cf1285769b` |
| portal/src/components/ui.tsx | `09ca2ba083fffda7e8f44ed874551bb34e4fe4184d4e5ba6c4ababa377963e7e` |
| portal/src/lib/backup.ts | `3c15f5bccde9c486025bc12ff3c5248aeaa8aa14978c3605a2e1e4dc5310c920` |
| portal/src/lib/backupFolder.ts | `553e48cd82fb1479f1b4ac53374cdcadcebb6628a76ecd75887c2cb343ab693d` |
| portal/src/lib/db.ts | `446ee737a9223a954cd47c23330983a0f111ff4fe94890274b283abe06889d30` |
| portal/src/lib/delivery.ts | `0dd69d807906d64534a5dad78c43b978cb6078d2caf19671470ce61938e42025` |
| portal/src/lib/embedWorker.ts | `84bccf5e3c12d4bb2556517af6e5886f77ba0a41f65c086611384489cf173c68` |
| portal/src/lib/fontFace.ts | `b6442e04d4b5bb00e82374d6b7e1a465def3a25fac6ff89efd0855c422380c27` |
| portal/src/lib/foundry.ts | `6ce4cee34e22f95ba30bb7a37f3ae4e320dda7108410dc087687df9cf9567961` |
| portal/src/lib/fsFolder.ts | `e24b2ddecc9cf295b3d3ccc5db76a219715e37912ea603fc5a8ba0e8d7f31b31` |
| portal/src/lib/issueFlow.ts | `136ec89ddd3b1bb959485937faf1e656c8b79b906bb979db627ddd74adb49452` |
| portal/src/lib/issuer.ts | `aabdf8d3e768c3eb1f0199a25e2ee88ec9771741299196585d64f1c829562f46` |
| portal/src/lib/license.ts | `a9c3e72860c8d8a432eae7f64dca47bc6303b623cfac6d6bb05bf14dde1f5811` |
| portal/src/lib/localCustomers.ts | `702dec4cd91bf60288414e312e22d498b9d12d561ba0e48d497ae259f7c40b8b` |
| portal/src/lib/localFonts.ts | `e2cba514bc08b9fabc88afa2d811b40d22ac04fc09755a9f30918a2a44eedd4a` |
| portal/src/lib/localOrders.ts | `63434134b0c4a96b8daca20a37d05af85fc5686944686d00143db54a54d6eb20` |
| portal/src/lib/platform.ts | `e7d5288ded7ab4d90fadf44731f4bc7283fc344c13ff4c0384e7f082f283eae9` |
| portal/src/lib/schemes.ts | `f00fdc70a2df6bd0e5cfb1ff6b9186354aa412f28956ee30fe2db221a30c1058` |
| portal/src/lib/toast.ts | `136804c357a9bb4773ae4e6907759ebade963baf0ae1978b465788fa225cc60d` |
| portal/src/lib/trace.ts | `a54f507bfb5f25e0fc6a38b99759816a0619d8c2ccbcf2e72a3171871e927c5d` |
| portal/src/lib/traceHistory.ts | `ccdb1bcd11280722b041fe9fb4fd9e57e37ca7f083fab406e233a4a847665d60` |
| portal/src/lib/traceReportHtml.ts | `85b297679cba1810a09336169713c3bc459ca44615016ce2b41a64b52b5bd70f` |
| portal/src/lib/trust.ts | `b1c90403fa0e43ec05ac76fff892c0718cb00170ae810b87a077b0cf41e3f6dc` |
| portal/src/lib/zip.ts | `550ef7db0bea2658a65e4f314a3605d4ba10a45490a68a7d422860033fb3383a` |
| portal/src/main.tsx | `d4f896b8431e2995744daea33b9566e37ac5ac8735d501aa8d8cda2bd413c624` |
| portal/src/pages/Clients.tsx | `031507b564d6518031a76069f5fd833c2d235df6935a82f14eaebbf1d4311af9` |
| portal/src/pages/Fonts.tsx | `951125bf43dae9676a364c0fd5e61013c426068d6b5d30580222613604eb3b7d` |
| portal/src/pages/Issue.tsx | `489428499dbabbf8fc03047a046eadcc690191167797f13e786478257d59c852` |
| portal/src/pages/Legal.tsx | `1d91147e648395aa8501bf8a591f06326ae68cf1bf91596328eef33f927916b9` |
| portal/src/pages/Login.tsx | `ac807138ce13bb4ae0cae24df08b98d25664b996ef52fc47a5e8eca4ad94b3d4` |
| portal/src/pages/Orders.tsx | `7d052fd628966704c109e65a1e87e2a967642e5d1d1d30ecf4a4f3876c9c4091` |
| portal/src/pages/Overview.tsx | `ce4f4d7e8318709705d7f8ed4aa02aec1d7dde4ab3b40c6986716bf67b19a0c2` |
| portal/src/pages/ResetPassword.tsx | `450b3f93103fd0e84d49b31df0e783ac5a2db2abc5293ad62c65adc38adc835b` |
| portal/src/pages/Security.tsx | `422143fddf8d1f163e8ee4228ba702a79b759ac3b0232634d3a0806c0dbfbbef` |
| portal/src/pages/Settings.tsx | `fb7965f17be25e26b5254edc607789a4f39ffa72395bb1ab8c24ef01153e5320` |
| portal/src/pages/Trace.tsx | `c979d4ed74b0308579b805a5e1971c850372cf5d675cf3b770b7fc9a19308e8d` |
| portal/src/pages/VerifyEmail.tsx | `c2a653dd5a815366fca36c9bc89deb8ccc4600a1d18ee41c02b7ced0afc9ee12` |
| portal/src/styles/theme-v9-ext.css | `007b4fa73dbbcbd9dba9468c1ef285f70b8616b9fda742f7e75270648971b193` |
| portal/src/styles/theme-v9.css | `23cbfaa179099f46d4e84e5ccc3e37fd0e3fe66988d7e04d870e401f4dc407fa` |
| portal/src/vite-env.d.ts | `65996936fbb042915f7b74a200fcdde7e410f32a669b1ab9597cfaa4b0faddb5` |
| portal/tsconfig.json | `8f2c000dd69ebc121b15206fe406135410a3e2217c19c48bc5350e71301d5596` |
| portal/vite.config.ts | `f7f264e642501b7f683abb9f33be9cb63b4d83528f80290f62e7d5c0f5f77e54` |
| scripts/oss/README.md | `478195e7899e723c52a8fd9a78b5ebd92ad9bbbc42a59a1f0cbcdcc8e9041f4f` |
| tsconfig.json | `0aadf9c7deaf9e0c31d7adb1ad8aa09a63d501c52f6830927eab9555dea9d10a` |

重新生成：在主仓库运行 `npm run oss:export`。
