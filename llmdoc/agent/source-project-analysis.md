# AIOS Database Management Frontend - 深度项目分析

## 执行摘要

`frontend/v0-aios-database-management` 是一个基于 Next.js 14 + React 18 + TypeScript 的现代化 Web 应用，提供完整的数据库管理、任务创建、实时监控和3D模型生成功能。该项目采用模块化组件架构，共包含 63 个 React 组件和 9 个自定义 Hook，支持 WebSocket 实时通信、RESTful API 集成以及复杂的多步骤向导流程。

---

## 一、项目整体架构

### 1.1 技术栈

**前端框架**
- Next.js 14.2.16 - React 全栈框架，使用 App Router
- React 18 - UI 库，函数组件 + Hooks 模式
- TypeScript 5 - 全面的类型安全

**UI 组件库**
- Radix UI - 无样式、可访问性优先的原语组件库
- Tailwind CSS 4.1.9 - 实用优先的 CSS 框架
- Lucide React - SVG 图标库（454 个图标）

**表单与验证**
- React Hook Form 7.60.0 - 高性能表单库
- Zod 3.25.67 - TypeScript 优先的数据验证
- @hookform/resolvers - Zod 与 React Hook Form 集成

**状态管理与实时通信**
- React Hooks (useState, useCallback, useEffect, useRef) - 本地状态管理
- 自定义 Hooks - 业务逻辑封装
- WebSocket API - 实时双向通信（原生 API，非库）

**可视化与图表**
- Recharts 2.15.4 - React 图表库（系统监控）
- React Flow 11.11.4 - 流程图和关系可视化
- Embla Carousel 8.5.1 - 轮播组件

**HTTP 通信**
- Fetch API - 原生 HTTP 客户端
- 自定义 API 层 (lib/api.ts) - 统一的 API 请求处理

**通知与反馈**
- Sonner 1.7.4 - Toast 通知库
- 自定义 Dialog、Alert、Badge 组件

**开发工具**
- Jest 29.7.0 - 单元测试框架
- React Testing Library 14.1.2 - 组件测试库
- ESLint - 代码质量检查
- Prettier - 代码格式化

**部署**
- Vercel - 自动化部署平台

---

## 二、项目文件结构

```
frontend/v0-aios-database-management/
├── app/                                    # Next.js App Router
│   ├── page.tsx                           # 主页面
│   ├── layout.tsx                         # 根布局
│   ├── api/                               # API Routes
│   ├── task-creation/                     # 任务创建页面
│   ├── task-monitor/                      # 任务监控页面
│   ├── deployment-sites/                  # 部署站点管理
│   ├── spatial-visualization/             # 空间查询可视化
│   ├── wizard/                            # 快速向导
│   ├── xkt-generator/                     # XKT模型生成
│   ├── xkt-viewer/                        # XKT模型查看器
│   ├── collaboration/                     # 协作功能
│   └── users/                             # 用户管理（开发中）
├── components/                            # React 组件库（63个）
│   ├── ui/                               # 基础 UI 组件（20+）
│   ├── task-creation/                    # 任务创建组件
│   ├── task-monitor/                     # 监控仪表板组件
│   ├── deployment-sites/                 # 站点管理组件
│   ├── spatial-query/                    # 空间查询可视化
│   ├── batch-operations/                 # 批量操作
│   ├── collaboration/                    # 协作功能
│   ├── task-history/                     # 任务历史
│   ├── task-logs/                        # 任务日志
│   ├── xkt-generator.tsx                 # XKT生成器
│   ├── xkt-viewer.tsx                    # XKT查看器
│   ├── sidebar.tsx                       # 侧边栏导航
│   └── theme-provider.tsx                # 主题管理
├── hooks/                                 # 自定义 React Hooks（9个）
│   ├── use-task-creation.ts              # 任务创建逻辑
│   ├── use-task-monitor.ts               # 任务监控逻辑
│   ├── use-websocket.ts                  # WebSocket 连接
│   ├── use-create-site-form.ts           # 站点创建表单
│   ├── use-site-operations.ts            # 站点操作
│   ├── use-database-status.ts            # 数据库状态
│   ├── use-task-history.ts               # 任务历史
│   ├── use-task-logs.ts                  # 任务日志
│   └── use-batch-selection.ts            # 批量选择
├── lib/                                   # 工具库和 API 客户端
│   ├── api.ts                            # 基础 API 工具
│   ├── api/
│   │   ├── task-creation.ts              # 任务创建 API
│   │   ├── task-monitor.ts               # 任务监控 API
│   │   ├── collaboration.ts              # 协作 API
│   │   └── collaboration-adapter.ts      # 协作适配器
│   ├── xkt-api.ts                        # XKT 生成 API
│   ├── model-generation-apis.ts          # 模型生成 API
│   ├── parsing-apis.ts                   # 数据解析 API
│   ├── database-status.ts                # 数据库状态
│   ├── env.ts                            # 环境配置
│   └── utils.ts                          # 工具函数
├── types/                                 # TypeScript 类型定义
│   ├── task-creation.ts                  # 任务创建类型
│   ├── task-monitor.ts                   # 任务监控类型
│   ├── task-history.ts                   # 任务历史类型
│   ├── task-logs.ts                      # 任务日志类型
│   └── collaboration.ts                  # 协作类型
├── styles/                                # 全局样式
│   └── globals.css
├── public/                                # 静态资源
├── __tests__/                             # 单元测试
├── docs/                                  # 项目文档（3份）
├── package.json                          # 依赖配置
├── tsconfig.json                         # TypeScript 配置
├── next.config.mjs                       # Next.js 配置
├── tailwind.config.js                    # Tailwind 配置
├── jest.config.js                        # Jest 配置
└── DEVELOPMENT_SETUP.md                  # 开发指南
```

