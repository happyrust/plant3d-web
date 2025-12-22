# 后端 API 结构和 SurrealDB 集成模式调查报告

## 概述

本报告深入调查 plant3d-web 项目的后端 API 架构、环境配置、类型定义和 WebSocket 通知机制。项目基于 Vue 3 + TypeScript 前端架构，后端通过 HTTP RESTful API 和 WebSocket 实现通信。

---

## 代码文件清单

### API 模块文件

- `src/api/genModelTaskApi.ts` (taskCreate, taskGetList, taskStart, taskStop, getTaskWebSocketUrl): 任务管理 API 的核心实现，包括任务 CRUD、状态变更和 WebSocket URL 生成
- `src/api/genModelPdmsAttrApi.ts` (pdmsGetPtset, pdmsGetUiAttr, PtsetResponse): PDMS 属性数据 API，用于获取连接点数据
- `src/api/genModelE3dApi.ts` (e3dGetNode, e3dGetChildren, e3dSearch, TreeNodeDto): E3D 树形结构 API
- `src/api/genModelSpatialApi.ts` (querySpatialIndex, SpatialQueryParams): 空间查询 API
- `src/api/genModelRoomTreeApi.ts` (roomTreeGetRoot, roomTreeGetChildren, roomTreeSearch): 房间树形结构 API

### 类型定义文件

- `src/types/task.ts` (Task, TaskStatus, TaskType, TaskCreationRequest, SystemMetrics): 任务相关类型定义，支持 3 种任务类型和 5 种状态
- `src/types/spec.ts`: 规范定义文件
- `src/types/auth.ts`: 认证相关类型

### 业务逻辑层

- `src/composables/useTaskCreation.ts` (useTaskCreation, TaskCreationFormData): 任务创建表单管理和验证逻辑
- `src/composables/useTaskMonitor.ts` (useTaskMonitor, UseTaskMonitorReturn): 任务监控和 WebSocket 连接管理
- `src/composables/useTaskCreationStore.ts`: 任务创建状态存储
- `src/composables/useWebSocket.ts` (useWebSocket, UseWebSocketReturn): 通用 WebSocket 连接管理

### 配置文件

- `vite.config.ts`: Vite 开发服务器配置，包括 API 代理设置
- `package.json`: 项目依赖声明

---

## 报告内容

### 一、API 调用通用模式

#### 1.1 基础 URL 构建

**文件**: `src/api/genModelTaskApi.ts`（行 17-22）

```typescript
function getBaseUrl(): string {
  const envBase = (import.meta.env as unknown as { VITE_GEN_MODEL_API_BASE_URL?: string })
    .VITE_GEN_MODEL_API_BASE_URL;
  return (envBase && envBase.trim()) || 'http://localhost:8080';
}
```

**关键点**：
- 从 Vite 环境变量 `VITE_GEN_MODEL_API_BASE_URL` 读取后端地址
- 默认值为 `http://localhost:8080`（开发环境）
- 所有 API 模块统一使用此函数获取基础 URL

#### 1.2 HTTP 请求通用函数

**文件**: `src/api/genModelTaskApi.ts`（行 24-42）

```typescript
async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getBaseUrl().replace(/\/$/, '');
  const url = `${base}${path.startsWith('/') ? '' : '/'}${path}`;

  const resp = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${text}`);
  }

  return (await resp.json()) as T;
}
```

**通用特性**：
- 泛型支持 `fetchJson<T>`，返回 `Promise<T>`
- 自动添加 `Content-Type: application/json` 头
- 自动处理 URL 路径拼接（去除 trailing slash）
- 统一错误处理：非 2xx 状态码抛出异常
- 所有 API 模块采用相同模式

#### 1.3 API 端点设计示例

**例1：任务查询** (genModelTaskApi.ts 行 79-89)
```typescript
export async function taskGetList(options?: {
  status?: Task['status'];
  limit?: number;
}): Promise<TaskListResponse> {
  let path = '/api/tasks';
  const params = new URLSearchParams();
  if (options?.status) params.set('status', options.status);
  if (options?.limit) params.set('limit', String(options.limit));
  if (params.toString()) path += `?${params.toString()}`;
  return await fetchJson<TaskListResponse>(path);
}
```

**例2：任务创建** (genModelTaskApi.ts 行 169-174)
```typescript
export async function taskCreate(request: TaskCreationRequest): Promise<TaskCreationResponse> {
  return await fetchJson<TaskCreationResponse>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}
