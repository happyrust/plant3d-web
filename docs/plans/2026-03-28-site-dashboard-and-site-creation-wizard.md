# 站点管理 Dashboard 与新建站点向导 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 plant3d-web 中新增“主站点控制台”能力，支持查看/筛选/管理 deployment sites，并通过向导快速创建新站点；同时让当前站点支持基于站点配置快速创建解析/建模任务，但不在第一期实现主站点跨站远程发任务。

**Architecture:** 前端新增独立的 `DeploymentSite` 领域层，不再复用当前 `ModelProject` 语义来承载站点。站点控制台统一对接 `../plant-model-gen` 已有的 `/api/deployment-sites`、`/api/sites`、`/api/site/identity` 合同；任务创建能力仅在“当前站点”上下文下注入配置并复用现有 `TaskCreationWizard` 与 `TaskMonitor` 链路。跨站任务调度明确留到后续独立方案，不在本计划内混做。

**Tech Stack:** Vue 3 + TypeScript + 现有 composables/API 模块 + Vuetify/Tailwind 混合 UI + plant-model-gen deployment-sites REST API

---

## 一、范围边界

### 本期包含
- 新增站点领域模型、API 封装、状态管理 composable
- 新增主站点 dashboard / 站点列表 / 站点详情抽屉
- 新增“新建站点向导”，支持手动创建与从 DbOption 导入
- 新增当前站点身份展示（读取 `/api/site/identity`）
- 让当前站点可基于站点配置快速打开任务创建向导
- 最小必要单测：字段映射、表单载荷、站点上下文到任务配置注入

### 本期不包含
- 主站点直接代理远程站点执行任务
- 重写现有 `useModelProjects` 为站点模型
- 重构 viewer/bundle/project 加载主链路
- 大规模 E2E 自动化

---

## 二、文件结构与职责拆分

### 新增文件
- `src/types/site.ts`
  - 站点领域类型定义：`DeploymentSite`、`DeploymentSiteStatus`、`DeploymentSiteIdentity`、列表响应、创建/更新请求体
- `src/api/siteRegistryApi.ts`
  - 对接 deployment-sites / site identity 的 REST API
- `src/composables/useDeploymentSites.ts`
  - 站点列表加载、筛选、详情读取、创建/更新/删除/健康检查动作封装
- `src/composables/useCurrentSiteIdentity.ts`
  - 当前站点身份读取与缓存
- `src/components/site/SiteDashboardPanel.vue`
  - 主站点控制台整体页面容器
- `src/components/site/SiteMetricCards.vue`
  - 站点统计卡片：总站点数 / Running / Offline / Failed / 当前站点
- `src/components/site/SiteCardList.vue`
  - 站点卡片/列表视图
- `src/components/site/SiteDetailDrawer.vue`
  - 站点详情抽屉 + 快捷动作
- `src/components/site/SiteStatusBadge.vue`
  - 站点状态徽标
- `src/components/site/SiteCreationWizard.vue`
  - 新建站点向导（手动创建 / 导入 DbOption）
- `src/components/site/SiteCreationWizard.test.ts`
  - 载荷构建与基础步骤校验最小测试
- `src/composables/useDeploymentSites.test.ts`
  - 响应映射、过滤、状态统计测试
- `src/composables/useCurrentSiteIdentity.test.ts`
  - 当前站点身份读取与兜底测试

### 修改文件
- `src/components/dashboard/DashboardLayout.vue`
  - 新增“站点管理”导航入口，并挂载 `SiteDashboardPanel`
- `src/components/dashboard/DashboardOverview.vue`
  - 首页快捷操作增加“站点管理 / 新建站点”入口，避免只能进项目页
- `src/composables/useDashboardWorkbench.ts`
  - 首页统计增加可选站点摘要（轻量接入，不破坏现有评审/项目逻辑）
- `src/components/task/TaskCreationWizard.vue`
  - 支持接收外部站点上下文与初始配置
