# 设计侧「批注处理」面板改为表格逐条处理（方案 A）开发计划（2026-10-10）

> 状态：**执行中**。plannotator 评审已通过（2026-10-10，无批注）；§6 五项 2026-10-10 用户拍板「全按推荐」；**P0、P1、P2 已完成**（实施记录见 §8），剩 P3。
> 依据：`plant3d-web@252cf5eb`（main）；方案原型 `ui/三维校审/designer-comment-table.pen` 中的方案 A（PNG 见同目录 `designer-comment-table-png/`）；2026-10-10 截图问题分析（共 14 条，下文按「分析 #n」引用）。
> 本文只定「改什么、分几批、怎样算完成」；交互细节以原型为准，原型与本文冲突时先改原型再改本文。

## 0. 一句话

去掉设计侧「批注处理」面板左侧 360px 的退回任务列表，改成 **顶部任务切换器 + 退回意见横条 + 进度 / 状态页签 + 全宽批注表（点一行展开即处理表单）+ 固定底栏**。表格、行内展开、处理完自动跳下一条都已有现成实现，主要工作是面板骨架重排、处理表单前置、任务级动作可达和状态口径。

## 1. 现状（2026-10-10 核过，出处在括号里）

| 项 | 现状 | 出处 |
| --- | --- | --- |
| 面板骨架 | 左 `w-[360px]` 嵌 `ResubmissionTaskList`；右侧 `flex-col overflow-hidden`，列表区写死 `min-h-[420px]`，头卡、统计卡、确认栏都不收缩 → 常见高度下「确认当前数据 / 流转回校对」被裁掉且滚不到（分析 #1、#2） | `DesignerCommentHandlingPanel.vue:629-823` |
| 左栏 | 卡片按整页宽度写，在 360px 里按钮一字一行、徽章竖排、信息行挤成窄柱（分析 #3、#4）；「进入批注处理」与点卡片是同一个函数（分析 #10）。**只在本面板使用**（`ResubmissionTaskListPanelDock` 包的也是本面板） | `ResubmissionTaskList.vue:184-334` |
| 批注表格 | 已有：单击行展开、再点收起；Enter / Space / Esc；↑↓ / Home / End / PageDown 切行（`handleRowKeyNav`）；容器查询三档（compact < 640、medium < 960、其余 wide）；每页 10 条；处理动作完成后自动展开下一条待处理，没有了就发 `queue-completed` | `AnnotationTableView.vue:128-133, 266-300, 397-436`；`useContainerQuery.ts` |
| 行内展开 | `AnnotationInlineDetailCard` 两列：左 = 标题 / 描述 / 定位、关联元素、测量；右 = `ReviewCommentsTimeline`。**处理动作（已修改 / 不需解决 + 备注，不需解决必填）嵌在时间线组件里**，与校核侧 `ReviewPanel` 共用 | `AnnotationInlineDetailCard.vue:261-640`；`ReviewCommentsTimeline.vue:186-660` |
| 统计 | 面板 5 张统计卡，表格又自带三颗药丸（待处理 / 已处理 / 已通过），重复 | `DesignerCommentHandlingPanel.vue:719-726`；`AnnotationTableView.vue:377` 起 |
| 退回元数据 | 没有 return 步时，退回节点回退成 `currentNode`（显示成「编制」）；退回时间只认 return 步（显示「—」，列表排序全按 0）；顶部同时显示「已退回」和「草稿」（分析 #5–#7） | `reviewTaskFilters.ts:35, 97-101`；`DesignerCommentHandlingPanel.vue:646-651` |
| 加载 / 失败 | 列表由父组件加载，列表自己的 `isLoading` 不置位；失败时 store 清空列表、只写 `error`，面板不读 → 加载中和失败都显示「暂无退回任务」（分析 #13） | `ResubmissionTaskList.vue:52`；`useUserStore.ts:885-889` |
| 禁用无原因 | 「确认当前数据」「流转回校对」灰掉时不说缺什么（分析 #9） | `DesignerCommentHandlingPanel.vue:242-247` |
| 回归守护 | 改本面板必须跑「双胞胎面板」5 套 vitest，PR 记录 baseline / after 差量 | `AGENTS.md:50-61` |
| e2e / harness | 没有引用左栏或本面板的 testid（rg 核过） | `e2e/`、`src/harness/` |
| 工作树 | main 上有他人在途改动（模型版本对比、`ViewerPanel.vue` 等），与本计划涉及的文件不重叠 | `git status` |

