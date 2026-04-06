# 三维校审 PMS 调试模拟器任务单

> 生成时间：2026-03-25  
> 适用阶段：`调试支撑：PMS iframe 模拟器`  
> 对应范围：PMS 风格校审清单页、快速角色切换、真实列表、iframe 打开与 form_id 诊断  
> 主设计参考：PMS `sysin.html` / 「三维校审单」列表页截图 / 审批处理弹窗截图  
> 配套文档：`docs/verification/pms-3d-review-integration-e2e.md`、`开发文档/三维校审/编校审交互接口设计.md`、`开发文档/三维校审/三维校审M0页面接口字段映射表.md`

## 0. 2026-04-01 当前已落地口径

围绕“点击**新增**后 plant3d 仍要求手动选择 Project”的问题，仿 PMS 调试页当前已经收口到以下行为：

1. **项目来源**改为后端 `/api/projects`，不再默认沿用 `PROJECT-EMBED-001` 这类伪项目号。
2. **默认项目解析顺序**为：`output_project -> project -> AvevaMarineSample -> 项目列表第一项`。
3. 工具栏中的项目字段已从**自由输入**改为**真实项目下拉选择**。
4. 发往 `/api/review/embed-url` 的 `project_id` 现在使用真实模型项目路径，例如 `AvevaMarineSample`。
5. 最终 iframe URL 收口为：
   - 保留 `user_token`
   - 保留 `output_project=<真实项目路径>`
   - 不再回流 `project_id / user_id / user_role`
6. 本地浏览器级验证结果已确认：点击「新增」后会直接进入 plant3d 嵌入工作区，不再回到项目选择页。

如果后续继续扩展该调试页，请以这一组口径为准，不要再把外部业务项目号直接塞回 `project_id`。

## 0.2 2026-04-02 当前运行态补充

在 0.1 的项目/嵌入合同之外，仿 PMS 调试页当前还已经收口到以下运行态事实：

1. **PMS 用户与工作流角色解耦**
   - `SJ / JH / SH / PZ`：PMS 测试用户
   - `sj / jd / sh / pz`：工作流角色
2. **external/passive 由 `workflow/sync` 驱动**
   - 外层 workflow 面板已支持：
     - `active`
     - `agree`
     - `return`
     - `stop`
3. **已验证的 external/passive 主链**
   - `SJ active -> JH agree -> SH agree -> PZ agree -> approved`
   - `SJ active -> JH agree -> SH stop -> cancelled`
   - `SJ active -> JH agree -> SH agree -> PZ return -> sj -> SJ reopen initiate`
4. **基于固定 BRAN `24381_145018` 的数据证据链**
   - `JH` 阶段可真实添加：
     - 1 条批注
     - 1 条距离测量
     - 1 个截图附件
   - `approved` reopen 时：
     - iframe 内恢复批注与测量
     - iframe 内“附件材料”tab 已出现 1 条附件条目
     - 当前默认显示 attachment `description` / 标签，而不是原始上传文件名
5. **可操作性判定已固定**
   - 已有单据优先按**真实任务指派**判断是否可操作
   - 缺失真实指派时回退按**默认测试流转映射**
   - `approved / cancelled` 终态强制只读

因此如果后续继续扩展该调试页，请不要再按“external/passive 下 reviewer 永远只读”来设计仿 PMS 外层壳；当前真实口径是：

> **plant3d 内部 reviewer 面板仍保持被动只读，但仿 PMS 外层 workflow 面板已可通过 `workflow/sync` 驱动外部流程。**

## 1. 目标

本任务的目标不是复刻完整 PMS 门户，而是先提供一个**高效率、可复现、可观察**的调试壳，用最少操作支撑以下调试主链路：

1. 通过固定 PMS 用户按钮快速切换 `SJ / JH / SH / PZ`。
2. 打开一个与 PMS「三维校审单」外观接近的列表页。
3. 列表直接展示真实后端返回的**全部校审数据**，不使用 mock 假数据。
4. 从列表中选中某条单据后，以 iframe 打开真实 plant3d 三维校审页。
5. 支持围绕同一个 `form_id` 做“首次打开 / 同用户重开 / 跨用户重开”调试。
6. 在外层页面同步观察 `taskId / formId / status / currentNode / components / workflow models`，便于定位“保存后重进为什么看不到关联构件”。

## 2. 范围与非范围

### 2.1 本轮范围