- `src/composables/useTaskCreation.ts`
  - 支持外部注入 `initialConfig` / `siteContext`，避免强依赖 `/api/config`
- `src/components/dock_panels/TaskCreationPanelDock.vue`
  - 支持向 `TaskCreationWizard` 透传站点上下文参数
- `src/api/genModelTaskApi.ts`
  - 只做极小改动：补任务创建时可选 site metadata 说明（如需要）
- `src/components/DockLayout.vue`
  - 预留从站点详情打开任务向导时的 preset/context 入口

### 文档文件
- `docs/plans/2026-03-28-site-dashboard-and-site-creation-wizard.md`
  - 当前实施计划（本文件）
- 如实现后有合同变化，再补：`docs/plans/2026-03-28-site-dashboard-and-site-creation-wizard-handoff.md`

---

## 三、关键设计决策

### 1. 站点与项目分层，不复用 `ModelProject`
- `ModelProject` 继续服务 viewer/project bundle 语义
- `DeploymentSite` 只服务站点控制台与站点配置
- 本期不把二者混成一个对象，避免污染现有模型加载链路

### 2. 当前站点可直接建任务，远端站点仅提供跳转
- 若详情抽屉中的站点 `site_id` 与 `/api/site/identity` 返回的当前站点一致，则提供：
  - 创建解析任务
  - 创建建模任务
  - 打开任务监控
- 若不是当前站点，则仅提供：
  - 打开前端地址
  - 复制后端地址
  - 健康检查
- UI 文案明确提示：`跨站任务调度未在当前版本开放，请进入目标站点执行任务。`

### 3. `TaskCreationWizard` 改为“配置可注入”
- 默认行为仍然保留：无外部配置时继续走 `/api/config`
- 新增 props / composable options：
  - `initialConfig?: DatabaseConfig`
  - `siteContext?: { siteId: string; siteName: string; isCurrentSite: boolean }`
- 这样可兼容：
  - 现有 Dock 面板入口
  - 站点详情抽屉打开向导入口

### 4. 新建站点向导采用“两条路径、一个模型”
- 手动创建：最终提交 `POST /api/deployment-sites`
- 导入 DbOption：最终提交 `POST /api/deployment-sites/import-dboption`
- 但 UI 保持统一步骤：
  - 选择创建方式
  - 基础信息
  - 地址与项目信息
  - 配置确认

---

## 四、任务拆解

### Task 1: 建立站点领域模型与 API 封装

**Files:**
- Create: `src/types/site.ts`
- Create: `src/api/siteRegistryApi.ts`
- Test: `src/composables/useDeploymentSites.test.ts`

- [ ] **Step 1: 定义站点领域类型**

在 `src/types/site.ts` 定义：
- `DeploymentSiteStatus`
- `DeploymentSite`
- `DeploymentSiteIdentity`
- `DeploymentSiteListResponse`
- `DeploymentSiteCreateRequest`
- `DeploymentSiteUpdateRequest`
- `DeploymentSiteImportRequest`

字段以 `../plant-model-gen/src/web_server/models.rs` 为事实源，至少覆盖：
- `site_id`
- `name`
- `region`
- `project_name`
- `project_path`
- `project_code`
- `frontend_url`
- `backend_url`
- `bind_host`
- `bind_port`
- `status`
- `last_seen_at`
- `config`

- [ ] **Step 2: 编写 API 模块**

在 `src/api/siteRegistryApi.ts` 新增：
- `getDeploymentSites(params)`
- `getDeploymentSite(siteId)`
- `createDeploymentSite(payload)`
- `updateDeploymentSite(siteId, payload)`
- `deleteDeploymentSite(siteId)`
- `healthcheckDeploymentSite(siteId)`
- `importDeploymentSiteFromDbOption(payload)`
- `getCurrentSiteIdentity()`

