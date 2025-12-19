# v0-aios-database-management 项目深度分析报告

## 项目概述

**项目名称**: AIOS Database Management (v0-aios-database-management)
**项目类型**: Next.js 全栈应用 (前端 + API Routes)
**核心功能**: 分布式任务管理、部署站点管理、协作系统、空间查询可视化
**部署方式**: Vercel (前端) + 本地/远程 Rust 后端 (端口 8080)

---

## 一、项目架构总体设计

### 1.1 技术栈概览

```
前端框架：
├── Next.js 14.2.16 (React 全栈框架)
├── React 18 (UI 库)
├── TypeScript 5 (类型安全)
├── Tailwind CSS 4.1.9 (样式)
├── Radix UI (无样式组件库)
└── 其他库：
    ├── react-hook-form + zod (表单验证)
    ├── react-flow 11.11.4 (流程图/DAG)
    ├── recharts 2.15.4 (数据可视化)
    ├── sonner (Toast 通知)
    └── lucide-react (图标库)

后端架构：
├── Rust + Axum (Web 框架)
├── SurrealDB (图数据库 - 主数据存储)
├── SQLite (关系数据库 - 任务元数据)
└── WebSocket (实时通信)
```

### 1.2 应用层级结构

```
v0-aios-database-management/
├── app/                              # Next.js App Router (页面层)
│   ├── page.tsx                      # 首页
│   ├── layout.tsx                    # 全局布局 + 导航
│   ├── task-creation/page.tsx        # 任务创建向导页面
│   ├── task-monitor/page.tsx         # 任务监控仪表板
│   ├── deployment-sites/             # 部署站点管理
│   │   ├── page.tsx                  # 站点列表页面
│   │   └── [id]/page.tsx             # 站点详情页面
│   ├── collaboration/                # 协作功能
│   ├── spatial-visualization/        # 空间查询可视化
│   ├── xkt-generator/                # XKT 模型生成
│   ├── wizard/page.tsx               # 向导页面 (快速任务创建)
│   └── api/                          # API Routes (代理到后端)
│
├── components/                       # React 组件库
│   ├── task-creation/                # 任务创建相关
│   │   └── TaskCreationWizard.tsx   # 4步向导组件
│   ├── task-monitor/                 # 任务监控相关
│   │   ├── TaskMonitorDashboard.tsx
│   │   ├── TaskStatusCard.tsx
│   │   ├── SystemMetricsPanel.tsx
│   │   └── TaskQueueMonitor.tsx
│   ├── deployment-sites/             # 站点管理相关
│   │   ├── site-detail-modal.tsx    # 站点详情弹窗
│   │   ├── site-card.tsx            # 站点卡片
│   │   ├── filters-bar.tsx          # 筛选条件
│   │   ├── file-browser-panel.tsx   # 文件浏览器
│   │   ├── enhanced-create-site-dialog.tsx
│   │   └── create-dialog/           # 创建站点对话框
│   ├── collaboration/                # 协作相关
│   ├── spatial-query/                # 空间查询
│   │   ├── SpatialVisualization.tsx
│   │   ├── AdvancedSpatialVisualization.tsx
│   │   └── nodes/                   # React Flow 节点定义
│   ├── task-history/                 # 任务历史
│   ├── task-logs/                    # 任务日志
│   ├── batch-operations/             # 批量操作
│   └── ui/                           # 基础 UI 组件 (Radix + Tailwind)
│
├── hooks/                            # 自定义 React Hooks (业务逻辑)
│   ├── use-task-creation.ts         # 任务创建逻辑
│   ├── use-task-monitor.ts          # 任务监控逻辑
│   ├── use-websocket.ts             # WebSocket 连接管理
│   ├── use-task-history.ts          # 任务历史管理
│   ├── use-task-logs.ts             # 任务日志获取
│   ├── use-database-status.ts       # 数据库状态查询
│   ├── use-site-operations.ts       # 站点操作
│   ├── use-batch-selection.ts       # 批量选择
│   └── use-create-site-form.ts      # 创建站点表单
│
├── lib/                              # 工具库 + API 客户端
│   ├── api.ts                       # 基础 API 工具 (URL 构建、响应处理)
│   ├── api/
│   │   ├── task-creation.ts         # 任务创建 API 客户端
│   │   ├── task-monitor.ts          # 任务监控 API 客户端
│   │   ├── collaboration.ts         # 协作 API 客户端
│   │   └── collaboration-adapter.ts # 协作数据适配层
│   ├── xkt-api.ts                   # XKT 模型生成 API
│   ├── database-status.ts           # 数据库状态 API
│   ├── model-generation-apis.ts     # 模型生成 API
│   ├── parsing-apis.ts              # 数据解析 API
│   ├── env.ts                       # 环境变量管理
│   └── utils.ts                     # 通用工具函数
│
├── types/                            # TypeScript 类型定义
│   ├── task-creation.ts             # 任务创建相关类型
│   ├── task-monitor.ts              # 任务监控相关类型
│   ├── collaboration.ts             # 协作相关类型
│   ├── task-history.ts              # 任务历史类型
│   └── task-logs.ts                 # 任务日志类型
│
├── package.json                      # 项目依赖配置
├── tsconfig.json                     # TypeScript 配置
├── tailwind.config.ts                # Tailwind 配置
├── next.config.mjs                   # Next.js 配置
└── .env.local                        # 环境变量 (NEXT_PUBLIC_API_BASE_URL)
```