```

**例3：PDMS 数据查询** (genModelPdmsAttrApi.ts 行 85-87)
```typescript
export async function pdmsGetPtset(refno: string): Promise<PtsetResponse> {
  return await fetchJson<PtsetResponse>(`/api/pdms/ptset/${encodeURIComponent(refno)}`);
}
```

---

### 二、环境变量配置

#### 2.1 Vite 环境变量使用

**文件**: `vite.config.ts`（行 20-24）和所有 API 文件

**开发环境代理配置**:
```typescript
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:8080',
      changeOrigin: true,
    },
    '/files': {
      target: 'http://localhost:8080',
      changeOrigin: true,
    },
  },
}
```

**环境变量说明**：
- `VITE_GEN_MODEL_API_BASE_URL`: 生成模型后端 API 基础 URL
- Vite 会在构建时注入环境变量到 `import.meta.env`
- 前缀 `VITE_` 使变量暴露给客户端代码

#### 2.2 环境配置方式

**配置途径**:
1. `.env` 文件（全局）
2. `.env.local` 文件（本地，不提交）
3. `.env.[mode]` 文件（特定模式，如 production）
4. 命令行环境变量

**示例配置流程**:
```bash
# 开发环境（默认）
VITE_GEN_MODEL_API_BASE_URL=http://localhost:8080

# 生产环境
VITE_GEN_MODEL_API_BASE_URL=https://api.example.com
```

---

### 三、错误处理方式

#### 3.1 HTTP 层错误处理

**文件**: `src/api/genModelTaskApi.ts`（行 36-39）

**模式**：
- 检查 `response.ok` 状态
- 非成功状态提取错误文本并抛出 `Error`
- 格式：`HTTP {status} {statusText}: {body}`

#### 3.2 业务逻辑层错误处理

**文件**: `src/composables/useTaskCreation.ts`（行 379-407）

```typescript
async function submitTask(): Promise<boolean> {
  loading.value = true;
  submitError.value = null;
  createdTaskId.value = null;

  try {
    const request = buildRequest();
    const response = await taskCreate(request);

    if (response.success && response.taskId) {
      createdTaskId.value = response.taskId;
      return true;
    } else {
      submitError.value = response.error_message || response.message || '创建任务失败';
      return false;
    }
  } catch (e) {
    submitError.value = `创建任务失败: ${e instanceof Error ? e.message : String(e)}`;
    return false;
  } finally {
    loading.value = false;
  }
}
```

**关键特性**：
- 区分 HTTP 错误和业务逻辑错误
- 通过 `response.success` 判断业务是否成功
- 统一的错误信息管理到 `ref<string | null>` 状态
- 错误消息优先级：`error_message` > `message` > 默认消息

#### 3.3 WebSocket 错误处理

**文件**: `src/composables/useWebSocket.ts`（行 149-170）

```typescript
ws.onerror = (event: Event) => {
  status.value = 'error';
  error.value = 'WebSocket 连接错误';
  opts.onError(event);
};

ws.onclose = () => {
  status.value = 'disconnected';
  isConnected.value = false;
  ws = null;
  opts.onDisconnected();

  // 自动重连逻辑
  if (opts.autoReconnect && reconnectCount.value < opts.maxReconnectAttempts) {
    reconnectCount.value++;
    error.value = `连接断开，${opts.reconnectDelay / 1000}秒后重试 (${reconnectCount.value}/${opts.maxReconnectAttempts})`;
    reconnectTimer = setTimeout(() => {
      connect();
    }, opts.reconnectDelay);
  }
};
```

**容错机制**：
- 自动重连机制（最多 5 次）
- 重连延迟 3000ms
- 详细的错误/恢复信息

---

### 四、类型定义方式

#### 4.1 任务类型系统

**文件**: `src/types/task.ts`

**任务类型枚举** (行 9-12):
```typescript
export type TaskType =
  | 'DataParsingWizard'  // 数据解析任务
  | 'DataGeneration'     // 模型生成任务
  | 'ModelExport';       // 导出模型任务