## 2. 目标与非目标

**目标**

- G1 主操作始终可达：面板高度 ≥ 600px 时，「确认当前数据 / 流转回校对」完整可见；按钮禁用时直接写出原因。
- G2 单层表格逐条处理：点一行展开处理表单（处理结论、处理说明置顶），「保存并处理下一条」后自动展开下一条待处理；支持 Enter / Esc / ↑↓。
- G3 任务切换不占表格宽度：顶部切换器列出全部退回单，每张带批注进度和「可流转」标记；切换时保留各自的筛选与展开状态。
- G4 信息不误导：退回来源、退回时间、状态徽章口径统一；加载中、加载失败、此单无批注三种状态分开显示。
- G5 窄面板可用：面板宽 ≥ 720px 时无挤压；布局按容器宽度切换（复用 `useContainerQuery`，不引新依赖）。
- G6 测试：双胞胎 5 套不新增 fail，type-check 不新增错误；新增用例覆盖切换器、底栏禁用原因、保存并下一条、窄面板。

**非目标**

- 不改后端接口；「退回没写 return 步」的根因另开问题追，P1.2 只做前端兜底。
- 不改校核侧 `ReviewPanel` 的交互；共用组件只做向后兼容的扩展，默认行为不变。
- 方案 B 的两级表、方案 C 的批量标记不做；C 的「图面错误一键已修改」列为可选项 P3.3，需拍板。

## 3. 分批计划

每批单独提交，提交前跑 §4 的检查。

### P0 · 骨架与可达性（约 1.5 天）

| # | 任务 | 改动 | 验收 |
| --- | --- | --- | --- |
| P0.1 | 面板改成三段：顶栏（固定）/ 中部滚动区 / 底栏（固定） | `DesignerCommentHandlingPanel.vue`：根改 `flex-col`；中部 `min-h-0 flex-1`，去掉 `min-h-[420px]`；列表区改 `flex flex-col`，`UnattributedDraftNotice` 之后的 workspace 改 `min-h-0 flex-1`（分析 #2） | 单测断言底栏在滚动区之外渲染；harness 在 600 / 768 / 900 高度下截图，底栏完整 |
| P0.2 | 新建 `DesignerTaskSwitcher.vue` 替代左栏 | 触发按钮显示「退回单据 i / n · 其余 k 张待处理」和当前单号；下拉每行：单号、退回自、批注进度条、「可流转」；可键盘选择；选中后调用面板现有的 `selectTask` | 新单测：3 张单渲染、切换、当前单高亮；空 / 加载中 / 失败三态 |
| P0.3 | 面板不再引用 `ResubmissionTaskList` | 删引用和测试里的 stub；组件去留见 §6-1 | rg 确认无其它引用 |
| P0.4 | 固定底栏 | 「未确认 X 条批注 / Y 条测量」+ 本轮说明 + 确认当前数据 + 流转回校对；禁用原因分三种：没有未确认的改动 / 先确认当前数据 / 还有未保存的改动（分析 #9） | 单测覆盖三种禁用原因文案 |

### P1 · 信息口径（约 1 天）

| # | 任务 | 改动 | 验收 |
| --- | --- | --- | --- |
| P1.1 | 顶栏：单号 + 已退回 + 优先级 + 「退回自 X · 时间」；退回态不再显示「草稿」 | `DesignerCommentHandlingPanel.vue:644-655`（分析 #7） | 单测 |
| P1.2 | 退回元数据：`getCanonicalReturnedMetadata` 新增 `returnFromNode`（只认 return 步，缺失为 `null`，显示「—」）；退回时间缺 return 步时回退到 `updatedAt` 并标「约」；切换器排序用同一口径 | `reviewTaskFilters.ts` 及调用处（分析 #5、#6） | `reviewTaskFilters.test.ts` 补「有 / 无 return 步」两组 |
| P1.3 | 退回意见横条：单行显示，超长可展开全文 | 面板 | 单测 |
| P1.4 | 进度条 + 状态页签替换 5 张统计卡；页签驱动表格的状态筛选（筛选状态上提，或给 `AnnotationTableView` 加受控 prop）；designer 模式隐藏表格自带的三颗药丸 | 面板 + `AnnotationTableView.vue` | 单测：点「待处理」后表格只剩 pending + rejected |
| P1.5 | 加载 / 失败 / 空态：面板和切换器读 `userStore.loading` / `userStore.error`，失败时给「重试」；此单无批注时说明下一步（口径见 §6-4） | 面板、切换器（分析 #8、#13） | 单测三态 |