要求：
- 统一复用 `getBackendApiBaseUrl()`
- 统一处理 JSON 错误返回
- 不在此层混入 UI 逻辑

- [ ] **Step 3: 写最小失败测试（映射 / 错误处理）**

测试点：
- 列表响应 `{ items, total, page, per_page, pages }` 能被正确读取
- `409`、`400` 错误能转换成可展示 message
- `site_id` 缺失时不 silently fallback 为错误字段

Run: `npm test -- src/composables/useDeploymentSites.test.ts`
Expected: 初始 FAIL（模块未实现或断言不通过）

- [ ] **Step 4: 实现 API 最小通过版本**

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test -- src/composables/useDeploymentSites.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/types/site.ts src/api/siteRegistryApi.ts src/composables/useDeploymentSites.test.ts
git commit -m "feat(site): add deployment site api contracts"
```

---

### Task 2: 新增站点数据 composable 与当前站点身份 composable

**Files:**
- Create: `src/composables/useDeploymentSites.ts`
- Create: `src/composables/useCurrentSiteIdentity.ts`
- Test: `src/composables/useDeploymentSites.test.ts`
- Test: `src/composables/useCurrentSiteIdentity.test.ts`

- [ ] **Step 1: 设计 composable 输出接口**

`useDeploymentSites()` 至少提供：
- `sites`
- `loading`
- `error`
- `filters`
- `stats`
- `selectedSite`
- `loadSites`
- `openSiteDetail`
- `createSite`
- `updateSite`
- `deleteSite`
- `healthcheckSite`

`useCurrentSiteIdentity()` 至少提供：
- `identity`
- `loading`
- `error`
- `refresh`
- `isCurrentSite(site)`

- [ ] **Step 2: 写失败测试**

测试点：
- `stats` 正确计算 Running / Failed / Offline 数量
- `isCurrentSite(site)` 按 `site_id` 匹配
- `loadSites` 失败时 error 正确设置

Run: `npm test -- src/composables/useDeploymentSites.test.ts src/composables/useCurrentSiteIdentity.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 composable**

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/composables/useDeploymentSites.test.ts src/composables/useCurrentSiteIdentity.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/composables/useDeploymentSites.ts src/composables/useCurrentSiteIdentity.ts src/composables/useDeploymentSites.test.ts src/composables/useCurrentSiteIdentity.test.ts
git commit -m "feat(site): add deployment site composables"
```

---

### Task 3: 新增站点控制台页面与导航接入

**Files:**
- Create: `src/components/site/SiteDashboardPanel.vue`
- Create: `src/components/site/SiteMetricCards.vue`
- Create: `src/components/site/SiteCardList.vue`
- Create: `src/components/site/SiteStatusBadge.vue`
- Modify: `src/components/dashboard/DashboardLayout.vue`
- Modify: `src/components/dashboard/DashboardOverview.vue`

- [ ] **Step 1: 先做静态 UI 骨架**

页面需要包含：
- 头部：主站点名称 / 当前站点身份 / 刷新 / 新建站点按钮
- 统计卡片：总站点 / Running / Offline / Failed / 当前站点
- 列表区域：卡片或表格视图
- 空状态 / 加载态 / 错误态

- [ ] **Step 2: 接入 composable 数据源**

要求：
- 使用 `useDeploymentSites()` 加载数据
- 使用 `useCurrentSiteIdentity()` 展示当前站点标识
- 不在组件里直接写 fetch

- [ ] **Step 3: 在 DashboardLayout 新增导航项**

新增菜单 ID：`sites`

行为：
- `dashboard` 仍是首页概览
- `sites` 进入站点控制台
- 不影响原 `projects` / `reviews` 流程

- [ ] **Step 4: 首页增加站点快捷入口**

在 `DashboardOverview.vue` 的快捷操作区新增：
- 站点管理
- 新建站点

要求：
- 不删除当前已有“上传/打开模型 / 发起提资 / 待办校审”入口
- 新增按钮点击后切到 `sites`

- [ ] **Step 5: 手工验证导航联通性**

Run: `npm run dev`
Expected:
- 首页可进入站点控制台
- 站点控制台可返回首页
- 无控制台红错

- [ ] **Step 6: Commit**

```bash
git add src/components/site/SiteDashboardPanel.vue src/components/site/SiteMetricCards.vue src/components/site/SiteCardList.vue src/components/site/SiteStatusBadge.vue src/components/dashboard/DashboardLayout.vue src/components/dashboard/DashboardOverview.vue
git commit -m "feat(site): add site dashboard entry"
```

---

### Task 4: 新增站点详情抽屉与快捷动作

**Files:**
- Create: `src/components/site/SiteDetailDrawer.vue`
- Modify: `src/components/site/SiteDashboardPanel.vue`
- Modify: `src/components/site/SiteCardList.vue`

- [ ] **Step 1: 设计详情抽屉内容区块**

区块拆分：
- 基础信息
- 项目与地址
- 运行配置摘要
- 快捷动作

动作清单：
- 当前站点：创建解析任务 / 创建建模任务 / 打开任务监控 / 健康检查 / 编辑
- 非当前站点：打开站点 / 复制地址 / 健康检查 / 编辑
- 所有站点：删除（当前站点若后端 409，展示明确提示）

- [ ] **Step 2: 实现详情抽屉并接到列表项点击**

- [ ] **Step 3: 实现快捷动作的最小行为**

要求：
- 健康检查：调用 `healthcheckSite`
- 打开站点：`window.open(frontend_url, '_blank')`
- 复制地址：优先复制 `backend_url`
- 当前站点创建任务：先预留事件回调，Task 6 再真正接通

- [ ] **Step 4: 手工验证**

Run: `npm run dev`
Expected:
- 点击卡片能打开详情
- 健康检查返回后状态刷新
- 删除当前站点时能收到失败提示

- [ ] **Step 5: Commit**

```bash
git add src/components/site/SiteDetailDrawer.vue src/components/site/SiteDashboardPanel.vue src/components/site/SiteCardList.vue
git commit -m "feat(site): add site detail drawer actions"
```

---

### Task 5: 新增站点创建向导（手动创建 + DbOption 导入）

**Files:**
- Create: `src/components/site/SiteCreationWizard.vue`
- Test: `src/components/site/SiteCreationWizard.test.ts`
- Modify: `src/components/site/SiteDashboardPanel.vue`

- [ ] **Step 1: 写失败测试（载荷构建）**

测试点：
- 手动创建模式生成 `DeploymentSiteCreateRequest`
- 导入模式生成 `DeploymentSiteImportRequest`
- 手动创建时关键字段缺失会阻止提交：
  - `name`
  - `project_name`
  - `project_code`
  - `backend_url` 或 `bind_host/bind_port`

Run: `npm test -- src/components/site/SiteCreationWizard.test.ts`
Expected: FAIL

- [ ] **Step 2: 实现向导步骤 UI**

步骤建议：
1. 创建方式
2. 基础信息
3. 项目与地址
4. 配置确认

默认值要求：
- `bind_host = 0.0.0.0`
- `bind_port = 3100`
- `module = DESI`
- `mdb_name = ALL`
- `db_type = surrealdb`
- `gen_model = true`
- `gen_mesh = true`
- `gen_spatial_tree = true`
- `apply_boolean_operation = true`

- [ ] **Step 3: 实现提交逻辑**

手动创建：
- 调 `createDeploymentSite(payload)`

导入模式：
- 调 `importDeploymentSiteFromDbOption(payload)`

成功后：
- 关闭向导
- 刷新站点列表
- 自动打开刚创建站点的详情抽屉

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/components/site/SiteCreationWizard.test.ts`
Expected: PASS

