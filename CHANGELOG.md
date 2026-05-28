# 更新日志

## [未发布]

### 变更

- **测量关键点(ptset)捕捉 — hover 显示 + 自动吸附** (2026-05-28)
  - 测量（距离/角度/点标高/高差）时，鼠标 hover 构件会按 refno 拉取其关键点（ptset：管端/法兰中心/喷嘴等连接点）并以绿色十字显示；光标靠近关键点时落点自动吸附到该点精确坐标
  - 新增吸附引擎 `usePtsetSnap` 与纯换算模块 `utils/three/ptsetTransform.ts`（场景坐标换算链与 `usePtsetVisualizationThree` 完全一致，保证吸附点与显示十字对齐），含 9 个单测
  - 吸附统一注入测量取点的唯一咽喉 `pickSurfacePoint`，预览与最终落点同时生效，四种测量模式通用；hover 取数带 80ms 防抖、按 refno 缓存与 in-flight 去重
  - `MeasurementPanel` 样式设置新增「关键点捕捉」开关与像素阈值（默认 12px），持久化到 `useXeokitMeasurementStyleStore`；吸附到关键点时标记/lens 用独立绿色并显示点号
  - 涉及文件：`composables/usePtsetSnap.ts`、`utils/three/ptsetTransform.ts`、`composables/useXeokitMeasurementTools.ts`、`composables/useXeokitMeasurementStyleStore.ts`、`composables/xeokitMeasurementUi.ts`、`components/tools/MeasurementPanel.vue`；设计文档 `goals/ptset-hover-measure-snap/`
  - 验证：全量 `npm run type-check` 通过；`usePtsetSnap`(9) 与 `xeokitMeasurementUi`(2) 单测通过

- **RUS-239 驳回后重新流转 — UX 增强与健壮性提升** (2026-05-08)
  - 设计批注处理面板新增**驳回原因提示框**：当任务被校核驳回时，在任务级动作区域顶部显示醒目的 amber 提示框，展示驳回原因并引导用户处理批注后点击「流转回校对」
  - 「流转回校对」按钮就绪态增加 ring 高亮效果，禁用态 title 属性说明具体原因（未处理批注 / 未保存证据）
  - 有未保存证据数据时额外显示 amber 警告提示
  - `workflowBridge.ts` 新增 `notifyParentWorkflowActionWithAck()`：发送 workflow action 后等待父窗口回执（`plant3d.workflow_action_ack`），5 秒超时返回 `'timeout'`，便于调用方在 PMS 未响应时回退到备选方案

- **校审外部流程默认模式与编译期开关** (2026-05-12)
  - 新增 `VITE_REVIEW_ENABLE_INTERNAL_WORKFLOW_MODE` 编译期开关，默认关闭；关闭时 `workflow_mode=manual/internal`、session/local storage 和 embed 参数都不会把前端切到内部主动模式
  - 发起编校审面板在外部流程模式下只保存 task 并发送 `plant3d.form_saved`，不再调用内部 `submitTaskToNextNode` 抢先把单据从 `sj` 推到 `jd`
  - `authGetToken` 与 PMS embed payload builder 不再发送 `workflow_mode`，公开校审 API 不再靠额外参数判断内部/外部模式
  - 保留内部主动模式作为显式编译产物能力：仅设置 `VITE_REVIEW_ENABLE_INTERNAL_WORKFLOW_MODE=1/true` 时兼容旧的 manual/internal 调试入口
  - 验证：`npm run type-check` 通过；后端默认/内部 feature 双向 HTTP smoke 均符合预期

- **RUS-239 驳回后重新流转修复** (2026-04-30)
  - 新增外部流程桥接判断，仅在 PMS/仿 PMS 嵌入模式下向父窗口发送 `plant3d.workflow_action`
  - 设计批注处理页“流转回校对”和任务详情“再次提交”接入 `workflow/sync active` 语义，避免外部流程场景继续走内部 submit
  - 仿 PMS runner 在发起后关闭额外 `3d-view` 页面并降低诊断等待耦合，`bran-mixed` 已验证通过至 `PZ approve`
  - 保留独立/内部模式的旧提交流转路径，并补充 RUS-239 计划、发现和执行记录