### P2 · 行内展开即处理表单（约 2 天，风险最高）

| # | 任务 | 改动 | 验收 |
| --- | --- | --- | --- |
| P2.1 | 把处理动作从时间线里抽出来：`useAnnotationReviewAction`（选择动作、不需解决必填、提交、回读持久化状态）+ `AnnotationDecisionForm.vue`（处理结论 + 处理说明 + 提交按钮） | 新文件；`ReviewCommentsTimeline` 改为复用同一 composable，新增 `showActionComposer`（默认 `true`，校核侧不变） | `ReviewCommentsTimeline.test.ts` 全绿；新组件单测 |
| P2.2 | 设计侧展开区重排：左 = 决策表单（置顶）+ 关联元素 + 测量证据；右 = 讨论（隐藏 composer）；底部 = 在三维中定位 / 收起 / 「保存并处理下一条」 | `AnnotationInlineDetailCard.vue`，只动 `designerOnly` 分支 | 单测：designer 模式下表单在讨论之前；校核模式 DOM 断言不变 |
| P2.3 | 「保存并处理下一条」：提交成功后沿用 `handleReviewActionCompleted` 自动展开下一条；最后一条发 `queue-completed` 时提示，并把焦点移到底栏「确认当前数据」 | `AnnotationTableView.vue`（已有）、面板 `handleQueueCompleted` | 单测：提交后下一条展开；最后一条之后焦点在底栏 |
| P2.4 | ~~↑↓ 在行间移动焦点~~：已有（`handleRowKeyNav`），P2 只核对展开区打开时键盘焦点不丢 | `AnnotationTableView.vue` | 单测 |

### P3 · 窄面板与收尾（约 1 天）

| # | 任务 | 改动 | 验收 |
| --- | --- | --- | --- |
| P3.1 | 容器查询：面板 < 960px 时展开区改上下排、顶栏元信息折行；< 720px（`compactMax` 设 720）时搜索收成图标 | 面板 + 详情卡，复用 `useContainerQuery` | harness 720 / 1000 / 1200 三档截图 |
| P3.2 | harness：方案 A 三档宽度 × 三种状态（有批注 / 空 / 加载失败） | `src/harness/` 新增一页 | 截图存入 `docs/verification/2026-10-xx-designer-comment-table/` |
| P3.3 | （可选，§6-2 拍板后才做）「○ 图面错误」行上加「已修改」快捷按钮；「× 原则错误」必须展开填说明 | `AnnotationTableView.vue` 处理情况列 | 单测 |
| P3.4 | 收尾：CHANGELOG；按 §6-1 删除或保留 `ResubmissionTaskList` 及其测试 | — | — |

## 4. 测试与验收

- 每批提交前：跑 AGENTS.md 的双胞胎 5 套（`ReviewPanel` / `DesignerCommentHandlingPanel` / `AnnotationTableView` / `AnnotationSheetWorkspace` / `ReviewCommentsTimeline`），记录 baseline 与 after 的 pass / fail，不新增 fail；`type-check` 不新增错误。
- `DesignerCommentHandlingPanel.test.ts` 现有 19 个用例：依赖左栏 stub 的改为切换器；行内展开、再次提交、外部嵌入相关用例的断言不改。
- 新增：`DesignerTaskSwitcher.test.ts`、`AnnotationDecisionForm.test.ts`；补充：`reviewTaskFilters.test.ts`，以及面板的底栏、页签、三态用例。
- 截图：P3.2 的 harness 三档宽度 × 600 / 900 高度，对照原型 PNG 走查。

## 5. 风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| `ReviewCommentsTimeline` 与校核侧共用，抽处理动作可能改坏校核流程 | 高 | 先抽 composable、不改行为；新 prop 默认值保持原 DOM；跑 5 套回归和校核侧用例 |
| 双胞胎面板整段消失式回归（05-17 事故） | 高 | 每批小提交；PR 写 5 套 baseline / after |
| 外部嵌入（PMS iframe，`embed_landing_state` 带 `form_id`、未匹配内部任务）走「外部批注单」头部 | 中 | 顶栏保留这个分支和 `hasUnmatchedExternalEntry` 提示；相关现有用例断言不改 |
| 退回步缺失是数据问题，前端回退到 `updatedAt` 可能误导 | 低 | 标「约」并加 tooltip；根因另开问题 |
| 工作树多会话共用 | 中 | 只 `git add` 本计划涉及的明确路径 |