```

**任务状态枚举** (行 23-28):
```typescript
export type TaskStatus =
  | 'pending'     // 等待中
  | 'running'     // 运行中
  | 'completed'   // 已完成
  | 'failed'      // 失败
  | 'cancelled';  // 已取消
```

**优先级定义** (行 31):
```typescript
export type TaskPriority = 'low' | 'normal' | 'high' | 'critical';
```

#### 4.2 任务参数多态设计

**文件**: `src/types/task.ts`（行 35-61）

```typescript
// 解析任务参数
export type ParseTaskParameters = {
  parseMode: 'all' | 'dbnum' | 'refno';
  dbnum?: number;
  refno?: string;
};

// 模型生成任务参数
export type ModelGenParameters = {
  generateModels: boolean;
  generateMesh: boolean;
  generateSpatialTree: boolean;
  applyBooleanOperation: boolean;
  meshTolRatio: number;
  maxConcurrent?: number;
  exportWebBundle?: boolean;  // 导出 Web 数据包
};

// 导出模型任务参数
export type ModelExportParameters = {
  refno: string;           // 参考号
  regenModel: boolean;     // 是否重新生成
  exportObj: boolean;      // 是否导出OBJ
};

// 任务参数联合类型
export type TaskParameters = ParseTaskParameters | ModelGenParameters | ModelExportParameters;
```

**特点**：
- 使用 TypeScript 联合类型实现参数多态
- 不同任务类型对应不同的参数结构
- 通过 `task_type` 字段区分参数类型

#### 4.3 API 请求/响应类型

**文件**: `src/types/task.ts`（行 115-154）

**请求类型** (行 115-121):
```typescript
export type TaskCreationRequest = {
  name: string;
  task_type: TaskType;
  priority: TaskPriority;
  description?: string;
  parameters: TaskParameters;
};
```

**响应类型** (行 124-130):
```typescript
export type TaskCreationResponse = {
  success: boolean;
  taskId?: string;
  task?: Task;
  message?: string;
  error_message?: string;
};
```

**通用响应模式**：
- `success: boolean` 表示业务逻辑成功/失败
- `error_message` 包含错误详情
- 可选的 `task` 或 `taskId` 返回创建的任务

#### 4.4 系统指标类型

**文件**: `src/types/task.ts`（行 105-110）

```typescript
export type SystemMetrics = {
  cpuUsage: number;           // CPU 使用率 0-100
  memoryUsage: number;        // 内存使用率 0-100
  activeTaskCount: number;    // 活跃任务数
  queuedTaskCount: number;    // 队列中的任务数
};
```

---

### 五、WebSocket 通知机制

#### 5.1 WebSocket 端点和 URL 生成

**文件**: `src/api/genModelTaskApi.ts`（行 272-298）

```typescript
export function getTaskWebSocketUrl(): string {
  const base = getBaseUrl();
  if (!base) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws/tasks`;
  }

  const wsBase = base.replace(/^http/, 'ws');
  return `${wsBase}/ws/tasks`;
}

export function getTaskProgressWebSocketUrl(taskId: string): string {
  const base = getBaseUrl();
  if (!base) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws/progress/${encodeURIComponent(taskId)}`;
  }

  const wsBase = base.replace(/^http/, 'ws');
  return `${wsBase}/ws/progress/${encodeURIComponent(taskId)}`;
}
```

**关键特性**：
- `/ws/tasks` - 任务流通知通道
- `/ws/progress/{taskId}` - 单个任务进度通知通道
- 自动 HTTP ↔ WebSocket 协议转换
- 支持 HTTPS ↔ WSS 转换

#### 5.2 WebSocket 消息类型

**文件**: `src/types/task.ts`（行 166-178）

```typescript
export type WebSocketMessageType =
  | 'task_update'      // 任务状态更新
  | 'task_progress'    // 任务进度更新
  | 'system_metrics'   // 系统指标更新
  | 'task_completed'   // 任务完成
  | 'task_failed';     // 任务失败