- [ ] **Step 5: 手工验证**

Run: `npm run dev`
Expected:
- 可从主站点 dashboard 打开新建站点向导
- 手动创建成功后列表刷新
- DbOption 导入成功后列表刷新

- [ ] **Step 6: Commit**

```bash
git add src/components/site/SiteCreationWizard.vue src/components/site/SiteCreationWizard.test.ts src/components/site/SiteDashboardPanel.vue
git commit -m "feat(site): add site creation wizard"
```

---

### Task 6: 让任务创建支持站点配置注入

**Files:**
- Modify: `src/composables/useTaskCreation.ts`
- Modify: `src/components/task/TaskCreationWizard.vue`
- Modify: `src/components/dock_panels/TaskCreationPanelDock.vue`
- Modify: `src/components/site/SiteDetailDrawer.vue`
- Test: `src/components/site/SiteCreationWizard.test.ts`
- Test: `src/composables/useDeploymentSites.test.ts`

- [ ] **Step 1: 扩展 `useTaskCreation` 参数接口**

新增可选参数：
- `initialConfig?: DatabaseConfig | null`
- `siteContext?: { siteId: string; siteName: string; isCurrentSite: boolean }`

行为要求：
- 有 `initialConfig` 时，不再在 `onMounted` 强制覆盖 `/api/config`
- 无 `initialConfig` 时保持现有行为不变