**项目规模统计**
- React 组件：63 个
- 自定义 Hooks：9 个
- API 模块：11 个库文件
- 类型定义：5 个主要文件
- 文档：6 份（README + 技术文档）

---

## 三、核心功能模块清单

### 3.1 任务管理系统

#### A. 任务创建模块
**位置**：`components/task-creation/` + `hooks/use-task-creation.ts` + `lib/api/task-creation.ts`

**功能描述**
- 4 步向导式任务创建流程
- 支持 5 种任务类型（数据解析、模型生成、空间树生成、全量同步、增量同步）
- 实时任务名称验证
- 部署站点选择
- 动态参数配置（根据任务类型显示不同参数）
- 任务预览和资源预估
- 优先级设置（低/普通/高/紧急）

**核心组件**
- `TaskCreationWizard` (components/task-creation/TaskCreationWizard.tsx) - 向导主组件
  - 4 步骤管理：基础信息、站点选择、参数配置、预览确认
  - 实时验证和错误处理
  - 进度指示器
  - 资源预估显示

**依赖的后端 API**
- `GET /api/deployment-sites` - 获取可用部署站点
- `GET /api/task-templates` - 获取任务模板
- `GET /api/task-creation/validate-name?name={name}` - 验证任务名称唯一性
- `POST /api/task-creation/preview` - 预览配置并获取资源预估
- `POST /api/task-creation` - 创建任务

**业务逻辑实现**
- `use-task-creation.ts` Hook：
  - `loadSites()` - 加载部署站点列表
  - `loadTemplates()` - 加载任务模板
  - `validateName(taskName)` - 验证任务名称
  - `previewConfig(formData)` - 预览任务配置
  - `submitTask(formData)` - 提交任务创建

**数据模型**
```typescript
interface TaskCreationFormData {
  taskName: string           // 任务名称
  taskType: TaskType         // 任务类型
  siteId: string             // 部署站点 ID
  priority: TaskPriority     // 优先级
  description: string        // 描述
  parameters: TaskParameters // 任务参数
}

type TaskType =
  | 'DataParsingWizard'
  | 'ModelGeneration'
  | 'SpatialTreeGeneration'
  | 'FullSync'
  | 'IncrementalSync'

interface TaskParameters {
  parseMode?: 'all' | 'dbnum' | 'refno'
  dbnum?: number
  refno?: string
  generateModels?: boolean
  generateMesh?: boolean
  generateSpatialTree?: boolean
  applyBooleanOperation?: boolean
  meshTolRatio?: number
  maxConcurrent?: number
  parallelProcessing?: boolean
}
```

**UI 结构**
- 步骤指示器 (Progress bar)
- 表单卡片
- 验证状态指示（加载、成功、错误）
- 动态表单字段
- 预览面板
- 操作按钮（上一步、下一步、提交）

---

#### B. 任务监控模块
**位置**：`components/task-monitor/` + `hooks/use-task-monitor.ts` + `lib/api/task-monitor.ts`

**功能描述**
- 实时任务状态监控仪表板
- 多标签页设计（任务状态、系统监控、任务队列）
- WebSocket 实时推送
- 轮询备选方案
- 任务操作（启动/停止/暂停）
- 系统资源监控（CPU/内存/磁盘）
- 任务队列可视化
- 实时状态指示器

**核心组件**
- `TaskMonitorDashboard` (components/task-monitor/TaskMonitorDashboard.tsx) - 仪表板主组件
  - WebSocket 连接管理
  - 自动刷新逻辑
  - 标签页管理
  - 错误处理
- `TaskStatusCard` (components/task-monitor/TaskStatusCard.tsx) - 任务状态卡片
  - 任务基本信息
  - 进度条显示
  - 操作按钮
  - 时间统计
- `SystemMetricsPanel` (components/task-monitor/SystemMetricsPanel.tsx) - 系统指标面板
  - 实时图表（Recharts）
  - 资源使用情况
- `TaskQueueMonitor` (components/task-monitor/TaskQueueMonitor.tsx) - 任务队列监控
  - 队列状态分组
  - 任务计数统计
- `RealtimeStatusIndicator` (components/task-monitor/RealtimeStatusIndicator.tsx) - 连接状态指示
  - WebSocket 连接状态显示
  - 最后更新时间
  - 重连按钮