- **RUS-238 测量路径展示增强** (2026-04-30)
  - 测量列表、确认测量回放和批注测量证据支持异步展示模型树完整路径
  - 新增统一展示层 `useMeasurementPathSummaries`，保持 refno fallback，路径解析成功后再替换为完整路径
  - lookup 失败、模型树数据不可用或历史记录缺上下文时继续显示规范化 refno，不影响定位、隐藏、删除和回放行为
  - 补充 RUS-238 UI 接入、验收与 PMS/编校审后续验证计划文档

- **RUS-238 推送后验收规划** (2026-04-30)
  - 新增 planning-with-files 规划目录，沉淀任务计划、findings、progress、验收输入清单和工作区盘点
  - 新增自包含 HTML/SVG 流程图，说明从验收输入收集到 PMS/编校审验收与工作区收敛的路径
  - 明确真实验收继续依赖 BRAN、PMS 包名/任务单、角色和入口输入

- **RUS-238 仿 PMS 验收记录** (2026-04-30)
  - 使用 BRAN `24381_145018` 跑通 approved 主链，最终 `status=approved` / `node=pz`
  - restore 场景中 BRAN、测量和确认记录读回通过，剩余失败定位为刷新前评论内容 UI 断言
  - Chrome CDP full flow 通过真实 PMS 入口创建三维校审单，并在嵌入站点接口命中包名或 BRAN

- **批注错误类型替换** (2026-04-27)
  - 将批注"严重度"体系（致命/严重/一般/建议）替换为"错误类型"体系
  - 新增三种错误类型：原则错误（×）、一般错误（△）、图面错误（○）
  - 涉及文件：`auth.ts`、`AnnotationPanel.vue`、`AnnotationOverlayBar.vue`、`useToolStore.ts`

### 重构

- **审核面板 split / table 数据源统一** (2026-05-18)
  - `ReviewPanel.vue` 的卡片列表 split 视图与批注表格 table 视图共享单一原始来源 `scopedReviewerItems: AnnotationWorkspaceItem[]`
  - 删除本地 `AnnotationListItem` 类型定义、`allAnnotationItems` computed、`findAnnotationListItemFromWorkspace` 反向适配器（净 -81 行）
  - 卡片列表 handler `toggleAnnotationDetail` / `flyToAnnotationItem` / `getAnnotationReviewBadge` 入参类型迁移到 `AnnotationWorkspaceItem`
  - 行为不变：双胞胎面板 5 套件 baseline 33 fail / 56 pass → after 33 fail / 59 pass（仅新增早些补丁的 3 pass，0 新增 fail）
  - 消除 2026-05-18 早些补丁所对齐却未消除的"双轨"，让未来过滤维度扩展只需改一处
  - 关键文件：`src/components/review/ReviewPanel.vue`
  - 关联文档：`docs/plans/2026-05-18-reviewer-split-table-data-source-unification-plan.md`、`开发文档/三维校审/审核面板批注表格视图回归事故复盘-2026-05-17.md` §12

### 修复

