# 更新日志

## 2026-05-18

### 管道距离测量与标注增强（4 个独立 PR 一日全交付）

PipeDistanceDrawer + LinearDimension3D 这条链路过去半年只覆盖了"逐根点击 BRAN
→ 单色橙线 + 整数无单位 label"的最基础版本；本次按 `docs/plans/2026-05-18-
pipe-distance-annotation-enhancement-plan.md` 的 4 PR 拆分一次性交付。

**PR-1 标注视觉对齐效果图（commit efc33ae）**
- 修复 `usePipeDistanceAnnotationThree.ts` 隐藏 bug：旧调用
  `new LinearDimension3D({ start, end, color, textColor })` 把 params
  对象当作首位 `materials` 参数传入，运行时 `materials.ssDimensionDefault`
  会抛错——结果"显示标注"勾选后 3D 场景实际没有任何尺寸线。这个 bug 不影响
  type-check（首参类型宽，TS 不严校）、不影响 build，所以一直没人发现。
- 新建 per-composable `materials = markRaw(new AnnotationMaterials())`，与
  `useMbdPipeAnnotationThree.ts:1051` 同 pattern，避免污染全局。
- 改用 `new LinearDimension3D(materials, { start, end, ... })` 双参签名；
  `text: \`${result.distance} mm\`` + `decimals: 0` + `unit: 'mm'`，与
  `assets/pipe-distance-annotation-aveva-e3d-2026-05-18.png` 效果图对齐。
- `dim.setBackgroundColor(0xff6b00)` + `dim.setMaterialSet(materials.orange)`
  让 label 用品牌橙底实心矩形显示。

**PR-2 距离严重度三档配色（commit e29c8c8）**
- 新增纯函数 helper `src/composables/pipeDistanceSeverity.ts`：
  - `resolvePipeDistanceSeverity(distanceMm)` 把单条 mm 距离映射到
    `'critical' | 'warning' | 'safe'`（阈值 plan §1.1 PR-2：< 100mm critical /
    [100, 300) warning / >= 300mm safe）。
  - `resolvePipeDistanceSeverityVisuals(severity, materials)` 落地为
    `{ materialSet, backgroundColor }`：
    - critical: 0xff3d00 红橙 + `materials.ssDimensionDefault`
    - warning : 0xff6b00 默认橙 + `materials.orange`
    - safe    : 0xffb74d 暖白 + `materials.yellow`
- `usePipeDistanceAnnotationThree` 渲染每条结果时按 severity 动态调用
  `setBackgroundColor` + `setMaterialSet`，替代 PR-1 固定橙色。
- 边界处理：NaN → critical fail-safe；负数 → critical；Infinity → safe。
- 测试：`pipeDistanceSeverity.test.ts` 7/7 PASS。

**PR-3 框选 BRAN 拾取链路（commit 4387c58）**
- 让 10+ 根 BRAN 选择从"逐根点击"收敛为一次拖框；复用 `useDtxTools` 既有
  `annotation_obb` marquee 几何（向左 contain / 向右 intersect）+
  `findNounByRefnoAcrossAllDbnos` 做 noun 过滤。
- `useToolStore`：`ToolMode` 扩 `'pick_refno_box'`；新增
  `startBoxPickRefno(nounFilter, onConfirm)` action，与 `startPickRefno`
  共享 `pickRefnoFilter` / `pickedRefnos` / `pickRefnoCallback` 三件
  状态；`setToolMode` 退出条件拓展到 `pick_refno_box`；`confirmPickRefno`
  / `cancelPickRefno` 改走 `setToolMode('none')`，顺带 fix 现存 leak（直接
  赋值 `toolMode.value` 会跳过 filter / callback 清理）。
- `useDtxTools`：marquee 三件套 + `collectRefnosInScreenRect` +
  `updateMarqueeStyle` 函数 mode 类型扩 `'pick_refno_box'`；`onCanvas
  PointerDown/Move/Up` 三个 handler 接入；`endMarquee` 加 `pick_refno_box`
  分支：拿全集 → 按 `store.pickRefnoFilter` 过滤 → addPickedRefno 后自动
  `confirmPickRefno`。
- `PipeDistanceDrawer.vue`：旧"选择 BRAN 管道"单按钮拆为 grid 2 列
  "点击选" + "拖框选" 双按钮；hint 提示按模式切换。
- 测试：`useToolStore.pickRefnoBox.test.ts` 5/5 PASS。