---

## 二、核心业务功能模块详解

### 2.1 任务创建模块 (task-creation)

#### 功能定义

任务创建是平台的核心功能，支持5种任务类型的创建和配置：

1. **DataParsingWizard** - 数据解析任务
   - 解析PDMS数据库文件
   - 提取几何和属性信息
   - 支持全部/指定数据库编号/指定参考号三种模式

2. **ModelGeneration** - 模型生成任务
   - 基于解析数据生成3D模型
   - 生成网格、空间树
   - 支持布尔运算

3. **SpatialTreeGeneration** - 空间树生成
   - 构建空间索引树
   - 优化查询性能

4. **FullSync** - 全量同步任务
   - 完整同步所有数据到目标数据库

5. **IncrementalSync** - 增量同步任务
   - 仅同步变更的数据

#### 主要代码文件

- `components/task-creation/TaskCreationWizard.tsx` (TaskCreationWizard):
  - 4步向导组件 (基础信息 → 站点选择 → 参数配置 → 预览)
  - 多步骤表单管理
  - 实时验证和错误处理

- `lib/api/task-creation.ts` (API 客户端):
  - `fetchDeploymentSites()` - 获取部署站点列表
  - `fetchTaskTemplates()` - 获取任务模板
  - `createTask()` - 创建任务请求
  - `validateTaskName()` - 验证任务名称唯一性
  - `previewTaskConfig()` - 预览任务配置和资源估计

- `hooks/use-task-creation.ts` (useTaskCreation Hook):
  - 管理站点、模板、加载状态
  - 封装 API 调用逻辑
  - 错误处理和状态管理

- `types/task-creation.ts` (类型定义):
  ```typescript
  TaskType: DataParsingWizard | ModelGeneration | SpatialTreeGeneration | FullSync | IncrementalSync
  TaskPriority: Low | Normal | High | Critical
  TaskParameters: 支持解析/生成/同步的各类参数
  ```

- `app/task-creation/page.tsx` (页面):
  - 渲染向导页面
  - 集成 TaskCreationWizard 组件
  - 处理页面导航

#### 工作流程

1. 用户访问 `/task-creation` 页面
2. 加载部署站点列表
3. 第1步：填写基础信息（名称、类型、优先级、描述）
4. 第2步：选择部署站点 + 查看站点详情
5. 第3步：根据任务类型动态配置参数
6. 第4步：预览配置信息和资源需求
7. 确认创建 → 后端创建任务 → 跳转到任务监控

---

### 2.2 任务监控模块 (task-monitor)

#### 功能定义

实时监控所有任务的执行状态、性能指标和系统资源：

- **任务队列视图**: 查看 pending、running、completed、failed 的任务
- **任务卡片**: 显示任务进度、状态、耗时
- **系统指标**: CPU、内存、磁盘、网络使用率
- **任务控制**: 启动、停止、暂停、继续操作
- **WebSocket 实时更新**: 接收实时任务状态和系统指标推送

#### 主要代码文件

- `components/task-monitor/TaskMonitorDashboard.tsx` (TaskMonitorDashboard):
  - 主仪表板组件
  - 整合任务队列、系统指标、任务卡片

- `components/task-monitor/TaskStatusCard.tsx` (TaskStatusCard):
  - 单个任务的详细卡片
  - 显示进度、错误信息、操作按钮

- `components/task-monitor/SystemMetricsPanel.tsx` (SystemMetricsPanel):
  - 系统资源监控面板
  - 使用 Recharts 展示图表

- `lib/api/task-monitor.ts` (API 客户端):
  - `fetchTaskStatus()` - 获取任务和系统状态
  - `startTask(taskId)` - 启动任务
  - `stopTask(taskId)` - 停止任务
  - `pauseTask(taskId)` - 暂停任务
  - `resumeTask(taskId)` - 继续任务
  - `cancelTask(taskId)` - 取消任务
  - `fetchTaskProgress(taskId)` - 获取任务进度
  - `fetchSystemMetrics()` - 获取系统指标

- `hooks/use-task-monitor.ts` (useTaskMonitor Hook):
  - 管理监控状态
  - 处理实时数据更新
  - WebSocket 连接管理
  - 任务控制操作