**依赖的后端 API**
- `GET /api/tasks` - 获取所有任务状态
- `GET /api/tasks/{taskId}` - 获取任务详情
- `GET /api/tasks/{taskId}/progress` - 获取任务进度
- `POST /api/tasks/{taskId}/start` - 启动任务
- `POST /api/tasks/{taskId}/stop` - 停止任务
- `POST /api/tasks/{taskId}/pause` - 暂停任务
- `DELETE /api/tasks/{taskId}` - 取消任务
- `GET /api/node-status` - 获取节点状态和系统指标
- `ws://host/ws/tasks/updates` - WebSocket 实时推送

**业务逻辑实现**
- `use-task-monitor.ts` Hook：
  - `refreshData()` - 刷新任务和系统数据
  - `startTask(taskId)` - 启动任务
  - `stopTask(taskId)` - 停止任务
  - `pauseTask(taskId)` - 暂停任务
  - 状态规范化函数（处理时间戳、枚举等）
- `use-websocket.ts` Hook：
  - WebSocket 连接管理
  - 自动重连逻辑（最多 5 次）
  - 消息解析和分发

**数据模型**
```typescript
interface Task {
  id: string
  name: string
  type: TaskType
  status: TaskStatus  // pending|running|paused|completed|failed|cancelled
  progress: number    // 0-100
  startTime?: string
  endTime?: string
  durationMs?: number
  estimatedTime?: number
  priority?: TaskPriority
  parameters?: Record<string, any>
  result?: TaskResult
  error?: string
}

interface SystemMetrics {
  cpu: number        // CPU 使用百分比
  memory: number     // 内存使用百分比
  disk?: number
  network?: number
  uptimeSeconds?: number
  activeTasks?: number
  databaseConnected?: boolean
  surrealdbConnected?: boolean
}
```

**UI 结构**
- 头部状态栏（标题、连接状态指示、刷新按钮）
- 标签页导航（任务状态、系统监控、任务队列）
- 任务卡片列表（任务信息、进度条、操作按钮）
- 系统指标图表（实时折线图）
- 队列监控（分类统计）

---

### 3.2 部署站点管理系统

#### A. 站点创建模块
**位置**：`components/deployment-sites/` + `hooks/use-create-site-form.ts` + `lib/api.ts`

**功能描述**
- 3 步向导式站点创建流程
- 基础信息配置（名称、环境、根目录）
- 项目扫描和选择
- 数据库配置（连接参数、高级选项）
- 文件浏览功能
- 项目自动扫描

**核心组件**
- `EnhancedCreateSiteDialog` (components/deployment-sites/enhanced-create-site-dialog.tsx)
  - 3 步向导对话框
  - 表单状态管理
  - 表单验证
  - 错误显示
- `Step1BasicInfo` (components/deployment-sites/steps/step1-basic-info.tsx)
  - 站点名称输入
  - 环境选择（开发/测试/生产）
  - 描述和根目录
- `Step2SelectProjects` (components/deployment-sites/steps/step2-select-projects.tsx)
  - 项目列表显示
  - 项目多选
  - 扫描目录功能
  - 加载状态
- `Step3DatabaseConfig` (components/deployment-sites/steps/step3-database-config.tsx)
  - 基础数据库字段（数据库类型、NS、数据库名、模块名）
  - 连接配置（IP、端口、用户名、密码）
  - 高级选项（生成模型、网格、空间树、布尔运算等）

**依赖的后端 API**
- `POST /api/deployment-sites` - 创建部署站点
- `GET /api/deployment-sites` - 获取站点列表（支持查询参数）
- `GET /api/deployment-sites/{id}` - 获取站点详情
- `PATCH /api/deployment-sites/{id}` - 更新站点
- `DELETE /api/deployment-sites/{id}` - 删除站点
- `GET /api/file-browser` - 浏览目录结构
- `POST /api/file-browser/scan` - 扫描目录查找项目

**业务逻辑实现**
- `use-create-site-form.ts` Hook：
  - 表单状态管理
  - `handleInputChange()` - 输入字段更新
  - `handleConfigChange()` - 配置字段更新
  - `toggleProjectSelection()` - 项目选择切换
  - `resetForm()` - 表单重置
- `use-site-operations.ts`：
  - `scanDirectory()` - 扫描目录查找项目
  - `submitCreateSite()` - 提交站点创建

**数据模型**
```typescript
interface DeploymentSiteConfigPayload {
  name: string
  manual_db_nums: number[]
  project_name: string
  project_path: string
  project_code: number
  mdb_name: string
  module: string
  db_type: string              // SurrealDB/SQLite
  surreal_ns: number
  db_ip: string
  db_port: string
  db_user: string
  db_password: string
  gen_model: boolean
  gen_mesh: boolean
  gen_spatial_tree: boolean
  apply_boolean_operation: boolean
  mesh_tol_ratio: number
  room_keyword: string
  target_sesno: number | null
}

interface CreateDeploymentSitePayload {
  name: string
  description?: string
  root_directory?: string | null
  selected_projects: string[]
  config: DeploymentSiteConfigPayload
  env?: string | null
  owner?: string | null
  tags?: Record<string, unknown> | null
  notes?: string | null
}
```