export type WebSocketMessage = {
  type: WebSocketMessageType;
  data: Task | SystemMetrics | { taskId: string; progress: number };
  timestamp: string;
};
```

#### 5.3 WebSocket 连接管理

**文件**: `src/composables/useWebSocket.ts`

**配置选项** (行 6-21):
```typescript
export type UseWebSocketOptions = {
  autoReconnect?: boolean;              // 自动重连
  maxReconnectAttempts?: number;        // 最大重连次数
  reconnectDelay?: number;              // 重连延迟（毫秒）
  onConnected?: () => void;             // 连接成功回调
  onDisconnected?: () => void;          // 断开连接回调
  onMessage?: (data: unknown) => void;  // 收到消息回调
  onError?: (error: Event) => void;     // 错误回调
};
```

**默认配置** (行 44-52):
```typescript
const DEFAULT_OPTIONS: Required<UseWebSocketOptions> = {
  autoReconnect: true,
  maxReconnectAttempts: 5,
  reconnectDelay: 3000,
  onConnected: () => {},
  onDisconnected: () => {},
  onMessage: () => {},
  onError: () => {},
};
```

#### 5.4 任务监控与 WebSocket 集成

**文件**: `src/composables/useTaskMonitor.ts`（行 120-130）

```typescript
watch(lastMessage, (message) => {
  if (!message) return;
  handleWebSocketMessage(message as WebSocketMessage);
});

function handleWebSocketMessage(message: WebSocketMessage): void {
  lastUpdateTime.value = message.timestamp || new Date().toISOString();

  switch (message.type) {
    case 'task_update':
    case 'task_completed':
    case 'task_failed': {
      const updatedTask = normalizeTask(message.data as Record<string, unknown>);
      const index = tasks.value.findIndex((t) => t.id === updatedTask.id);
      if (index >= 0) {
        tasks.value[index] = updatedTask;
      } else {
        tasks.value.push(updatedTask);
      }
      break;
    }
    // ... 其他消息类型处理
  }
}
```

**特点**：
- 使用 Vue watch 监听 WebSocket 消息
- 自动更新本地任务列表状态
- 支持实时进度更新
- 支持系统指标推送

#### 5.5 轮询作为备选机制

**文件**: `src/composables/useTaskMonitor.ts`（行 245-259）

```typescript
function startPolling(): void {
  if (opts.pollingInterval <= 0) return;
  if (pollingTimer) return;

  pollingTimer = setInterval(() => {
    refresh();
  }, opts.pollingInterval);
}