- `types/task-monitor.ts` (类型定义):
  ```typescript
  TaskStatus: pending | running | paused | completed | failed | cancelled | unknown
  SystemMetrics: { cpu, memory, disk, network, uptimeSeconds, activeTasks, databaseConnected, surrealdbConnected }
  ```

- `app/task-monitor/page.tsx` (页面):
  - 渲染监控仪表板

#### 工作流程

1. 用户访问 `/task-monitor` 页面
2. 建立 WebSocket 连接获取实时数据
3. 定时轮询 `/api/tasks` 获取任务列表
4. 显示任务和系统指标
5. 用户可以启动/停止/暂停任务
6. 实时更新任务进度和状态

---

### 2.3 部署站点管理模块 (deployment-sites)

#### 功能定义

管理系统中的所有部署站点，包括创建、编辑、删除、查询站点配置：

- **站点列表**: 显示所有站点的卡片视图或表格视图
- **站点搜索和筛选**: 按名称、状态、环境、所有者搜索
- **站点详情**: 显示完整的站点配置、数据库状态、解析状态、模型生成状态
- **创建站点**: 多步骤向导创建新站点
- **编辑站点**: 修改站点配置
- **数据库操作**: 启动、停止、检查数据库状态

#### 主要代码文件

- `components/deployment-sites/site-card.tsx` (SiteCard):
  - 站点卡片组件
  - 显示基本信息、状态、操作按钮

- `components/deployment-sites/site-detail-modal.tsx` (SiteDetailModal):
  - 站点详情弹窗
  - 显示数据库配置、生成选项、运行状态
  - 支持数据库控制操作

- `components/deployment-sites/filters-bar.tsx` (FiltersBar):
  - 搜索和筛选条件

- `components/deployment-sites/file-browser-panel.tsx` (FileBrowserPanel):
  - 文件浏览器面板
  - 选择项目目录

- `components/deployment-sites/enhanced-create-site-dialog.tsx` (EnhancedCreateSiteDialog):
  - 创建站点对话框
  - 多步骤表单

- `lib/api.ts` (部署站点 API):
  - `createDeploymentSite(payload)` - 创建站点
  - `fetchDeploymentSites(params)` - 获取站点列表 (支持搜索、筛选、分页)
  - `patchDeploymentSite(siteId, payload)` - 更新站点
  - `fetchDeploymentSite(siteId)` - 获取站点详情
  - `deleteDeploymentSite(siteId)` - 删除站点

- `app/deployment-sites/hooks/use-deployment-sites.ts` (useDeploymentSites Hook):
  - 加载和管理站点列表
  - 处理搜索、筛选、分页

- `app/deployment-sites/page.tsx` (页面):
  - 站点列表页面

- `app/deployment-sites/[id]/page.tsx` (页面):
  - 站点详情页面

#### 工作流程

1. 用户访问 `/deployment-sites` 查看站点列表
2. 可以搜索、筛选站点
3. 点击站点卡片查看详情 → 打开 SiteDetailModal
4. 查看数据库配置、生成选项、运行状态
5. 可以执行数据库操作 (启动/停止/检查状态)
6. 点击"创建站点"按钮 → 打开创建对话框
7. 填写站点信息 → 完成创建

---

### 2.4 协作功能模块 (collaboration)

#### 功能定义

支持多个部署站点之间的数据协作和同步：

- **协作组管理**: 创建、修改、删除协作组
- **远程站点管理**: 管理远程站点的连接和同步
- **数据同步**: 支持单向/双向/手动同步
- **冲突解决**: 支持多种冲突解决策略
- **同步日志**: 记录同步历史和统计信息

#### 协作类型

1. **ConfigSharing** - 配置共享
2. **DataSync** - 数据同步
3. **TaskCoordination** - 任务协调
4. **Hybrid** - 混合模式

#### 主要代码文件

- `lib/api/collaboration.ts` (协作 API 客户端):
  - 获取协作组列表
  - 创建/更新协作组
  - 同步数据
  - 获取同步日志

- `lib/api/collaboration-adapter.ts` (数据适配层):
  - 转换后端数据格式
  - 规范化数据结构

- `types/collaboration.ts` (类型定义):
  ```typescript
  CollaborationGroupType: ConfigSharing | DataSync | TaskCoordination | Hybrid
  SyncMode: OneWay | TwoWay | Manual
  ConflictResolution: PrimaryWins | LatestWins | Manual
  SyncStatus: InProgress | Success | Failed | PartialSuccess
  ```

- `app/collaboration/page.tsx` (协作列表页面)
- `app/collaboration/[id]/page.tsx` (协作详情页面)

#### 工作流程

1. 用户访问 `/collaboration` 查看协作组列表
2. 创建协作组 → 选择站点和同步策略
3. 配置同步规则 (模式、冲突解决、自动同步)
4. 执行手动同步
5. 查看同步日志和统计信息

---

### 2.5 空间查询可视化模块 (spatial-query)