- 独立 PMS 风格调试页（优先独立 html 入口）
- 左侧静态菜单壳与顶部面包屑/当前层级/当前用户区域
- 顶部固定 PMS 用户快捷切换
- PMS 风格工具栏与表格布局
- 真实校审数据列表与前端字段映射层
- 列表选择、查看、刷新、重开当前单据
- iframe 嵌入真实 plant3d 校审页面
- 诊断信息区与 `form_id` 关联核查动作

### 2.2 不属于本轮的内容

- 完整 PMS 登录认证协议复刻
- 完整门户首页、菜单权限树、平台管理功能
- PMS 真正的新增/编辑/删除业务弹窗闭环
- 后端新增接口或状态机改造
- 对 plant3d 三维页内部流程按钮做第二套外层替代 UI

## 3. 页面与交互结构

### FE-T0 页面壳结构落点确定

- **目标**：采用仓库现有独立调试页约定，新增一个 PMS 风格独立页面，而不是先侵入主应用 DockLayout。
- **涉及文件**：建议新增 `pms-review-simulator.html`、`src/debug/pmsReviewSimulator.ts`
- **依赖**：参考现有 `embed-url-test.html`、`rebar-beam-demo.html`
- **完成标准**：
  - 页面可直接通过独立 URL 打开。
  - 页面自身完成布局、状态管理与数据加载。
  - 不要求主应用内先做正式菜单入口。
- **风险/备注**：若强行塞入当前主应用，会扩大布局与状态隔离复杂度，不利于快速调试。

### FE-T1 PMS 风格列表页框架搭建

- **目标**：先把截图中的「三维校审单」主界面形态搭起来。
- **涉及文件**：`pms-review-simulator.html`、`src/debug/pmsReviewSimulator.ts`、必要的局部样式文件
- **依赖**：截图结构与现有 PMS 页面观感
- **完成标准**：
  - 左侧菜单至少包含 `设计交付 -> 三维校审单`、`平台管理`。
  - 顶部至少包含面包屑、当前层级、当前用户区。
  - 中间主区包含工具栏、全量表格、iframe 区、诊断区。
  - 页面结构优先接近 PMS，而不是沿用当前 plant3d 主应用的 Dock 样式。
- **风险/备注**：本轮重点是信息架构与调试效率，不做像素级还原。

### FE-T2 快速用户切换

- **目标**：提供“一键切用户”的调试能力，避免每次重走复杂登录流程。
- **涉及文件**：`src/debug/pmsReviewSimulator.ts`
- **依赖**：PMS 用户别名固定为 `SJ / JH / SH / PZ`
- **完成标准**：
  - 顶部提供固定 PMS 用户按钮。
  - 切换后当前用户展示立即更新。
  - 切换后列表自动刷新。
  - 切换后默认关闭当前 iframe，避免旧会话残留。
  - 保留“最近打开单据”的 `form_id`，供新角色一键重开。
- **风险/备注**：本轮是“PMS 用户上下文模拟”，不是 PMS 后端登录态真正迁移；工作流角色应由外部 `role` 或任务节点决定。

### FE-T3 校审清单表格实现

- **目标**：按截图列结构展示真实校审数据，并支持高效调试操作。
- **涉及文件**：`src/debug/pmsReviewSimulator.ts`
- **依赖**：现有 review 任务接口返回
- **完成标准**：
  - 固定展示以下列：`序号 / 状态 / 项目代码 / 项目名称 / 标题 / 版本 / 模型表单编号 / 备注 / 录入人 / 录入日期`
  - 列顺序与截图保持一致。
  - 数据源来自真实后端，不内置静态假数据。
  - 默认展示当前可拉到的全部校审记录。
  - 支持行选中、高亮、双击查看。
- **风险/备注**：若接口返回字段不完整，第一版允许空列，但表格骨架必须稳定。

### FE-T4 工具栏最小动作集

- **目标**：保留 PMS 工具栏形态，但只开放调试最需要的动作。
- **涉及文件**：`src/debug/pmsReviewSimulator.ts`
- **依赖**：列表选择状态与 iframe 打开状态
- **完成标准**：
  - 工具栏显示：`新增 / 删除 / 编辑 / 查看 / 刷新`
  - 第一版真正可用：`新增 / 查看 / 刷新`
  - 第一版禁用：`删除 / 编辑`
  - `查看` 在未选中行时禁用。
  - `刷新` 会刷新列表与当前诊断快照。
- **风险/备注**：按钮存在感用于贴近 PMS，但不能把本轮范围扩成完整业务 CRUD。

