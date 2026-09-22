# 节点版本视图 · 设计稿回写与「设计有 / 实现无」缺口收口 开发计划

> 日期：2026-09-21。来源：用户「分析现在版本查看对比实现的进度」→「现在的 pencil 界面是否已经有了」→
> 「把设计稿补到当前实现：不动已定稿的 S0–S3，新增 S4 / S5 两帧并重新导出 PNG，然后用 plannotator 制定开发计划」。
> 上位计划：`docs/plans/2026-09-18-model-version-compare-gen-model-v1-migration-plan.md`（§10 节点版本视图、§11 / §11.1 三维联动）；决策 ADR 0066；
> 词条 `CONTEXT.md`「模型版本查看」一节。
> 设计稿：`plant-10/design/node-version-history.pen`——**09-21 16:24 新增 S4「三维联动实况」与 S5「树差异模式」**，S0–S3 / F1 / F2 一字未动；
> 九帧导出 `docs/plans/2026-09-18-node-version-view-design/`（S0–S3 / F1 / F2 重导后字节数与 09-18 22:18 那批逐一相同 = 定稿帧确实没动）。
> 前端基线：plant3d-web `main@0bc598e1`（PR #79 已合）+ 工作树未提交改动（§1.3）；后端 gen-model-refactor `0b2bf527b` + 未提交 `src/fast_model/attribute_diff.rs`。
>
> 状态：用户 16:3x 拍板 **「D1–D6 全按推荐，直接从 P0 开干」**；**P0 / P1 / P3-a / P3-b / P3-c / P2-a / P2-b 全部完成**（§8 执行记录），~~只剩 **P2-c**（等后端 `attribute_diff.rs` 提交）与设计稿 S4 注 5 / 注 6 改口（等 .pen 被打开）~~
> **09-22 全部收完**：十笔真机 / e2e 补齐（三档显卡）、P2-c 真机（`:8022` 换成后端工作树构建）、S4 注 5 / 注 6 改口 + 重导——见 §8 末三节。后端 `attribute_diff.rs` 那半仍由另一条会话提交。

## 0. 一句话

设计稿与实现在 09-18 22:48 定稿后分叉：实现多出一整套三维联动与树差异模式（已回写成 S4 / S5），设计稿里则有**六处**实现没做或做法不同。
本计划先把工作树里混在一起的三份改动分开提交（P0），再按「便宜的先做、要拍板的等拍板、依赖后端的等后端」收那六处（P1–P3），
每项写清做法、验证与设计稿回写点。不改后端口径的事只记不做。

## 1. 已核实的基线（2026-09-21 15:5x–16:2x 查证）

### 1.1 已合入 `main` 的部分

| 层 | 状态 | 要点 |
|---|---|---|
| 取数迁移（09-18 计划 §1–§7） | ✅ | B / A1 / A2 / A3 + legacy 版本链退役六组；09-20 `0b2e317c` 整个 legacy 数据源退役 |
| 端口 `ModelVersionSource` | ✅ | `listVersions / listElementVersions / loadVersion / attributesAt / attributeHistory / listNodeVersions / diffSummary`；旧服务端 404 → `ModelVersionRouteUnavailableError` 回落 |
| 节点版本视图（ADR 0066，`061c83b2`） | ✅ | 范围开关、时间线点选 A/B、与上一版比 / 与最新比、属性对比 tab（时间线折净差）、模型对比 tab（差异摘要按单元分组 → 逐组「在三维中对比」）、「仅属性」（`91e7480f`）、三入口 |
| 模型树差异模式 | ✅ | 徽章 / 幽灵行 /「当前已不在」/ 底部 `ModelVersionAttrDiffPanel` /「在 3D 中定位」/ 属性面板「已删除」登记 |
| 三维联动（§11 / §11.1，PR #79） | ✅ | 四态着色、单视口角标 + 图例、「三维只看差异」、单视口点 A/B 构件 → 属性面板读那一版 |
| e2e | ✅ | `model-version-compare-gen-model-v1.spec.ts` 4 条 × 两夹具、`node-version-view-gen-model-v1.spec.ts` 2 条（09-22 起 3 条，见 §8 末） |

### 1.2 设计稿 vs 实现（逐帧读 .pen 文字核出来的）

**设计有 · 实现有** ✅：三入口、范围开关 + 叶子置灰、时间线一行一会话（user / comment / 属性 n / 影响芯片 /「单元 n」）、「只看几何变的」、
「与上一版比 / 与最新比」、点两行选 A/B、属性对比 tab（戳 / 显示未变）、差异摘要五格、按单元分组 + 「包含未变化」、S3「本节点」置顶、
切回仅自身时 A/B 保留 + 「本范围无变化」灰行 + 空态、运行态卡（单视口 / 分屏 / A-B 卡 / 环境刷新）。

**设计有 · 实现没有或不一样** ⚠️（本计划的对象）：