// WebSocket 连接失败时启动轮询
onConnected: () => {
  error.value = null;
  if (pollingTimer) {
    stopPolling();
  }
},
onDisconnected: () => {
  if (opts.pollingInterval > 0 && !pollingTimer) {
    startPolling();
  }
},
```

**设计**：
- 默认轮询间隔：5000ms
- WebSocket 连接成功时停止轮询
- WebSocket 断开时自动启动轮询作为备选
- 保证数据更新的连续性

---

### 六、现有任务相关 API 调用

**文件**: `src/api/genModelTaskApi.ts`

#### 6.1 查询类 API

| API 函数 | HTTP 方法 | 端点 | 功能 |
|---------|----------|------|------|
| `taskGetList()` | GET | `/api/tasks` | 获取任务列表，支持 status、limit 筛选 |
| `taskGetById()` | GET | `/api/tasks/{taskId}` | 获取单个任务详情 |
| `taskGetError()` | GET | `/api/tasks/{taskId}/error` | 获取任务错误详情 |
| `taskGetLogs()` | GET | `/api/tasks/{taskId}/logs` | 获取任务日志，支持 level、search 筛选 |
| `taskGetSystemMetrics()` | GET | `/api/status` | 获取系统指标（CPU、内存、活跃任务数） |
| `taskGetNodeStatus()` | GET | `/api/node-status` | 获取节点状态（LiteFS 复制状态） |

#### 6.2 创建类 API

| API 函数 | HTTP 方法 | 端点 | 功能 |
|---------|----------|------|------|
| `taskCreate()` | POST | `/api/tasks` | 创建单个任务 |
| `taskCreateBatch()` | POST | `/api/tasks/batch` | 批量创建任务 |
| `taskValidateName()` | GET | `/api/task-creation/validate-name` | 验证任务名称是否可用 |
| `taskPreviewConfig()` | POST | `/api/task-creation/preview` | 预览任务配置和资源需求 |

#### 6.3 操作类 API

| API 函数 | HTTP 方法 | 端点 | 功能 |
|---------|----------|------|------|
| `taskStart()` | POST | `/api/tasks/{taskId}/start` | 启动任务（Pending → Running） |
| `taskStop()` | POST | `/api/tasks/{taskId}/stop` | 停止任务（Running → Cancelled） |
| `taskRestart()` | POST | `/api/tasks/{taskId}/restart` | 重启失败的任务 |
| `taskDelete()` | DELETE | `/api/tasks/{taskId}` | 删除任务 |
| `taskDownloadExport()` | GET | `/api/tasks/{taskId}/download` | 下载导出文件 |

#### 6.4 API 特殊处理

**数据规范化** (genModelTaskApi.ts 行 305-380):
```typescript
export function normalizeTask(raw: Record<string, unknown>): Task {
  return {
    id: String(raw.id || raw.task_id || ''),
    name: String(raw.name || raw.task_name || ''),
    type: normalizeTaskType(raw.type || raw.task_type),
    status: normalizeTaskStatus(raw.status),
    // ...
  };
}
```

**处理后端不一致的字段名**：
- `id` ↔ `task_id`
- `name` ↔ `task_name`
- `type` ↔ `task_type`
- `startTime` ↔ `start_time`

**时间戳规范化** (行 359-380):
- 支持秒级和毫秒级 Unix 时间戳
- 自动转换为 ISO 8601 格式

---

### 七、其他 API 模块

#### 7.1 PDMS 属性 API

**文件**: `src/api/genModelPdmsAttrApi.ts`

**主要函数**：
- `pdmsGetUiAttr(refno)` - 获取 UI 属性数据
- `pdmsGetPtset(refno)` - 获取连接点（Point Set）数据

**关键类型**:
```typescript
export interface PtsetResponse {
  success: boolean;
  refno: string;
  ptset: PtsetPoint[];
  world_transform: number[][] | null;  // 4x4 变换矩阵
  unit_info?: { source_unit; target_unit; conversion_factor };
  error_message?: string | null;
}
```

#### 7.2 E3D 树形 API

**文件**: `src/api/genModelE3dApi.ts`

**主要函数**：
- `e3dGetWorldRoot()` - 获取世界根节点
- `e3dGetNode(refno)` - 获取指定节点
- `e3dGetChildren(refno, limit?)` - 获取子节点
- `e3dGetAncestors(refno)` - 获取祖先节点
- `e3dGetSubtreeRefnos(refno, params)` - 获取子树所有参考号
- `e3dSearch(req)` - 搜索节点

#### 7.3 空间查询 API

**文件**: `src/api/genModelSpatialApi.ts`

**主要函数**：
- `querySpatialIndex(params)` - 空间索引查询

**参数类型**:
```typescript
export type SpatialQueryParams = {
  mode?: 'bbox' | 'refno';
  refno?: string;
  distance?: number;
  minx?: number; miny?: number; minz?: number;
  maxx?: number; maxy?: number; maxz?: number;
};
```

#### 7.4 房间树 API

**文件**: `src/api/genModelRoomTreeApi.ts`

**主要函数**：
- `roomTreeGetRoot()` - 获取房间树根节点
- `roomTreeGetChildren(id, limit?)` - 获取子节点
- `roomTreeGetAncestors(id)` - 获取祖先节点
- `roomTreeSearch(req)` - 搜索房间

---

### 八、Composable 层设计

#### 8.1 任务创建 Composable

**文件**: `src/composables/useTaskCreation.ts`

**职责**：
- 管理多步骤表单状态（3 个步骤）
- 实时验证表单数据
- 异步名称唯一性检验
- 参数类型转换和请求构建
- 错误管理

**关键状态**:
```typescript
export type UseTaskCreationReturn = {
  currentStep: Ref<number>;
  formData: TaskCreationFormData;
  errors: Ref<ValidationErrors>;
  loading: Ref<boolean>;
  validatingName: Ref<boolean>;
  nameAvailable: Ref<boolean | null>;
  submitError: Ref<string | null>;
  createdTaskId: Ref<string | null>;
  stepProcessing: Ref<boolean>;
  // ... 计算属性和方法
};
```

#### 8.2 任务监控 Composable

**文件**: `src/composables/useTaskMonitor.ts`

**职责**：
- 管理任务列表和系统指标
- WebSocket 连接和消息处理
- 轮询作为备选机制
- 任务操作（启动、停止、重启、删除）
- 数据刷新和实时更新

**混合式数据更新**:
```
    ┌─── WebSocket /ws/tasks
    │    (实时推送)
    ├─── 轮询 GET /api/tasks
    │    (备选，5s 间隔)
    └─── 任务操作后刷新
         (确保最新状态)