---

#### B. 站点管理模块
**位置**：`app/deployment-sites/` + `components/deployment-sites/`

**功能描述**
- 站点列表展示（网格视图/列表视图）
- 站点卡片信息展示
- 站点状态过滤和搜索
- 站点详情模态框
- 站点操作（启动/暂停/删除/编辑）
- 站点统计面板

**核心组件**
- `SiteCard` (components/deployment-sites/site-card.tsx)
  - 站点基本信息展示
  - 状态徽章
  - 操作按钮
  - 点击查看详情
- `SiteDetailModal` (components/deployment-sites/site-detail-modal.tsx)
  - 站点详情显示
  - 运行状态概览
  - 基本信息、数据库配置、项目配置
  - 数据库状态检查
  - 解析状态查询
  - 模型生成状态
- `SiteList` (components/deployment-sites/site-list.tsx)
  - 网格视图/列表视图切换
  - 分页功能
  - 加载状态
- `StatsPanel` (components/deployment-sites/stats-panel.tsx)
  - 总站点数统计
  - 运行中/已暂停/已停止计数
- `FiltersBar` (components/deployment-sites/filters-bar.tsx)
  - 状态过滤
  - 环境过滤
  - 所有者过滤
  - 搜索功能
  - 排序选项

**业务逻辑实现**
- `use-site-operations.ts`：
  - 站点 CRUD 操作
  - 状态更新
  - 删除确认
- `use-database-status.ts`：
  - 检查数据库状态
  - 启动/停止数据库

---

### 3.3 模型和数据处理系统

#### A. XKT 模型生成模块
**位置**：`components/xkt-generator.tsx` + `lib/xkt-api.ts`

**功能描述**
- XKT 格式模型生成
- 数据库号和参考号输入
- 压缩选项
- 生成历史记录
- 文件下载和查看

**核心组件**
- `XKTGenerator` (components/xkt-generator.tsx)
  - 生成 XKT 标签页
    - 数据库号输入（必填）
    - 参考号输入（可选）
    - 压缩开关
    - 生成按钮
  - 历史记录标签页
    - 生成文件列表
    - 文件大小显示
    - 下载和查看按钮
  - 查看器对话框
  - 错误处理和反馈

**依赖的后端 API**
- `POST /api/xkt/generate` - 生成 XKT 文件

**业务逻辑实现**
- 参数验证（数据库号必填）
- 生成状态管理
- 文件大小获取
- 下载链接构建
- 错误处理

**数据模型**
```typescript
interface GenerationParams {
  dbno: string       // 数据库号
  refno: string      // 参考号（可选）
  compress: boolean  // 压缩选项
}

interface XKTFile {
  filename: string
  size: number
  url: string
  dbno: number
  refno?: string
  timestamp: string
}
```

**API 集成**
- `buildXktApiUrl(path)` - 构建 XKT API 地址
- `resolveXktResourceUrl(url)` - 解析资源 URL（支持相对和绝对路径）

---

#### B. 解析任务管理
**位置**：`lib/parsing-apis.ts`

**核心 API**
- `fetchParsingTasks(siteId, params?)` - 获取解析任务列表
- `fetchParsingTaskStatus(siteId)` - 获取解析任务状态

**数据模型**
```typescript
interface ParsingTask {
  id: string
  siteId: string
  projectName: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number
  filesProcessed?: number
  filesTotal?: number
  errorMessage?: string
}
```

---

#### C. 模型生成管理
**位置**：`lib/model-generation-apis.ts`

**核心 API**
- `fetchModelGenerationTasks(siteId, params?)` - 获取模型生成任务列表
- `fetchModelGenerationTaskStatus(siteId)` - 获取模型生成状态
- `fetchTaskDetail(taskId, taskType)` - 获取任务详情
- `retryTask(taskId, taskType)` - 重试失败的任务

**数据模型**
```typescript
interface ModelGenerationTask {
  id: string
  siteId: string
  projectName: string
  taskType: 'model' | 'mesh' | 'spatial_tree'
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number
  outputPath?: string
  fileSize?: number
  errorMessage?: string
}
```

---

### 3.4 空间查询可视化系统

**位置**：`components/spatial-query/` + `app/spatial-visualization/`

**功能描述**
- 参考号输入查询
- 三种可视化模式
  - 简单树形视图
  - 高级树形视图（搜索、过滤、统计）
  - 流程图视图（React Flow）
- 节点层级展示
- 节点类型识别（空间/房间/构件）
- 实时搜索和过滤

**核心组件**
- `SpatialVisualization` - 简单树形视图
- `AdvancedSpatialVisualization` - 高级树形视图
  - 搜索框
  - 类型过滤按钮
  - 展开/折叠控制
  - 统计信息