| # | 设计稿 | 实现现状 | 收口 |
|---|---|---|---|
| G1 | S2 时间线「只看自身变的」筛选 | 没做（只有「只看几何变的」，`ModelUnitVersionComparePanel.vue:977`） | P1-a |
| G2 | S3 属性对比 tab 每行「定位」 | 面板里没有（`定位` 只出现在注释；只有树差异模式底部那块有「在 3D 中定位」） | P1-b |
| G3 | S1「加载更早 47 版…」分页 | 适配器按 `since_sesno` 连续拉全表（≤ 20 页），时间线一次全列 | P1-c（拍板 D2） |
| G4 | S2 一颗「在三维中对比（N 个单元 · M 份历史投影）」+ S2b「正在生成历史投影 3 / 4」进度 | 每组一颗按钮、一次装一个单元（面板头注「多单元一次装载下一期」） | P2-a（拍板 D3） |
| G5 | S2b ② 超 20 单元确认对话框（全部生成 / 先装 20 / 取消 / 继续） | 只在摘要下出一行 `needsConfirm` 琥珀提示（`:1205`），不弹框 | P2-b（拍板 D4） |
| G6 | S3「成员 +1 / 成员重排」 | 折时间线那条路只能说「动过」；已暂存的 `attributeDiff` 才给两端真差，后端路由未提交 | P2-c（拍板 D5） |

**实现有 · 设计稿没画** 🆕（09-19 之后加的，**本轮已回写成 S4 / S5**）：「仅属性」徽章与「本范围 n 版 · 仅属性 m」；三维四态着色 + 角标 / 图例 +
「三维只看差异」；点 A/B 构件 → 属性面板「属性来自版本 A · sesno n」横幅（单视口 + 分屏）；容器分组进三维的侧注脚；树差异模式整套
（幽灵行三种、底部属性历史对比三种横幅、属性面板「该构件已删除」）；旧服务端回落文案。

### 1.3 工作树未提交（`git status`，09-21 16:0x）

- **未暂存**（16 文件 +609/−87）：分屏拾取 + 环境按格 GPU 拾取 + 每格描边合成器（README §8.2 / §8.3）、容器分组 tombstone 侧（§8.4）；
  `CHANGELOG` / `CONTEXT` / plan §11.1 / README 都已写。**都已真机验、单测 / e2e 过，只差 commit。**
- **已暂存**（19 文件 +817/−271，混了三件事）：① `attributeDiff`（端口 + v1 适配器 + `genModelV1Api` DTO + 面板 `viewFromAttributeDiff / viewFromFold /
  emptyNetDiffText` + `nodeVersionTimeline` 纯函数 + 测试）——**没有 CHANGELOG 条目、plan §10 没记**；② 模型树无名构件短名（09-20，CHANGELOG 已有条目）；
  ③ 净距 `SpatialClearance*` 类型 + surface-clearance 两份文档（另一条线）。
- 后端：`gen-model-refactor/src/fast_model/attribute_diff.rs` **untracked**、`handlers.rs` modified；运行中的 `:8022`（`a382b2cf3`）对 `element/attribute-diff` 回 404。

### 1.4 本轮验证

工作树现状 `npx vitest run` 九个版本对比相关文件（面板 / 纯函数 / 时间线 / v1 适配器 / 树差异 / 属性历史面板 / 属性面板钉住 & 已删除 / GPUPicker）：
**9 文件 / 86 用例全绿**（2.4 s）。全仓 vitest、e2e、真机本轮未跑。

## 2. 分期

### P0 · 收工作树（不写新功能，半天）

- **P0-a** 未暂存的 16 文件按两件事提交：`feat(viewer): 版本对比分屏也能点构件——按格造射线、环境 GPU 拾取子视口、每格描边合成器（plan §11.1，README §8.2 / §8.3）`
  与 `fix(model-version): 容器分组进三维时 A 时没建 / B 时已删的单元按 tombstone 侧装（README §8.4）`；CHANGELOG 两条已在。
- **P0-b** 已暂存的拆三笔：`feat(model-version): 属性净差接 element/attribute-diff，旧服务端回落折时间线（ADR 0066 第四条路由，前端半边）` —— **补 CHANGELOG 条目 + plan 09-18 §10 追记一条**；
  `feat(model-tree): 无名构件按 E3D 规矩起名，默认短名可切全称`（CHANGELOG 条目已在）；`SpatialClearance*` 类型 + 两份文档退回未暂存，交给净距那条线的会话。
- 出口：全仓 vitest 全绿；`node scripts/type-check.mjs` 基线外 0；ESLint 触及文件 0；`PLAYWRIGHT_PORT=3111 npx playwright test e2e/model-version-compare-gen-model-v1.spec.ts e2e/node-version-view-gen-model-v1.spec.ts --workers=1` 全过。
- 拍板 **D1**：`attributeDiff` 前端半边现在提交（有回落、后端没路由时行为与今天一样）还是等后端 `attribute_diff.rs` 落地一起？**推荐现在提交**。

### P1 · 设计有、实现无 · 便宜的（纯前端，1 天）

- **P1-a（G1）✅（16:5x）「只看自身变的」**：`所有子节点` 下时间线头加勾选 `selfOnly`（`data-testid="model-unit-compare-self-only"`），筛 `row.selfImpact !== null || row.attributeChangeCount > 0`
  （自身列未知 `unitColumnOnly` 时置灰、不筛）；`utils/nodeVersionTimeline.ts` 的筛行纯函数加一维；与「只看几何变的」可叠加。单测 +2；e2e `node-version-view` 容器那条加断言（勾上后行数 ≤ 未勾）。
- **P1-b（G2）✅（16:5x）S3 每行「定位」**：属性对比 tab 的构件行加「定位」——已装 A/B 时派版本对比事件 `focus`（走 `focusModelUnitVersionCompare`，并 A/B 两层包围盒找，幽灵也能飞）；
  没装时 `locateRefno` 飞环境模型；当前树里没有的（B 版之后又被删）且没装 A/B 时按钮置灰、title 说明。单测 +1（两种分支各派什么事件）。
