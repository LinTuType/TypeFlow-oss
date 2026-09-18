# TypeFlow 开源自证清单（MANIFEST）

本仓库由文镇 TypeFlow 主仓库（私有）按开源范围导出生成：**引擎（engine/）+ 门户前端（portal/）**。
签发服务端（worker/）暂不公开；「零上传」的可核验证据链全部在浏览器侧，不依赖对服务端的信任。

| 项 | 值 |
|---|---|
| 主仓库 commit | `528f443dcdf6433ac5b2cda36a8ad4c4163308ca`（branch main，工作树干净） |
| 导出时间 | 2026-09-18T03:30:32.855Z |
| 文件数 | 96 |

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
| engine/tests/e2e-portal.ts | `a9eedfe4e11dce277cd812284299c3364e6abea45345e557ba529f1677294a65` |
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
| portal/src/App.tsx | `355e848a1b0ae288c0e5b3d9ba6dc6bebef6ac675431f2629c27fb73c7767d5d` |
| portal/src/api/client.ts | `1981e322003d36784dcc5fb68ea32eb39da52b72f0206a36d72921cfac91cb88` |
| portal/src/components/AppShell.tsx | `00fa8958bd14881f85d54e423e14d2cee9d7eb6bca4f45f0334412cd0881820f` |
| portal/src/components/ErrorBoundary.tsx | `3d71bed023439924bf6b59b9cbf018d5aa9c0d180e37f02fd7709d1afe10783c` |
| portal/src/components/FontPicker.tsx | `64e7215e83874dcf388632270a938acf81a8ea85938fcf89e200f1e2a04c913c` |
| portal/src/components/GlyphPreview.tsx | `0b6ba900455d69699b0524cd68b5890004d24c4f31835803e4e0b9092fe497b5` |
| portal/src/components/Icon.tsx | `c0f0aeb97f88c9881a0d41016fe2bc32c2130735ae309e29f06de66abf04e9ea` |
| portal/src/components/IssueResult.tsx | `444692b6703ab55b0d66e1d90467b239b6893de8183036e29867e297bfbcc12b` |
| portal/src/components/LicensePaper.tsx | `389b9ef540fcf41b6716dfb5356e7ea250cb78c5543493d22faa5981e9834f2c` |
| portal/src/components/LocalDataNotice.tsx | `83a12c6b1d9e7eab993e3c864556491c9f3f8f0c2ec792a30249a1583d72add5` |
| portal/src/components/NetLog.tsx | `cd3a350221cf7626f70d517e23cd77dd5a8ba8f7b3b308b90307162b4afcfdf4` |
| portal/src/components/PageStage.tsx | `09f3c35eae01b2edc55a92f84f2752cc19c70ee265aaff94cd760ec91c7dff51` |
| portal/src/components/ProcessSlot.tsx | `62610cd55bacbe5767da877514831830394f4ff29fda84612f9afa1037dad713` |
| portal/src/components/Sidebar.tsx | `000e0efe69d1f3087e106bf7b290fee8aff5d4cf70933364fdcfabf6065caddb` |
| portal/src/components/ToastHost.tsx | `c916c32c3a7cc0eef9153761d085ccb5ddfca1785a1d876d99e874ddf0599df3` |
| portal/src/components/TraceReport.tsx | `28747ac059d24bad3d84a6fc7075f7aa20e4dc04804d45ae5d0490cf1285769b` |
| portal/src/components/ui.tsx | `09ca2ba083fffda7e8f44ed874551bb34e4fe4184d4e5ba6c4ababa377963e7e` |
| portal/src/lib/backup.ts | `8caae53363191adaae380a4c780470f0ff15eac6f5c4dbaf292be88ff119e4e1` |
| portal/src/lib/backupFolder.ts | `64eb61eb987f9186e8138a1977d0dd5ad0279d246ef79afcd29c6eeebd3bebbf` |
| portal/src/lib/db.ts | `446ee737a9223a954cd47c23330983a0f111ff4fe94890274b283abe06889d30` |
| portal/src/lib/delivery.ts | `219856d406882fd01bc898b3dae7fca17cce6f3d5d6a9fd8ef809415b04478b2` |
| portal/src/lib/embedWorker.ts | `84bccf5e3c12d4bb2556517af6e5886f77ba0a41f65c086611384489cf173c68` |
| portal/src/lib/fontFace.ts | `783ffa870c3705d263083c0743cf3912e3131ada0c6f28944a73ee50c0742796` |
| portal/src/lib/fontImport.ts | `b37de3ac9199ea26640ef6fd923bf8609b19ab37974535f20ecee35c63476bc7` |
| portal/src/lib/foundry.ts | `239295458e0052edcb574cc88e40c7bf43eda63aacb2002edf995297ed213480` |
| portal/src/lib/fsFolder.ts | `e24b2ddecc9cf295b3d3ccc5db76a219715e37912ea603fc5a8ba0e8d7f31b31` |
| portal/src/lib/issueFlow.ts | `a922002a7648a306689f16c08e55cae1c9fadebb38fb236f25ab5534c7f5f63c` |
| portal/src/lib/issuer.ts | `aabdf8d3e768c3eb1f0199a25e2ee88ec9771741299196585d64f1c829562f46` |
| portal/src/lib/license.ts | `34be21bdca5d9f5d1b6a6fef0d70868ba0a7d5c4b5e06ef62f28aa56daf4f927` |
| portal/src/lib/localCustomers.ts | `702dec4cd91bf60288414e312e22d498b9d12d561ba0e48d497ae259f7c40b8b` |
| portal/src/lib/localFonts.ts | `e2cba514bc08b9fabc88afa2d811b40d22ac04fc09755a9f30918a2a44eedd4a` |
| portal/src/lib/localOrders.ts | `9542697496d510b86bdc59e270df2577623fe83b48e44813e8b7ae932a5bd9e6` |
| portal/src/lib/mailto.ts | `25c670c0003245eb58fd8ab1e6deee466aa060c119610a39005a8831dbda3780` |
| portal/src/lib/onboarding.ts | `23fce120e8d007c2f9dbcf04f6049008da1bf56cb5ac75e7dc0deac173c50d42` |
| portal/src/lib/platform.ts | `e7d5288ded7ab4d90fadf44731f4bc7283fc344c13ff4c0384e7f082f283eae9` |
| portal/src/lib/restore.ts | `44c78421f64955b0aadfe88f35115d1b17e7313398a17c5a049a8b2821d3a7d4` |
| portal/src/lib/schemes.ts | `f00fdc70a2df6bd0e5cfb1ff6b9186354aa412f28956ee30fe2db221a30c1058` |
| portal/src/lib/sealImage.ts | `1c36a7cfbbce4f4b31e0ab10b81420bbb6f3c062594c1f3d2c516704bd2121e9` |
| portal/src/lib/toast.ts | `136804c357a9bb4773ae4e6907759ebade963baf0ae1978b465788fa225cc60d` |
| portal/src/lib/trace.ts | `a54f507bfb5f25e0fc6a38b99759816a0619d8c2ccbcf2e72a3171871e927c5d` |
| portal/src/lib/traceHistory.ts | `ccdb1bcd11280722b041fe9fb4fd9e57e37ca7f083fab406e233a4a847665d60` |
| portal/src/lib/traceReportHtml.ts | `85b297679cba1810a09336169713c3bc459ca44615016ce2b41a64b52b5bd70f` |
| portal/src/lib/trust.ts | `a8760838c6595c996ad0cb3b4e13e5aafda086dfdd6dd868e66b3584692cc439` |
| portal/src/lib/zip.ts | `550ef7db0bea2658a65e4f314a3605d4ba10a45490a68a7d422860033fb3383a` |
| portal/src/main.tsx | `d4f896b8431e2995744daea33b9566e37ac5ac8735d501aa8d8cda2bd413c624` |
| portal/src/pages/Clients.tsx | `031507b564d6518031a76069f5fd833c2d235df6935a82f14eaebbf1d4311af9` |
| portal/src/pages/Fonts.tsx | `8505265fd5546d66aaf9154c2ece444ed255c874becab06323cffc17e96730a8` |
| portal/src/pages/Issue.tsx | `1f936821b043bc9d5f8a1047b87357a57eeb88136ee48bcb8548fac973edfbff` |
| portal/src/pages/Legal.tsx | `c90271454e609564a2839a3ec19ed68e9395847776644ccc272f8d25aa1e048c` |
| portal/src/pages/Login.tsx | `d2d56fd2d6bf3810c26721bf2f1ce2fb34ee83c03abd5f12536b988178329cbf` |
| portal/src/pages/Orders.tsx | `734b1e252805e7d379cab4e0b609c0caa6952ef41df7def72363a4914b8a5b81` |
| portal/src/pages/Overview.tsx | `e4e5ef2aee4854b406c8c375ae58de7bd666859ba1f68c7877c87eb931983870` |
| portal/src/pages/ResetPassword.tsx | `450b3f93103fd0e84d49b31df0e783ac5a2db2abc5293ad62c65adc38adc835b` |
| portal/src/pages/Security.tsx | `73771c8f4bd86451f48f5a438d3111fc5ce7b186727398726c07bca160202f47` |
| portal/src/pages/Settings.tsx | `59198ada434c8dbe95f2775a6fe20f099d5893a51e2a8620b77db91ac9806eb7` |
| portal/src/pages/Trace.tsx | `c979d4ed74b0308579b805a5e1971c850372cf5d675cf3b770b7fc9a19308e8d` |
| portal/src/pages/VerifyEmail.tsx | `c2a653dd5a815366fca36c9bc89deb8ccc4600a1d18ee41c02b7ced0afc9ee12` |
| portal/src/pages/Welcome.tsx | `21afa3c06edfad560fbfe1f75b2d01f92d439b463997342dbf923562183b3550` |
| portal/src/styles/theme-v9-ext.css | `de47abf5e7d3ce23b08e9f957c4d06eccc5ffb6290ad5a0912601038149bf797` |
| portal/src/styles/theme-v9.css | `23cbfaa179099f46d4e84e5ccc3e37fd0e3fe66988d7e04d870e401f4dc407fa` |
| portal/src/vite-env.d.ts | `65996936fbb042915f7b74a200fcdde7e410f32a669b1ab9597cfaa4b0faddb5` |
| portal/tsconfig.json | `8f2c000dd69ebc121b15206fe406135410a3e2217c19c48bc5350e71301d5596` |
| portal/vite.config.ts | `f7f264e642501b7f683abb9f33be9cb63b4d83528f80290f62e7d5c0f5f77e54` |
| scripts/oss/README.md | `478195e7899e723c52a8fd9a78b5ebd92ad9bbbc42a59a1f0cbcdcc8e9041f4f` |
| tsconfig.json | `0aadf9c7deaf9e0c31d7adb1ad8aa09a63d501c52f6830927eab9555dea9d10a` |

重新生成：在主仓库运行 `npm run oss:export`。