- [ ] **Step 2: 扩展 `TaskCreationWizard` props**

新增 props：
- `initialConfig?`
- `siteContext?`

UI 增补：
- 若存在 `siteContext`，在向导头部显示：
  - 当前站点名称
  - 当前站点/远端站点标识
- 若 `!siteContext.isCurrentSite`，禁用提交并提示“请进入目标站点执行任务”

> 注：本期按方案 A，其实不应从远端站点打开可提交向导；这里的禁用仅作防御性兜底，不作为主流程。

- [ ] **Step 3: 从站点详情抽屉接入当前站点快速创建动作**

当前站点点击“创建解析任务 / 创建建模任务”时：
- 打开现有任务创建面板，或者先在站点页内嵌一个对话式向导（二选一，优先低改动）
- 注入 `site.config`
- 注入 preset type：
  - 解析 -> `DataParsingWizard`
  - 建模 -> `DataGeneration`

推荐低改动方案：
- 继续复用现有 `TaskCreationPanelDock`
- 通过 store 新增 `presetSiteContext`
- Dock 打开时透传到 `TaskCreationWizard`

- [ ] **Step 4: 手工验证当前站点任务创建链路**

Run: `npm run dev`
Expected:
- 在当前站点详情点击“创建解析任务”可打开任务向导
- 向导默认使用该站点 config
- 提交后任务进入现有任务监控面板

- [ ] **Step 5: 最小回归测试**

Run:
- `npm test -- src/components/site/SiteCreationWizard.test.ts src/composables/useDeploymentSites.test.ts`
- `npm run type-check`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/composables/useTaskCreation.ts src/components/task/TaskCreationWizard.vue src/components/dock_panels/TaskCreationPanelDock.vue src/components/site/SiteDetailDrawer.vue
git commit -m "feat(task): support site-scoped task creation"
```

---

### Task 7: 文案、交互边界与回归验证

**Files:**
- Modify: `src/components/site/SiteDashboardPanel.vue`
- Modify: `src/components/site/SiteDetailDrawer.vue`
- Modify: `src/components/task/TaskCreationWizard.vue`
- Modify: `docs/plans/2026-03-28-site-dashboard-and-site-creation-wizard.md`

- [ ] **Step 1: 明确跨站边界文案**

文案要求：
- 非当前站点详情中显示：
  - `该站点为远端执行节点；当前版本不支持在主站点直接为其发起任务。`
  - `请点击“打开站点”进入目标站点执行任务。`
- 当前站点详情中显示：
  - `当前站点，可直接使用本地任务创建与监控能力。`

- [ ] **Step 2: 做一次最小人工回归**

验证清单：
- 主站点 dashboard 能加载站点列表
- 新建站点（手动）成功
- 新建站点（导入）成功
- 详情抽屉健康检查成功
- 当前站点能创建解析任务
- 非当前站点不出现可提交的任务创建主流程

- [ ] **Step 3: 全量前端检查**

Run:
- `npm run type-check`
- `npm run lint`
- `npm test`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/site/SiteDashboardPanel.vue src/components/site/SiteDetailDrawer.vue src/components/task/TaskCreationWizard.vue docs/plans/2026-03-28-site-dashboard-and-site-creation-wizard.md
git commit -m "docs(site): finalize site dashboard workflow boundaries"
```