#### 功能定义

提供强大的空间关系查询和可视化工具：

- **参考号查询**: 输入参考号查询对应节点
- **层级展示**: 自动展示节点的所有子节点
- **三种可视化模式**:
  1. 简单树形视图 - 基础树形展示
  2. 高级树形视图 - 支持搜索、过滤、统计
  3. 流程图视图 - 使用 React Flow 实现拖拽、缩放

#### 节点类型

| 类型 | 图标 | 颜色 | 说明 |
|------|------|------|------|
| SPACE | 🏢 | 蓝色 | 空间/框架 |
| ROOM | 🚪 | 绿色 | 房间/面板 |
| COMPONENT | ⚙️ | 紫色 | 构件/元素 |

#### 主要代码文件

- `components/spatial-query/SpatialVisualization.tsx` (SpatialVisualization):
  - 简单树形视图

- `components/spatial-query/AdvancedSpatialVisualization.tsx` (AdvancedSpatialVisualization):
  - 高级树形视图（搜索、过滤、统计）

- `components/spatial-query/nodes/` (React Flow 节点定义):
  - 流程图视图的节点、边定义

- `app/spatial-visualization/page.tsx` (页面):
  - 空间查询可视化页面

#### API 端点

- `GET /api/spatial/query/:refno` - 查询节点及其子节点
- `GET /api/spatial/children/:refno` - 查询子节点列表
- `GET /api/spatial/node-info/:refno` - 获取节点详细信息

---

### 2.6 XKT 模型生成模块 (xkt-generator)

#### 功能定义

生成 XKT 格式的 3D 模型文件，支持在 xeokit-sdk 中使用：

- **模型预览**: 实时预览生成的模型
- **参数配置**: 支持各种生成参数
- **进度监控**: 实时显示生成进度

#### 主要代码文件

- `lib/xkt-api.ts` (XKT API):
  - 模型生成相关 API 调用

- `app/xkt-generator/page.tsx` (页面):
  - XKT 生成页面

- `app/xkt-viewer/page.tsx` (页面):
  - XKT 模型查看器

---

### 2.7 向导页面模块 (wizard)

#### 功能定义

为了快速创建任务而设计的简化版向导，支持批量创建任务：

- **快速模式**: 支持一次创建多个任务
- **高级模式**: 跳转到完整的任务创建向导

#### 主要代码文件

- `app/wizard/page.tsx` (向导页面):
  - 快速任务创建向导

#### 工作流程

1. 用户访问 `/wizard` 页面
2. 快速模式：选择站点 → 选择任务类型 → 配置参数 → 批量创建
3. 高级模式：点击"前往高级任务创建" → 跳转到 `/task-creation`

---

## 三、数据模型与类型系统

### 3.1 任务相关类型

```typescript
// task-creation.ts
export interface TaskCreationRequest {
  taskName: string                    // 任务名称
  taskType: TaskType                  // 任务类型
  siteId: string                      // 部署站点ID
  priority: TaskPriority              // 优先级
  description?: string                // 任务描述
  parameters: TaskParameters          // 参数配置
}

export type TaskType =
  | 'DataParsingWizard'               // 数据解析
  | 'ModelGeneration'                 // 模型生成
  | 'SpatialTreeGeneration'          // 空间树生成
  | 'FullSync'                        // 全量同步
  | 'IncrementalSync'                // 增量同步

export type TaskPriority = 'Low' | 'Normal' | 'High' | 'Critical'

export interface TaskParameters {
  // 解析参数
  parseMode?: 'all' | 'dbnum' | 'refno'
  dbnum?: number
  refno?: string

  // 生成参数
  generateModels?: boolean
  generateMesh?: boolean
  generateSpatialTree?: boolean
  applyBooleanOperation?: boolean
  meshTolRatio?: number

  // 同步参数
  syncMode?: 'full' | 'incremental'
  targetSesno?: number

  // 通用参数
  maxConcurrent?: number              // 最大并发数
  parallelProcessing?: boolean        // 并行处理
}

// task-monitor.ts
export interface Task {
  id: string                          // 任务ID
  name: string                        // 任务名称
  type: TaskType                      // 任务类型
  status: TaskStatus                  // 任务状态
  progress: number                    // 进度百分比
  startTime?: string                  // 开始时间
  endTime?: string                    // 结束时间
  durationMs?: number                 // 耗时 (毫秒)
  estimatedTime?: number              // 预估时间
  priority?: TaskPriority             // 优先级
  parameters?: Record<string, any>    // 参数
  result?: TaskResult                 // 执行结果
  error?: string                      // 错误信息
}

export type TaskStatus =
  | "pending"                         // 待执行
  | "running"                         // 运行中
  | "paused"                          // 暂停
  | "completed"                       // 完成
  | "failed"                          // 失败
  | "cancelled"                       // 已取消
  | "unknown"                         // 未知
```