- **P1-c（G3）✅（19:0x，选 (b)）「加载更早 n 版…」**：拍板 **D2**——(a) 不做（v1 全表冷 2–7 s、`since_sesno` 命中缓存 20 ms，用户没抱怨）；(b) **只改展示**：缺省渲染最近 20 行 + 一行「加载更早 n 版…」
  点开全列，取数不动；(c) 取数也分页（`limit` + 「加载更早」再拉）。**推荐 (b)**——设计稿的样子、零后端、不影响 e2e 数字（计数仍按全表）。

### P2 · 设计有、实现不一样 · 要拍板（2–3 天）

- **P2-a（G4）✅（19:4x）多单元一次装载**：面板 `runCompareGroups(groups)`——按摘要组顺序两侧 `loadVersion`（并发 ≤ 2），每装好一组就派 `open`（或新增 `append` 事件）进隔离图层，
  进度卡「正在生成历史投影 n / m · <unit>@<sesno>」按份数走（tombstone 侧不计份）；`open` detail 从单单元扩成 `units[]`，四态计划 `planModelUnitCompareObjectStyles` 仍按 refno 查 rows、不受影响；
  退出 DELETE 全部快照；「三维只看差异」/ 角标 / 分屏拾取对多单元同样成立（角标只说版本，不说单元）。拍板 **D3**：做不做；缺省上限（建议 ≤ 20 单元，超过走 P2-b）。
- **P2-b（G5）✅（19:4x）阈值确认对话框**：`diffSummary.needsConfirm` 时弹确认（全部生成 / 先装变化最大的 N 个 / 取消），阈值与预估份数由后端给（核 `node/diff-summary` 回执字段名：`needs_confirm` /
  预估份数字段——README §7 记的是 `needs_confirm`，份数字段要核）；「先装 N 个」排序按组内变更数。**依赖 P2-a**。拍板 **D4**：与 P2-a 绑定（P2-a 不做则本条也不做，逐组装载本就不超阈值）。
- **P2-c（G6）成员 / owner 真差 ✅（09-22 15:4x 真机 + e2e，见 §8 末；后端那半仍未提交，`:8022` 跑的是工作树快照）**：前端已暂存消费 `members.added / removed / reordered` 与 `owner [A, B]`；等 gen-model-refactor `attribute_diff.rs` 提交并起到 `:8022` 后真机
  （SITE 24384/22399 573→628 子树点开 BRAN 24384_23257 应出「成员重排」，EQUI 24384_24776 出「成员 +1」），e2e 容器那条加断言。拍板 **D5**：后端那半由谁 / 何时提交（正在改的是另一条会话）。

### P3 · 实现自己记下的缺口（设计稿没提，1 天）

- **P3-a ✅（17:1x）** 容器的 `compare_a / compare_b` URL 参数不生效：`autorunFromUrl` 在 `!hasUnit` 之前先把这对套到时间线（不跑对比、不装几何）；不在表里照旧回落最近两版并提示。单测 +1；e2e 容器那条加 URL 变体。
- **P3-b ✅（17:1x）** 换组分屏回单视口：`runCompareGroup` close→open 时把当前 `viewMode` 带进 `open` detail（`viewMode?: 'single' | 'split'`），ViewerPanel 就位后按它切；缺省仍单视口。单测 +1；e2e 管道分组一条。
- **P3-c ✅（19:5x，选 (c)）** 分屏描边合成器去留（README §8.3：RX 590 每格 +0.8–1.1 ms、软渲染 11 fps）：拍板 **D6**——(a) 留（两条路一致、选中两格描边）；(b) 退回直接 render（选中靠 `setObjectColor` 橙色，分屏暗一档回来）；
  (c) **留，但无硬件加速时自动退回**（`WEBGL_debug_renderer_info` 认出 SwiftShader / llvmpipe 就走直接 render）。**推荐 (c)**。
- **P3-d** FTUB 纯 POS 变更被归 `mesh` 而非 `placement`：gen-model-refactor 分类器口径，**不在本计划**，只记。

## 3. 设计稿回写点

- S4 / S5 已按 09-21 实现回写（本轮）。S0–S3 / F1 / F2 不动。
- P1-a / P1-b / P2-a / P2-b 做完 = 实现追上设计稿，**设计稿不用改**；P1-c 选 (b) 同样不用改。
- P3-a / P3-b 做完改 S4 注 6 那句「换组 = close 再 open，分屏回单视口（未动）」；P3-c 拍板后改 S4 注 5 末句「去留待拍板」。
  **✅ 09-22 15:5x 改口**（`plant-10/design/node-version-history.pen` 15:57 存盘）：注 5 末句 → 「09-21 拍板：留，认出软渲染（SwiftShader / llvmpipe / Microsoft Basic Render Driver）就自动退回直接 render，分屏摘要下照实说一句（P3-c，09-22 两档真机都过）」；
  注 6 → 「不止一组时一颗总按钮『全部变了的单元一起进三维』（按份并发 ≤ 2、进度『正在生成历史投影 n / m』，> 20 个或服务端要确认先问；S2 / S2b，P2-a / P2-b）；换组 = close 再 open，分屏跟着保持不掉回单视口（P3-b）」；
  分屏那格的 Footnote 里「去留待拍板（README §8.3）」同步改「留着，软渲染自动退回直接 render（README §8.3 / §8.5）」。Notes 列 576 高、没有裁切；只重导了 S4 一帧（`S4-3d-linkage-live.png` 3120×1524），其余八帧一字未动不重导。