---

## 五、接口契约对接说明

### 1. 站点列表
- `GET /api/deployment-sites`
- 也兼容 `GET /api/sites`
- 以 `site_id` 为主键，不用 `id` 做前端主识别

### 2. 当前站点身份
- `GET /api/site/identity`
- 关键字段：
  - `site_id`
  - `site_name`
  - `frontend_url`
  - `backend_url`
  - `project_name`
  - `project_code`
  - `bind_host`
  - `bind_port`
  - `registration_status`

### 3. 手动创建站点
- `POST /api/deployment-sites`
- 最小必填建议：
  - `name`
  - `project_name`
  - `project_code`
  - `config`
- 建议总是显式提交：
  - `site_id`
  - `frontend_url`
  - `backend_url`
  - `bind_host`
  - `bind_port`

### 4. 导入 DbOption
- `POST /api/deployment-sites/import-dboption`
- 提交最小字段：
  - `path`
  - 可选覆盖：`frontend_url` / `backend_url` / `region` / `owner`

### 5. 当前站点任务创建
- 仍走现有：
  - `POST /api/tasks`
  - `POST /api/tasks/{id}/start`
- 配置来源改为站点上下文注入

---

## 六、验收标准

### 功能验收
- 可在前端查看 deployment sites 列表
- 可区分当前站点与其他站点
- 可通过向导创建新站点
- 可从 DbOption 导入新站点
- 当前站点可直接创建解析/建模任务
- 远端站点不会误触发本地任务执行

### 代码验收
- 不新增站点/项目混合类型
- 任务向导默认行为不回归
- API 层与 UI 层职责分离
- 无大文件继续堆逻辑的情况；站点控制台逻辑拆分清晰

### 回归验收
- `DashboardLayout` 原有 dashboard / reviews / projects 不被破坏
- `TaskMonitorPanel` 仍能正常刷新任务
- `TaskCreationWizard` 在旧入口仍可使用

---

## 七、实现顺序建议

按下面顺序执行，风险最低：
1. 站点类型 + API
2. 站点 composable
3. 站点 dashboard 导航入口
4. 站点详情抽屉
5. 新建站点向导
6. 当前站点任务创建注入
7. 文案与回归

不要先改 `useModelProjects`，也不要先做“远端站点直接发任务”。

---

## 八、人工验证命令

```bash
npm run dev
npm run type-check
npm run lint
npm test
```

如需最小定点测试，优先使用：

```bash
npm test -- src/composables/useDeploymentSites.test.ts
npm test -- src/composables/useCurrentSiteIdentity.test.ts
npm test -- src/components/site/SiteCreationWizard.test.ts
```

---

## 九、后续扩展（不在本计划内）

后续若要做“主站点直接为远端站点发任务”，请先单独立项，新增后端远程调度合同，例如：
- `POST /api/deployment-sites/{id}/dispatch-task`
- 主站点后端代理请求目标站点 `backend_url`
- 返回目标站点 task_id 与 site_id 的绑定关系

当前版本不要把这部分偷偷混入现有 `/api/tasks` 或 `/api/deployment-sites/{id}/tasks` 里。