### 3.2 部署站点相关类型

```typescript
// task-creation.ts
export interface DeploymentSite {
  id: string                          // 站点ID
  name: string                        // 站点名称
  status: string                      // 状态
  environment: string                 // 环境
  description?: string                // 描述
  config?: any                        // 站点配置
}

// api.ts
export interface DeploymentSiteConfigPayload {
  name: string
  manual_db_nums: number[]
  project_name: string
  project_path: string
  project_code: number
  mdb_name: string
  module: string
  db_type: string
  surreal_ns: number
  db_ip: string
  db_port: string
  db_user: string
  db_password: string
  gen_model: boolean                  // 生成模型
  gen_mesh: boolean                   // 生成网格
  gen_spatial_tree: boolean           // 生成空间树
  apply_boolean_operation: boolean    // 应用布尔运算
  mesh_tol_ratio: number              // 网格容差比例
  room_keyword: string
  target_sesno: number | null
}
```

### 3.3 协作相关类型

```typescript
// collaboration.ts
export interface CollaborationGroup {
  id: string
  name: string
  description?: string
  group_type: CollaborationGroupType
  site_ids: string[]
  primary_site_id?: string
  shared_config?: any
  sync_strategy: SyncStrategy
  status: CollaborationGroupStatus
  creator: string
  created_at: string
  updated_at: string
}

export interface SyncStrategy {
  mode: SyncMode                      // 同步模式
  interval_seconds: number            // 同步间隔（秒）
  auto_sync: boolean                  // 自动同步
  conflict_resolution: ConflictResolution  // 冲突解决策略
}
```

---

## 四、API 架构与调用层

### 4.1 API 调用流程

```
前端 UI 组件
    ↓
React Hooks (useTaskCreation, useTaskMonitor 等)
    ↓
API 客户端 (lib/api/*.ts)
    ↓
buildApiUrl() 和 handleResponse() 处理
    ↓
fetch() HTTP 请求
    ↓
后端 Rust API (http://localhost:8080)
    ↓
SurrealDB / SQLite 数据库
```

### 4.2 主要 API 端点

#### 任务相关

```
POST   /api/task-creation               # 创建任务
POST   /api/task-creation/validate-name # 验证任务名称
POST   /api/task-creation/preview       # 预览任务配置

GET    /api/tasks                       # 获取任务列表
GET    /api/tasks/:taskId               # 获取任务详情
GET    /api/tasks/:taskId/progress      # 获取任务进度
POST   /api/tasks/:taskId/start         # 启动任务
POST   /api/tasks/:taskId/stop          # 停止任务
POST   /api/tasks/:taskId/pause         # 暂停任务
DELETE /api/tasks/:taskId               # 取消任务

GET    /api/task-templates              # 获取任务模板
```

#### 站点相关

```
GET    /api/deployment-sites            # 获取站点列表（支持搜索、筛选、分页）
POST   /api/deployment-sites            # 创建站点
GET    /api/deployment-sites/:id        # 获取站点详情
PATCH  /api/deployment-sites/:id        # 更新站点
DELETE /api/deployment-sites/:id        # 删除站点
```

#### 系统相关

```
GET    /api/status                      # 获取系统状态（CPU、内存等）
GET    /api/node-status                 # 获取节点状态
GET    /api/deployment-sites            # 获取部署站点列表
```

#### 空间查询相关

```
GET    /api/spatial/query/:refno        # 查询节点及子节点
GET    /api/spatial/children/:refno     # 获取子节点列表
GET    /api/spatial/node-info/:refno    # 获取节点详细信息
```

#### 协作相关

```
GET    /api/collaboration/groups        # 获取协作组列表
POST   /api/collaboration/groups        # 创建协作组
GET    /api/collaboration/groups/:id    # 获取协作组详情
PATCH  /api/collaboration/groups/:id    # 更新协作组
DELETE /api/collaboration/groups/:id    # 删除协作组
POST   /api/collaboration/sync          # 执行同步
GET    /api/collaboration/sync-logs     # 获取同步日志
```

### 4.3 环境变量配置

```bash
# .env.local
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
```

- 前端通过 `NEXT_PUBLIC_API_BASE_URL` 配置后端地址
- 所有 API 调用都通过 `buildApiUrl()` 函数添加前缀

---

## 五、UI 组件系统

### 5.1 Radix UI 组件使用

项目使用 Radix UI 提供的原始、无样式组件，结合 Tailwind CSS 实现样式：

- **Form 组件**: Dialog、Select、RadioGroup、Tabs、Slider
- **Display 组件**: Progress、AspectRatio、Separator、HoverCard
- **Navigation 组件**: NavigationMenu、Menubar、ContextMenu
- **Input 组件**: Input、Checkbox、Switch、Label
- **Feedback 组件**: Toast (使用 sonner)

### 5.2 主要组件库结构