- **外部 PMS 单据批注状态同步与启动健壮性增强（U011 整组）** (2026-05-19)
  - `useAnnotationReviewStateSync.ts` 新增 `pickLatestAnnotationStates`：同一批注的多轮记录按 `(reviewRound, updatedAt)` 去重，只应用最新一轮；避免上一轮的 `decision_status=rejected` 覆盖 SJ 二次处理后的 `fixed`
  - `ReviewPanel.vue` 的 `refreshAnnotationReviewStatesForCurrentTask` 与 `activeReviewFormId` watch 不再强依赖 `currentTask`：外部 form 聚焦时只凭 `activeReviewFormId` 也能按 `formId` 拉一次最新批注状态；`restoreConfirmedRecordsIntoScene` 与 `confirmCurrentData` 成功后追加一次主动刷新
  - `ReviewPanel.vue` 新增「外部 form 聚焦 + split 视图 + 仅 1 条作用域批注」自动展开 watch：解决 FORM-DE19AFADC087 默认折叠把 SJ 处理按钮（已修改 / 不需解决 / 提交处理结果）藏进卡片导致体感不可见的问题
  - `embedContextRestore.ts` PMS 嵌入打开 form-focused 单据时改为「`loadTaskByFormId` 直拉（8s 超时） + `loadReviewTasks` 后台 fire-and-forget」，并在 `resolveEmbedRestoreResult` 仍 missing 时回填 form-loader 命中结果；URL 已带可验证 form_id 时不再被「拉当前角色全量任务列表」阻塞
  - `useToolStore.ts` 把 `getReviewCommentThreadStore` / `getCommentsFromStore` / `liftAnnotationComment` 从运行时 lazy 引用重构为顶层 import + `_getThreadStore()` helper（符合项目 `no-inline-imports` 规则），让 `addCommentToAnnotation` 在 vitest 环境也能直接走共享 thread store
  - 新增 `useAnnotationReviewStateSync.test.ts` 1 条单测锁定多轮状态优先级；扩展 `useToolStore.persistence.test.ts` 1 条单测验证 `addCommentToAnnotation` 不依赖 runtime globals
  - 验证：`npm run type-check` 通过；6 个改动文件 `eslint` 0 error 0 warning；新增 + 扩展的两个测试 13/13 通过；双胞胎 4 套件 baseline 34 fail / 53 pass → after 34 fail / 53 pass（**0 新增 fail**，已对比 stash baseline）

- **JD/JH 可确认 SJ 已处理的驳回批注** (2026-05-18)
  - 外部 `form_id` 聚焦场景下，`ReviewPanel.vue` 同步批注处理状态改为按 `formId` 查询，不再强绑当前内部 `taskId`
  - 修复 SJ、JD、JH 在同一外部单据上恢复到不同内部 taskId 时，JD/JH 看不到 SJ 已提交的 `fixed/wont_fix`，导致“同意 / 驳回”被禁用的问题
  - 后端 `plant-model-gen` 已同步补充 `jh` 角色的 `agree/reject` 权限白名单，避免 JH token 被服务端拒绝
  - 验证：`npm run type-check` 通过；`ReviewCommentsTimeline.test.ts` 11/11 通过；`npm run build` 通过；后端本地 `cargo check` 因缺少 NASM 被环境阻断，线上部署后 `/api/health` 与 `/api/version` 均 HTTP 200

- **SJ 驳回单据批注处理确认入口恢复** (2026-05-18)
  - 修复 SJ 打开驳回/退回单据进入 `ReviewPanel` 后，评论线程调用 `buildCommentThreadKey()` 时报 `buildCommentThreadKey is not defined` 的运行时错误
  - `useToolStore.ts` 显式导入 `buildCommentThreadKey`，避免依赖 auto-import/global 类型声明导致类型层面通过但运行时未注入
  - 外部 SJ returned/rejected 场景保留 `designer-only` 时间线语义，恢复“已修改 / 不需解决 → 提交处理结果”入口，用于逐条确认批注已处理
  - 仍不开放校审侧“同意 / 驳回”动作，也不恢复新增批注/测量证据入口；“确认当前数据”继续只服务新增证据保存
  - 验证：`npm run type-check` 通过；`ReviewCommentsTimeline.test.ts` + `commentThread.test.ts` + `commentThreadStore.test.ts` 35/35 通过；`npm run build` 通过