- 每次改 .pen 后重导九帧到 `docs/plans/2026-09-18-node-version-view-design/`（导出名按帧：`S4-3d-linkage-live.png` / `S5-tree-diff-mode.png`）。

## 4. 验证口径（每项都要）

- vitest 涉及文件全绿；`node scripts/type-check.mjs` 基线外 0 新增；ESLint 触及文件 0（`ViewerPanel.vue:27/28` 那条 import 分组空行是 HEAD 就有的，不算）。
- e2e：`PLAYWRIGHT_PORT=3111 npx playwright test e2e/model-version-compare-gen-model-v1.spec.ts e2e/node-version-view-gen-model-v1.spec.ts --workers=1`（dev `:3111` + `:8022`；缺省夹具 `24384_26480` 与 `MODEL_VERSION_E2E_UNIT=24384_23257` 各跑一遍）。
- 真机截图 + 请求账进 `docs/verification/model-version-compare-gen-model-v1-2026-09-18/`，README 追一节；CHANGELOG 一条；09-18 plan 追记。
- 声称完成必附「跑了什么、结果如何」；跑不了的标未验证 + 原因。

## 5. 明确不做

- 不做后端 diff 接口、不做全库版本树、不找回 release 线（沿 09-18 计划 §6）。
- 不改 `element/versions` / `node/versions` 的模型口径（「仅属性」按前端并集处理，09-19 拍板）。
- 不动 S0–S3 / F1 / F2 定稿帧；不并「三维只看差异」与「包含未变化」两个开关（有意分开）。
- 分类器 `mesh` vs `placement` 口径（P3-d）不在本仓。

## 6. 要拍的决策

| # | 问题 | 选项 | 推荐 |
|---|---|---|---|
| D1 | `attributeDiff` 前端半边何时提交 | 现在 / 等后端一起 | 现在（有回落，行为不变） |
| D2 | 「加载更早 n 版…」 | 不做 / 只改展示（最近 20 行 + 展开）/ 取数也分页 | 只改展示 |
| D3 | 多单元一次装载 | 不做（保持逐组）/ 做，缺省上限 ≤ 20 单元 | 做，上限 20 |
| D4 | 阈值确认对话框 | 与 D3 绑定 / 独立 | 绑定 |
| D5 | 后端 `element/attribute-diff` 落地 | 谁 / 何时提交 `attribute_diff.rs` | 等另一条会话提交后接真机 |
| D6 | 分屏描边合成器 | 留 / 退回直接 render / 留但软渲染自动退回 | 留但软渲染自动退回 |

## 7. 顺序建议

P0（半天）→ P1-a / P1-b（半天）→ P3-a / P3-b（半天）→ P1-c（D2 定后 2 小时）→ P2-a + P2-b（D3 / D4 定后 2 天）→ P3-c（D6 定后半天）→ P2-c（等 D5）。

## 8. 执行记录

### P0（2026-09-21 16:3x–16:4x）

工作树是多条会话共用的，三笔都用临时索引（`GIT_INDEX_FILE`）从 HEAD 树 + 指定 blob / hunk 拼出来提交，**没有碰别的会话暂存着的内容**
（`history.txt`、`PropertiesPanel.deleted.test.ts` 那一行、`genModelV1Api.ts` 里净距块的搬家、两份 surface-clearance 文档仍留在暂存区；
房间层级树 PR-D 那批未跟踪 / 未暂存文件一律没动）。

| 提交 | 内容 | 备注 |
|---|---|---|
| `0f7b46ed` `feat(model-tree)` | 无名构件短名（9 文件，CHANGELOG 条目原已在） | `genModelV1Api.ts` 只取 `EleTreeNodeDto` 那一个 hunk |
| `ecc65fb7` `feat(model-version)` | `attributeDiff` 前端半边（9 文件）+ **新写** CHANGELOG 条目 + 09-18 plan §10 追记 | D1 按推荐「现在提交」；真机未验（`:8022` 无此路由，走回落） |
| `fc726fd3` `feat(viewer)` | 分屏拾取 + 每格描边合成器 + 容器分组 tombstone 侧（34 文件，含 3d-diff-color 证据 24 个） | **P0-a 原定两笔并成一笔**：§8.2 / §8.4 的 hunk 在 `ViewerPanel.vue` / 纯函数 / 测试 / 四份文档里交错，拆开要按 hunk 手切、中间态难保证能编译，改为一笔、提交说明分两段写 |
| `1cac05b1` `fix(viewer)` | 修正 `fc726fd3` 三处错位 | 见下条 |

- **`fc726fd3` 的错位与修正**：为了把工作树里已写好但无单测无文档的 P3-a / P3-b 代码（容器 `compare_a/b` 套时间线、换组保留 `viewMode`）留在工作树不入这笔，
  三个文件按 hunk 排除后用 `-U0` 补丁进临时索引；被排除 hunk 之后的行号漂移，`ViewerPanel.vue` 两段（`attachPicking` 的 `const down` 落到清空之后；分屏两枚角标的 tombstone
  `<span>` 错格）与 `modelUnitVersionCompare.ts` 一段（`ModelUnitVersionCompareEnvironment` 类型块拆散）插错了位置——**`fc726fd3` 本身不可编译**。
  `1cac05b1` 用工作树内容反向去掉 P3 hunk（带上下文）重建三个文件，与工作树逐字一致。中途一次 `--amend` 落到了别的会话刚提交的 `14ece7b6` 上，
  已把 `14ece7b6` 原样放回、修正另起 `1cac05b1`；一次被 shell 包装层改写的 `git commit-tree` 误把别的会话的暂存内容提交成 `601ced69`，已 `reset --soft` 撤回、暂存区复原。