```
components/
├── ui/                                # 基础 UI 组件（Radix + Tailwind）
│   ├── button.tsx
│   ├── dialog.tsx
│   ├── input.tsx
│   ├── select.tsx
│   ├── tabs.tsx
│   ├── progress.tsx
│   ├── radio-group.tsx
│   └── ...
├── task-creation/
│   └── TaskCreationWizard.tsx         # 多步骤向导
├── task-monitor/
│   ├── TaskMonitorDashboard.tsx
│   ├── TaskStatusCard.tsx
│   ├── SystemMetricsPanel.tsx
│   └── TaskQueueMonitor.tsx
├── deployment-sites/
│   ├── site-card.tsx
│   ├── site-detail-modal.tsx
│   ├── site-list.tsx
│   ├── filters-bar.tsx
│   ├── file-browser-panel.tsx
│   └── enhanced-create-site-dialog.tsx
├── spatial-query/
│   ├── SpatialVisualization.tsx
│   ├── AdvancedSpatialVisualization.tsx
│   └── nodes/
│       ├── SpaceNode.tsx
│       ├── RoomNode.tsx
│       └── ComponentNode.tsx
├── collaboration/                     # 协作相关组件
├── task-history/                      # 任务历史组件
├── task-logs/                         # 任务日志组件
└── batch-operations/                  # 批量操作组件
```

---

## 六、状态管理与数据流

### 6.1 状态管理策略

项目采用 **React Hooks + 自定义 Hook** 的模式管理状态：

```
UI 组件 (React Functional Components)
    ↓
自定义 Hooks (useTaskCreation, useTaskMonitor 等)
    ↓
API 客户端 (lib/api/*.ts)
    ↓
Local State (useState) + Effects (useEffect)
    ↓
外部数据源 (REST API / WebSocket)
```

### 6.2 主要 Hooks

#### useTaskCreation

```typescript
export function useTaskCreation() {
  return {
    sites: DeploymentSite[]            // 部署站点列表
    templates: TaskTemplate[]          // 任务模板列表
    loading: boolean                   // 加载状态
    error: string | null               // 错误信息
    loadSites: () => Promise<void>     // 加载站点
    loadTemplates: () => Promise<void> // 加载模板
    validateName: (name: string) => Promise<{available, message}>
    previewConfig: (formData) => Promise<{estimatedDuration, resourceRequirements, warnings}>
    submitTask: (formData) => Promise<TaskCreationResponse>
    setError: (error: string | null) => void
  }
}
```

#### useTaskMonitor

```typescript
export function useTaskMonitor() {
  return {
    tasks: Task[]                      // 任务列表
    systemMetrics: SystemMetrics       // 系统指标
    isConnected: boolean               // 连接状态
    lastUpdate: string                 // 最后更新时间
    error: string | null               // 错误信息
    loading: boolean                   // 加载状态
    refreshData: () => Promise<void>   // 刷新数据
    startTask: (taskId) => Promise<void>
    stopTask: (taskId) => Promise<void>
    pauseTask: (taskId) => Promise<void>
  }
}
```

### 6.3 数据更新流程

```
任务创建页面
  ↓ 用户提交表单
  ↓
useTaskCreation.submitTask()
  ↓ 调用 createTask() API
  ↓
POST /api/task-creation
  ↓ 后端返回 TaskCreationResponse
  ↓
导航到 /task-monitor
  ↓
useTaskMonitor.refreshData()
  ↓ 从后端获取最新任务列表
  ↓
WebSocket 实时推送任务更新
  ↓
TaskMonitorDashboard 显示最新状态
```

---

## 七、依赖关系图

### 7.1 模块依赖关系

```
页面层 (app/)
├── task-creation/page.tsx
│   ├── components/task-creation/TaskCreationWizard.tsx
│   │   └── hooks/use-task-creation.ts
│   │       └── lib/api/task-creation.ts
│   │           └── lib/api.ts (buildApiUrl, handleResponse)
│   └── types/task-creation.ts
│
├── task-monitor/page.tsx
│   ├── components/task-monitor/TaskMonitorDashboard.tsx
│   │   ├── components/task-monitor/TaskStatusCard.tsx
│   │   ├── components/task-monitor/SystemMetricsPanel.tsx
│   │   └── hooks/use-task-monitor.ts
│   │       └── lib/api/task-monitor.ts
│   │           └── lib/api.ts
│   └── types/task-monitor.ts
│
├── deployment-sites/page.tsx
│   ├── components/deployment-sites/site-card.tsx
│   ├── components/deployment-sites/site-detail-modal.tsx
│   ├── components/deployment-sites/enhanced-create-site-dialog.tsx
│   ├── app/deployment-sites/hooks/use-deployment-sites.ts
│   │   └── lib/api.ts (fetchDeploymentSites, createDeploymentSite 等)
│   └── types/task-creation.ts
│
├── collaboration/page.tsx
│   ├── lib/api/collaboration.ts
│   ├── lib/api/collaboration-adapter.ts
│   └── types/collaboration.ts
│
└── spatial-visualization/page.tsx
    ├── components/spatial-query/SpatialVisualization.tsx
    ├── components/spatial-query/AdvancedSpatialVisualization.tsx
    └── components/spatial-query/nodes/

组件共享依赖
├── components/ui/ (Radix UI + Tailwind CSS)
├── lib/env.ts (环境变量)
├── lib/utils.ts (工具函数)
└── lib/database-status.ts (数据库状态)
```