- `ReactFlowVisualization` - 流程图视图
  - 节点拖拽
  - 缩放平移
  - 小地图导航
  - 自定义节点样式

**依赖的后端 API**
- `GET /api/spatial/query/:refno` - 查询空间节点
- `GET /api/spatial/children/:refno` - 查询子节点
- `GET /api/spatial/node-info/:refno` - 获取节点详细信息

---

### 3.5 快速向导系统

**位置**：`app/wizard/page.tsx`

**功能描述**
- 双模式向导设计
- 快速模式：简化的参数配置，支持批量创建
- 高级模式：完整的向导流程，跳转到专门的高级页面
- 站点选择
- 任务类型多选
- 解析范围配置
- 优先级设置

**集成**
- 快速模式 → 任务监控页面跳转
- 高级模式 → 任务创建向导页面跳转

---

### 3.6 协作功能系统（开发中）

**位置**：`components/collaboration/` + `lib/api/collaboration.ts`

**功能概述**
- 站点选择器
- 同步流程图
- 组织管理
- 协作适配器

**核心模块**
- `collaboration.ts` - 协作 API（253 行）
- `collaboration-adapter.ts` - 协作适配器（466 行）

---

## 四、自定义 Hooks 详细说明

### 1. `use-task-creation.ts` (123 行)
**职责**：任务创建业务逻辑封装

**导出接口**
```typescript
function useTaskCreation() {
  return {
    sites: DeploymentSite[]
    templates: TaskTemplate[]
    loading: boolean
    error: string | null
    loadSites: () => Promise<void>
    loadTemplates: () => Promise<void>
    validateName: (taskName: string) => Promise<{available: boolean}>
    previewConfig: (formData) => Promise<PreviewResult>
    submitTask: (formData) => Promise<TaskCreationResponse>
    setError: (error: string | null) => void
  }
}
```

---

### 2. `use-task-monitor.ts` (>150 行)
**职责**：任务监控状态管理和数据刷新

**导出接口**
```typescript
function useTaskMonitor() {
  return {
    tasks: Task[]
    systemMetrics: SystemMetrics
    isConnected: boolean
    lastUpdate: string
    error: string | null
    refreshData: () => Promise<void>
    startTask: (taskId: string) => Promise<void>
    stopTask: (taskId: string) => Promise<void>
    pauseTask: (taskId: string) => Promise<void>
  }
}
```

**关键功能**
- 状态规范化（处理 Rust 后端的多种时间戳格式）
- 任务操作（启动、停止、暂停）
- 错误处理和重试

---

### 3. `use-websocket.ts` (147 行)
**职责**：WebSocket 连接管理和实时通信

**导出接口**
```typescript
function useWebSocket(url?: string | null) {
  return {
    isConnected: boolean
    lastMessage: any
    error: string | null
    connect: () => void
    disconnect: () => void
    sendMessage: (message: any) => void
  }
}
```

**关键特性**
- 自动重连机制（最多 5 次，延迟 3 秒）
- 协议自动转换（http/https → ws/wss）
- 消息 JSON 解析
- 生命周期管理

---

### 4. `use-create-site-form.ts`
**职责**：站点创建表单状态管理

**导出接口**
- 步骤管理
- 表单数据状态
- 项目列表管理
- 表单操作方法

---

### 5. `use-site-operations.ts`
**职责**：站点操作的 API 封装

**导出接口**
- `scanDirectory()` - 扫描项目目录
- `submitCreateSite()` - 提交站点创建

---

### 6. `use-database-status.ts` (64 行)
**职责**：数据库状态查询和控制

---

### 7. `use-task-history.ts`
**职责**：任务历史管理

---

### 8. `use-task-logs.ts`
**职责**：任务日志获取和展示

---

### 9. `use-batch-selection.ts`
**职责**：批量选择操作

---

## 五、API 层架构

### 5.1 基础 API 工具

**位置**：`lib/api.ts` (165 行)

**核心函数**
- `buildApiUrl(path: string): string` - 构建完整的 API URL
- `handleResponse<T>(response: Response): Promise<T>` - 统一的响应处理
- 数据类型定义和接口

**关键特性**
- 环境配置支持（通过 `NEXT_PUBLIC_API_BASE_URL`）
- 错误消息提取和标准化
- JSON 解析异常处理
- HTTP 状态码检查

---

### 5.2 任务创建 API

**位置**：`lib/api/task-creation.ts` (107 行)

**导出函数**
- `fetchDeploymentSites(): Promise<DeploymentSite[]>` - 获取部署站点
- `fetchTaskTemplates(): Promise<TaskTemplate[]>` - 获取任务模板
- `createTask(request): Promise<TaskCreationResponse>` - 创建任务
- `validateTaskName(name): Promise<{available: boolean}>` - 验证任务名称
- `fetchSiteDetails(siteId)` - 获取站点详情
- `previewTaskConfig(request)` - 预览任务配置