**PR-4 结果筛选 / 单条切换（commit 4000a27）**
- 检测结果 ≥ 10 条时能聚焦关心的距离范围：
  - 抽屉结果区加"仅看 ≥ N mm"距离阈值输入框（0 / 非法 / 负 → 清阈值）；
  - 每行加 Eye / EyeOff 切换按钮，控制单条 3D 标注显隐；
  - 标题计数从"N"改为"可见 N / 总 M"，附"已隐藏 X 条"提示；
  - 所有结果被过滤时显示"点此重置"入口。
- `usePipeDistanceStore`：新增 `hiddenResultIds: Set<string>` /
  `resultMinDistance: number | null` state + `visibleResults` computed +
  `toggleResultHidden` / `setResultMinDistance` / `resetResultFilters`
  action；`clearResults` 末尾顺带 reset 筛选，避免 state 残留误伤下次检测。
- `usePipeDistanceAnnotationThree` composable 签名不动；Drawer 改传
  `store.visibleResults` 替代 `store.results` 即自动跳过被 hide /
  不满足阈值的 3D 标注渲染。
- 列表 `v-for` 仍按全集 idx 渲染（保持 `activeResultIndex` 不变），靠
  `v-show` 控制可见性，避免改 index 引发的 ripple。
- 测试：`usePipeDistanceStore.resultFilter.test.ts` 7/7 PASS。

**回归汇总**
- 双胞胎 5 套件（cloudCollapsed + DockLayout + ReviewPanel + DCH +
  pickRefno）+ 本次新增 3 套件（pipeDistanceSeverity + pickRefnoBox +
  resultFilter）共 8 套件：35 failed / 80 passed = 与计划起点 baseline
  完全一致，**0 新增 fail**，新增 19 pass。
- `npm run type-check` 0 error；本次涉及文件 lint 0 error 0 warning。
- 不破坏 `activeResultIndex` API；`MeasurementPanel.test.ts` mock 无需改。
- 起点 commit = `3ca20ec`；落地链 = `efc33ae` (PR-1) → `e29c8c8` (PR-2) →
  `4387c58` (PR-3) → `4000a27` (PR-4)。

### 矩形 / OBB 批注双击图钉收起（推广 cloud 方案 A 到全部批注类型）

- 延续早些 commit 359932d 的「云线批注双击图钉收起」能力，按方案 A 推广到
  矩形 / OBB 批注；原本这两类批注的 pin 是 3D mesh、没有独立 DOM marker，
  无法绑定 `dblclick`，所以「双击图钉收起文字框」对它们一直缺位。
- `useToolStore.ts`：`RectAnnotationRecord` / `ObbAnnotationRecord` 新增
  `collapsed?: boolean` 字段；`normalizeRect/ObbAnnotationRecord` 默认补
  `false`；新增 `setRectAnnotationsCollapsed` / `setObbAnnotationsCollapsed`
  action 并导出，与 `setTextAnnotationsCollapsed` / `setCloudAnnotationsCollapsed`
  对齐。
- `useDtxTools.ts`（rect / obb 渲染段）：
  - 在原 3D `visual.pin` 之外新增 DOM marker（`makeTextAnnotationMarkerEl(overlay, 'R' | 'O', r.collapsed === true)`），注册到 `markers` map 与 cloud 一致；
  - marker `click` 用 `ev.detail > 1 return` 拦截、避免与双击冲突；
  - marker `dblclick` 调用对应 `setRect/ObbAnnotationsCollapsed`，复用文字批注 `toggleTextAnnotationCollapsed` helper；
  - `visual.box` + `visual.pin` 始终 add 到 `toolsGroup`；`visual.leader.root` 与 label / 拖动 / 输入事件被 `shouldRenderTextAnnotationCard(r.collapsed)` 包裹，`collapsed` 时只保留 box + 3D pin + DOM 图钉 marker，隐藏文字框 + 引线。
- 扩展 `src/composables/useToolStore.cloudCollapsed.test.ts`：在原 cloud
  describe 基础上加 rect / obb 两组 describe，共 8 条新单测覆盖 normalize 默认值、
  `add` 保留显式 `collapsed=true`、批量双向切换、跨类型不污染。整体 13/13 PASS。
- 验证：`npm run type-check` 0 error；`useToolStore.ts` + `useDtxTools.ts`
  lint 0/0；双胞胎 5 套件 + DockLayout + cloudCollapsed 汇总 35 fail / 78 pass
  （0 新增 fail，新增 8 rect+obb pass）。