- **验证（HEAD `1cac05b1`，另开 detached worktree `D:\tmp\wt-head` + node_modules junction）**：vitest 版本对比 / 模型树相关 10 文件 **100 用例全绿**；
  `node scripts/type-check.mjs` 504 条 / 基线 539，基线外只有 `pmsContractSequence.test.ts` TS6307 一条——是 worktree 绝对路径不同造成的基线键漂移，与本轮改动无关；
  ESLint 22 个触及文件只剩 `ViewerPanel.vue:28` 那条 HEAD 就有的 import 分组空行。**未跑**：全仓 vitest、e2e（dev `:3111` / `:8022` 未起）。
- **仍在工作树、未提交**：P3-a / P3-b 那 39 行（`ModelUnitVersionComparePanel.vue` / `ViewerPanel.vue` / `modelUnitVersionCompare.ts`）——归 P3 时补单测 + 文档再提；
  设计稿 S4 / S5 PNG 与本计划随 `docs(plan)` 另一笔提交。
- **教训**：共享工作树上别用 `--amend`（别的会话随时会在你后面提交）；按 hunk 拆提交要带上下文（`-U3` + `apply -R`），不要 `-U0`。

### P1-a / P1-b（2026-09-21 16:5x–17:0x）

- **P1-a「只看自身变的」**：`filterNodeTimelineRows(rows, { scope, selected, geometryOnly, selfOnly, selfColumnUnknown })` 收掉面板里原来内联的筛法，
  `selfOnly` 只在 `subtree` 下生效、`selfColumnUnknown` 时不筛；面板时间线头 `scope === 'subtree'` 才露出勾选（`data-testid="model-unit-compare-self-only"`，
  自身列未知时 `disabled` + title 说明），与「只看几何变的」（补了 `data-testid="model-unit-compare-geometry-only"`）并排。
- **P1-b「定位」**：属性对比 tab 每行右侧一颗（`model-unit-compare-element-locate-<refno>`），`locateElement` = `ensurePanelAndActivate('viewer')` + 派 `focus`；
  `canLocateElement`：`compareActive || status !== 'deleted'`（B 侧已删且没装 A / B 时置灰）。`ViewerPanel.focusModelUnitVersionCompare` 去掉「没装 A / B 就 return」，
  A / B 两层找不到时回落到主图层 `o:<refno>:` 前缀的对象并起包围盒；回落找到的按普通选中（「已删除」登记的保护只对隔离图层命中生效）；哪儿都没有仍不动相机。
- **验证**：vitest `nodeVersionTimeline.test.ts` +2（selfOnly / 叠加 / 未知列 / 选中保留）、面板 +2（勾选露出与筛行、定位派事件与置灰）→ 两文件 32 过；
  `node scripts/type-check.mjs` 基线外 0 新增；ESLint 只剩 `ViewerPanel.vue:28` 那条既有的。**真机未跑**、e2e 未跑（dev `:3111` 未起）——`node-version-view` 容器那条
  加「只看自身变的」断言留到下次起 dev 时一并补。
- 设计稿：G1 / G2 两处实现追上设计稿，S2 / S3 不用改。

### P3-a / P3-b（2026-09-21 17:0x–17:2x）

- 代码是 P0 之前就在工作树里的那 36 行（别的会话写的，当时无单测无文档、README 还写着「未动」）：`autorunFromUrl` 的容器分支（`wantPair` / `pairIn` / 切 `subtree` / 落 `model` tab / 提示原文）、
  `runCompareVersions` 在 `close` 前记 `keepViewMode` 随 `open` 带走、`ModelUnitVersionCompareOpenDetail.viewMode?`、ViewerPanel 就位后 `setModelUnitCompareViewMode(detail.viewMode)`。逐行核过，没改。
- 补：面板单测 +2（P3-a：791 只在子树里 → 自动切「所有子节点」、A=791 B=897、模型对比 tab、不 `loadVersion` 不派 `open`；`compare_a=5` 不在链上 → 提示、范围与缺省 A / B 不动。
  P3-b：三组连开，第一组 `open` 不带 `viewMode`，视口就位成 split 后第二组带 `'split'`，回 single 后第三组带 `'single'`）；README §8.4 末两条、09-18 plan §11.1 末句改口；CHANGELOG 一条。
- **验证**：vitest 面板 20 过；type-check 基线外 0 新增；ESLint 只剩 `ViewerPanel.vue:28` 那条既有的。**真机 / e2e 未跑**（dev `:3111` 未起）——e2e 两条变体（容器 URL 直达、管道分组换组仍分屏）留待下次起 dev。
- 设计稿：S4 注 6 那句「换组 = close 再 open，分屏回单视口（未动）」**待改口**——Pencil MCP 只对编辑器里当前活动的 .pen 生效，此刻活动的是别的会话正在改的
  `ui/空间查询/room-hierarchy-tree.pen`，不抢焦点；等 `node-version-history.pen` 再被打开时改一句并重导 `S4-3d-linkage-live.png`。