> 2026-04-01 更新：项目字段当前已不是自由文本输入，而是后端 `/api/projects` 驱动的下拉选择；默认真实可用项目优先 `AvevaMarineSample`。

### FE-T5 iframe 打开与重开模型

- **目标**：让列表页成为真实 plant3d 校审页的稳定调试入口。
- **涉及文件**：`src/debug/pmsReviewSimulator.ts`、复用 `src/api/reviewApi.ts`
- **依赖**：`POST /api/review/embed-url`
- **完成标准**：
- 选中行后可点击“查看”在页面下方或右侧打开 iframe。
- “新增”可打开一个发起态 iframe 会话。
- 外层状态至少保留：当前 PMS 用户、当前工作流角色、`form_id`、`task_id`、打开来源、最近打开时间。
- 提供“以当前 PMS 用户重新打开当前单据”动作。
- 提供“同用户刷新重开”动作。
- external/passive 下需额外支持外层 workflow 面板：
  - `SJ active`
  - `JH / SH / PZ agree`
  - `return`
  - `stop`
- 终态或非目标用户打开已有单据时，应自动退回 `readonly`。
- **风险/备注**：本轮由外层页负责“打开谁、用谁打开”，三维内部仍由真实页面负责流程操作。

### FE-T6 诊断区与 form_id 核查

- **目标**：围绕 `form_id` 给出最小但够用的观测面板，帮助定位关联构件问题。
- **涉及文件**：`src/debug/pmsReviewSimulator.ts`、复用 `src/api/reviewApi.ts`
- **依赖**：任务详情接口、workflow query 接口
- **完成标准**：
  - 打开任意单据后显示：`form_id`、`task_id`、`status`、`current_node`、`components 数量`、`workflow models 数量`、当前 PMS 用户、当前工作流角色、最近刷新时间。
  - 提供“查任务详情”动作。
  - 提供“查 form_id 聚合结果”动作。
  - 支持对比 `task.components` 与 `workflow models`。
- **风险/备注**：诊断区是本页的核心价值，不能只做视觉占位。

## 4. 数据与接口任务单

### INT-T1 列表数据适配层

- **目标**：把现有 review 任务数据稳定映射成 PMS 列表行结构。
- **依赖**：`/api/review/tasks`
- **输出**：统一的 `ReviewListRow` 视图模型。
- **必须确认**：
  - `状态` 的中文映射规则
  - `模型表单编号` 固定使用 `form_id`
  - `录入日期` 固定格式化为 `YYYY-MM-DD`

### INT-T2 iframe 嵌入地址适配

- **目标**：收口当前调试页获取 iframe 地址的单一路径。
- **依赖**：`/api/review/embed-url`
- **输出**：
  - 从当前角色与当前项目生成嵌入地址
  - 支持“新增打开”与“按既有单据重开”两种模式
- **必须确认**：若接口返回 `url` 与 `relative_path + token + query` 双轨格式，调试页要统一兼容。

> 2026-04-01 更新：当前调试页最终 iframe URL 已收口为 token-primary，并保留 `output_project` 作为资源作用域提示；不再把 `project_id / user_id / user_role` 回流进最终 URL。

### INT-T3 form_id 维度核查链路

- **目标**：在同一页面内跑通“任务详情”和“按 form_id 聚合查询”的双视角对照。
- **依赖**：`/api/review/tasks/:id`、`/api/review/workflow/sync` 查询能力
- **输出**：一份可复用的对照快照：
  - `task.components`
  - `workflow models`
  - `current_node`
  - `task_status`
- **必须确认**：查询失败时不能静默吞掉，要在诊断区明确呈现。

## 5. 验证任务单

### QA-T1 列表页形态验证

- **覆盖**：左侧菜单、顶部面包屑、工具栏、表格列顺序、当前用户区域
- **通过标准**：页面结构与截图主框架一致，用户可一眼识别为 PMS 风格调试页

### QA-T2 全量数据展示验证

- **覆盖**：真实接口返回、表格滚动、空列兜底、状态映射
- **通过标准**：页面展示真实校审数据，且默认尽可能显示全部记录，而不是局部 mock 示例

### QA-T3 快速切角色验证

- **覆盖**：`SJ -> JH -> SH -> PZ` 切换、列表刷新、iframe 重置
- **通过标准**：切换操作为单击完成，无需重新登录整套流程

### QA-T4 列表进入 iframe 验证