**API 端点**
- GET `/api/deployment-sites`
- GET `/api/task-templates`
- GET `/api/task-creation/validate-name`
- POST `/api/task-creation`
- POST `/api/task-creation/preview`

---

### 5.3 任务监控 API

**位置**：`lib/api/task-monitor.ts` (172 行)

**导出函数**
- `fetchTaskStatus(): Promise<{tasks, systemMetrics, timestamp}>`
- `startTask(taskId): Promise<{success}>`
- `stopTask(taskId): Promise<{success}>`
- `pauseTask(taskId): Promise<{success}>`
- `resumeTask(taskId): Promise<{success}>`
- `cancelTask(taskId): Promise<{success}>`
- `fetchTaskProgress(taskId)`
- `fetchSystemMetrics(): Promise<SystemMetrics>`

**API 端点**
- GET `/api/tasks`
- GET `/api/tasks/{taskId}`
- GET `/api/tasks/{taskId}/progress`
- POST `/api/tasks/{taskId}/start`
- POST `/api/tasks/{taskId}/stop`
- DELETE `/api/tasks/{taskId}`
- GET `/api/node-status`

---

### 5.4 其他专用 API

**解析任务 API** (`lib/parsing-apis.ts`)
- `fetchParsingTasks(siteId, params?)`
- `fetchParsingTaskStatus(siteId)`

**模型生成 API** (`lib/model-generation-apis.ts`)
- `fetchModelGenerationTasks(siteId, params?)`
- `fetchModelGenerationTaskStatus(siteId)`
- `fetchTaskDetail(taskId, taskType)`
- `retryTask(taskId, taskType)`

**XKT API** (`lib/xkt-api.ts`)
- `buildXktApiUrl(path): string`
- `resolveXktResourceUrl(url): string`

**协作 API** (`lib/api/collaboration.ts`)
- 长约 253 行的协作功能 API

---

## 六、主要业务流程

### 6.1 任务创建流程

```
用户访问 /task-creation
  ↓
加载部署站点和模板
  ↓
[步骤 1] 基础信息配置
  - 输入任务名称
  - 实时验证唯一性（API 调用）
  - 选择任务类型
  - 设置优先级
  - 填写描述
  ↓
[步骤 2] 选择部署站点
  - 从列表中选择站点
  - 显示站点信息
  ↓
[步骤 3] 任务参数配置
  - 根据任务类型显示不同参数
  - 数据解析：解析模式、数据库编号、参考号
  - 模型生成：生成选项、网格容差、并发数
  ↓
[步骤 4] 预览和确认
  - 显示配置预览
  - 调用 API 获取资源预估
  - 显示预计时间和资源需求
  ↓
提交任务创建（API 调用）
  ↓
创建成功 → 跳转到任务监控页面
创建失败 → 显示错误，返回到相应步骤
```

### 6.2 任务监控流程

```
用户访问 /task-monitor
  ↓
初始化监控面板
  ↓
尝试建立 WebSocket 连接 (/ws/tasks/updates)
  ↓
[如果 WebSocket 连接成功]
  - 接收实时任务更新
  - 接收系统指标更新
  - 实时刷新 UI
  ↓
[如果 WebSocket 连接失败]
  - 启用轮询模式（每 5 秒刷新）
  - 调用 GET /api/tasks 获取任务列表
  - 调用 GET /api/node-status 获取系统指标
  ↓
用户操作任务
  - 启动任务 → POST /api/tasks/{taskId}/start
  - 停止任务 → POST /api/tasks/{taskId}/stop
  - 暂停任务 → POST /api/tasks/{taskId}/stop（复用）
  ↓
刷新 UI 展示
```

### 6.3 站点创建流程

```
用户点击"创建站点"
  ↓
打开增强版创建对话框
  ↓
[步骤 1] 基础信息
  - 输入站点名称（必填）
  - 选择环境（开发/测试/生产）
  - 输入根目录路径
  - 填写描述
  - 验证并进入下一步
  ↓
[步骤 2] 选择项目
  - 用户点击"扫描目录"
  - 调用 API 扫描指定路径
  - 显示扫描到的项目列表
  - 用户多选项目
  - 至少选择一个项目才能继续
  ↓
[步骤 3] 数据库配置
  - 配置数据库基础字段
  - 配置数据库连接（IP/端口/用户/密码）
  - [可选] 展开高级选项
    - 生成模型
    - 生成网格
    - 生成空间树
    - 应用布尔运算
    - 网格容差比例
    - 房间关键字
    - 目标会话号
  ↓
提交站点创建
  - POST /api/deployment-sites
  - 创建成功 → 关闭对话框，刷新站点列表
  - 创建失败 → 显示错误详情，允许修改
```

---

## 七、需要移植的核心代码

### 7.1 任务创建相关

**需要移植的文件**
- `components/task-creation/TaskCreationWizard.tsx` - 4 步向导主组件
- `hooks/use-task-creation.ts` - 任务创建业务逻辑
- `lib/api/task-creation.ts` - 任务创建 API 调用
- `types/task-creation.ts` - 类型定义
- UI 组件（Button、Card、Select、Input 等）