- 提交 `aaa2d2c2`。顺带查清 CHANGELOG 行尾的来龙去脉（逐提交按字节数）：`0bc598e1` 起纯 LF；`ecc65fb7`（本计划 P0-b）用脚本插条目时带进 4 行 CRLF（混行尾）；
  `b414a70d`（别的会话）整文件转成 CRLF；`1d0ba873` 号称「恢复 LF」但 blob 仍是 245 行全 CRLF——没恢复成；之后所有提交（含本计划的）都是全 CRLF。
  本仓 `*.md` 624 个 CRLF / 36 个 LF / 5 个混，`src/**` 也是 CRLF 为主，没有 `.editorconfig` / `.gitattributes` / prettier `endOfLine`——**CHANGELOG 现状（全 CRLF）与仓内多数一致，不再改**；要统一行尾是另一件事（加 `.gitattributes` 一次性归一），不在本计划。

### P1-c（2026-09-21 18:4x–19:0x，D2 选 (b) 只改展示）

- `sliceNodeTimelineRows(rows, { expanded, selected, initial = NODE_TIMELINE_INITIAL_ROWS(20) })` → `{ rows, hidden }`：从最近那版起连续切 20 行，被选为 A / B 的行在折起那段里时切点顺延到它
  （URL `compare_a` / 「与上一版比」选到很早的会话也看得见），`expanded` 或不够 20 行时整表 / `hidden = 0`。
- 面板：`timelineExpanded`（`loadVersions` 重载折回；切范围 / 勾筛选不折）→ `timelineSlice = slice(visibleTimelineRows)`；`<ul>` 只画 `timelineSlice.rows`，`</ul>` 后一颗
  `model-unit-compare-timeline-more`（`data-hidden`，文案「加载更早 n 版…」，title 说明不再请求服务端）。计数 `timelineCounts` 仍按全表。
- e2e：`model-version-compare-gen-model-v1.spec.ts` 数全表前先等第一行可见、点开那一行（3 s 内没有 = 没折）；`node-version-view-gen-model-v1.spec.ts` 加 `expandTimeline()`，叶子那条断言折起时正好 20 行 + 有「加载更早」、点开后那一行消失，
  容器切「所有子节点」后先点开再数 `inScopeRows`。**计划 §1 说「不影响 e2e 数字」不对**——e2e 是数 `li` 的，不改 spec 就会挂（叶子 53 版、子树 298 版），这次一并改了。
- **验证**：vitest `nodeVersionTimeline.test.ts` +2（切 20 / 折数 / 点开 / 不够 20 不折；选中顺延 / 选在前 20 不多露 / null 不算 / 选最早全列）、面板 +1（25 版：20 行 + 「加载更早 5 版」、
  「本范围 25 版」按全表、缺省 A / B 在段内、点开 25 行且不再 `listVersions`、换节点重载折回）→ 两文件 **37 过**；type-check 基线外 0 新增；ESLint 触及 6 文件 0。
  **真机 / e2e 未跑**：`:3111` 在，但它连的 `:8022` 没起（`:8027` 那台是房间线的构建，没有版本路由）。
- 设计稿：S1 画的就是这个样子（「加载更早 47 版…」一行），不用改。

### P2-a / P2-b（2026-09-21 19:2x–19:5x，D3「做，上限 20」/ D4「绑定」）

- **装载路合一**：`runCompareUnits(pairs)` 单单元与多单元同一条——每单元 A / B 两侧各一份 `loadSide`（同 geometryKey 只取一份两侧共用、tombstone 侧适配器回空集不算份），
  两个工位并发 ≤ 2 顺序领活，进度 `compareProgress { done, total, current[] }`（份 > 2 才露卡，单单元不露）；一份失败 / 本次被更新的请求作废就不再开新份，
  本次已取到的几份全部还回去（`releaseTaken`，从前半路失败会漏快照）。装完每单元各比一份差异（`compareModelUnitGeometry`）、树差异模式每单元各折一份拼起来
  （`dispatchTreeDiff(units[])`，B 侧 tombstone 的单元根照旧进树）、`attributesAt` 按 refno 找它属于哪份几何，然后**一发** `open`。
- **`open` detail 扩成多单元而 ViewerPanel 几乎不动**：`before` / `after` 用 `mergeModelUnitVersionSides` 把各单元那一侧并成一侧（entries 合表、refnos 拼接、`version` 借容器身份 +
  第一个单元的 sesno、每个单元都不存在才整侧 `tombstone`），`rows` 拼起来，`units[]` 各自一份，`unitRefno` = 容器；单单元 detail 与从前**逐字相同**（不带 `units`）。
  ViewerPanel 只改三处：目标 refno 加上每个单元根、环境按每个单元根整单元藏（`collectModelUnitTargetObjectIds` 接 `string | string[]`）、`__modelUnitVersionCompare.units`。
  四态着色（按 refno 查 rows）/ 角标 / 「只看差异」/ 分屏拾取 / 点 A / B 构件读那一版，对合起来的一侧原样成立。
- **与计划原文的出入**：计划写「每装好一组就派 `open`（或新增 `append` 事件）」——实际是**装完一发 `open`**：ViewerPanel 的 `openModelUnitVersionCompare` 是一次性的
  （清层 → 藏环境 → 建两层 → 装 → 上色 → fit），逐组 append 要它可重入（再进层、重 fit、重上色、重算 hidden），改动面大过收益；进度在面板卡上看，装完一起进三维。
  阈值确认做成面板里的**内嵌卡**（`role="alertdialog"`）而不是模态框：同一面板里答，不抢焦点、不遮三维。