### 云线批注双击图钉收起（与文字批注对齐）

- 修复云线批注的文字框不能像文字批注一样「双击图钉收起来」的问题；
  此前 `CloudAnnotationRecord` 缺 `collapsed` 字段，`useToolStore` 也未提供
  `setCloudAnnotationsCollapsed` action，`useDtxTools` 渲染云线 marker 时
  第 3 参数写死 `false` 且只绑 `click`、不绑 `dblclick`，导致云线文字框无法
  通过图钉折叠/展开。
- `useToolStore.ts`：`CloudAnnotationRecord` 新增 `collapsed?: boolean` 字段；
  `normalizeCloudAnnotationRecord` 默认补 `false`；新增
  `setCloudAnnotationsCollapsed(ids, collapsed)` action 并导出，与
  `setTextAnnotationsCollapsed` 对齐。
- `useDtxTools.ts` 云线渲染段：`makeTextAnnotationMarkerEl` 第 3 参数改为
  `c.collapsed === true`（图钉视觉同步状态）；新增
  `cloudMarker.addEventListener('dblclick', ...)`，调用
  `setCloudAnnotationsCollapsed` 切换 collapsed，并复用文字批注
  `toggleTextAnnotationCollapsed` helper；`leader.root` / `label` / 拖动 / 输入
  事件统一被 `shouldRenderTextAnnotationCard(c.collapsed)` 包裹，`collapsed`
  时仅渲染 `pin` + `outline` + `bboxEdges`，保留云线轮廓与包围盒视觉。
- 新增 `src/composables/useToolStore.cloudCollapsed.test.ts` 5 条单测：
  normalize 默认值、`add` 保留显式 `collapsed=true`、批量双向切换、空/空白 ids
  防御、不污染文字批注 `collapsed`。
- `DockLayout.test.ts` 顺手补 `useReviewStore` mock 的 `currentTask` ref
  （远端 commit 加入 `isExternalSjReturnedFormFocused` helper 时漏 mock，
  导致单跑 3 个 `TypeError: Cannot read properties of undefined (reading 'value')`；
  与本主题无关，但顺手清理）。
- 验证：`npm run type-check` 0 error；`useToolStore.ts` + `useDtxTools.ts` lint
  0 error 0 warning；`cloudCollapsed.test.ts` 5/5 通过；双胞胎 5 套件 +
  DockLayout + cloudCollapsed 汇总 35 fail / 70 pass（0 新增 fail，转绿
  DockLayout 3 个 TypeError，新增 5 个 cloud collapsed pass）。

### JD/JH 可确认 SJ 已处理的驳回批注

- 外部 `form_id` 聚焦场景下，`ReviewPanel.vue` 同步批注处理状态改为按 `formId` 查询，不再强绑当前内部 `taskId`。
- 修复 SJ、JD、JH 在同一外部单据上恢复到不同内部 taskId 时，JD/JH 看不到 SJ 已提交的 `fixed/wont_fix`，导致“同意 / 驳回”被禁用的问题。
- 后端 `plant-model-gen` 已同步补充 `jh` 角色的 `agree/reject` 权限白名单，避免 JH token 被服务端拒绝。
- 验证：`npm run type-check` 通过；`ReviewCommentsTimeline.test.ts` 11/11 通过；`npm run build` 通过；后端本地 `cargo check` 因缺少 NASM 被环境阻断，线上部署后 `/api/health` 与 `/api/version` 均 HTTP 200。

### SJ 驳回单据批注处理确认入口恢复

- 修复 SJ 打开驳回/退回单据进入 `ReviewPanel` 后，评论线程调用 `buildCommentThreadKey()` 报 `buildCommentThreadKey is not defined` 的运行时错误。
- `useToolStore.ts` 显式导入 `buildCommentThreadKey`，避免类型层面通过但运行时未注入。
- 外部 SJ returned/rejected 场景保留 `designer-only` 语义，恢复“已修改 / 不需解决 → 提交处理结果”入口，用于逐条确认批注已处理。
- 仍不开放校审侧“同意 / 驳回”动作，也不恢复新增批注/测量证据入口；“确认当前数据”继续只服务新增证据保存。
- 验证：`npm run type-check` 通过；`ReviewCommentsTimeline.test.ts` + `commentThread.test.ts` + `commentThreadStore.test.ts` 35/35 通过；`npm run build` 通过。

