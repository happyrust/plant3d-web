# 站点管理 Dashboard / 新建站点向导 UI Handoff

## 1. 目标

本轮实现把 `plant3d-web` 从“只面向当前后端实例的任务创建”扩展为“主站点控制台 + 当前站点快速建任务”的两层结构：

- **主站点控制台**：管理 deployment sites，查看站点状态，创建新站点
- **当前站点工作区**：基于当前站点配置快速创建解析/建模任务，并打开任务监控

本期**不实现**主站点跨站远程发任务。

---

## 2. 关键页面与组件

### 2.1 Dashboard 导航

文件：
- `src/components/dashboard/DashboardLayout.vue`
- `src/components/dashboard/DashboardOverview.vue`

当前主导航顺序：
1. 首页 (Dashboard)
2. 站点管理
3. 模型工程
4. 校审批注

首页快捷操作已新增：
- 站点管理
- 上传/打开模型
- 发起编校审
- 待办校审

---

### 2.2 站点控制台

文件：
- `src/components/site/SiteDashboardPanel.vue`

当前包含：
- 当前站点身份展示
- 统计卡片：总站点 / Running / Offline / Failed / 当前站点
- 站点列表
- 新建站点按钮
- 查看详情入口

数据源：
- `useDeploymentSites()`
- `useCurrentSiteIdentity()`

---

### 2.3 站点详情抽屉

文件：
- `src/components/site/SiteDetailDrawer.vue`

当前区块：
- 基础信息
- 项目与地址
- 运行配置摘要
- 快捷动作

### 当前站点动作
- 创建解析任务
- 创建建模任务
- 打开任务监控
- 健康检查
- 编辑（当前仅占位 toast）
- 删除

### 远端站点动作
- 打开站点
- 复制后端地址
- 健康检查
- 编辑（当前仅占位 toast）
- 删除

### 已落地边界文案
- 当前站点：
  - `当前站点快捷入口将基于当前站点配置打开任务创建面板，并复用现有任务监控链路。`
- 远端站点：
  - `主站点暂不支持跨站直接发任务，请使用“打开站点”进入目标站点后再执行任务。`

---

### 2.4 新建站点向导

文件：
- `src/components/site/SiteCreationWizard.vue`

步骤：
1. 创建方式
2. 基础信息
3. 项目与地址 / 导入路径与地址
4. 确认提交

两种模式：
- 手动创建
- DbOption 导入

创建成功回流：
1. 关闭向导
2. 刷新站点列表
3. 自动打开新站点详情

---

### 2.5 任务创建向导（站点感知）

文件：
- `src/composables/useTaskCreation.ts`
- `src/composables/useTaskCreationStore.ts`
- `src/components/task/TaskCreationWizard.vue`

新增能力：
- `initialConfig?: DatabaseConfig | null`
- `siteContext?: { siteId: string; siteName: string; isCurrentSite: boolean } | null`

优先级：
1. 显式 props 注入
2. `useTaskCreationStore()` 的 preset context
3. 默认回退到 `/api/config`

UI 上已新增站点 banner：
- `当前站点：xxx`
- `当前站点执行`

---

## 3. 站点相关 composable / API

### API
文件：`src/api/siteRegistryApi.ts`

已封装：
- `getDeploymentSites`
- `getDeploymentSite`
- `createDeploymentSite`
- `updateDeploymentSite`
- `deleteDeploymentSite`
- `healthcheckDeploymentSite`
- `importDeploymentSiteFromDbOption`
- `getCurrentSiteIdentity`

### composable
文件：`src/composables/useDeploymentSites.ts`

已提供：
- `sites`
- `loading`
- `error`
- `stats`
- `selectedSite`
- `loadSites`
- `openSiteDetail`
- `createSite`
- `importSite`
- `updateSite`
- `deleteSite`
- `healthcheckSite`

文件：`src/composables/useCurrentSiteIdentity.ts`

已提供：
- `identity`
- `loading`
- `error`
- `refresh`
- `isCurrentSite(site)`

---

## 4. 当前交互约束

### 已支持
- 主站点创建 / 导入站点
- 主站点查看站点详情与健康检查
- 当前站点快速打开解析 / 建模任务创建面板
- 当前站点快速打开任务监控面板
- 远端站点打开前端地址 / 复制后端地址

### 未支持
- 主站点跨站直接远程发任务
- 站点编辑向导
- 站点删除二次确认弹窗
- 站点筛选 / 搜索 / 排序 UI

---

## 5. 后续 UI 可以继续打磨的点

### 优先级高
1. 给站点列表补筛选栏（status / region / owner / env）
2. 给站点详情补状态徽标与 last_seen_at 格式化
3. 给新建向导补更清晰的字段分组与默认值说明
4. 给“编辑站点”补真正的编辑向导

### 优先级中
1. 站点控制台支持卡片视图 / 表格视图切换
2. 新建成功后高亮刚创建的站点
3. 新增站点健康状态标签颜色映射

---

## 6. 验收基线

本轮代码回归已经覆盖：
- `src/composables/useDeploymentSites.test.ts`
- `src/composables/useTaskCreation.test.ts`
- `src/components/dashboard/DashboardLayout.test.ts`
- `src/components/site/SiteDashboardPanel.test.ts`
- `src/components/site/SiteCreationWizard.test.ts`

当前最重要的产品边界是：

> **当前站点支持快速建任务；远端站点不支持跨站直接发任务。**

这个语义已经同时体现在：
- 站点详情抽屉文案
- 快捷动作行为
- 任务创建上下文注入链路