- **P2-b**：`runCompareGroups` 在 `groups.length > MODEL_UNIT_COMPARE_MAX_UNITS(20) || diffSummary.needsConfirm` 时把那批组放进 `pendingGroupsConfirm` 先问；
  「全部生成」/「先装变化最大的 20 个」（`pickMostChangedGroups`：added + deleted + modified 从大到小、noop 不算、同分保持摘要顺序；只在超上限时露出）/「取消」。
  换 A / B、换范围（`loadDiffSummary`）、换节点重载都收掉没答的框。总按钮 `model-unit-compare-run-groups` 只在不止一组时露出，注「N 个单元 · 约 M 份历史投影」
  （`countGroupProjections` 客户端按 tombstone 侧算，服务端 `estimatedProjections` 只在 `needs_confirm` 那行提示里说）。
- **面板文案**：运行态卡「N 个单元 · <容器> 下 · DB」；A / B 卡「n 个单元该版本单元已删除：…」/「…该版本没有这个单元：…」（`absentUnits`）；几何差异摘要标题
  「N 个单元 · 几何差异（…）」；被装的组标「三维中」，多单元时「三维中 · 只看这组」（点它 = 只看那一组）。差异摘要下那行 `needs_confirm` 提示改口（不再说「一次只装一个」）。
  面板文件头注释、09-18 plan §10「多单元一次装载下一期」改口。
- **验证**：vitest `modelUnitVersionCompare.test.ts` +2（合侧 / 单元根一串 / 藏环境；挑变化最大 / 份数）、`ModelUnitVersionComparePanel.test.ts` +2（三组：并发 ≤ 2 逐步放行看进度 0/4 → 2/4 → 3/4、
  一发 `open` 带 `units` 三个、两侧并起来、rows 拼接、A / B 卡注脚、再点一组回单单元；22 组：先问 / 取消不装 / 先装 20 个掉的是 X0 与 X1 / `needsConfirm` 全部生成 6 份）
  → 版本对比相关 9 文件 **99 过**；type-check 基线外 0 新增；ESLint 只剩 `ViewerPanel.vue:28` 那条既有的。**真机 / e2e 未跑**（`:8022` 未起）——e2e 容器那条加了守卫段
  （不止一组且 ≤ 20 且服务端没说要确认才点总按钮，断言摘要标题「N 个单元」、`__modelUnitVersionCompare.units.length`、总按钮「三维中」）；真机夹具 SITE 24384/22399 630→632 只有一组，走不到那段，
  要看多单元得挑 PIPE 24384_23225 300→380（5 组）那样的对。
- 设计稿：S2 那一颗总按钮与 S2b「正在生成历史投影 3 / 4」/ 确认框 ②，实现追上了；S4 注 6 那句「一次一个单元，S2 画的一颗总按钮 + 进度未做」**待改口**（Pencil 活动文件仍是别的会话的）。

### P3-c（2026-09-21 19:5x，D6 选 (c)「留，但软渲染自动退回」）

- `utils/three/webglRendererInfo.ts`：`readWebGLRendererInfo(gl)` 先读 `WEBGL_debug_renderer_info.UNMASKED_RENDERER_WEBGL`、没扩展退回 `gl.RENDERER`、抛错 / 没上下文当不知道；
  `isSoftwareRendererName` 认 SwiftShader / llvmpipe / softpipe / Microsoft Basic Render Driver / software rasterizer 一类。**读不到不降级**（Chrome 缺省 `RENDERER` 只回「WebKit WebGL」）。
- ViewerPanel：`resolveModelUnitCompareSplitOutline(viewer)` 按上下文定一次、缓存，`localStorage['plant3d-web.viewer.splitOutline']` = `compositor` / `direct` 可强制；
  `renderModelUnitCompareScene` 的 `useCompositor = selection.hasOutline() && splitOutline.compositor`；就位后 `state.splitOutline` + `__modelUnitVersionCompare.splitOutline`。
  单视口那条路不动（合成器照旧）。
- 面板：分屏摘要下软渲染时一句「这台机子是软渲染（<显卡串>）：分屏走直接渲染、不走描边合成器……」（`model-unit-compare-split-direct-render`）。
- **验证**：vitest `webglRendererInfo.test.ts` 2 例（名字识别 9 正 3 负；扩展 / 回落 / 空值 / 抛错 / null）、面板 +1 → 版本对比相关 10 文件 **102 过**；type-check 基线外 0 新增；ESLint 只剩 `ViewerPanel.vue:28` 既有的。
  ~~**真机未跑**（`:8022` 未起）~~ 09-22 两档真机都过（下一节）。
- 设计稿：S4 注 5 末句「去留待拍板」**待改口**为「留，软渲染自动退回直接 render」（Pencil 活动文件仍是别的会话的）。

### 真机 / e2e 补齐（2026-09-22 14:5x–15:1x，接班会话）

十笔全部只过了单测这件事今天收了。细账在 README §8.5，这里记要点：