### SJ 外部单据仅在驳回/退回状态下进入校审面板

- 修正 `sj + 外部 form_id` 被无条件路由到 `ReviewPanel` 的问题：普通未驳回单据保持设计端落点。
- 只有恢复到的任务确认为 canonical returned/rejected 时，SJ 打开该单据才显示校审面板。
- `embedRoleLanding.ts` 不再仅凭 `sj + form_id` 把落点改为 reviewer；`form_id` 仍用于权限与批注 scope 判定。
- `embedContextRestore.ts` 支持 returned designer task panel 选择，外部 SJ returned/rejected 场景可路由到 `review`。
- `DockLayout.vue` 在任务恢复后结合 `isCanonicalReturnedTask()` 决定是否收敛到校审面板。
- 验证：`embedRoleLanding.test.ts` + `embedContextRestore.test.ts` 35/35 通过；`npm run type-check` 通过；`git diff --check` 通过。

## 2026-05-08

### RUS-239 驳回后重新流转 — UX 增强与健壮性提升

- 设计批注处理面板新增**驳回原因提示框**：驳回任务打开时在任务级动作区域顶部显示 amber 提示框，展示驳回原因并引导用户点击「流转回校对」。
- 「流转回校对」按钮就绪态增加 ring 高亮效果，禁用态显示 title 提示（未处理批注 / 未保存证据）。
- `workflowBridge.ts` 新增 `notifyParentWorkflowActionWithAck()`，发送 workflow action 后等待父窗口 `plant3d.workflow_action_ack` 回执，5 秒超时返回 `'timeout'`。

## 2026-04-30

### RUS-239 驳回后重新流转修复

- 新增外部流程桥接判断，仅在 PMS/仿 PMS 嵌入模式下向父窗口发送 `plant3d.workflow_action`。
- 设计批注处理页“流转回校对”和任务详情“再次提交”已接入 `workflow/sync active` 语义，避免外部流程场景继续走内部 submit。
- 仿 PMS runner 在发起后关闭额外 `3d-view` 页面并降低诊断等待耦合，`bran-mixed` 已验证通过至 `PZ approve`。
- 保留独立/内部模式的旧提交流转路径，并补充 RUS-239 计划、发现和执行记录。

### RUS-238 测量路径展示增强

- 测量列表、确认测量回放和批注测量证据已支持异步解析模型树完整路径。
- 新增统一展示层 `useMeasurementPathSummaries`，初始仍显示 refno fallback，路径解析成功后再替换为完整路径。
- 完整路径查询失败、模型树数据不可用或历史记录缺上下文时，继续显示 `24381/145018` 这类规范化 refno，不影响页面渲染。
- 批注证据仅在展示层增强，保留原有定位链路和同步 summary fallback。
- 补充 RUS-238 UI 接入、验收与后续 PMS/编校审验证计划文档。

### RUS-238 推送后验收规划

- 新增 planning-with-files 规划目录，包含任务计划、findings、progress、验收输入清单和工作区盘点。
- 新增自包含 HTML/SVG 流程图，展示真实验收、PMS/编校审验收、二次开发判断与工作区收敛路径。
- 明确真实验收继续依赖目标 BRAN、PMS 包名/任务单、验收角色和入口输入。

### RUS-238 仿 PMS 验收记录

- 使用 BRAN `24381_145018` 跑通 approved 主链，最终 `status=approved` / `node=pz`。
- restore 场景中 BRAN、测量和确认记录读回通过；整体失败来自刷新前评论内容 UI 断言，非测量路径展示失败。
- Chrome CDP full flow 通过真实 PMS 入口创建三维校审单，并在嵌入站点接口命中包名或 BRAN。

## 2026-04-27

### 三维校审批注截图增强

- 统一批注截图数据模型，以 `screenshot` 作为主路径，并兼容历史 cloud 批注的 `thumbnailUrl` / `attachmentId`。
- 截图上传支持 `sourceAnnotationId`、描述信息和 `annotation_screenshot` 类型元数据，便于服务端追踪来源批注。
- 审查工作区、批注表格和处理时间线支持展示批注截图缩略图，并可点击预览大图。
- 表格筛选、排序、CSV 导出和工作区错误类型统一为“原则错误 / 一般错误 / 图面错误”。
- 删除批注和重拍截图时会异步清理旧截图附件，降低服务端孤儿附件残留。
- 批注面板截图上传时显示进度；已有截图重拍前会提示确认。