**移植要点**
1. 将 Radix UI 组件替换为目标框架的组件
2. 保留 React Hook Form + Zod 的表单验证逻辑
3. 保留任务参数动态配置逻辑
4. 适配 API 调用方式

---

### 7.2 任务监控相关

**需要移植的文件**
- `components/task-monitor/TaskMonitorDashboard.tsx` - 监控仪表板
- `components/task-monitor/TaskStatusCard.tsx` - 任务卡片
- `components/task-monitor/SystemMetricsPanel.tsx` - 系统指标
- `hooks/use-task-monitor.ts` - 监控业务逻辑
- `hooks/use-websocket.ts` - WebSocket 管理
- `lib/api/task-monitor.ts` - 监控 API

**移植要点**
1. WebSocket 连接管理逻辑可复用
2. 自动重连机制（5 次，3 秒延迟）可保留
3. 状态规范化逻辑（时间戳处理）必须保留
4. 轮询和 WebSocket 双通道逻辑可保留
5. Recharts 图表组件需替换

---

### 7.3 站点管理相关

**需要移植的文件**
- `components/deployment-sites/enhanced-create-site-dialog.tsx` - 站点创建对话框
- `components/deployment-sites/steps/step1-basic-info.tsx` - 基础信息步骤
- `components/deployment-sites/steps/step2-select-projects.tsx` - 项目选择步骤
- `components/deployment-sites/steps/step3-database-config.tsx` - 数据库配置步骤
- `components/deployment-sites/site-card.tsx` - 站点卡片
- `components/deployment-sites/site-detail-modal.tsx` - 站点详情模态框
- `hooks/use-create-site-form.ts` - 站点表单管理
- `hooks/use-site-operations.ts` - 站点操作

**移植要点**
1. 3 步向导流程保留
2. 表单验证逻辑保留
3. 项目扫描功能（API 调用）保留
4. 数据库配置选项保留

---

### 7.4 数据处理相关

**需要移植的文件**
- `components/xkt-generator.tsx` - XKT 生成器
- `lib/xkt-api.ts` - XKT API 工具
- `lib/parsing-apis.ts` - 解析 API
- `lib/model-generation-apis.ts` - 模型生成 API

**移植要点**
1. XKT 生成参数和调用逻辑保留
2. 文件下载逻辑保留
3. API 调用模式保留

---

### 7.5 空间查询可视化

**需要移植的文件**
- `components/spatial-query/SpatialVisualization.tsx` - 简单树形视图
- `components/spatial-query/AdvancedSpatialVisualization.tsx` - 高级树形视图
- `components/spatial-query/ReactFlowVisualization.tsx` - 流程图视图

**移植要点**
1. 树形结构逻辑保留
2. React Flow 组件需替换或保留（根据目标框架）
3. 搜索和过滤逻辑保留

---

## 八、技术集成要点

### 8.1 API 集成方式

```typescript
// 基础 URL 构建
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? ""
function buildApiUrl(path: string): string {
  if (!API_BASE_URL) return path
  return `${API_BASE_URL}${path}`
}

// 响应处理
async function handleResponse<T>(response: Response): Promise<T> {
  const text = await response.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch (error) {
      throw new Error(`解析响应失败`)
    }
  }

  if (!response.ok) {
    const message = data?.error || response.statusText || "请求失败"
    throw new Error(message)
  }

  return data as T
}

// 使用示例
const response = await fetch(buildApiUrl('/api/tasks'), {
  method: 'GET',
  headers: { 'Accept': 'application/json' }
})
const result = await handleResponse<TaskData>(response)
```

### 8.2 WebSocket 集成方式

```typescript
// 协议自动转换
const target = new URL(url, window.location.origin)
if (target.protocol === "http:") target.protocol = "ws:"
else if (target.protocol === "https:") target.protocol = "wss:"

// 自动重连
const maxReconnectAttempts = 5
const reconnectDelay = 3000
if (reconnectAttempts.current < maxReconnectAttempts) {
  reconnectAttempts.current++
  setTimeout(() => connect(), reconnectDelay)
}

// 消息处理
ws.onmessage = (event) => {
  try {
    const data = JSON.parse(event.data)
    handleMessage(data)
  } catch (error) {
    console.error('Failed to parse WebSocket message:', error)
  }
}
```

### 8.3 表单验证集成

```typescript
// React Hook Form + Zod 组合
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"

const schema = z.object({
  taskName: z.string().min(1, "任务名称不能为空"),
  taskType: z.enum(['DataParsingWizard', 'ModelGeneration', ...]),
  siteId: z.string().min(1, "必须选择站点"),
})

const { register, handleSubmit, formState: { errors } } = useForm({
  resolver: zodResolver(schema)
})

// 实时验证（异步）
const validateName = async (name: string) => {
  const result = await fetch(buildApiUrl(`/api/task-creation/validate-name?name=${name}`))
  return await handleResponse(result)
}
```