- **SJ 外部单据仅在驳回/退回状态下进入校审面板** (2026-05-18)
  - 修正 `sj + 外部 form_id` 被无条件路由到 `ReviewPanel` 的问题：现在普通未驳回单据保持设计端落点，只有恢复到的任务确认为 canonical returned/rejected 时才显示校审面板
  - `embedRoleLanding.ts` 不再只凭 `sj + form_id` 把落点改为 reviewer；form_id 仍用于权限与批注 scope 判定
  - `embedContextRestore.ts` 新增 returned designer task panel 选择能力，供外部 SJ returned/rejected 场景路由到 `review`
  - `DockLayout.vue` 在任务恢复后结合 `isCanonicalReturnedTask()` 决定是否收敛到校审面板，避免未驳回单据也进入校审工作台
  - 验证：`embedRoleLanding.test.ts` + `embedContextRestore.test.ts` 35/35 通过；`npm run type-check` 通过；`git diff --check` 通过
  - 已知基线：面板大回归套件中 `ReviewPanel` / `DesignerCommentHandlingPanel` 仍有既有失败，本次聚焦落点逻辑未扩大修复范围

- **外部 form_id 收敛规则推广到任意 reviewer 角色（A2 升级）** (2026-05-18)
  - 产品规约：「不能跨 form_id 批注，看的就是对应单据的数据」。本次把 2026-05-18 早些只针对 SJ 的外部 form_id 收敛规则推广到任意 reviewer 角色（sj/jd/sh/pz）
  - `embedRoleLanding.ts` 新增 `isExternalFormFocusedMode(params)`，不再要求 `role === 'sj'`，只看 `isPassiveWorkflowMode + verifiedFormId`
  - `ReviewPanel.vue` 的 `scopedReviewerItems` form_id 过滤改用 `isExternalFormFocused`；原 `isExternalSjFormFocused` 保留用于 SJ 权限边界（`canCreateReviewEvidence` / `allow-review-actions`）
  - `DockLayout.vue` 的 `closeBlockedReviewPanels` 与 ribbon command 守卫（`panel.resubmissionTasks` / `designerCommentHandling` / `annotationTable`）改用更广义的 `inExternalFormFocusedMode`，保留 `inExternalSjFormFocusedMode` 用于 SJ 专用语义
  - `AnnotationOverlayBar` / `useDtxTools` 中按现有 `shouldUseDesignerPanel` 逻辑（DESIGNER 角色 + canonical returned task）对 jd/sh/pz 天然走 review 分支，无需额外升级
  - 新增 `ReviewPanel.test.ts` 用例：passive workflow + jd / sh 角色 + form_id → 表格按 form_id 收敛；原 manual workflow 用例改为「activeReviewFormId 为空时不过滤」更准确反映新规则
  - 回归差量：6 套件 33 fail / 67 pass（+1 pass，0 新增 fail）；type-check 0 error；ReviewPanel.vue + DockLayout.vue lint 0/0
  - 关键文件：`src/components/review/embedRoleLanding.ts`、`src/components/review/ReviewPanel.vue`、`src/components/DockLayout.vue`、`src/components/review/ReviewPanel.test.ts`

- **SJ 外部 form_id 入口全面收敛到 ReviewPanel** (2026-05-18)
  - SJ 经 PMS 外部流程打开带 form_id 的单据时，所有批注处理统一在审核侧 ReviewPanel 内完成，不再单独打开「批注处理」(DCH) / 「退回任务列表」/ 「发起编校审」/ 「待审核任务」面板
  - 新增 `isExternalSjFormFocusedMode()` helper，扩展 `closeBlockedReviewPanels`：SJ 外部 form_id 模式额外关闭 DCH/resubmissionTasks/initiateReview/reviewerTasks
  - Ribbon command `panel.resubmissionTasks` / `panel.designerCommentHandling` / `panel.annotationTable` 在 SJ 外部 form_id 模式下强制路由到 review
  - 重写 `DockLayout.test.ts` 中过时的「设计端被动恢复未匹配内部任务但 workflow/sync 有批注记录时仍进入批注处理」用例，改为锁定新策略「仍统一落到 review 面板，不再单独开 DCH」（转绿 1 条原 baseline fail）
  - 双胞胎 5 套件 + DockLayout 汇总：baseline 34 fail / 62 pass → after 33 fail / 66 pass（净 -1 fail / +4 pass，0 新增 fail）
  - 关键文件：`src/components/DockLayout.vue`、`src/components/DockLayout.test.ts`
  - 关联文档：`开发文档/三维校审/审核面板批注表格视图回归事故复盘-2026-05-17.md` §13、`.plannotator/plan-sj-reject-ui.md` §2 / §5