```

---

### 九、SurrealDB 集成现状

**调查结果**：
项目前端代码中**没有直接的 SurrealDB 连接代码**。所有数据库操作均通过后端 RESTful API 进行。

**架构**:
```
前端 (Vue 3 + TypeScript)
  ↓ HTTP/WebSocket
后端 (Rust + Axum)
  ↓ 数据库驱动
SurrealDB / SQLite
```

**后端数据库交互**:
- 由 Rust 后端负责数据库连接和查询
- 前端通过 API 间接访问数据库
- 前端无需知道 SurrealDB 的具体实现细节

---

### 十、关键工程实践

#### 10.1 环境隔离

- Vite 环境变量 + 代理服务器实现开发环境隔离
- 构建时注入生产环境 URL
- 支持多环境部署

#### 10.2 类型安全

- 完整的 TypeScript 类型定义覆盖所有 API 请求/响应
- 泛型函数 `fetchJson<T>` 支持类型推导
- 联合类型支持多态参数

#### 10.3 容错机制

- WebSocket 自动重连（5 次，3s 延迟）
- 轮询作为备选机制
- HTTP 错误自动捕获和报告
- 业务逻辑错误通过 `success` 字段区分

#### 10.4 状态管理

- Vue 3 Composition API + ref/reactive
- Composable 封装业务逻辑
- 清晰的数据流：UI → Composable → API
- 状态和操作方法共同导出

---

## 总结

### 核心发现

1. **API 设计统一**: 所有模块使用相同的 `fetchJson` 通用函数，简化 API 调用逻辑

2. **环境配置灵活**: 支持 Vite 环境变量和代理配置，开发/生产环境无缝切换

3. **WebSocket 双通道**:
   - `/ws/tasks` - 全局任务更新推送
   - `/ws/progress/{taskId}` - 单任务进度推送

4. **容错设计周密**:
   - WebSocket 断开时自动轮询
   - 完善的重连机制
   - 前端无单点故障

5. **类型定义完整**: 所有 API 请求/响应都有明确的 TypeScript 类型

6. **SurrealDB 透明化**: 前端完全解耦 SurrealDB，通过后端 API 交互

### 扩展建议

1. **新 API 添加**: 遵循 `fetchJson<T>(path, init)` 通用模式，返回类型化响应

2. **新任务类型**: 在 `TaskType` 和相应的 `TaskParameters` 中扩展

3. **WebSocket 消息**: 在 `WebSocketMessageType` 中新增消息类型，并在 `handleWebSocketMessage` 中处理

4. **环境变量**: 添加 `VITE_` 前缀，在 API 基础 URL 构建中引用

---

## 文件导航速查

| 需求 | 相关文件 |
|------|--------|
| API 调用方法 | `src/api/*.ts` |
| 类型定义 | `src/types/task.ts` |
| 环境配置 | `vite.config.ts`, `.env.local` |
| 任务创建逻辑 | `src/composables/useTaskCreation.ts` |
| 任务监控 | `src/composables/useTaskMonitor.ts` |
| WebSocket | `src/composables/useWebSocket.ts` |
| HTTP 错误处理 | `src/api/genModelTaskApi.ts` 中的 `fetchJson` |
| 业务逻辑错误处理 | 各 Composable 中的 try-catch |