## 6. 需要拍板（2026-10-10 已拍板：五项全按推荐）

1. `ResubmissionTaskList.vue` 去留（目前只在本面板使用）。推荐：P3.4 删除，连同测试。
2. 「图面错误一键已修改」是否进第一版。推荐：不进，作为 P3.3 可选项。
3. 状态页签默认停在哪一页。推荐：「待处理」，设计侧打开就是要动手的那几条。
4. 此单没有批注时的口径。推荐：提示「这张单没有需要处理的批注，可直接确认数据并流转回校对」；「未归属草稿」只读提示沿用现有口径（不导入）。（P1 落地时改为「可直接流转回校对」：没有任何可确认内容时「确认当前数据」本来就点不了，见 §8 P1。）
5. 「流转回校对」是否要求全部批注都已处理。现状只要求已确认且无未保存改动，提交时再由后端批注检查拦截。推荐：维持现状，底栏额外显示「还有 N 条待处理」。

## 7. 工期

P0 1.5 天 + P1 1 天 + P2 2 天 + P3 1 天，合计约 5.5 人日（不含拍板等待）。

## 8. 实施记录

### P0（2026-10-10）

- 面板改为「顶栏 / 滚动区 / 底栏」三段：`DesignerCommentHandlingPanel.vue` 根改 `flex-col`，中部 `designer-comment-scroll` 滚动，去掉 `min-h-[420px]`；确认栏从滚动内容里移到固定底栏 `<footer data-testid="designer-task-confirmation">`，备注改单行输入；「确认记录版本」与「净距冲突」提示移到滚动区（`designer-task-restore-notices`，无内容时隐藏）。
- 新增 `DesignerTaskSwitcher.vue` 替代左栏：触发按钮显示「退回单据 i / n · 其余 k 张待处理」+ 当前单号；下拉每行显示单号、优先级、退回意见、退回时间；支持 ↑↓ / Home / End / Esc、点外部收起；无单据时区分加载中 / 加载失败（可重试）/ 确实为空。面板不再引用 `ResubmissionTaskList`（组件按 §6-1 在 P3.4 删除）。
- 底栏禁用原因：「没有未确认的改动」「还有未确认的改动，请先确认当前数据」「先确认当前数据后才能流转」「当前数据与已确认版本不一致」。
- 与计划的偏差：**切换器下拉里没有放每张单的批注进度条**——`ReviewTask` 不带批注统计，非当前单的批注也不在本机，要做得等后端给单据级批注汇总；当前单的进度留给 P1.4 的进度条。
- 验证：双胞胎 5 套 + `DesignerTaskSwitcher.test.ts` 共 6 个文件 132 例全过（面板用例 19 → 21，其中 2 例改断言、2 例新增；切换器新增 5 例）；`type-check` 499 / 基线 499、新增 0；eslint 无告警。harness 截图见 `docs/verification/2026-10-10-designer-comment-table/p0-*.png`（1200×900、1200×640、760×768，切换器展开，行展开），出图命令：`node scripts/visual-baseline/shot.mjs harness/designer-comment-table.html --port 5193 --out docs/verification/2026-10-10-designer-comment-table`。
- P0 过程中发现、留给后续批次：
  1. 项目关了 Tailwind preflight，没写边框 / 背景类的 `<button>` 会吃浏览器默认样式；`AnnotationTableView` 表头排序按钮和行操作图标按钮在截图里带默认边框，P1 顺手补 `border-0 bg-transparent`。
  2. 单据没有任何批注时，「确认当前数据」（无可确认内容）和「流转回校对」（无确认记录）互相卡死，P1.5 落 §6-4 口径时一并处理。
  3. 矮面板（640px）里头卡 + 5 张统计卡占满首屏，表格要滚动才看得到，P1.1 / P1.4 压缩后再复拍。

### P1（2026-10-10）