- **`:8022`**：用户 09-21 晚两次「起好了」都没起来（cargo 在编、没产出新 exe）。今天照 README §7 的做法用同一 exe（`a382b2cf3`）/ cwd / DbOption / env 经 `Win32_Process.Create` 重起（不挂终端，pid 17932，内存库）——版本对比这条线的真机基线一直是它，没换成 0.1.30 那个 exe，少一个变量。
- **先按 HEAD 上的 spec 原样跑**：两份 6 passed（54.9 s，冷缓存）——P1-c 的折叠断言、P2-a 的守卫段真机成立。
- **补断言**：`model-version-compare` 第一条分屏后读 `__modelUnitVersionCompare.splitOutline`，用 `isSoftwareRendererName`（spec 直接 import）判该走哪条路、那一句露不露（P3-c）；`node-version-view` 容器那条加两个勾选的行数（P1-a：全表 299 → 只看自身变的 5 → 只看几何变的 297，先选好 A 630 / B 632 再勾）、每行「定位」的可点 / 置灰 / title 与装好组后被删构件定位相机真飞（P1-b）；**新第三条**：PIPE 24384_23225 `compare_a=300&compare_b=380` URL 直达自动切「所有子节点」落模型对比 tab 即停（P3-a）→ 总按钮一起装 5 个单元、进度卡、A / B 卡各列 2 个不存在的单元、五个组按钮「三维中 · 只看这组」（P2-a）→ 分屏后点一组「只看这组」分屏仍在（P3-b）→ 退出 generate 8 / DELETE 8。
  `playwright.config.ts` 加 `PLAYWRIGHT_GPU=1`（ANGLE D3D11）/ `PLAYWRIGHT_SOFTWARE_GL=1`（ANGLE SwiftShader）两个开关。
- **三档全绿**：Chrome 缺省 headless 7 passed 28.9 s；`PLAYWRIGHT_GPU=1` 7 passed 28.9 s（`compositor true`，RX590）；`PLAYWRIGHT_SOFTWARE_GL=1` 7 passed 29.0 s（`compositor false`，那一句带 SwiftShader 串）。pageerror 0。
  **本机 Chrome 新 headless 缺省就拿到真显卡**——P3-c 记录里「缺省 headless 落在 SwiftShader」是 09-21 一次性脚本用 chromium 的情形，e2e 要看软渲染那条路得显式 `PLAYWRIGHT_SOFTWARE_GL=1`。
- **P2-b 确认框 e2e 到不了**：ams8000 任何一段都凑不出 > 20 组（SITE 全程 5 → 632 只有 8 组几何变过），只在单测里。
- **教程配图**：`docs/guides/images/model-version-view/01…10` 嵌进 `MODEL_VERSION_VIEW_TUTORIAL.md`（09-21 写教程时欠的）。
- **仍欠**：~~P2-c（后端 `attribute_diff.rs` 仍 untracked）~~（下一段）；S4 注 5 / 注 6 改口（Pencil 里现在没打开任何 .pen）。

### P2-c 真机 / e2e（2026-09-22 15:3x–15:4x，用户拍板「拿工作树编一份换到 :8022」）

- 后端那半还是没提交（`attribute_diff.rs` untracked、`handlers.rs` / `mod.rs` / `attribute_history.rs` modified）。按用户拍板拿 gen-model-refactor **工作树**编 release（3 m 09 s）→ `_runs\review-full-8031\aios-database-attrdiff-wt-0b2bf527b.exe`，收掉 a382b2cf3 那台、同 cwd / env 起到 `:8022`（pid 61404，`0.1.30+g0b2bf527bc4e.dirty`）。
- 真机（README §5.5）：叶子 FTUB 626 → 630 净差表 `data-source=server`、「1 项变化」只列 POS——**这版服务端把 SPAMAP 标成戳**（a382b2cf3 上不是，§7 记的「2 项变化」就是它），勾「含戳」才出；容器子树 573 → 628 点开 EQUI 24384_24776 →「成员 新增 1（24384_26495）」、ZONE 24384_24775 →「属性一字没差，只有成员表 / owner 动了」+「成员 新增 1（24384_26482）」，两处都不再有「折出来的」那句。
- **§2 P2-c 写的「BRAN 24384_23257 应出『成员重排』」不成立**：attribute-history 里它在 (573, 628] 只有 626 一条（CACHID / noop / 无 members），服务端真差也没 members，两条路由一致——是计划把段写错了；EQUI 24776 那条成立（时间线 +26484 / −26484 / +26495 三跳，净差 +26495 一条，正是「净差 vs 折」的差别）。
- e2e：叶子那条净差来路按服务端有无路由断言 `server` / `folded` + 戳缺省不列；**新第四条**（没路由就跳过）逐行拿 `element/attribute-diff`、挑成员 / owner 有差的点开断言。两份 spec 对这台 **8 passed（31.6 s）**，pageerror 0。
- 后端一提交 / 一改，这台 `.dirty` 就过时了；换正式构建按 README §5.5 那行重起。

### 设计稿 S4 注 5 / 注 6 改口（2026-09-22 15:5x）

Pencil MCP 只认编辑器里打开着的 .pen，`cursor --reuse-window` 把 `plant-10/design/node-version-history.pen` 开进当前窗口后按 §3 改了三处文字（注 5 / 注 6 / 分屏 Footnote），`Get` 核过 Notes 列无 `problems`、截图无裁切；Ctrl+S 存盘（15:57:14，587,225 B；plant-10 不是 git 仓）；`Export` 只导 S4 一帧覆盖 `S4-3d-linkage-live.png`。**收口计划到此全部收完**：P0 / P1 / P2 / P3 十笔真机 + e2e、P2-c 真机、设计稿回写。