- **审核面板批注表格 form_id 收敛** (2026-05-18)
  - SJ 经 PMS 外部流程打开被驳回单据并切到「批注表格」时，不再显示其它 form_id 的批注
  - `ReviewPanel.vue` 的 `annotationWorkspaceItems` 改为先构造全集再按 `isExternalSjFormFocused` + `activeReviewFormId` 过滤，行为与同文件 `allAnnotationItems`（卡片列表）严格对齐，复用 `scopeAnnotationWorkspaceItemsByFormId` helper
  - 新增 3 条 vitest 用例锁定 form_id scope 行为（SJ 外部聚焦 / manual workflow / passive workflow+jd 角色），双胞胎面板 5 套件 baseline 33 fail / 56 pass → after 33 fail / 59 pass（0 新增 fail）
  - 关键文件：`src/components/review/ReviewPanel.vue`、`src/components/review/ReviewPanel.test.ts`
  - 关联文档：`docs/plans/2026-05-18-reviewer-annotation-table-formid-scope-plan.md`、`开发文档/三维校审/审核面板批注表格视图回归事故复盘-2026-05-17.md` §11、`.plannotator/plan-sj-reject-ui.md` §6

- **审核面板「批注表格」视图回填** (2026-05-17)
  - 恢复 reviewer 工作台（`ReviewPanel.vue`）的「卡片列表 ⇄ 批注表格」tab 切换；ribbon `panel.annotationTable` 按钮在校核面板上重新生效
  - 直接复用 `buildAnnotationWorkspaceItems` 构造 `AnnotationWorkspaceItem[]` 喂给 `AnnotationTableView`，无须新增适配器
  - 表格视图为只读浏览：行单击=选中、行双击=飞到 3D + 自动切回卡片列表、右键=复制 RefNo / 整行文本
  - 视图模式持久化到 localStorage，独立 key `plant3d-web-nav-state-reviewer-workbench-v1`，刷新后保持
  - 根因：ccb8d08（PR 8）落地的能力在某次反向 rebase 中被 028de56 之前的 ReviewPanel 版本整段覆盖；后续 merge `6ad374b` 巩固损坏
  - 关键文件：`src/components/review/ReviewPanel.vue`
  - 关联文档：`docs/plans/2026-05-17-reviewer-annotation-table-restore-plan.md` + `开发文档/三维校审/审核面板批注表格视图回归事故复盘-2026-05-17.md`

- **测量清空修复** (2026-04-29)
  - 修复顶部菜单“测量 → 清空”只按当前测量模式清理，导致画面上已有测量标签残留的问题
  - 统一清理普通测量、xeokit 测量、未完成测量草稿，以及测量模式生成的管-墙/柱距离标注
  - 保留普通“尺寸标注”，避免误删用户手动创建的尺寸内容

- **PMS 模拟器驳回流程修复** (2026-04-27)
  - 修复 `openWorkflowDialog` 和 `executeWorkflowAction` 中 `shouldUseSyncOnlyWorkflowAction` 使用过期的 `state.sidePanelMode` 导致 SH 节点无法执行 agree 操作的问题
  - 根因：`openIframe` 异步加载诊断数据（`refreshDiagnosticsSnapshot`）后才更新 `sidePanelMode`，但 `openWorkflowDialog` 在诊断加载完成前就读取了旧值 `'readonly'`，导致 `shouldUseSyncOnlyWorkflowAction` 返回 `false`，阻止了外部流程模式下的 workflow/sync 操作
  - 修复方式：在 `openWorkflowDialog` 和 `executeWorkflowAction` 中使用 `deriveSidePanelMode()` 实时计算最新的面板模式，取代可能过期的 `state.sidePanelMode`
  - 影响范围：PMS 模拟器中的三维校审驳回（return）流程，特别是 SH→PZ→SJ 的驳回链路
  - 验证：`PMS_SIMULATOR_CASE=return` 场景 17/17 断言全部通过