### 7.2 外部依赖关系

```
Next.js 应用
├── React 18
├── TypeScript
├── Tailwind CSS 4.1.9
│   └── tailwindcss-animate
├── Radix UI (10+ 组件)
├── react-hook-form
├── zod (数据验证)
├── reactflow (React Flow DAG 可视化)
├── recharts (数据图表)
├── lucide-react (图标)
├── sonner (Toast 通知)
├── clsx (类名工具)
├── date-fns (日期处理)
└── fetch API (HTTP 请求)
```

---

## 八、配置与部署

### 8.1 开发环境配置

#### 启动方式1: 使用启动脚本

```bash
cd /Volumes/DPC/work/plant-code/gen-model/frontend/v0-aios-database-management
./start-dev.sh
```

脚本会：
- 启动 Rust 后端 (端口 8080)
- 启动 Next.js 前端 (端口 3000)
- 自动配置环境变量

#### 启动方式2: 手动启动

**步骤1: 启动 Rust 后端**
```bash
cd /Volumes/DPC/work/plant-code/gen-model
cargo run --bin web_server --features "web_server,ws,gen_model,manifold,project_hd"
```

**步骤2: 启动 Next.js 前端**
```bash
cd /Volumes/DPC/work/plant-code/gen-model/frontend/v0-aios-database-management
pnpm install
pnpm run dev
```

### 8.2 环境变量配置

创建 `.env.local` 文件：

```
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
```

### 8.3 访问地址

- **前端**: http://localhost:3000
- **后端 API**: http://localhost:8080
- **验证后端**: curl http://localhost:8080/api/node-status

### 8.4 生产部署

**前端部署 (Vercel)**:
```bash
cd frontend/v0-aios-database-management
npm install
npm run build
npm start
```

**后端部署**:
```bash
cd gen-model
cargo build --release
./target/release/gen-model
```

---

## 九、扩展性设计

### 9.1 新功能扩展

#### 添加新任务类型

1. 在 `types/task-creation.ts` 中添加 `TaskType` 枚举
2. 在 `TaskCreationWizard.tsx` 中添加参数配置表单
3. 在 `lib/api/task-creation.ts` 中添加 API 调用
4. 在后端 Rust 中实现任务处理逻辑

#### 添加新的 UI 组件

1. 在 `components/ui/` 创建新组件
2. 结合 Radix UI 原始组件 + Tailwind CSS
3. 导出到 `index.ts`
4. 在页面中使用

#### 添加新的页面

1. 在 `app/` 创建新目录和 `page.tsx`
2. 创建相关的业务组件
3. 创建相关的 Hooks 和 API 客户端
4. 在导航中添加链接

### 9.2 性能优化

- **代码分割**: Next.js 自动支持路由级别的代码分割
- **图片优化**: 使用 Next.js Image 组件
- **缓存策略**: API 调用支持缓存配置
- **虚拟化**: React Flow 内置虚拟化渲染支持大规模数据
- **懒加载**: 子节点按需加载

### 9.3 错误处理

所有 API 调用通过 `handleResponse()` 统一处理：

```typescript
export async function handleResponse<T>(response: Response): Promise<T> {
  const text = await response.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch (error) {
      throw new Error(`解析响应失败: ${String(error)}`)
    }
  }

  if (!response.ok) {
    const message = (data as any)?.error || response.statusText || '请求失败'
    throw new Error(message)
  }

  return data as T
}
```

---

## 十、页面导航与布局

### 10.1 主导航菜单

```
应用首页
├── 任务管理
│   ├── 快速向导 (/wizard)
│   ├── 创建任务 (/task-creation)
│   ├── 任务监控 (/task-monitor)
│   ├── 批量任务 (/tasks/batch)
│   └── 定时任务 (/tasks/scheduled)
├── 部署站点 (/deployment-sites)
├── 协作管理 (/collaboration)
├── 空间查询 (/spatial-visualization)
├── 模型生成 (/xkt-generator)
└── 系统管理
    ├── 用户管理 (/users)
    └── API 测试 (/api-test)
```

### 10.2 布局结构

```
app/layout.tsx
├── Header
├── Sidebar Navigation
├── Main Content Area
│   └── page.tsx (Route-specific)
└── Footer
```

---