- 顶栏并入任务信息：切换器（单号）+「已退回」（非退回态显示原状态）+ 优先级 +「退回自 X（操作人）· 时间 · 构件 n 个」；退回态不再显示「草稿」。原头卡（描述、退回节点 / 当前节点四宫格）去掉。
- 退回意见单独一条固定在顶栏下，单行截断，超出时出现「展开全文」（ResizeObserver 量宽，jsdom 下不出按钮）。
- 退回元数据：`getCanonicalReturnedMetadata` 新增 `returnFromNode`（只认 return 步，缺失为 `null`，显示「—」）；新增 `getResubmissionReturnTimeInfo`（缺 return 步时回退 `updatedAt` 并标「约」）和 `sortTasksByLatestReturn`。面板的退回单列表（切换器顺序和默认选中）都按它排序，切换器显示同一口径的时间。
- 5 张统计卡换成「处理进度 x / y」+ 状态页签（全部 / 待处理 / 已处理 / 已通过，口径同表格三颗药丸）。页签在面板里预筛表格行；`AnnotationTableView` / `AnnotationSheetWorkspace` 新增 `hideStatusControls`，设计侧隐藏表内状态下拉和三颗药丸。默认停在「待处理」（没有待处理时停在「全部」），用户点过的页签按任务 / 单据记住；外部入口指向页签外的批注时自动切到「全部」再展开。
- 空单：表格空态写「这张单没有需要处理的批注 / 可直接流转回校对；如果校对那边有批注，点『刷新任务』重新同步」；单据上没有任何可确认的批注 / 测量时放行「流转回校对」（提交前的后端批注检查照旧把关），P0 发现的两头卡死解除。
- 底栏追加「还有 N 条待处理」（§6-5）。
- 顺手修：`AnnotationTableView` 的按钮全部补显式边框 / 背景类（表头排序、行操作图标、标题编辑、缩略图、分页、右键菜单、导出、清除筛选），校核侧 `ReviewPanel` 共用同一表格，一并受益。
- 修正 P0 遗留：P0 的 type-check 是在加 harness 之前跑的，harness 种子批注上的 `formId`（不在 `AnnotationRecord` 类型里）多出 1 条类型错误，随 P0 提交进了 main；本批改为显式类型，type-check 回到 499 = 基线。
- 与 P0 断言的差异：「可直接从统一批注单展开已修改批注」先切到「全部」页签再点行（默认页签是「待处理」）；P0 的「禁用时写明原因」用例改为「空单可直接流转，有未确认改动时写明原因」。
- 验证：双胞胎 5 套 + `DesignerTaskSwitcher` / `reviewTaskFilters` / `ResubmissionTaskList` 共 8 个文件 164 例全过（面板 21 → 25，reviewTaskFilters 20 → 23）；`type-check` 499 / 基线 499、新增 0；eslint 无告警。截图 `docs/verification/2026-10-10-designer-comment-table/p1-*.png`（出图时加 `SHOT_STAGE=p1`）。
- 留给后续：表头「序号」列 40px 放不下文字 + 排序图标，会折成两行（P3）；760px 宽时顶栏按钮、底栏按钮各折到第二行，能用，P3.1 再看。

### P2（2026-10-10）

- 处理动作（门禁、备注必填、后端落库、本地回写、提示、完成事件）整体搬到 `useAnnotationReviewAction`，`ReviewCommentsTimeline` 改为复用它，行为不变；新增 `showActionComposer`（默认 `true`，校核侧 DOM 不变）。
- 新增 `AnnotationDecisionForm`：处理结论（已修改 / 不需解决，单选）+ 处理说明（不需解决必填并提示）+「保存并处理下一条」（Ctrl / ⌘ + Enter 同效），只在设计侧 normal 档的行内展开区出现、排在最上面；时间线标题改为「讨论」并隐藏它自己的处理区。dock 档和校核角色保持原样——dock 档的评论输入框嵌在时间线的处理区里，拆出去会一起丢。
- 保存后沿用表格已有的「自动展开下一条待处理」；没有下一条时提示「下一步：确认当前数据并流转回校对」，焦点移到底栏可用的按钮（先「确认当前数据」，不可用时「流转回校对」）。最后一条处理完、「待处理」清零后，页签按 P1 的默认规则回到「全部」。
- 与计划的偏差：「在三维中定位 / 收起」没挪到展开区底部，仍在问题信息卡里（改动最小，不影响操作）；展开区两列布局仍按视口 `xl` 断点，面板窄时讨论区排在下方，留给 P3.1 的容器查询。
- 验证：全量 vitest 343 个文件 3215 例全过；其中双胞胎 5 套 + `AnnotationDecisionForm` / `AnnotationInlineDetailCard` / `DesignerTaskSwitcher` 共 159 例（面板 25 → 26、行内详情卡 15 → 17、处理表单新增 5、时间线 13 例原样通过）；`type-check` 499 / 基线 499、新增 0；eslint 无告警。截图 `p2-*.png`（出图时加 `SHOT_STAGE=p2`）。