- **覆盖**：选中一条记录后查看、双击查看、新增发起态打开
- **通过标准**：iframe 能稳定打开真实 plant3d 页面，并正确带出当前角色与单据上下文；若点击「新增」，不应再落到项目选择页，而应直接进入嵌入工作区

### QA-T5 同单据重开验证

- **覆盖**：同角色重开、跨角色重开、最近打开单据保留
- **通过标准**：可以围绕同一 `form_id` 连续执行 `SJ 打开 -> JH 重开` 这样的调试动作

### QA-T7 external/passive workflow 主链验证

- **覆盖**：
  - `SJ active -> JH agree -> SH agree -> PZ agree -> approved`
  - `SJ active -> JH agree -> SH stop -> cancelled`
  - `SJ active -> JH agree -> SH agree -> PZ return -> sj -> SJ reopen`
- **通过标准**：
  - `workflow/sync` 动作后 backend 真实状态发生变化
  - `task_status / form_status / lineage.status` 与页面表现一致
  - `approved / cancelled` reopen 自动只读
  - `return -> sj` 后 `SJ` 可重新进入 `initiate`

### QA-T8 BRAN 数据恢复验证

- **覆盖**：固定 BRAN `24381_145018` 下的批注、测量、附件恢复
- **通过标准**：
  - `JH` 阶段可真实添加 1 条批注、1 条距离测量、1 个截图附件
  - `records/by-task` 可回读 `annotations_total = 1`、`measurements_total = 1`
  - `workflow/sync?action=query` 可回读 `attachments_len = 1`
  - `approved` reopen 时，iframe 内恢复批注与测量，附件 tab 至少出现 1 条附件条目

### QA-T6 关联构件问题定位验证

- **覆盖**：`task.components` 与 `workflow models` 对照、重进后 UI 显示情况
- **通过标准**：至少能明确区分以下三类问题：
  1. 任务里有构件，但前端重进未恢复
  2. 任务里有构件，但 `form_id` 聚合结果为空
  3. 当前页面看似成功，但后端任务事实并未落库

## 6. 必须拍板的确认项

以下事项在实际编码前必须作为实现口径固定：

1. 第一版主入口采用**独立调试页**，不先侵入主应用路由/布局。
2. 第一版列表字段顺序与截图保持一致，不做自由列配置。
3. 第一版只开放 `新增 / 查看 / 刷新` 三个实际动作；**当前运行态已扩展**为：
   - 仿 PMS 外层 workflow 面板支持 `active / agree / return / stop`
   - 但 plant3d 内部 reviewer 工作区在 passive/external 下仍不开放内部流转按钮
   - 固定 BRAN `24381_145018` 的批注 / 测量 / 附件恢复链已经验证通过，后续 UI 不要回退到“附件只能外层可见”的旧口径
4. 第一版角色切换使用固定别名按钮，不复刻完整 PMS 登录协议。
5. 第一版 iframe 内使用真实 plant3d 页面按钮，外层不重做第二套流程 UI。
6. 第一版诊断必须同时覆盖 `task` 视角与 `form_id` 视角。

## 7. 可留到后续的事项

- 与主应用联通的正式入口按钮
- 列表筛选、分页、排序、导出
- 更完整的 PMS 工具栏动作（编辑、删除）
- 更接近 PMS 的审批处理弹窗模拟
- 真正的多账号登录态与 Cookie/Token 管理
- 自动化脚本与该调试页联动（例如一键打开最近单据并切角色）

## 8. 推荐执行顺序

1. `FE-T0` 独立页面落点与入口确定
2. `FE-T1` 搭建 PMS 风格列表页主框架
3. `FE-T2` 接入快速角色切换
4. `INT-T1` 完成列表数据适配层
5. `FE-T3` 接入真实全量表格
6. `FE-T4` 完成工具栏最小动作集
7. `FE-T5` 打通 iframe 打开与重开逻辑
8. `FE-T6` 完成诊断区与 `form_id` 核查
9. 执行 `QA-T1 ~ QA-T6` 做最小闭环验收

## 9. 建议的立即动作

1. 先按本任务单实现**独立调试页 + 快速角色切换 + 全量校审列表 + iframe 打开**四个骨架能力。
2. 第一轮不先追求完整 PMS 门户复刻，只保证“切用户快、找单据快、打开快、重进快”。
3. 完成后立即用同一条真实 `form_id` 做 `SJ -> JH` 跨角色重开验证，作为本页第一优先验收用例。