## 十一、功能清单和调用关系

### 11.1 完整功能清单

| 模块 | 功能 | 页面 | 主要组件 | API 端点 | 状态 |
|------|------|------|---------|---------|------|
| **任务管理** | 创建任务 | `/task-creation` | TaskCreationWizard | POST /api/task-creation | ✓ 完成 |
| | 监控任务 | `/task-monitor` | TaskMonitorDashboard | GET /api/tasks | ✓ 完成 |
| | 快速向导 | `/wizard` | WizardPage | POST /api/task-creation | ✓ 完成 |
| **部署站点** | 站点列表 | `/deployment-sites` | SiteCard | GET /api/deployment-sites | ✓ 完成 |
| | 站点详情 | `/deployment-sites/[id]` | SiteDetailModal | GET /api/deployment-sites/:id | ✓ 完成 |
| | 创建站点 | - | EnhancedCreateSiteDialog | POST /api/deployment-sites | ✓ 完成 |
| **协作管理** | 协作组列表 | `/collaboration` | - | GET /api/collaboration/groups | ✓ 完成 |
| | 协作详情 | `/collaboration/[id]` | - | GET /api/collaboration/groups/:id | ✓ 完成 |
| | 数据同步 | - | - | POST /api/collaboration/sync | ✓ 完成 |
| **空间查询** | 可视化查询 | `/spatial-visualization` | SpatialVisualization | GET /api/spatial/query/:refno | ✓ 完成 |
| | 高级树形视图 | - | AdvancedSpatialVisualization | GET /api/spatial/children/:refno | ✓ 完成 |
| **模型生成** | XKT 生成 | `/xkt-generator` | - | POST /api/xkt/generate | ✓ 完成 |
| | 模型查看器 | `/xkt-viewer` | - | GET /api/xkt/:id | ✓ 完成 |

### 11.2 核心调用链路

```
创建任务流程：
  task-creation/page.tsx
  → TaskCreationWizard.tsx
  → useTaskCreation Hook
  → createTask() API
  → POST /api/task-creation
  → 返回 TaskCreationResponse
  → 导航到 /task-monitor
  → useTaskMonitor 加载任务列表

监控任务流程：
  task-monitor/page.tsx
  → TaskMonitorDashboard.tsx
  → useTaskMonitor Hook
  → fetchTaskStatus() API
  → GET /api/tasks + GET /api/status
  → WebSocket 实时推送
  → 任务卡片显示更新

站点管理流程：
  deployment-sites/page.tsx
  → SiteCard.tsx
  → useDeploymentSites Hook
  → fetchDeploymentSites() API
  → GET /api/deployment-sites
  → 显示站点卡片列表
  → 点击卡片打开 SiteDetailModal
  → 显示站点详细信息

空间查询流程：
  spatial-visualization/page.tsx
  → SpatialVisualization.tsx
  → 输入参考号
  → GET /api/spatial/query/:refno
  → 返回节点及子节点
  → 显示树形或流程图
```

---

## 十二、性能指标与监控

### 12.1 系统监控

```typescript
interface SystemMetrics {
  cpu: number                         // CPU 使用率 (%)
  memory: number                      // 内存使用率 (%)
  disk?: number                       // 磁盘使用率 (%)
  network?: number                    // 网络使用率 (%)
  uptimeSeconds?: number              // 运行时长 (秒)
  activeTasks?: number                // 活跃任务数
  databaseConnected?: boolean         // 数据库连接状态
  surrealdbConnected?: boolean        // SurrealDB 连接状态
}
```

### 12.2 任务指标

```typescript
interface TaskMetrics {
  recordsProcessed: number            // 处理记录数
  processingTime: number              // 处理时间 (ms)
  memoryUsage: number                 // 内存使用 (MB)
  cpuUsage: number                    // CPU 使用率 (%)
}
```

---

## 总结与移植建议

### 核心特性
1. **完整的任务管理系统** - 从创建到监控的完整流程
2. **分布式部署支持** - 支持多个部署站点的管理和协作
3. **实时数据同步** - WebSocket 实时推送任务和系统指标
4. **强大的可视化** - React Flow 支持复杂的空间关系展示
5. **模块化架构** - 清晰的代码结构，易于扩展和维护

### 移植时的重点
1. **后端 API 对接** - 确保 REST API 端点与前端期望一致
2. **环境配置** - 正确配置 `NEXT_PUBLIC_API_BASE_URL`
3. **数据类型对齐** - 确保后端返回的数据格式与前端类型定义匹配
4. **WebSocket 集成** - 配置实时通信连接
5. **错误处理** - 实现统一的错误处理和用户反馈机制

---

## 代码统计

- **总页面数**: 12+
- **主要组件数**: 20+
- **自定义 Hooks**: 9
- **API 客户端模块**: 5
- **类型定义文件**: 5
- **依赖库数**: 30+

