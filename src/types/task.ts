// 任务管理类型定义
// 基于后端 Rust/Axum 实现
// 后端支持的任务状态: Pending, Running, Completed, Failed, Cancelled
// 注意：后端不支持 Paused 状态

// ============ 任务类型枚举 ============

/** 任务类型 */
export type TaskType =
  | 'DataParsingWizard'  // 数据解析任务 (原 DataParsing)
  | 'DataGeneration'     // 模型生成任务 (原 ModelGeneration)
  | 'ModelExport';       // 导出模型任务

/**
 * 任务状态
 * 后端支持的状态转换:
 * - Pending -> Running (启动任务)
 * - Running -> Completed (任务成功完成)
 * - Running -> Failed (任务执行失败)
 * - Running -> Cancelled (停止任务)
 * - Pending -> Cancelled (取消等待中的任务)
 */
export type TaskStatus =
  | 'pending'     // 等待中
  | 'running'     // 运行中
  | 'completed'   // 已完成
  | 'failed'      // 失败
  | 'cancelled';  // 已取消

/** 任务优先级 */
export type TaskPriority = 'low' | 'normal' | 'high' | 'critical';

// ============ 任务参数 ============

/** 解析任务参数 */
export type ParseTaskParameters = {
  parseMode: 'all' | 'dbnum' | 'refno';
  dbnum?: number;
  refno?: string;
};

/** 模型生成任务参数 */
export type ModelGenParameters = {
  generateModels: boolean;
  generateMesh: boolean;
  generateSpatialTree: boolean;
  applyBooleanOperation: boolean;
  meshTolRatio: number;
  maxConcurrent?: number;
  exportWebBundle?: boolean;  // 导出 Web 数据包（默认开启）
};

/** 导出模型任务参数 */
export type ModelExportParameters = {
  refno: string;           // 参考号，如 "17496_106028"
  regenModel: boolean;     // 是否重新生成模型 (--regen-model)
  exportObj: boolean;      // 是否导出OBJ (--export-obj)
};

/** 任务参数联合类型 */
export type TaskParameters = ParseTaskParameters | ModelGenParameters | ModelExportParameters;

// ============ 任务实体 ============

/** 任务实体 */
export type Task = {
  id: string;
  name: string;
  type: TaskType;
  status: TaskStatus;
  progress: number;           // 0-100
  startTime?: string;
  endTime?: string;
  durationMs?: number;
  estimatedTimeMs?: number;
  priority: TaskPriority;
  parameters?: TaskParameters;
  result?: TaskResult;
  error?: string;
  metadata?: Record<string, any>;
};

/** 任务执行结果 */
export type TaskResult = {
  success: boolean;
  message?: string;
  data?: Record<string, unknown>;
  metrics?: TaskMetrics;
};

/** 任务执行指标 */
export type TaskMetrics = {
  recordsProcessed: number;
  processingTimeMs: number;
  memoryUsageMb: number;
  cpuUsagePercent: number;
};

// ============ 系统指标 ============

/**
 * 系统指标
 * 后端 GET /api/status 返回: cpu_usage, memory_usage, active_task_count
 */
export type SystemMetrics = {
  cpuUsage: number;           // CPU 使用率 0-100
  memoryUsage: number;        // 内存使用率 0-100
  activeTaskCount: number;    // 活跃任务数
  queuedTaskCount: number;    // 队列中的任务数
};

// ============ 任务创建 ============

/** 任务创建请求 */
export type TaskCreationRequest = {
  name: string;
  task_type: TaskType;
  priority: TaskPriority;
  description?: string;
  parameters: TaskParameters;
};

/** 任务创建响应 */
export type TaskCreationResponse = {
  success: boolean;
  taskId?: string;
  task?: Task;
  message?: string;
  error_message?: string;
};

// ============ API 响应类型 ============

/** 任务列表响应 */
export type TaskListResponse = {
  success: boolean;
  tasks: Task[];
  error_message?: string;
};

/** 单个任务响应 */
export type TaskResponse = {
  success: boolean;
  task?: Task;
  error_message?: string;
};

/** 任务操作响应 */
export type TaskActionResponse = {
  success: boolean;
  message?: string;
  task?: Task;  // 部分操作会返回更新后的任务
  error_message?: string;
};

/** 系统指标响应 */
export type SystemMetricsResponse = {
  success: boolean;
  metrics?: SystemMetrics;
  error_message?: string;
};

// ============ WebSocket 消息 ============

/** WebSocket 消息类型 */
export type WebSocketMessageType =
  | 'task_update'      // 任务状态更新
  | 'task_progress'    // 任务进度更新
  | 'system_metrics'   // 系统指标更新
  | 'task_completed'   // 任务完成
  | 'task_failed';     // 任务失败

/** WebSocket 消息 */
export type WebSocketMessage = {
  type: WebSocketMessageType;
  data: Task | SystemMetrics | { taskId: string; progress: number };
  timestamp: string;
};

// ============ 辅助函数 ============

/** 获取任务类型显示名称 */
export function getTaskTypeDisplayName(type: TaskType): string {
  const typeNames: Record<TaskType, string> = {
    DataParsingWizard: '数据解析',
    DataGeneration: '模型生成',
    ModelExport: '导出模型',
  };
  return typeNames[type] || type;
}

/** 获取任务状态显示信息 */
export function getTaskStatusDisplay(status: TaskStatus): { label: string; color: string } {
  const statusMap: Record<TaskStatus, { label: string; color: string }> = {
    pending: { label: '等待中', color: 'grey' },
    running: { label: '运行中', color: 'blue' },
    completed: { label: '已完成', color: 'green' },
    failed: { label: '失败', color: 'red' },
    cancelled: { label: '已取消', color: 'grey' },
  };
  return statusMap[status] || { label: status, color: 'grey' };
}

/** 获取优先级显示信息 */
export function getPriorityDisplay(priority: TaskPriority): { label: string; color: string } {
  const priorityMap: Record<TaskPriority, { label: string; color: string }> = {
    low: { label: '低', color: 'grey' },
    normal: { label: '普通', color: 'blue' },
    high: { label: '高', color: 'orange' },
    critical: { label: '紧急', color: 'red' },
  };
  return priorityMap[priority] || { label: priority, color: 'grey' };
}

/** 格式化持续时间 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}分${remainingSeconds}秒`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}小时${remainingMinutes}分`;
}