### 8.4 状态管理模式

```typescript
// 使用自定义 Hook 封装业务逻辑
export function useTaskCreation() {
  const [sites, setSites] = useState<DeploymentSite[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadSites = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchDeploymentSites()
      setSites(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  return { sites, loading, error, loadSites }
}

// 在组件中使用
export function TaskCreationWizard() {
  const { sites, loading, error, loadSites } = useTaskCreation()

  useEffect(() => {
    loadSites()
  }, [loadSites])

  // 组件逻辑...
}
```

---

## 九、环境配置和启动

### 9.1 环境变量

**`.env.local` 配置**
```
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
NEXT_PUBLIC_XKT_API_BASE_URL=http://localhost:8080
```

### 9.2 启动方式

**方法一：启动脚本（推荐）**
```bash
cd frontend/v0-aios-database-management
./start-dev.sh
```

**方法二：手动启动**
```bash
# 启动 Rust 后端（端口 8080）
cd gen-model
cargo run --bin web_server --features "web_server,ws,gen_model,manifold,project_hd"

# 启动 Next.js 前端（端口 3000）
cd frontend/v0-aios-database-management
pnpm run dev
```

---

## 十、技术债务和改进机会

### 当前限制
1. 暂无认证授权机制
2. 数据库状态控制逻辑不完整
3. 协作功能开发中
4. 用户管理功能开发中
5. 部分错误处理需要增强

### 建议改进
1. 添加基于角色的访问控制（RBAC）
2. 实现任务模板管理系统
3. 添加任务依赖关系支持
4. 实现更详细的性能监控和告警
5. 优化大数据列表渲染（虚拟化）
6. 添加国际化支持

---

## 十一、核心代码统计

| 分类 | 数量 | 说明 |
|------|------|------|
| React 组件 | 63 | 包括 UI 基础组件和业务组件 |
| 自定义 Hooks | 9 | 业务逻辑封装 |
| API 模块 | 11 | 包括基础 API 和专用 API |
| 类型定义文件 | 5 | TypeScript 类型系统 |
| 页面路由 | 12+ | Next.js 页面 |
| 文档 | 6+ | 包括技术文档和指南 |

---

## 十二、移植建议

### 优先级 1（核心功能）
1. 任务创建向导（TaskCreationWizard）
2. 任务监控仪表板（TaskMonitorDashboard）
3. WebSocket 管理（use-websocket）
4. 基础 API 层

### 优先级 2（重要功能）
5. 站点管理（创建、列表、详情）
6. XKT 模型生成
7. 快速向导

### 优先级 3（增强功能）
8. 空间查询可视化
9. 任务历史和日志
10. 协作功能

### 技术替换清单
| 原技术 | 建议替换 | 注意事项 |
|--------|----------|---------|
| Radix UI | 目标框架 UI 库 | 保留组件逻辑 |
| Tailwind CSS | 目标框架 CSS 方案 | 保留响应式设计 |
| Recharts | 目标框架图表库 | 保留数据绑定逻辑 |
| React Flow | 目标框架流程图库 | 或继续使用 React Flow |
| Zod | 目标框架验证库 | 保留验证规则 |

---

## 十三、关键文件速查表

| 功能 | 核心文件 | 行数 | 重要程度 |
|------|---------|------|---------|
| 任务创建向导 | TaskCreationWizard.tsx | 400+ | ★★★ |
| 任务监控 | TaskMonitorDashboard.tsx | 150+ | ★★★ |
| 站点创建 | enhanced-create-site-dialog.tsx | 200+ | ★★★ |
| 任务创建逻辑 | use-task-creation.ts | 123 | ★★★ |
| 任务监控逻辑 | use-task-monitor.ts | 150+ | ★★★ |
| WebSocket 管理 | use-websocket.ts | 147 | ★★★ |
| 基础 API | api.ts | 165 | ★★★ |
| 任务创建 API | api/task-creation.ts | 107 | ★★★ |
| 任务监控 API | api/task-monitor.ts | 172 | ★★★ |
| XKT 生成 | xkt-generator.tsx | 300+ | ★★ |
| 空间可视化 | SpatialVisualization.tsx | 200+ | ★★ |
| 协作功能 | collaboration.ts | 253 | ★ |

---

## 总结

`v0-aios-database-management` 是一个功能完整、架构清晰的现代化前端应用。其核心价值在于：

1. **模块化设计**：63 个组件清晰分工，易于维护和扩展
2. **完善的业务逻辑**：9 个自定义 Hook 封装复杂业务
3. **可靠的实时通信**：WebSocket + 轮询双通道，自动重连机制
4. **灵活的 API 层**：统一的 API 调用方式，易于集成不同后端
5. **丰富的功能**：任务管理、站点管理、模型生成、空间可视化等

在移植到 Vue.js 项目时，可以保留核心业务逻辑和 API 集成方式，仅需替换 UI 组件和框架特定的代码。优先移植任务创建、任务监控和站点管理模块，这些是系统的核心功能。
